// Copyright (c) 2016 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

var assert = require('assert');
var process = require('process');
var version = require('./package.json').version;

/*global global*/
if (typeof global.tchannelVersion === 'string' &&
    version !== global.tchannelVersion
) {
    assert(false,
        'Must use only a single version of tchannel.\n' +
        'Found two versions: ' + version + ' and ' +
            global.tchannelVersion + '\n'
    );
} else {
    global.tchannelVersion = version;
}

var extend = require('xtend');
var globalTimers = extend(require('timers'), {
    now: Date.now
});
var setImmediate = require('timers').setImmediate;
var globalRandom = Math.random;
var net = require('net');
var format = require('util').format;
var inherits = require('util').inherits;
var inspect = require('util').inspect;

var HostPort = require('./host-port.js');
var nullLogger = require('./null-logger.js');
var EndpointHandler = require('./endpoint-handler.js');
var TChannelRequest = require('./request');
var TChannelServiceNameHandler = require('./service-name-handler');
var errors = require('./errors');
var EventEmitter = require('./lib/event_emitter.js');
var ObjectPool = require('./lib/object_pool');
var RetryRatioTracker = require('./lib/retry_ratio_tracker');

var TChannelAsThrift = require('./as/thrift');
var TChannelAsJSON = require('./as/json');
var TChannelConnection = require('./connection');
var TChannelRootPeers = require('./root_peers');
var TChannelSubPeers = require('./sub_peers');
var TChannelServices = require('./services');
var RetryFlags = require('./retry-flags.js');
var TimeHeap = require('./time_heap');
var CountedReadySignal = require('ready-signal/counted');
var BatchStatsd = require('./lib/statsd.js');
var PeerFileWatcher = require('./peer-file-watcher.js');

var TracingAgent = require('./trace/agent');

var CONN_STALE_PERIOD = 1500;
var SANITY_PERIOD = 10 * 1000;

var DEFAULT_RETRY_FLAGS = new RetryFlags(
    /*never:*/ false,
    /*onConnectionError*/ true,
    /*onTimeout*/ false
);

var MAXIMUM_TTL_ALLOWED = 2 * 60 * 1000;
var MAX_TOMBSTONE_TTL = 5000;

// TODO restore spying
// var Spy = require('./v2/spy');
// var dumpEnabled = /\btchannel_dump\b/.test(process.env.NODE_DEBUG || '');

var DEFAULT_ENABLE_MAX_RETRY_RATIO = false;
var DEFAULT_MAX_RETRY_RATIO = 0.1;

