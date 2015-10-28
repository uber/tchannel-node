// Copyright (c) 2015 Uber Technologies, Inc.
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
var inherits = require('util').inherits;
var inspect = require('util').inspect;
var EventEmitter = require('./lib/event_emitter');
var stat = require('./lib/stat.js');
var net = require('net');
var CountedReadySignal = require('ready-signal/counted');

var TChannelConnection = require('./connection');
var errors = require('./errors');
var Request = require('./request');
var PreferOutgoing = require('./peer_score_strategies.js').PreferOutgoing;
var NoPreference = require('./peer_score_strategies.js').NoPreference;
var PreferIncoming = require('./peer_score_strategies.js').PreferIncoming;

var DEFAULT_REPORT_INTERVAL = 1000;

function TChannelPeer(channel, hostPort, options) {
    assert(hostPort !== '0.0.0.0:0', 'Cannot create ephemeral peer');

    if (!(this instanceof TChannelPeer)) {
        return new TChannelPeer(channel, hostPort, options);
    }
    var self = this;
    options = options || {};
    EventEmitter.call(self);

    self.stateChangedEvent = self.defineEvent('stateChanged');
    self.allocConnectionEvent = self.defineEvent('allocConnection');
    self.removeConnectionEvent = self.defineEvent('removeConnection');
    self.channel = channel;
    self.logger = self.channel.logger;
    self.timers = self.channel.timers;
    self.random = self.channel.random;
    self.hostPort = hostPort;
    self.connections = [];
    self.pendingIdentified = 0;
    self.heapElements = [];
    self.scoreStrategy = null;
    self.draining = false;
    self.drainTimer = null;
    self.drainReason = '';
    self.drainDirection = '';
    self.boundOnIdentified = onIdentified;
    self.boundOnConnectionError = onConnectionError;
    self.boundOnConnectionClose = onConnectionClose;
    self.boundOnPendingChange = onPendingChange;
    self._weightedRange = null;

    self.reportInterval = options.reportInterval || DEFAULT_REPORT_INTERVAL;
    if (self.reportInterval > 0 && self.channel.emitConnectionMetrics) {
        self.reportTimer = self.timers.setTimeout(
            onReport, self.reportInterval
        );
    }

    var direction = options.preferConnectionDirection || 'any';
    self.setPreferConnectionDirection(direction);

    function onIdentified(_, conn) {
        self.onIdentified(conn);
    }

    function onConnectionError(err, conn) {
        self.onConnectionError(err, conn);
    }

    function onConnectionClose(_, conn) {
        self.onConnectionClose(conn);
    }

    function onPendingChange(pending, conn) {
        self.onPendingChange(conn, pending);
    }

    function onReport() {
        if (!self.hostPort) {
            return;
        }

        var count = self.countConnections('out');
        if (self.channel.emitConnectionMetrics) {
            self.channel.emitFastStat(self.channel.buildStat(
                'tchannel.connections.active',
                'gauge',
                count,
                new stat.ConnectionsActiveTags(
                    self.channel.hostPort,
                    self.hostPort
                )
            ));
        }

        self.reportTimer = self.timers.setTimeout(
            onReport, self.reportInterval
        );
    }
}

inherits(TChannelPeer, EventEmitter);

TChannelPeer.prototype.toString =
function toString() {
    var self = this;
    return 'TChannelPeer(' + self.hostPort + ')';
};

TChannelPeer.prototype.inspect =
function inspectPeer() {
    var self = this;
    return 'TChannelPeer(' + inspect(self.extendLogInfo({})) + ')';
};

TChannelPeer.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info.hostPort = self.hostPort;
    info.peerDraining = self.draining;

    return info;
};

