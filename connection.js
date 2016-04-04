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
var Buffer = require('buffer').Buffer;
var process = require('process');
var bufrw = require('bufrw');
var extend = require('xtend');
var ReadMachine = require('bufrw/stream/read_machine');
var inherits = require('util').inherits;

var stat = require('./stat-tags.js');
var EventEmitter = require('./lib/event_emitter');
var v2 = require('./v2');
var errors = require('./errors');
var States = require('./reqres_states');
var Operations = require('./operations');

var CONNECTION_BASE_IDENTIFIER = 0;
var MAX_PENDING_SOCKET_WRITE_REQ = 100;

function TChannelConnection(channel, socket, direction, socketRemoteAddr) {
    assert(!channel.destroyed, 'refuse to create connection for destroyed channel');

    EventEmitter.call(this);
    this.errorEvent = this.defineEvent('error');
    this.timedOutEvent = this.defineEvent('timedOut');
    this.pingResponseEvent = this.defineEvent('pingResonse');

    this.draining = false;
    this.drainReason = '';

    this.closing = false;
    this.closeError = null;
    this.closeEvent = this.defineEvent('close');

    this.channel = channel;
    this.options = this.channel.options;
    this.logger = channel.logger;
    this.random = channel.random;
    this.timers = channel.timers;
    this.direction = direction;
    this.socketRemoteAddr = socketRemoteAddr;
    this.remoteName = null; // filled in by identify message

    this.ops = new Operations({
        timers: this.timers,
        logger: this.logger,
        random: this.random,
        initTimeout: this.channel.initTimeout,
        connectionStalePeriod: this.options.connectionStalePeriod,
        maxTombstoneTTL: this.options.maxTombstoneTTL,
        connection: this
    });

    this.guid = ++CONNECTION_BASE_IDENTIFIER + '~';

    this.tracer = this.channel.tracer;
    this.identifiedEvent = this.defineEvent('identified');

    if (direction === 'out') {
        if (this.channel.emitConnectionMetrics) {
            this.channel.emitFastStat(
                'tchannel.connections.initiated',
                'counter',
                1,
                new stat.ConnectionsInitiatedTags(
                    this.channel.hostPort || '0.0.0.0:0',
                    socketRemoteAddr
                ));
        }
    } else if (this.channel.emitConnectionMetrics) {
        this.channel.emitFastStat(
            'tchannel.connections.accepted',
            'counter',
            1,
            new stat.ConnectionsAcceptedTags(
                this.channel.hostPort,
                socketRemoteAddr
            ));
    }

    this.socket = socket;
    this.ephemeral = false;
    this.initHeaders = null;

    var self = this;
    // TODO: prototype this options shape
    var opts = {
        logger: this.channel.logger,
        random: this.channel.random,
        timers: this.channel.timers,
        hostPort: this.channel.hostPort,
        requireAs: this.channel.requireAs,
        requireCn: this.channel.requireCn,
        tracer: this.tracer,
        processName: this.options.processName,
        connection: this,
        handleCallLazily: handleCallLazily
    };

    this.handler = new v2.Handler(opts);

    this.mach = ReadMachine(bufrw.UInt16BE, v2.Frame.RW);

    this.setupSocket();
    this.setupHandler();
    this.start();

    function handleCallLazily(frame) {
        return self.handleCallLazily(frame);
    }
}
inherits(TChannelConnection, EventEmitter);

TChannelConnection.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    info = self.channel.extendLogInfo(info);

    info.connGUID = self.guid;
    info.connDirection = self.direction;
    info.socketRemoteAddr = self.socketRemoteAddr;
    info.remoteName = self.remoteName;
    info.connClosing = self.closing;

    return info;
};

TChannelConnection.prototype.drain =
function drain(reason, callback) {
    var self = this;

    self._drain(reason);

    if (callback) {
        if (self.ops.hasDrained()) {
            process.nextTick(callback);
        } else {
            self.ops.drainEvent.on(callback);
        }
    }
};