/*eslint-disable max-statements*/
function TChannel(options) {
    if (!(this instanceof TChannel)) {
        return new TChannel(options);
    }

    var self = this;
    EventEmitter.call(this);
    this.errorEvent = this.defineEvent('error');
    this.listeningEvent = this.defineEvent('listening');
    this.connectionEvent = this.defineEvent('connection');
    this.statEvent = this.defineEvent('stat');
    this.peerChosenEvent = null;
    this.peerScoredEvent = null;

    this.options = extend({
        useLazyHandling: false,
        useLazyRelaying: true,
        timeoutCheckInterval: 100,
        timeoutFuzz: 100,
        connectionStalePeriod: CONN_STALE_PERIOD,
        maxTombstoneTTL: MAX_TOMBSTONE_TTL,

        // TODO: maybe we should always add pid to user-supplied?
        processName: format('%s[%s]', process.title, process.pid)
    }, options);

    this.logger = this.options.logger || nullLogger;
    this.random = this.options.random || globalRandom;
    this.timers = this.options.timers || globalTimers;
    this.initTimeout = this.options.initTimeout || 2000;
    this.requireAs = this.options.requireAs;
    this.requireCn = this.options.requireCn;
    this.emitConnectionMetrics =
        typeof this.options.emitConnectionMetrics === 'boolean' ?
        this.options.emitConnectionMetrics : false;
    this.choosePeerWithHeap = typeof this.options.choosePeerWithHeap === 'boolean' ?
        this.options.choosePeerWithHeap : true;
    this.connectionAttemptDelay = this.options.connectionAttemptDelay;
    this.maxConnectionAttemptDelay = this.options.maxConnectionAttemptDelay;
    this.refreshConnectedPeersDelay = this.options.refreshConnectedPeersDelay;

    this.setObservePeerScoreEvents(this.options.observePeerScoreEvents);

    // Filled in by the listen call:
    this.host = null;
    this.requestedPort = null;

    // Filled in by listening event:
    this.hostPort = null;

    // name of the service running over this channel
    this.serviceName = '';
    if (this.options.serviceName) {
        this.serviceName = this.options.serviceName;
        delete this.options.serviceName;
    }

    this.topChannel = this.options.topChannel || null;
    this.subChannels = this.topChannel ? null : {};

    // for processing operation timeouts
    this.timeHeap = this.options.timeHeap || new TimeHeap({
        timers: this.timers,
        // TODO: do we still need/want fuzzing?
        minTimeout: fuzzedMinTimeout
    });

    function fuzzedMinTimeout() {
        var fuzz = self.options.timeoutFuzz;
        if (fuzz) {
            fuzz = Math.floor(fuzz * (self.random() - 0.5));
        }
        return self.options.timeoutCheckInterval + fuzz;
    }

    // how to handle incoming requests
    if (!this.options.handler) {
        if (!this.serviceName) {
            this.handler = TChannelServiceNameHandler({
                channel: this,
                isBusy: this.options.isBusy
            });
        } else {
            this.handler = EndpointHandler(this.serviceName);
        }
    } else {
        this.handler = this.options.handler;
        delete this.options.handler;
    }

    // populated by:
    // - manually api (.peers.add etc)
    // - incoming connections on any listening socket

    if (!this.topChannel) {
        this.peers = new TChannelRootPeers(this, this.options);
    } else {
        this.peers = new TChannelSubPeers(this, this.options);
    }

    // For tracking the number of pending requests to any service
    this.services = new TChannelServices();
    if (this.options.maxPending !== undefined) {
        this.services.maxPending = this.options.maxPending;
    }
    if (this.options.maxPendingForService !== undefined) {
        this.services.maxPendingForService = this.options.maxPendingForService;
    }

    // TChannel advances through the following states.
    this.listened = false;
    this.listening = false;
    this.destroyed = false;
    this.draining = false;

    // set when draining (e.g. graceful shutdown)
    this.drainReason = '';
    this.drainExempt = null;

    var trace = typeof this.options.trace === 'boolean' ?
        this.options.trace : true;

    if (trace) {
        this.tracer = new TracingAgent({
            logger: this.logger,
            forceTrace: this.options.forceTrace,
            serviceName: this.options.serviceNameOverwrite,
            reporter: this.options.traceReporter
        });
    }

    if (typeof this.options.traceSample === 'number') {
        this.traceSample = this.options.traceSample;
    } else {
        this.traceSample = 0.01;
    }

    // lazily created by .getServer (usually from .listen)
    this.serverSocket = null;
    this.serverConnections = null;

    this.TChannelAsThrift = TChannelAsThrift;
    this.TChannelAsJSON = TChannelAsJSON;

    this.statsd = this.options.statsd;
    this.batchStats = null;

    this.requestDefaults = this.options.requestDefaults ?
        new RequestDefaults(this.options.requestDefaults) : null;

    if (!this.topChannel) {
        if (this.options.batchStats) {
            this.batchStats = this.options.batchStats;
            this.batchStatsAllocated = false;
        } else {
            this.batchStats = new BatchStatsd({
                logger: this.logger,
                timers: this.timers,
                statsd: this.statsd,
                baseTags: this.options.statTags
            });
            this.batchStatsAllocated = true;

            this.batchStats.flushStats();
        }

        this.sanityTimer = this.timers.setTimeout(doSanitySweep, SANITY_PERIOD);
    } else {
        this.batchStats = this.topChannel.batchStats;
    }

    if (this.batchStats) {
        ObjectPool.bootstrap({
            channel: this,
            reportInterval: 5000,
            timers: this.timers,
            debug: this.options.objectPoolDebug ? true : false
        });
    }

    this.maximumRelayTTL = MAXIMUM_TTL_ALLOWED;
    this.watcher = null;

    function doSanitySweep() {
        self.sanityTimer = null;
        self.sanitySweep(sweepDone);
    }

    function sweepDone() {
        if (self.destroyed) {
            return;
        }
        self.sanityTimer = self.timers.setTimeout(doSanitySweep, SANITY_PERIOD);
    }

    // for client retry budget
    this.enableMaxRetryRatio = this.options.enableMaxRetryRatio || DEFAULT_ENABLE_MAX_RETRY_RATIO;
    this.maxRetryRatio = this.options.maxRetryRatio || DEFAULT_MAX_RETRY_RATIO; // retries to requests
    assert(this.maxRetryRatio >= 0.0, 'maxRetryRatio must be non-negative');
    this.retryRatioTracker = null;
    if (this.enableMaxRetryRatio && this.topChannel) { // only track ratio in sub channel
        this.retryRatioTracker = new RetryRatioTracker({
            rateCounterInterval: this.options.rateCounterInterval,
            rateCounterNumOfBuckets: this.options.rateCounterNumOfBuckets,
            timers: this.timers
        });
    }
}
inherits(TChannel, EventEmitter);
/*eslint-enable max-statements*/