TChannelPeer.prototype.drain =
function drain(options, callback) {
    var self = this;
    var chan = self.channel.topChannel || self.channel;

    assert(options, 'options is required');
    assert(options.reason, 'a reason is required');
    assert(!chan.draining, 'cannot drain a peer while channel is draining');
    assert(!self.draining, 'cannot double drain a peer');

    self.draining = true;
    self.drainReason = options.reason;
    self.drainDirection = options.direction || 'both';

    if (options.timeout) {
        var drainTimer = chan.timers.setTimeout(drainTimedOut, options.timeout);
        self.drainTimer = drainTimer;
    }

    var start = chan.timers.now();
    var finished = false;
    var drained = CountedReadySignal(1);
    process.nextTick(drained.signal);
    drained(drainDone);

    for (var i = 0; i < self.connections.length; i++) {
        var conn = self.connections[i];
        if (self.drainDirection === 'both' ||
            self.drainDirection === conn.direction) {
            drained.counter++;
            conn.drain(self.drainReason, drained.signal);
        }
    }

    self.logger.info('draining peer', self.extendLogInfo({
        reason: self.drainReason,
        direction: self.drainDirection,
        count: drained.counter
    }));

    function drainDone() {
        finish(null);
    }

    function drainTimedOut() {
        if (finished) {
            return;
        }
        var now = chan.timers.now();
        finish(errors.PeerDrainTimedOutError({
            direction: self.drainDirection,
            elapsed: now - start,
            timeout: options.timeout
        }));
    }

    function finish(err) {
        if (drainTimer) {
            chan.timers.clearTimeout(drainTimer);
            if (self.drainTimer === drainTimer) {
                self.drainTimer = null;
            }
        }
        if (!finished) {
            finished = true;
            callback(err);
        }
    }
};

TChannelPeer.prototype.clearDrain =
function clearDrain() {
    var self = this;
    var chan = self.channel.topChannel || self.channel;

    self.draining = false;
    self.drainReason = '';
    self.drainDirection = '';
    if (self.drainTimer) {
        chan.timers.clearTimeout(self.drainTimer);
        self.drainTimer = null;
    }
};

TChannelPeer.prototype.setPreferConnectionDirection = function setPreferConnectionDirection(direction) {
    var self = this;
    if (self.preferConnectionDirection === direction) {
        return;
    }

    self.preferConnectionDirection = direction;
    if (self.preferConnectionDirection === 'out') {
        self.setScoreStrategy(PreferOutgoing);
    } else if (self.preferConnectionDirection === 'in') {
        self.setScoreStrategy(PreferIncoming);
    } else {
        self.setScoreStrategy(NoPreference);
    }

    self.invalidateScore('setPreferConnectionDirection');
};

TChannelPeer.prototype.setScoreStrategy = function setScoreStrategy(ScoreStrategy) {
    var self = this;

    self.scoreStrategy = new ScoreStrategy(self);
};

TChannelPeer.prototype.invalidateScore = function invalidateScore(reason) {
    var self = this;

    self._weightedRange = null;

    if (!self.heapElements.length) {
        return;
    }

    var info = self.channel.peerScoredEvent ? {
        peer: self,
        reason: reason || 'unknown',
        score: 0,
        oldScores: [],
        scores: []
    } : null;

    var score = self.scoreStrategy.getScore();
    for (var i = 0; i < self.heapElements.length; i++) {
        var el = self.heapElements[i];
        if (info) {
            info.oldScores.push(el.score);
            info.scores.push(score);
        }
        el.rescore(score);
    }

    if (info) {
        self.channel.peerScoredEvent.emit(self, info);
    }
};

TChannelPeer.prototype.isConnected = function isConnected(direction, identified) {
    var self = this;

    if (identified === undefined) identified = true;
    for (var i = 0; i < self.connections.length; i++) {
        var conn = self.connections[i];
        if (direction && conn.direction !== direction) {
            continue;
        } else if (conn.closing) {
            continue;
        } else if (conn.remoteName !== null || !identified) {
            return true;
        }
    }

    return false;
};