TChannelConnection.prototype._drain =
function _drain(reason, exempt) {
    var self = this;

    self.draining = true;
    self.drainReason = reason;
    self.ops.draining = true;

    if (self.remoteName) {
        sendDrainingFrame();
    } else {
        self.identifiedEvent.on(sendDrainingFrame);
    }

    function sendDrainingFrame() {
        self.handler.sendErrorFrame(
            v2.Frame.NullId, null,
            'Declined',
            'draining: ' + self.drainReason);
    }
};

// create a request
TChannelConnection.prototype.request =
function connBaseRequest(options) {
    var self = this;

    assert(self.remoteName, 'cannot make request unless identified');
    options.remoteAddr = self.remoteName;

    // TODO: use this to protect against >4Mi outstanding messages edge case
    // (e.g. zombie operation bug, incredible throughput, or simply very long
    // timeout
    // assert(!self.requests.out[id], 'duplicate frame id in flight');

    // options.checksumType = options.checksum;

    var req = self.buildOutRequest(options);
    if (self.draining && (
        !self.channel.drainExempt ||
        !self.channel.drainExempt(req)
    )) {
        req.drained = true;
        req.drainReason = self.drainReason;
    }
    self.ops.addOutReq(req);
    req.peer.invalidateScore('conn.request');
    return req;
};

TChannelConnection.prototype.handleCallRequest = function handleCallRequest(req) {
    var self = this;

    req.remoteAddr = self.remoteName;
    self.ops.addInReq(req);

    if (self.draining && (
        !self.channel.drainExempt ||
        !self.channel.drainExempt(req)
    )) {
        var res = self.buildResponse(req, {});
        res.sendError('Declined', 'connection draining: ' + self.drainReason);
        return;
    }

    process.nextTick(runHandler);

    function runHandler() {
        self.runHandler(req);
    }
};

TChannelConnection.prototype.handleCallLazily = function handleCallLazily(frame) {
    var self = this;
    var op = null;

    switch (frame.type) {
        case v2.Types.CallRequest:
            return self.channel.handler.handleLazily &&
                   self.channel.handler.handleLazily(self, frame);
        case v2.Types.CallResponse:
        case v2.Types.CallResponseCont:
        case v2.Types.ErrorResponse:
            op = self.ops.getOutReq(frame.id);
            break;
        case v2.Types.CallRequestCont:
            op = self.ops.getInReq(frame.id);
            break;
        default:
            return false;
    }

    if (!op || !op.handleFrameLazily) {
        return false;
    }
    op.handleFrameLazily(frame);
    return true;
};

TChannelConnection.prototype.runHandler = function runHandler(req) {
    var self = this;

    self.channel.emitFastStat(
        'tchannel.inbound.calls.recvd',
        'counter',
        1,
        new stat.InboundCallsRecvdTags(
            req.callerName,
            req.serviceName,
            req.endpoint
        )
    );

    self.channel.handler.handleRequest(req, buildResponse);
    function buildResponse(options) {
        return self.buildResponse(req, options || {});
    }
};

TChannelConnection.prototype.buildResponse =
function buildResponse(req, options) {
    var self = this;

    if (req.res && req.res.state !== States.Initial) {
        req.errorEvent.emit(req, errors.ResponseAlreadyStarted({
            state: req.res.state,
            reason: 'buildResponse called twice',
            codeString: req.res.codeString,
            responseMessage: req.res.message
        }));
        return req.res;
    }

    return self._buildResponse(req, options);
};

TChannelConnection.prototype._buildResponse =
function _buildResponse(req, options) {
    var self = this;

    options.channel = self.channel;
    options.inreq = req;

    // TODO give this options a well defined type
    req.res = self.buildOutResponse(req, options);

    req.res.errorEvent.on(onError);
    req.res.finishEvent.on(opDone);

    if (!req.forwardTrace) {
        self.captureResponseSpans(req.res);
    }

    return req.res;

    function opDone() {
        self.onReqDone(req);
    }

    function onError(err) {
        self.onResponseError(err, req);
    }
};