TChannel.prototype.setMaximumRelayTTL =
function setMaximumRelayTTL(value) {
    var self = this;

    self.maximumRelayTTL = value;

    var keys = Object.keys(self.subChannels);
    for (var i = 0; i < keys.length; i++) {
        var subChan = self.subChannels[keys[i]];

        subChan.maximumRelayTTL = value;
    }
};

TChannel.prototype.toString =
function channelToString() {
    var self = this;
    if (!self.topChannel) {
        return 'TChannel(' + self.hostPort + ')';
    }
    return 'TSubChannel(' + self.serviceName + ',' + self.hostPort + ')';
};

TChannel.prototype.inspect =
function tchannelInspect() {
    var self = this;
    return 'TChannel(' + inspect(self.extendLogInfo({})) + ')';
};

TChannel.prototype.setPreferConnectionDirection =
function setPreferConnectionDirection(direction) {
    var self = this;

    self.peers.preferConnectionDirection = direction;
    var peers = self.peers.values();

    for (var i = 0; i < peers.length; i++) {
        peers[i].setPreferConnectionDirection(direction);
    }
};

TChannel.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info.hostPort = self.hostPort;
    info.channelListened = self.listened;
    info.channelListening = self.listening;
    info.channelDestroyed = self.destroyed;
    info.channelDraining = self.draining;

    return info;
};

TChannel.prototype.eachConnection = function eachConnection(each) {
    var self = this;

    var peers = self.peers.values();
    var i;
    for (i = 0; i < peers.length; i++) {
        var peer = peers[i];
        for (var j = 0; j < peer.connections.length; j++) {
            each(peer.connections[j]);
        }
    }

    if (self.serverConnections) {
        var connKeys = Object.keys(self.serverConnections);
        for (i = 0; i < connKeys.length; i++) {
            each(self.serverConnections[connKeys[i]]);
        }
    }
};

TChannel.prototype.setObservePeerScoreEvents =
function setObservePeerScoreEvents(obs) {
    var self = this;

    if (obs) {
        self.peerChosenEvent = self.defineEvent('peerChosen');
        self.peerScoredEvent = self.defineEvent('peerScored');
    } else {
        self.peerChosenEvent = null;
        self.peerScoredEvent = null;
    }
};

TChannel.prototype.setWriteBufferMode =
function setWriteBufferMode(mode) {
    // No-op for back-compat
};