TChannelPeer.prototype.closeDrainedConnections =
function closeDrainedConnections(callback) {
    var self = this;

    var counter = 1;
    var conns = self.connections.slice(0);

    for (var i = 0; i < conns.length; i++) {
        var conn = conns[i];
        if (conn.draining) {
            counter++;
            conn.close(onClose);
        }
    }
    onClose();

    function onClose() {
        if (--counter <= 0) {
            if (counter < 0) {
                self.logger.error('closed more peer sockets than expected', {
                    counter: counter
                });
            }
            callback(null);
        }
    }
};

TChannelPeer.prototype.close =
function close(callback) {
    var self = this;

    if (self.reportTimer) {
        self.timers.clearTimeout(self.reportTimer);
        self.reportTimer = null;
    }

    var conns = self.connections.slice(0);
    var counter = conns.length;
    if (counter) {
        for (var i = 0; i < conns.length; i++) {
            conns[i].close(onClose);
        }
    } else {
        callback(null);
    }
    function onClose() {
        if (--counter <= 0) {
            if (counter < 0) {
                self.logger.error('closed more peer sockets than expected', {
                    counter: counter
                });
            }
            callback(null);
        }
    }
};

TChannelPeer.prototype.getInConnection = function getInConnection(preferIdentified) {
    var self = this;
    var candidate = null;
    for (var i = 0; i < self.connections.length; i++) {
        var conn = self.connections[i];
        if (conn.closing) continue;
        if (!preferIdentified) return conn; // user doesn't care, take first incoming
        if (conn.remoteName) return conn; // user wanted an identified channel, and we found one
        if (!candidate) candidate = conn; // we'll fallback to returning this if we can't find an identified one
    }
    return candidate;
};

TChannelPeer.prototype.getIdentifiedInConnection = function getIdentifiedInConnection() {
    var self = this;
    return self.getInConnection(true);
};

TChannelPeer.prototype.getOutConnection = function getOutConnection(preferIdentified) {
    var self = this;
    var candidate = null;
    for (var i = self.connections.length - 1; i >= 0; i--) {
        var conn = self.connections[i];
        if (conn.closing) continue;
        if (!preferIdentified) return conn; // user doesn't care, take last outgoing
        if (conn.remoteName) return conn; // user wanted an identified channel, and we found one
        if (!candidate) candidate = conn; // we'll fallback to returning this if we can't find an identified one
    }
    return candidate;
};

TChannelPeer.prototype.getIdentifiedOutConnection = function getIdentifiedOutConnection() {
    var self = this;
    return self.getOutConnection(true);
};

TChannelPeer.prototype.countConnections = function countConnections(direction) {
    var self = this;
    if (!direction) {
        return self.connections.length;
    }

    var count = 0;
    for (var i = 0; i < self.connections.length; i++) {
        var conn = self.connections[i];
        if (conn.direction === direction) {
            count++;
        }
    }

    return count;
};

// ensures that a connection exists
TChannelPeer.prototype.connect =
function connect(outOnly) {
    var self = this;
    var conn = null;
    if (self.preferConnectionDirection === 'in' && !outOnly) {
        conn = self.getIdentifiedInConnection();
    } else {
        conn = self.getIdentifiedOutConnection();
    }

    if (!conn || (outOnly && conn.direction !== 'out')) {
        var socket = self.makeOutSocket();
        conn = self.makeOutConnection(socket);
        self.addConnection(conn);
    }
    return conn;
};

// ensures that an outbound connection exists
TChannelPeer.prototype.connectTo = function connectTo() {
    var self = this;
    return self.connect(true);
};

TChannelPeer.prototype.waitForIdentified =
function waitForIdentified(conn, callback) {
    var self = this;

    if (typeof conn === 'function' && !callback) {
        callback = conn;
        conn = self.connect();
    }

    if (conn.closing) {
        callback(conn.closeError);
    } else if (conn.remoteName) {
        callback(null);
    } else {
        self._waitForIdentified(conn, callback);
    }
};