TChannelConnection.prototype.captureResponseSpans =
function captureResponseSpans(res) {
    var self = this;

    res.spanEvent.on(handleSpanFromRes);

    function handleSpanFromRes(span) {
        self.handleSpanFromRes(span);
    }
};

function isStringOrBuffer(x) {
    return typeof x === 'string' || Buffer.isBuffer(x);
}

TChannelConnection.prototype.handleSpanFromRes =
function handleSpanFromRes(span) {
    var self = this;

    self.channel.tracer.report(span);
};

TChannelConnection.prototype.onResponseError =
function onResponseError(err, req) {
    var self = this;

    var reqTimedOut = req.err &&
                      errors.classify(req.err) === 'Timeout';

    // don't log if we get further timeout errors for already timed out response
    if (reqTimedOut && errors.classify(err) === 'Timeout') {
        return;
    }

    var loggingOptions = req.extendLogInfo(req.res.extendLogInfo({
        error: err
    }));

    if (req.res.state === States.Done) {
        var arg2 = isStringOrBuffer(req.res.arg2) ?
            req.res.arg2 : 'streaming';
        var arg3 = isStringOrBuffer(req.res.arg3) ?
            req.res.arg3 : 'streaming';

        loggingOptions.bufArg2 = arg2.slice(0, 50);
        loggingOptions.arg2 = String(arg2).slice(0, 50);
        loggingOptions.bufArg3 = arg3.slice(0, 50);
        loggingOptions.arg3 = String(arg3).slice(0, 50);
    }

    if ((err.type === 'tchannel.response-already-started' ||
        err.type === 'tchannel.response-already-done') &&
        reqTimedOut
    ) {
        self.logger.info(
            'error for timed out outgoing response', loggingOptions
        );
    } else {
        self.logger.error(
            'outgoing response has an error', loggingOptions
        );
    }
};

TChannelConnection.prototype.onReqDone = function onReqDone(req) {
    var self = this;

    var inreq = self.ops.popInReq(req.id);

    if (inreq === req) {
        return;
    }

    // incoming req that timed out are already cleaned up
    if (req.err && errors.classify(req.err) === 'Timeout') {
        return;
    }

    if (inreq) {
        // we popped something else
        self.logger.warn('mismatched conn.onReqDone', self.extendLogInfo(req.extendLogInfo({})));
        return;
    }

    // there was nothing to pop
    if (self.closing) {
        // this happens because TChannelConnection#resetAll calls popInReq on
        // all conn.requests.in, and is okay
        return;
    }

    self.logger.warn('orphaned conn.onReqDone', self.extendLogInfo(req.extendLogInfo({})));
};

TChannelConnection.prototype.setLazyHandling = function setLazyHandling(enabled) {
    var self = this;

    // TODO: push down read machine concern into handler entirely;
    // boundary should just be self.handler.handleChunk in
    // onSocketChunk under setupSocket; then the switching logic
    // moves wholly into a `self.handler.setLazyHandling(bool)`
    if (enabled && self.mach.chunkRW !== v2.LazyFrame.RW) {
        self.mach.chunkRW = v2.LazyFrame.RW;
    } else if (!enabled && self.mach.chunkRW !== v2.Frame.RW) {
        self.mach.chunkRW = v2.Frame.RW;
    }
    self.handler.useLazyFrames(enabled);
};