TChannel.prototype.setChoosePeerWithHeap =
function setChoosePeerWithHeap(enabled) {
    var self = this;
    self.choosePeerWithHeap = enabled;
    if (self.topChannel) {
        self.peers.setChoosePeerWithHeap(enabled);
    }
};

TChannel.prototype.setLazyHandling =
function setLazyHandling(enabled) {
    var self = this;

    if (self.topChannel) {
        self.topChannel.setLazyHandling(enabled);
        return;
    }

    self.options.useLazyHandling = enabled;
    self.eachConnection(updateEachConn);

    function updateEachConn(conn) {
        conn.setLazyHandling(enabled);
    }
};

TChannel.prototype.setLazyRelaying =
function setLazyRelaying(enabled) {
    var self = this;

    if (self.topChannel) {
        self.topChannel.setLazyRelaying(enabled);
        return;
    }

    self.options.useLazyRelaying = enabled;

    var keys = Object.keys(self.subChannels);
    for (var i = 0; i < keys.length; i++) {
        var subChan = self.subChannels[keys[i]];
        if (subChan.handler.type === 'tchannel.relay-handler') {
            subChan.handler.lazyEnabled = enabled;
        }
    }
};

TChannel.prototype.drain = function drain(reason, callback) {
    var self = this;

    // TODO: we could do this by defaulting and/or forcing you into an
    // exemption function that exempting anything not matching the given sub
    // channel's service name; however there are many other complications to
    // consider to implement sub channel draining, so for now:
    assert(!self.topChannel, 'sub channel draining not supported');
    assert(!self.draining, 'channel already draining');

    self.draining = true;
    self.drainReason = reason;

    var drained = CountedReadySignal(1);
    drained(callback);
    self.eachConnection(drainEachConn);
    process.nextTick(drained.signal);
    self.logger.info('draining channel', self.extendLogInfo({
        reason: self.drainReason,
        count: drained.counter
    }));

    function drainEachConn(conn) {
        drained.counter++;
        conn.drain(self.drainReason, drained.signal);
    }
};

TChannel.prototype.getServer = function getServer() {
    var self = this;
    if (self.serverSocket) {
        return self.serverSocket;
    }

    self.serverConnections = Object.create(null);
    self.serverSocket = net.createServer(onServerSocketConnection);
    self.serverSocket.on('listening', onServerSocketListening);
    self.serverSocket.on('error', onServerSocketError);

    return self.serverSocket;

    function onServerSocketConnection(sock) {
        self.onServerSocketConnection(sock);
    }

    function onServerSocketListening() {
        self.onServerSocketListening();
    }

    function onServerSocketError(err) {
        self.onServerSocketError(err);
    }
};

TChannel.prototype.onServerSocketConnection = function onServerSocketConnection(sock) {
    var self = this;

    if (self.destroyed) {
        self.logger.error('got incoming socket whilst destroyed', self.extendLogInfo({
            remoteAddress: sock.remoteAddress,
            remotePort: sock.remotePort
        }));
        return;
    }

    var socketRemoteAddr = sock.remoteAddress + ':' + sock.remotePort;
    var chan = self.topChannel || self;
    var conn = new TChannelConnection(chan, sock, 'in', socketRemoteAddr);

    if (self.draining) {
        conn.drain(self.drainReason, null);
    }

    conn.errorEvent.on(onConnectionError);

    if (self.serverConnections[socketRemoteAddr]) {
        var oldConn = self.serverConnections[socketRemoteAddr];
        oldConn.resetAll(errors.SocketClosedError({
            reason: 'duplicate socketRemoteAddr incoming conn'
        }));
        delete self.serverConnections[socketRemoteAddr];
    }

    sock.on('close', onSocketClose);

    self.serverConnections[socketRemoteAddr] = conn;
    self.connectionEvent.emit(self, conn);

    function onSocketClose() {
        delete self.serverConnections[socketRemoteAddr];
    }

    // TODO: move method
    function onConnectionError(err) {
        var codeName = errors.classify(err);

        var loggerInfo = conn.extendLogInfo({
            error: err
        });

        if (codeName === 'Timeout' ||
            codeName === 'NetworkError') {
            self.logger.warn('Got a connection error', loggerInfo);
        } else {
            self.logger.error('Got an unexpected connection error', loggerInfo);
        }
        delete self.serverConnections[socketRemoteAddr];
    }
};