TChannelPeer.prototype._waitForIdentified =
function _waitForIdentified(conn, callback) {
    var self = this;

    self.pendingIdentified++;
    conn.errorEvent.on(onConnectionError);
    conn.closeEvent.on(onConnectionClose);
    conn.identifiedEvent.on(onIdentified);
    self.invalidateScore('waitForIdentified');

    function onConnectionError(err) {
        finish(err);
    }

    function onConnectionClose(err) {
        finish(err);
    }

    function onIdentified() {
        finish(null);
    }

    function finish(err) {
        self.pendingIdentified = 0;
        conn.errorEvent.removeListener(onConnectionError);
        conn.closeEvent.removeListener(onConnectionClose);
        conn.identifiedEvent.removeListener(onIdentified);
        self.invalidateScore('waitForIdentified > finish');
        callback(err);
    }
};

TChannelPeer.prototype.request = function peerRequest(options) {
    var self = this;
    options.timeout = options.timeout || Request.defaultTimeout;
    return self.connect().request(options);
};

TChannelPeer.prototype.addConnection = function addConnection(conn) {
    var self = this;
    // TODO: first approx alert for self.connections.length > 2
    // TODO: second approx support pruning
    if (conn.direction === 'out') {
        self.connections.push(conn);
    } else {
        self.connections.unshift(conn);
    }
    conn.errorEvent.on(self.boundOnConnectionError);
    conn.closeEvent.on(self.boundOnConnectionClose);
    conn.ops.pendingChangeEvent.on(self.boundOnPendingChange);

    self._maybeInvalidateScore('addConnection');
    if (!conn.remoteName) {
        // TODO: could optimize if handler had a way of saying "would a new
        // identified connection change your Tier?"
        conn.identifiedEvent.on(self.boundOnIdentified);
    }

    if (!conn.draining) {
        if (conn.channel.draining) {
            conn.drain(conn.channel.drainReason, null);
        } else if (self.draining && (
                   self.drainDirection === 'both' ||
                   self.drainDirection === conn.direction)) {
            conn.drain(self.drainReason, null);
        }
    }

    return conn;
};

TChannelPeer.prototype.onIdentified =
function onIdentified(conn) {
    var self = this;

    conn.identifiedEvent.removeListener(self.boundOnIdentified);
    self._maybeInvalidateScore('addConnection > onIdentified');
};

TChannelPeer.prototype.onConnectionError =
function onConnectionError(err, conn) {
    var self = this;
    self.removeConnectionFrom(err, conn);
};

TChannelPeer.prototype.onConnectionClose =
function onConnectionClose(conn) {
    var self = this;
    self.removeConnectionFrom(null, conn);
};

TChannelPeer.prototype.onPendingChange =
function onPendingChange() {
    var self = this;

    // TODO: it would be possible to a faster partial-recomputation based only
    // on the change of pending for the this one connection. Note arguments are
    // (conn, pending)
    self._maybeInvalidateScore('pendingChange');
};

TChannelPeer.prototype.removeConnectionFrom =
function removeConnectionFrom(err, conn) {
    var self = this;

    conn.closeEvent.removeListener(self.boundOnConnectionClose);
    conn.errorEvent.removeListener(self.boundOnConnectionError);
    conn.identifiedEvent.removeListener(self.boundOnIdentified);
    conn.ops.pendingChangeEvent.removeListener(self.boundOnPendingChange);

    if (err) {
        var loggerInfo = {
            error: err,
            direction: conn.direction,
            remoteName: conn.remoteName,
            socketRemoteAddr: conn.socketRemoteAddr
        };
        var codeName = errors.classify(err);
        if (codeName === 'Timeout') {
            self.logger.warn('Got a connection error', loggerInfo);
        } else {
            self.logger.error('Got an unexpected connection error', loggerInfo);
        }
    }

    self.removeConnection(conn);
};