TChannelConnection.prototype.setupSocket = function setupSocket() {
    var self = this;

    self.socket.setNoDelay(true);
    // TODO: stream the data with backpressure
    // when you add data event listener you go into
    // a deoptimized mode and you have lost all
    // backpressure on the stream
    self.socket.on('data', onSocketChunk);
    self.socket.on('close', onSocketClose);
    self.socket.on('error', onSocketError);

    // TODO: move to method for function optimization
    function onSocketChunk(chunk) {
        var err = self.mach.handleChunk(chunk);
        if (err) {
            self.sendProtocolError('read', err);
        }
    }

    // TODO: move to method for function optimization
    function onSocketClose() {
        self.resetAll(errors.SocketClosedError({
            reason: 'remote closed',
            socketRemoteAddr: self.socketRemoteAddr,
            direction: self.direction,
            remoteName: self.remoteName
        }));

        if (self.ephemeral) {
            var peer = self.channel.peers.get(self.socketRemoteAddr);
            if (peer) {
                peer.close(noop);
            }
            self.channel.peers.delete(self.socketRemoteAddr);
        }
    }

    function onSocketError(err) {
        self.onSocketError(err);
    }
};

function noop() {}

TChannelConnection.prototype.setupHandler = function setupHandler() {
    var self = this;

    self.setLazyHandling(self.channel.options.useLazyHandling);

    self.handler.write = function write(buf) {
        self.writeToSocket(buf);
    };

    self.mach.emit = handleReadFrame;

    self.handler.writeErrorEvent.on(onWriteError);
    self.handler.errorEvent.on(onHandlerError);
    self.handler.errorFrameEvent.on(onErrorFrame);
    self.handler.callIncomingRequestEvent.on(onCallRequest);
    self.handler.callIncomingResponseEvent.on(onCallResponse);
    self.handler.pingIncomingResponseEvent.on(onPingResponse);
    self.handler.callIncomingErrorFrameEvent.on(onCallErrorFrame);

    // TODO: restore dumping from old:
    // var stream = self.socket;
    // if (dumpEnabled) {
    //     stream = stream.pipe(Spy(process.stdout, {
    //         prefix: '>>> ' + self.remoteAddr + ' '
    //     }));
    // }
    // stream = stream
    //     .pipe(self.reader)
    //     .pipe(self.handler)
    //     ;
    // if (dumpEnabled) {
    //     stream = stream.pipe(Spy(process.stdout, {
    //         prefix: '<<< ' + self.remoteAddr + ' '
    //     }));
    // }
    // stream = stream
    //     .pipe(self.socket)
    //     ;

    function onWriteError(err) {
        self.onWriteError(err);
    }

    function onHandlerError(err) {
        self.onHandlerError(err);
    }

    function onErrorFrame(errFrame) {
        self.onErrorFrame(errFrame);
    }

    function handleReadFrame(frame) {
        self.handleReadFrame(frame);
    }

    function onCallRequest(req) {
        self.handleCallRequest(req);
    }

    function onCallResponse(res) {
        self.onCallResponse(res);
    }

    function onPingResponse(res) {
        self.handlePingResponse(res);
    }

    function onCallErrorFrame(errFrame) {
        self.onCallErrorFrame(errFrame);
    }
};

TChannelConnection.prototype.writeToSocket =
function writeToSocket(buf) {
    var self = this;

    if (self.socket._writableState.buffer.length >
        MAX_PENDING_SOCKET_WRITE_REQ
    ) {
        var error = errors.SocketWriteFullError({
            pendingWrites: self.socket._writableState.buffer.length
        });
        self.logger.warn('resetting connection due to write backup',
            self.extendLogInfo({
                pendingWrites: self.socket._writableState.buffer.length,
                totalFastBufferBytes: self.socket._writableState.length,
                lastBufferLength: buf.length,
                error: error
            })
        );

        // NUKE THE SOCKET
        self.resetAll(error);
        return;
    }

    self.socket.write(buf);
};

TChannelConnection.prototype.sendProtocolError =
function sendProtocolError(type, err) {
    var self = this;

    assert(type === 'write' || type === 'read',
        'Got invalid type: ' + type);

    var protocolError;

    if (type === 'read') {
        protocolError = errors.TChannelReadProtocolError(err, {
            remoteName: self.remoteName,
            localName: self.channel.hostPort,
            frameId: err.frameId
        });

        self.channel.emitFastStat(
            'tchannel.inbound.protocol-errors',
            'counter',
            1,
            new stat.InboundProtocolErrorsTags(self.socketRemoteAddr)
        );

        self.handler.sendErrorFrame(
            protocolError.frameId || v2.Frame.NullId, null,
            'ProtocolError', protocolError.message);

        self.resetAll(protocolError);
    } else if (type === 'write') {
        protocolError = errors.TChannelWriteProtocolError(err, {
            remoteName: self.remoteName,
            localName: self.channel.hostPort,
            frameId: err.frameId
        });

        // TODO: what if you have a write error in a call req cont frame
        self.resetAll(protocolError);
    }
};