TChannel.prototype.onServerSocketListening = function onServerSocketListening() {
    var self = this;

    if (self.destroyed) {
        self.logger.error('got serverSocket listen whilst destroyed', self.extendLogInfo({
            requestedPort: self.requestedPort
        }));
        return;
    }

    var address = self.serverSocket.address();
    self.hostPort = self.host + ':' + address.port;
    self.listening = true;

    if (self.subChannels) {
        var subChanNames = Object.keys(self.subChannels);
        for (var i = 0; i < subChanNames.length; i++) {
            var chan = self.subChannels[subChanNames[i]];
            if (!chan.hostPort) {
                chan.hostPort = self.hostPort;
            }
        }
    }

    self.listeningEvent.emit(self);
};

TChannel.prototype.onServerSocketError = function onServerSocketError(err) {
    var self = this;

    if (err.code === 'EADDRINUSE') {
        err = errors.TChannelListenError(err, {
            requestedPort: self.requestedPort,
            host: self.host
        });
    }
    self.logger.error('server socket error', self.extendLogInfo({
        requestedPort: self.requestedPort,
        host: self.host,
        error: err
    }));
    self.errorEvent.emit(self, err);
};

TChannel.prototype.makeSubChannel = function makeSubChannel(options) {
    var self = this;
    if (!options) {
        options = {};
    }
    assert(!self.serviceName, 'arbitrary-depth sub channels are unsupported');
    assert(options.serviceName, 'must specify serviceName');
    assert(!self.subChannels[options.serviceName], 'duplicate sub channel creation');
    var opts = extend(self.options);
    var keys = Object.keys(options);
    for (var i = 0; i < keys.length; i++) {
        switch (keys[i]) {
            case 'peers':
                break;
            default:
                opts[keys[i]] = options[keys[i]];
        }
    }

    opts.topChannel = self;
    opts.timeHeap = self.timeHeap;

    opts.enableMaxRetryRatio = options.enableMaxRetryRatio;
    opts.maxRetryRatio = options.maxRetryRatio;

    var chan = TChannel(opts);

    if (options.peers) {
        for (i = 0; i < options.peers.length; i++) {
            if (typeof options.peers[i] === 'string') {
                chan.peers.add(options.peers[i]);
            }
        }
    }
    self.subChannels[chan.serviceName] = chan;

    // Subchannels should not have tracers; all tracing goes
    // through the top channel.
    chan.tracer = self.tracer;

    if (self.hostPort) {
        chan.hostPort = self.hostPort;
    }

    if (options.peerFile) {
        chan.watcher = new PeerFileWatcher(chan, {
            peerFile: options.peerFile,
            refreshInterval: options.refreshInterval
        });
    }

    return chan;
};

TChannel.prototype.listen = function listen(port, host, callback) {
    // Note:
    // - 0 is a valid port number, indicating that the system must assign an
    //   available ephemeral port
    // - 127.0.0.1 is a valid host, primarily for testing
    var self = this;

    assert(!self.topChannel, 'TChannel must listen on top channel');
    assert(!self.listened, 'TChannel can only listen once');

    var reason;
    reason = HostPort.validateHost(host);
    if (reason) {
        assert(false, reason);
    }

    reason = HostPort.validatePort(port, true);
    if (reason) {
        assert(false, reason);
    }

    self.listened = true;
    self.requestedPort = port;
    self.host = host;
    self.getServer().listen(port, host, callback);
};