TChannelPeer.prototype.removeConnection = function removeConnection(conn) {
    var self = this;

    var ret = null;

    var index = self.connections ? self.connections.indexOf(conn) : -1;
    if (index !== -1) {
        ret = self.connections.splice(index, 1)[0];
    }

    self._maybeInvalidateScore('removeConnection');

    self.removeConnectionEvent.emit(self, conn);
    return ret;
};

TChannelPeer.prototype.makeOutSocket = function makeOutSocket() {
    var self = this;
    var parts = self.hostPort.split(':');
    assert(parts.length === 2, 'invalid destination ' + self.hostPort);
    var host = parts[0];
    var port = parts[1];
    assert(host !== '0.0.0.0', 'cannot connect to ephemeral peer');
    assert(port !== '0', 'cannot connect to dynamic port');
    var socket = net.createConnection({host: host, port: port});
    return socket;
};

TChannelPeer.prototype.makeOutConnection = function makeOutConnection(socket) {
    var self = this;
    var chan = self.channel.topChannel || self.channel;
    var conn = new TChannelConnection(chan, socket, 'out', self.hostPort);
    self.allocConnectionEvent.emit(self, conn);
    return conn;
};

TChannelPeer.prototype.pendingWeightedRandom = function pendingWeightedRandom() {
    // Returns a score in the range from 0 to 1, where it is preferable to use
    // a peer with a higher score over one with a lower score.
    // This range is divided among an infinite set of subranges corresponding
    // to peers with the same number of pending requests.
    // So, the range (1/2, 1] is reserved for peers with 0 pending connections.
    // The range (1/4, 1/2] is reserved for peers with 1 pending connections.
    // The range (1/8, 1/4] is reserved for peers with 2 pending connections.
    // Ad nauseam.
    // Within each equivalence class, each peer receives a uniform random
    // value.
    //
    // The previous score was a weighted random variable:
    //   random() ** (1 + pending)
    // This had the attribute that a less loaded peer was merely more likely to
    // be chosen over a more loaded peer.
    // We observed with the introduction of a heap, that a less favored peer
    // would have its score less frequently re-evaluated.
    // An emergent behavior was that scores would, over time, be squeezed
    // toward zero and the least favored peer would remain the least favored
    // for ever increasing durations.
    //
    // This remains true with this algorithm, within each equivalence class.
    var self = this;
    var range = self.pendingWeightedRange();
    var min = range[0];
    var max = range[1];
    var diff = max - min;

    // Force rand to be (0, 1] instead of [0, 1) 
    var rand = self.random();
    if (rand === 0) {
        rand = 1;
    }

    return min + diff * rand;
};

TChannelPeer.prototype.pendingWeightedRange = function pendingWeightedRange() {
    var self = this;
    if (self._weightedRange) {
        return self._weightedRange;
    }

    var pending = self.countPending();
    var max = Math.pow(0.5, pending);
    var min = max / 2;
    self._weightedRange = [min, max];

    return self._weightedRange;
};

TChannelPeer.prototype.countPending = function countPending() {
    var self = this;

    var pending = self.pendingIdentified;

    for (var index = 0; index < self.connections.length; index++) {
        var connPending = self.connections[index].ops.getPending();

        pending += connPending.out;
        pending += connPending.errors;
    }

    return pending;
};

// TODO: on connection #getScore impacting event
// - on identified

// Called on connection change event
TChannelPeer.prototype._maybeInvalidateScore =
function _maybeInvalidateScore(reason) {
    var self = this;

    if (self.scoreStrategy.getTier() !== self.scoreStrategy.lastTier) {
        self.invalidateScore(reason);
    }
};

TChannelPeer.prototype.getScore = function getScore() {
    var self = this;
    return self.scoreStrategy.getScore();
};

module.exports = TChannelPeer;