TChannelConnection.prototype.onWriteError = function onWriteError(err) {
    var self = this;

    self.sendProtocolError('write', err);
};

TChannelConnection.prototype.onErrorFrame = function onErrorFrame(errFrame) {
    var self = this;

    // TODO: too coupled to v2

    switch (errFrame.body.code) {

    case v2.ErrorResponse.Codes.ProtocolError:
        var CodeErrorType = v2.ErrorResponse.CodeErrors[errFrame.body.code];
        self.resetAll(new CodeErrorType({
            originalId: errFrame.id,
            message: String(errFrame.body.message)
        }));
        return;

    case v2.ErrorResponse.Codes.Declined:
        var match = /^draining:\s*(.+)$/.exec(errFrame.body.message);
        if (match) {
            self.draining = true;
            self.drainReason = 'remote draining: ' + match[1];
            // TODO:
            // - info log?
            // - invaliadet peer score?
            return;
        }
        logUnhandled(v2.ErrorResponse.CodeNames[errFrame.body.code]);
        break;

    case v2.ErrorResponse.Codes.BadRequest:
    case v2.ErrorResponse.Codes.Busy:
    case v2.ErrorResponse.Codes.Cancelled:
    case v2.ErrorResponse.Codes.NetworkError:
    case v2.ErrorResponse.Codes.Timeout:
    case v2.ErrorResponse.Codes.UnexpectedError:
    case v2.ErrorResponse.Codes.Unhealthy:
        logUnhandled(v2.ErrorResponse.CodeNames[errFrame.body.code]);
        return;

    default:
        logUnhandled('unknown');
    }

    function logUnhandled(codeName) {
        self.logger.warn('unhandled error frame', self.extendLogInfo({
            id: errFrame.id,
            errorCode: errFrame.body.code,
            errorCodeName: codeName,
            errorTracing: errFrame.body.tracing,
            errorMessage: errFrame.body.message
        }));
    }
};

TChannelConnection.prototype.onHandlerError = function onHandlerError(err) {
    var self = this;

    if (err.isParseError) {
        self.sendProtocolError('read', err);
        return;
    }

    self.resetAll(err);
};

TChannelConnection.prototype.handlePingResponse = function handlePingResponse(resFrame) {
    var self = this;
    // TODO: explicit type
    self.pingResponseEvent.emit(self, {id: resFrame.id});
};

TChannelConnection.prototype.handleReadFrame = function handleReadFrame(frame) {
    var self = this;

    if (!self.closing) {
        self.ops.resetLastTimeoutTime();
    }

    self.handler.handleFrame(frame);
};

TChannelConnection.prototype.onCallResponse = function onCallResponse(res) {
    var self = this;

    var req = self.ops.getOutReq(res.id);
    if (res.state === States.Done || res.state === States.Error) {
        self.ops.popOutReq(res.id, res);
    } else {
        self._deferPopOutReq(res);
    }

    if (!req) {
        self.logUnknownCallResponse(res);
        return;
    }

    if (self.tracer && !req.forwardTrace) {
        // TODO: better annotations
        req.span.annotate('cr');
        self.tracer.report(req.span);
        res.span = req.span;
    }

    req.emitResponse(res);
};

TChannelConnection.prototype.logUnknownCallResponse =
function logUnknownCallResponse(res) {
    var self = this;

    var logger = self.channel.logger;
    var tombstone = self.ops.getOutTombstone(res.id);
    var info = self.extendLogInfo(res.extendLogInfo({
        responseHeaders: res.headers
    }));

    if (tombstone) {
        info = tombstone.extendLogInfo(info);
        logger.info('got call response for timed out call request', info);
    } else {
        logger.warn('got unexpected call response without call request', info);
    }
};