TChannel.prototype.register = function register(name, options, handler) {
    var self = this;

    var handlerType = self.handler && self.handler.type;

    switch (handlerType) {
        case 'tchannel.endpoint-handler':
            self.handler.register(name, options, handler);
            break;

        case 'tchannel.service-name-handler':
            throw errors.TopLevelRegisterError();

        default:
            if (typeof self.handler.register === 'function') {
                self.handler.register(name, options, handler);
            } else {
                throw errors.InvalidHandlerForRegister({
                    handlerType: handlerType,
                    handler: self.handler
                });
            }
    }
};

TChannel.prototype.address = function address() {
    var self = this;
    if (self.serverSocket) {
        return self.serverSocket.address() || null;
    } else if (self.topChannel) {
        return self.topChannel.address();
    } else {
        return null;
    }
};

/*
    Build a new opts
    Copy all props from defaults over.
    Build a new opts.headers
    Copy all headers from defaults.headers over
    For each key in per request options; assign
    For each key in per request headers; assign
*/
TChannel.prototype.requestOptions = function requestOptions(options) {
    var self = this;
    var prop;
    var opts = {};
    for (prop in self.requestDefaults) {
        if (prop === 'headers') {
            continue;
        }

        opts[prop] = self.requestDefaults[prop];
    }
    opts.headers = {};
    if (self.requestDefaults.headers) {
        /*eslint-disable guard-for-in*/
        for (prop in self.requestDefaults.headers) {
            opts.headers[prop] = self.requestDefaults.headers[prop];
        }
        /*eslint-enable guard-for-in*/
    }

    if (options) {
        for (prop in options) {
            if (prop === 'headers') {
                continue;
            }
            opts[prop] = options[prop];
        }
    }
    if (options && options.headers) {
        opts.headers = opts.headers;
        /*eslint-disable guard-for-in*/
        for (prop in options.headers) {
            opts.headers[prop] = options.headers[prop];
        }
        /*eslint-enable guard-for-in*/
    }
    return opts;
};

TChannel.prototype.waitForIdentified =
function waitForIdentified(options, callback) {
    var self = this;
    if (self.destroyed) {
        callback(errors.TChannelDestroyedError());
    } else {
        assert(typeof options.host === 'string', 'options.host is required');
        var peer = self.peers.add(options.host);
        peer.waitForIdentified(callback);
    }
};

/*
    Build a new opts
    Copy all props from defaults over.
    Build a new opts.headers
    Copy all headers from defaults.headers over
    For each key in per request options; assign
    For each key in per request headers; assign
*/
/*eslint max-statements: [2, 50]*/
TChannel.prototype.fastRequestDefaults =
function fastRequestDefaults(reqOpts) {
    var self = this;

    var defaults = self.requestDefaults;
    if (!defaults) {
        return;
    }

    if (defaults.timeout && !reqOpts.timeout) {
        reqOpts.timeout = defaults.timeout;
    }
    if (defaults.retryLimit && !reqOpts.retryLimit) {
        reqOpts.retryLimit = defaults.retryLimit;
    }
    if (defaults.serviceName && !reqOpts.serviceName) {
        reqOpts.serviceName = defaults.serviceName;
    }
    if (defaults._trackPendingSpecified && !reqOpts._trackPendingSpecified) {
        reqOpts.trackPending = defaults.trackPending;
    }
    if (defaults._checkSumTypeSpecified && reqOpts.checksumType === null) {
        reqOpts.checksumType = defaults.checksumType;
    }
    if (defaults._hasNoParentSpecified && !reqOpts._hasNoParentSpecified) {
        reqOpts.hasNoParent = defaults.hasNoParent;
    }
    if (defaults._traceSpecified && !reqOpts._traceSpecified) {
        reqOpts.trace = defaults.trace;
    }
    if (defaults.retryFlags && !reqOpts._retryFlagsSpecified) {
        reqOpts.retryFlags = defaults.retryFlags;
    }
    if (defaults.shouldApplicationRetry &&
        !reqOpts.shouldApplicationRetry
    ) {
        reqOpts.shouldApplicationRetry = defaults.shouldApplicationRetry;
    }

    if (defaults.headers) {
        for (var key in defaults.headers) {
            if (!reqOpts.headers[key]) {
                reqOpts.headers[key] = defaults.headers[key];
            }
        }
    }
};