TChannelConnection.prototype._deferPopOutReq = function _deferPopOutReq(res) {
    var self = this;
    var called = false;

    res.errorEvent.on(popOutReq);
    res.finishEvent.on(popOutReq);

    // TODO: move to method
    function popOutReq() {
        if (called) {
            return;
        }

        called = true;
        self.ops.popOutReq(res.id, res);
    }
};

TChannelConnection.prototype.ping = function ping() {
    var self = this;
    return self.handler.sendPingRequest();
};

TChannelConnection.prototype.onCallErrorFrame =
function onCallErrorFrame(errFrame) {
    var self = this;

    var id = errFrame.id;
    var req = self.ops.getOutReq(id);
    // TODO: req could rarely be a lazy req, then maybe call req.handleFrameLazily

    var CodeErrorType = v2.ErrorResponse.CodeErrors[errFrame.body.code];
    var err = new CodeErrorType({
        originalId: id,
        message: String(errFrame.body.message),
        remoteAddr: self.remoteName
    });

    if (req) {
        if (req.res) {
            req.res.errorEvent.emit(req.res, err);
        } else {
            // Only popOutReq if there is no call response object yet
            req = self.ops.popOutReq(id, err);
            req.emitError(err);
        }
    } else {
        self.logUnknownErrorFrame(err, id);
    }
};

TChannelConnection.prototype.logUnknownErrorFrame =
function logUnknownErrorFrame(err, id) {
    var self = this;

    var logger = self.channel.logger;
    var tombstone = self.ops.getOutTombstone(id);
    var level = errors.logLevel(err, err.codeName);

    // Do not log about incoming timeouts for tombstones
    if (err.codeName === 'Timeout' && tombstone) {
        return;
    }

    var info = self.extendLogInfo({
        error: err,
        isErrorFrame: err.isErrorFrame
    });

    if (level === 'error') {
        logger.error('got unexpected errorframe without call request', info);
    } else if (level === 'warn') {
        logger.warn('got errorframe without call request', info);
    } else if (level === 'info') {
        logger.info('got expected errorframe without call request', info);
    }
};

TChannelConnection.prototype.start = function start() {
    var self = this;
    if (self.direction === 'out') {
        self.handler.sendInitRequest();
        self.handler.initResponseEvent.on(onOutIdentified);
    } else {
        self.handler.initRequestEvent.on(onInIdentified);
    }

    var now = self.timers.now();
    var initOp = new InitOperation(self, now, self.channel.initTimeout);
    var initTo = self.channel.timeHeap.update(initOp, now);

    function onOutIdentified(init) {
        initTo.cancel();
        self.onOutIdentified(init);
    }

    function onInIdentified(init) {
        initTo.cancel();
        self.onInIdentified(init);
    }
};

TChannelConnection.prototype.onOutIdentified = function onOutIdentified(init) {
    var self = this;

    if (init.hostPort === '0.0.0.0:0') {
        return self.emit('error', errors.EphemeralInitResponse({
            hostPort: init.hostPort,
            socketRemoteAddr: self.socketRemoteAddr,
            processName: init.processName
        }));
    }

    self.initHeaders = init;
    self.remoteName = init.hostPort;
    self.identifiedEvent.emit(self, {
        hostPort: init.hostPort,
        processName: init.processName
    });
};

TChannelConnection.prototype.onInIdentified = function onInIdentified(init) {
    var self = this;
    if (init.hostPort === '0.0.0.0:0') {
        self.ephemeral = true;
        self.remoteName = '' + self.socket.remoteAddress + ':' + self.socket.remotePort;
        assert(self.remoteName !== self.channel.hostPort,
              'should not be able to receive ephemeral connection from self');
    } else {
        self.remoteName = init.hostPort;
    }

    self.initHeaders = init;
    self.channel.peers.add(self.remoteName).addConnection(self);
    self.identifiedEvent.emit(self, {
        hostPort: self.remoteName,
        processName: init.processName
    });
};

TChannelConnection.prototype.close = function close(callback) {
    var self = this;
    if (self.socket.destroyed) {
        callback();
    } else {
        self.socket.once('close', callback);
        self.resetAll(errors.LocalSocketCloseError());
    }
};

TChannelConnection.prototype.onSocketError = function onSocketError(err) {
    var self = this;
    if (!self.closing) {
        self.resetAll(errors.SocketError(err, {
            hostPort: self.channel.hostPort,
            direction: self.direction,
            socketRemoteAddr: self.socketRemoteAddr
        }));
    }
};

TChannelConnection.prototype.nextFrameId = function nextFrameId() {
    var self = this;
    return self.handler.nextFrameId();
};

TChannelConnection.prototype.buildOutRequest = function buildOutRequest(options) {
    var self = this;
    var req = self.handler.buildOutRequest(options);
    req.errorEvent.on(onReqError);
    return req;

    function onReqError(err) {
        // The timeout path already popped the error
        if (self.ops.getOutReq(req.id)) {
            self.ops.popOutReq(req.id, err);
        }
    }
};

TChannelConnection.prototype.buildOutResponse = function buildOutResponse(req, options) {
    var self = this;

    options = options || {};
    options.inreq = req;
    options.channel = self.channel;
    options.logger = self.logger;
    options.random = self.random;
    options.timers = self.timers;

    options.tracing = req.tracing;
    options.span = req.span;
    options.checksumType = req.checksum && req.checksum.type;

    // TODO: take over popInReq on req/res error?
    return self.handler.buildOutResponse(req, options);
};

// this connection is completely broken, and is going away
// In addition to erroring out all of the pending work, we reset the state
// in case anybody stumbles across this object in a core dump.
TChannelConnection.prototype.resetAll = function resetAll(err) {
    /*eslint complexity: [2, 20], max-statements: [2, 40]*/
    var self = this;

    self.ops.destroy();

    err = err || errors.TChannelConnectionCloseError();

    if (self.closing) {
        return;
    }

    self.closing = true;
    self.closeError = err;
    self.socket.destroy();

    var requests = self.ops.getRequests();
    var pending = self.ops.getPending();

    var inOpKeys = Object.keys(requests.in);
    var outOpKeys = Object.keys(requests.out);

    if (!err) {
        err = errors.UnknownConnectionReset();
    }

    if (!self.remoteName && self.channel.emitConnectionMetrics) {
        if (self.direction === 'out') {
            self.channel.emitFastStat(
                'tchannel.connections.connect-errors',
                'counter',
                1,
                new stat.ConnectionsConnectErrorsTags(
                    self.channel.hostPort || '0.0.0.0:0',
                    self.socketRemoteAddr
                ));
        } else {
            self.channel.emitFastStat(
                'tchannel.connections.accept-errors',
                'counter',
                1,
                new stat.ConnectionsAcceptErrorsTags(self.channel.hostPort));
        }
    } else if (self.channel.emitConnectionMetrics) {
        if (err.type !== 'tchannel.socket-local-closed') {
            self.channel.emitFastStat(
                'tchannel.connections.errors',
                'counter',
                1,
                new stat.ConnectionsErrorsTags(
                    self.remoteName,
                    err.type // TODO unified error type
                )
            );
        }

        self.channel.emitFastStat(
            'tchannel.connections.closed',
            'counter',
            1,
            new stat.ConnectionsClosedTags(
                self.channel.hostPort || '0.0.0.0:0',
                self.remoteName,
                err.type // TODO unified reason type
            )
        );
    }

    var logInfo = self.extendLogInfo({
        error: err,
        numInOps: inOpKeys.length,
        numOutOps: outOpKeys.length,
        inPending: pending.in,
        outPending: pending.out
    });

    // requests that we've received we can delete, but these reqs may have started their
    //   own outgoing work, which is hard to cancel. By setting this.closing, we make sure
    //   that once they do finish that their callback will swallow the response.
    inOpKeys.forEach(function eachInOp(id) {
        self.ops.popInReq(id);
        // TODO: support canceling pending handlers
        // TODO report or handle or log errors or something
    });

    // for all outgoing requests, forward the triggering error to the user callback
    outOpKeys.forEach(function eachOutOp(id) {
        var req = self.ops.popOutReq(id);
        if (!req) {
            return;
        }
        req.emitError(makeReqError(req));
    });

    function makeReqError(req) {
        var reqErr = err;
        if (reqErr.type === 'tchannel.socket-local-closed') {
            reqErr = errors.TChannelLocalResetError(reqErr);
        } else {
            reqErr = errors.TChannelConnectionResetError(reqErr);
        }
        return req.extendLogInfo(self.extendLogInfo(reqErr));
    }

    self.ops.clear();

    var errorCodeName = errors.classify(err);
    if (errorCodeName !== 'NetworkError' &&
        errorCodeName !== 'ProtocolError'
    ) {
        self.logger.warn('resetting connection', logInfo);
        self.errorEvent.emit(self, err);
    } else if (
        err.type !== 'tchannel.socket-local-closed' &&
        err.type !== 'tchannel.socket-closed'
    ) {
        logInfo.error = extend(err);
        logInfo.error.message = err.message;
        self.logger.info('resetting connection', logInfo);
    }

    self.closeEvent.emit(self, err);
};