function RequestDefaults(reqDefaults) {
    this.timeout = reqDefaults.timeout || 0;
    this.retryLimit = reqDefaults.retryLimit || 0;
    this.serviceName = reqDefaults.serviceName || '';

    this._trackPendingSpecified = typeof reqDefaults.trackPending === 'boolean';
    this.trackPending = reqDefaults.trackPending;

    this._checkSumTypeSpecified = typeof reqDefaults.checksumType === 'number';
    this.checksumType = reqDefaults.checksumType || 0;

    this._hasNoParentSpecified = typeof reqDefaults.hasNoParent === 'boolean';
    this.hasNoParent = reqDefaults.hasNoParent || false;

    this._traceSpecified = typeof reqDefaults.trace === 'boolean';
    this.trace = reqDefaults.trace || false;

    this.retryFlags = reqDefaults.retryFlags || null;
    this.shouldApplicationRetry = reqDefaults.shouldApplicationRetry || null;

    this.headers = reqDefaults.headers;
}

TChannel.prototype.request = function channelRequest(options) {
    var self = this;

    options = options || {};

    var opts = new RequestOptions(self, options);
    self.fastRequestDefaults(opts);

    if (opts.trace && opts.hasNoParent) {
        if (Math.random() < self.traceSample) {
            opts.trace = true;
        } else {
            opts.trace = false;
        }
    }

    return self._request(opts);
};

function RequestOptions(channel, opts) {
    /*eslint complexity: [2, 30]*/
    this.channel = channel;

    this.host = opts.host || '';
    this.streamed = opts.streamed || false;
    this.timeout = opts.timeout || 0;
    this.retryLimit = opts.retryLimit || 0;
    this.serviceName = opts.serviceName || '';
    this._trackPendingSpecified = typeof opts.trackPending === 'boolean';
    this.trackPending = opts.trackPending || false;
    this.checksumType = opts.checksumType || null;
    this._hasNoParentSpecified = typeof opts.hasNoParent === 'boolean';
    this.hasNoParent = opts.hasNoParent || false;
    this.forwardTrace = opts.forwardTrace || false;
    this._traceSpecified = typeof opts.trace === 'boolean';
    this.trace = this._traceSpecified ? opts.trace : true;
    this._retryFlagsSpecified = !!opts.retryFlags;
    this.retryFlags = opts.retryFlags || DEFAULT_RETRY_FLAGS;
    this.shouldApplicationRetry = opts.shouldApplicationRetry || null;
    this.parent = opts.parent || null;
    this.tracing = opts.tracing || null;
    this.peer = opts.peer || null;
    this.timeoutPerAttempt = opts.timeoutPerAttempt || 0;
    this.checksum = opts.checksum || null;

    // TODO optimize?
    this.headers = opts.headers || new RequestHeaders();

    this.retryCount = 0;
    this.logical = false;
    this.remoteAddr = null;
    this.hostPort = null;
}

function RequestHeaders() {
    this.cn = '';
    this.as = '';
    this.re = '';
}

TChannel.prototype._request = function _request(opts) {
    var self = this;

    assert(!self.destroyed, 'cannot request() to destroyed tchannel');
    if (!self.topChannel) {
        throw errors.TopLevelRequestError();
    }

    var req = null;
    // retries are only between hosts
    if (opts.peer) {
        opts.retryCount = 0;
        req = opts.peer.request(opts);
    } else if (opts.host) {
        opts.retryCount = 0;
        opts.peer = self.peers.add(opts.host);
        req = opts.peer.request(opts);
    // streaming retries not yet implemented
    } else if (opts.streamed) {
        opts.retryCount = 0;

        opts.peer = self.peers.choosePeer();
        if (!opts.peer) {
            // TODO: operational error?
            throw errors.NoPeerAvailable();
        }
        req = opts.peer.request(opts);
    } else {
        req = new TChannelRequest(opts);
    }

    return req;
};

TChannel.prototype.quit = // to provide backward compatibility.
TChannel.prototype.close = function close(callback) {
    var self = this;
    assert(!self.destroyed, 'TChannel double close');
    self.destroyed = true;

    var counter = 1;

    if (self.watcher) {
        self.watcher.destroy();
    }

    if (self.batchStats) {
        ObjectPool.unref();
    }

    if (self.sanityTimer) {
        self.timers.clearTimeout(self.sanityTimer);
        self.sanityTimer = null;
    }

    if (self.retryRatioTracker) {
        self.retryRatioTracker.destroy();
    }

    if (self.serverSocket) {
        ++counter;
        if (self.serverSocket.address()) {
            closeServerSocket();
        } else {
            self.serverSocket.once('listening', closeServerSocket);
        }
    }

    if (self.serverConnections) {
        var incomingConns = Object.keys(self.serverConnections);
        for (var i = 0; i < incomingConns.length; i++) {
            ++counter;
            var incomingConn = self.serverConnections[incomingConns[i]];
            incomingConn.close(onClose);
        }
    }

    if (self.subChannels) {
        var serviceNames = Object.keys(self.subChannels);
        serviceNames.forEach(function each(serviceName) {
            var svcchan = self.subChannels[serviceName];
            if (!svcchan.destroyed) {
                counter++;
                svcchan.close(onClose);
            }
        });
    }

    if (!self.topChannel) {
        if (self.batchStatsAllocated) {
            self.batchStats.destroy();
        }
        self.timeHeap.clear();
    }

    counter++;
    self.peers.close(onClose);

    onClose();

    function closeServerSocket() {
        self.serverSocket.once('close', onClose);
        self.serverSocket.close();
    }

    function onClose() {
        if (--counter <= 0) {
            if (counter < 0) {
                self.logger.error('closed more channel sockets than expected', self.extendLogInfo({
                    counter: counter
                }));
            }
            if (typeof callback === 'function') {
                callback();
            }
        }
    }
};

TChannel.prototype.emitFastStat =
function emitFastStat(name, type, value, tags) {
    var self = this;

    var stat = self.batchStats.pushStat(name, type, value, tags);

    var topChannel = self.topChannel ? self.topChannel : self;
    topChannel.statEvent.emit(topChannel, stat);
};

TChannel.prototype.flushStats = function flushStats() {
    var self = this;

    if (self.batchStats) {
        self.batchStats.flushStats();
    }
};

TChannel.prototype.sanitySweep =
function sanitySweep(callback) {
    var self = this;

    if (!self.serverConnections) {
        self.peers.sanitySweep(callback);
        return;
    }

    var incomingConns = Object.keys(self.serverConnections);

    nextConn(incomingConns, 0, function connSweepDone(err) {
        if (err) {
            callback(err);
            return;
        }

        self.peers.sanitySweep(callback);
    });

    function nextConn(connectionKeys, index, cb) {
        if (index >= connectionKeys.length) {
            cb(null);
            return;
        }

        var connection = self.serverConnections[connectionKeys[index]];
        connection.ops.sanitySweep(function opsSweepDone() {
            setImmediate(deferNextConn);
        });

        function deferNextConn() {
            nextConn(connectionKeys, index + 1, cb);
        }
    }
};

TChannel.prototype.setMaxTombstoneTTL =
function setMaxTombstoneTTL(ttl) {
    var self = this;

    if (ttl === self.options.maxTombstoneTTL) {
        return;
    }

    self.options.maxTombstoneTTL = ttl;
    var peers = self.peers.values();
    for (var i = 0; i < peers.length; i++) {
        var peer = peers[i];
        peer.setMaxTombstoneTTL(ttl);
    }
};

TChannel.prototype.isUnhealthyError = function isUnhealthyError(err) {
    if (!err) {
        return false;
    }
    var codeName = errors.classify(err);
    return errors.isUnhealthy(codeName);
};

module.exports = TChannel;