function InitOperation(connection, time, timeout) {
    var self = this;

    self.connection = connection;
    self.time = time;
    self.timeout = timeout;
}

InitOperation.prototype.onTimeout = function onTimeout(now) {
    var self = this;

    // noop if identify succeeded
    if (self.connection.remoteName || self.connection.closing) {
        return;
    }

    var elapsed = now - self.time;
    var err = errors.ConnectionTimeoutError({
        start: self.time,
        elapsed: elapsed,
        timeout: self.timeout
    });

    self.connection.logger.warn('destroying due to init timeout', self.connection.extendLogInfo({
        error: err
    }));
    self.connection.resetAll(err);
};

TChannelConnection.prototype.sendLazyErrorFrameForReq =
function sendLazyErrorFrameForReq(reqFrame, codeString, message) {
    var self = this;

    var res = reqFrame.bodyRW.lazy.readTracing(reqFrame);
    var tracing = res.err ? v2.Tracing.emptyTracing : res.value;

    self.sendLazyErrorFrame(reqFrame.id, tracing, codeString, message);

    var now = self.channel.timers.now();
    self._observeInboundErrorFrame(reqFrame, now, codeString);
};

TChannelConnection.prototype._observeInboundErrorFrame =
function _observeInboundErrorFrame(reqFrame, now, codeName) {
    var self = this;

    var serviceName = reqFrame.bodyRW.lazy
        .readServiceStr(reqFrame);
    var callerName = reqFrame.bodyRW.lazy
        .readCallerNameStr(reqFrame);
    var endpoint = reqFrame.bodyRW.lazy
        .readArg1Str(reqFrame);

    if (!callerName || !serviceName || endpoint === null) {
        return;
    }

    self.channel.emitFastStat(
        'tchannel.inbound.calls.latency',
        'timing',
        now - reqFrame.start,
        new stat.InboundCallsLatencyTags(
            callerName,
            serviceName,
            endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.inbound.calls.system-errors',
        'counter',
        1,
        new stat.InboundCallsSystemErrorsTags(
            callerName,
            serviceName,
            endpoint,
            codeName
        )
    );
};

TChannelConnection.prototype.sendLazyErrorFrame =
function sendLazyErrorFrame(id, tracing, codeString, message) {
    var self = this;

    self.handler.sendErrorFrame(id, tracing, codeString, message);
};

module.exports = TChannelConnection;
