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

var Buffer = require('buffer').Buffer;

var errors = require('./errors');
var v2 = require('./v2');
var stat = require('./stat-tags.js');

// "constant" byte buffer used for lookup in LazyRelayInReq#initRead
var cnBytes = Buffer('cn');

module.exports = {
    LazyRelayInReq: LazyRelayInReq,
    LazyRelayOutReq: LazyRelayOutReq,
    logError: logError
};

// TODO: lazy reqs
// - audit #extendLogInfo vs regular reqs

function LazyRelayInReq(conn, reqFrame) {
    var self = this;

    self.channel = conn.channel;
    self.conn = conn;
    self.start = conn.timers.now();
    self.remoteAddr = conn.remoteName;
    self.logger = conn.logger;
    self.peer = null;
    self.outreq = null;
    self.reqFrame = reqFrame;
    self.id = self.reqFrame.id;
    self.serviceName = '';
    self.callerName = '';
    self.timeout = 0;
    self.alive = true;
    self.operations = null;
    self.timeHeapHandle = null;
    self.endpoint = '';
    self.error = null;
    self.tracing = null;
    self.reqContFrames = [];

    self.boundExtendLogInfo = extendLogInfo;
    self.boundOnIdentified = onIdentified;

    function extendLogInfo(info) {
        return self.extendLogInfo(info);
    }

    function onIdentified(err) {
        if (err) {
            self.onError(err);
        } else {
            self.onIdentified();
        }
    }
}

LazyRelayInReq.prototype.type = 'tchannel.lazy.incoming-request';

LazyRelayInReq.prototype.initRead =
function initRead() {
    var self = this;

    // TODO: wrap errors in protocol read errors?

    var res = self.reqFrame.bodyRW.lazy.readTTL(self.reqFrame);
    if (res.err) {
        return res.err;
    }
    self.timeout = res.value;

    res = self.reqFrame.bodyRW.lazy.readService(self.reqFrame);
    if (res.err) {
        return res.err;
    }
    self.serviceName = res.value;

    res = self.reqFrame.bodyRW.lazy.readHeaders(self.reqFrame);
    if (res.err) {
        return res.err;
    }
    var headers = res.value;
    var cnHeader = headers.getValue(cnBytes);
    if (cnHeader !== undefined) {
        self.callerName = String(cnHeader);
    }

    res = self.reqFrame.bodyRW.lazy.readArg1(self.reqFrame, headers);
    if (res.err) {
        return res.err;
    }
    self.endpoint = String(res.value);

    res = self.reqFrame.bodyRW.lazy.readTracing(self.reqFrame);
    var tracing = res.err ? v2.Tracing.emptyTracing : res.value;
    self.tracing = tracing;

    return null;
};

LazyRelayInReq.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    if (self.conn) {
        info = self.conn.extendLogInfo(info);
    }

    if (self.outreq) {
        info = self.outreq._extendLogInfo(info);
    }

    info = self._extendLogInfo(info);

    return info;
};

LazyRelayInReq.prototype._extendLogInfo =
function _extendLogInfo(info) {
    var self = this;

    if (self.conn) {
        info = self.conn.extendLogInfo(info);
    }

    info.requestType = self.type;
    info.inRemoteAddr = self.remoteAddr;
    info.inRequestId = self.id;
    info.serviceName = self.serviceName;
    info.callerName = self.callerName;
    info.endpoint = self.endpoint;

    return info;
};

LazyRelayInReq.prototype.logError =
function relayRequestlogError(err, codeName) {
    var self = this;

    logError(self.conn.logger, err, codeName, self.boundExtendLogInfo);
};

LazyRelayInReq.prototype.onTimeout =
function onTimeout(now) {
    var self = this;

    self.onError(errors.RequestTimeoutError({
        id: self.id,
        start: self.start,
        elapsed: now - self.start,
        timeout: self.timeout
    }));
};

LazyRelayInReq.prototype.createOutRequest =
function createOutRequest() {
    var self = this;

    if (self.outreq) {
        self.conn.logger.warn('relay request already started', self.extendLogInfo({}));
        return;
    }

    var conn = self.peer.getInConnection(true);
    if (conn && conn.remoteName && !conn.closing) {
        self.forwardTo(conn);
    } else {
        self.peer.waitForIdentified(self.boundOnIdentified);
    }

    self.channel.emitFastStat(
        'tchannel.inbound.calls.recvd',
        'counter',
        1,
        new stat.InboundCallsRecvdTags(
            self.callerName,
            self.serviceName,
            self.endpoint
        )
    );
};

LazyRelayInReq.prototype.onIdentified =
function onIdentified(err) {
    var self = this;

    if (err) {
        self.onError(err);
        return;
    }

    var conn = self.peer.getInConnection(true);
    if (!conn.remoteName) {
        // we get the problem
        self.logger.warn('onIdentified called on unidentified connection', self.extendLogInfo({}));
    }
    if (conn.closing) {
        // most likely
        self.logger.warn('onIdentified called on closing connection', self.extendLogInfo({}));
    }

    self.forwardTo(conn);
};

LazyRelayInReq.prototype.forwardTo =
function forwardTo(conn) {
    var self = this;

    self.outreq = new LazyRelayOutReq(conn, self);

    var ttl = self.updateTTL(self.outreq.start);
    if (!ttl || ttl < 0) {
        // error or timeout, observability handled already by #updateTTL
        return;
    }

    self.outreq.timeout = ttl;
    conn.ops.addOutReq(self.outreq);
    self.peer.invalidateScore('lazyInReq.forwardTo');
    self.handleFrameLazily(self.reqFrame);
    self.reqFrame = null;

    for (var i = 0; i < self.reqContFrames.length; i++) {
        self.handleFrameLazily(self.reqContFrames[i]);
    }

    self.reqContFrames.length = 0;

    var now = self.channel.timers.now();
    self.channel.emitFastStat(
        'tchannel.relay.latency',
        'timing',
        now - self.start,
        new stat.RelayLatencyTags()
    );
};

LazyRelayInReq.prototype.updateTTL =
function updateTTL(now) {
    var self = this;

    var elapsed = now - self.start;
    var timeout = self.timeout - elapsed;

    if (timeout <= 0) {
        self.sendErrorFrame('Timeout', 'relay ttl expired');
        // TODO: log/stat
        return timeout;
    }

    if (self.channel.maximumRelayTTL !== 0 &&
        timeout > self.channel.maximumRelayTTL
    ) {
        self.logger.warn(
            'Clamping timeout to maximum ttl allowed',
            self.extendLogInfo({
                timeout: timeout,
                maximumTTL: self.channel.maximumRelayTTL
            })
        );

        timeout = self.channel.maximumRelayTTL;
    }

    var res = self.reqFrame.bodyRW.lazy.writeTTL(timeout, self.reqFrame);
    if (res.err) {
        // TODO: wrap? protocol write error?
        self.onError(res.err);
        return NaN;
    }

    return timeout;
};

LazyRelayInReq.prototype.onReadError =
function onReadError(err) {
    var self = this;

    var hasError = !self.alive && self.error;
    if (hasError) {
        self.logger.warn(
            'dropping read error from dead relay request',
            self.extendLogInfo({
                error: err
            })
        );
    }

    self.onError(err);
    self.conn.resetAll(err);
};

LazyRelayInReq.prototype.onError =
function onError(err) {
    var self = this;

    if (!self.alive && self.error) {
        self.logger.warn('dropping error from dead relay request', self.extendLogInfo({
            error: err
        }));
        return;
    }

    if (self.circuit) {
        self.circuit.state.onRequestError(err);
    }

    self.error = err;
    self.alive = false;
    var codeName = errors.classify(err) || 'UnexpectedError';
    self.sendErrorFrame(codeName, err.message);
    self.logError(err, codeName);
    // TODO: stat in some cases, e.g. declined / peer not available
    self.conn.ops.popInReq(self.id, self.extendLogInfo({
        info: 'lazy relay request error',
        relayDirection: 'in'
    }));

    self.reqContFrames.length = 0;
};

LazyRelayInReq.prototype.sendErrorFrame =
function sendErrorFrame(codeName, message) {
    var self = this;
    self.conn.sendLazyErrorFrame(self.id, self.tracing, codeName, message);
};

LazyRelayInReq.prototype.handleFrameLazily =
function handleFrameLazily(frame) {
    // frame.type will be one of:
    // - v2.Types.CallRequest
    // - v2.Types.CallRequestCont
    var self = this;

    if (!self.alive) {
        self.logger.warn('dropping frame from dead relay request', self.extendLogInfo({}));
        return;
    }

    // We have not flushed the CallRequest yet.
    // Probably waiting for init req/res blocking on out request conn.
    if (frame.type === v2.Types.CallRequestCont && self.reqFrame !== null) {
        self.reqContFrames.push(frame);
        return;
    }

    frame.setId(self.outreq.id);
    self.outreq.conn.writeToSocket(frame.buffer);
    if (frame.bodyRW.lazy.isFrameTerminal(frame)) {
        self.alive = false;
        self.conn.ops.popInReq(self.id, self.extendLogInfo({
            info: 'lazy relay request done',
            relayDirection: 'in'
        }));
    }

    if (frame.type === v2.Types.CallRequest) {
        self._observeCallReqFrame(frame);
    } else if (frame.type === v2.Types.CallRequestCont) {
        self._observeCallReqContFrame(frame);
    // } else { TODO: log
    }
};

LazyRelayInReq.prototype._observeCallReqFrame =
function _observeCallReqFrame(frame) {
    var self = this;

    self.channel.emitFastStat(
        'tchannel.inbound.request.size',
        'counter',
        frame.size,
        new stat.InboundRequestSizeTags(
            self.callerName,
            self.serviceName,
            self.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.request.size',
        'counter',
        frame.size,
        new stat.OutboundRequestSizeTags(
            self.serviceName,
            self.callerName,
            self.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.calls.sent',
        'counter',
        1,
        new stat.OutboundCallsSentTags(
            self.serviceName,
            self.callerName,
            self.endpoint
        )
    );
};

LazyRelayInReq.prototype._observeCallReqContFrame =
function _observeCallReqContFrame(frame) {
    var self = this;

    self.channel.emitFastStat(
        'tchannel.inbound.request.size',
        'counter',
        frame.size,
        new stat.InboundRequestSizeTags(
            self.callerName,
            self.serviceName,
            self.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.request.size',
        'counter',
        frame.size,
        new stat.OutboundRequestSizeTags(
            self.serviceName,
            self.callerName,
            self.endpoint
        )
    );
};

function LazyRelayOutReq(conn, inreq) {
    var self = this;

    self.channel = conn.channel;
    self.conn = conn;
    self.start = conn.timers.now();
    self.remoteAddr = conn.remoteName;
    self.logger = conn.logger;
    self.inreq = inreq;
    self.id = self.conn.nextFrameId();
    self.serviceName = self.inreq.serviceName;
    self.callerName = self.inreq.callerName;
    self.timeout = 0;
    self.operations = null;
    self.timeHeapHandle = null;
}

LazyRelayOutReq.prototype.type = 'tchannel.lazy.outgoing-request';

LazyRelayOutReq.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    if (self.conn) {
        info = self.conn.extendLogInfo(info);
    }

    if (self.inreq) {
        info = self.inreq._extendLogInfo(info);
    }

    info = self._extendLogInfo(info);

    return info;
};

LazyRelayOutReq.prototype._extendLogInfo =
function _extendLogInfo(info) {
    var self = this;

    info.requestType = self.type;
    info.outRequestAddr = self.remoteAddr;
    info.outRequestId = self.id;

    return info;
};

LazyRelayOutReq.prototype.emitError =
function emitError(err) {
    var self = this;

    var now = self.channel.timers.now();
    var elapsed = now - self.start;

    self.channel.emitFastStat(
        'tchannel.outbound.calls.per-attempt-latency',
        'timing',
        elapsed,
        new stat.OutboundCallsPerAttemptLatencyTags(
            self.inreq.serviceName,
            self.inreq.callerName,
            self.inreq.endpoint,
            self.remoteAddr,
            0
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.calls.per-attempt.operational-errors',
        'counter',
        1,
        new stat.OutboundCallsPerAttemptOperationalErrorsTags(
            self.inreq.serviceName,
            self.inreq.callerName,
            self.inreq.endpoint,
            err.type || 'unknown',
            0
        )
    );

    if (self.inreq.circuit) {
        self.inreq.circuit.state.onRequestError(err);
    }

    self.inreq.onError(err);
};

LazyRelayOutReq.prototype.logError =
function relayRequestlogError(err, codeName) {
    var self = this;

    self.inreq.logError(err, codeName);
};

LazyRelayOutReq.prototype.onTimeout =
function onTimeout(now) {
    var self = this;

    self.conn.ops.checkLastTimeoutTime(now);
    self.conn.ops.popOutReq(self.id, self.extendLogInfo({
        info: 'lazy out request timed out',
        relayDirection: 'out'
    }));

    self.emitError(errors.RequestTimeoutError({
        id: self.id,
        start: self.start,
        elapsed: now - self.start,
        timeout: self.timeout
    }));
};

LazyRelayOutReq.prototype.handleFrameLazily =
function handleFrameLazily(frame) {
    // frame.type will be one of:
    // - v2.Types.CallResponse
    // - v2.Types.CallResponseCont
    // - v2.Types.ErrorResponse
    var self = this;

    frame.setId(self.inreq.id);
    self.inreq.conn.writeToSocket(frame.buffer);
    if (frame.bodyRW.lazy.isFrameTerminal(frame)) {
        self.conn.ops.popOutReq(self.id, self.extendLogInfo({
            info: 'lazy relay request done',
            relayDirection: 'out'
        }));
        self.inreq.peer.invalidateScore('lazyOutReq.handleFrameLazily');
    }

    var now = self.channel.timers.now();
    if (frame.type === v2.Types.CallResponse) {
        self._observeCallResFrame(frame, now);
    } else if (frame.type === v2.Types.CallResponseCont) {
        self._observeCallResContFrame(frame, now);
    } else if (frame.type === v2.Types.ErrorResponse) {
        self._observeErrorFrame(frame, now);
    // } else { TODO: log
    }
};

LazyRelayOutReq.prototype._observeErrorFrame =
function _observeErrorFrame(errFrame, now) {
    var self = this;

    self.channel.emitFastStat(
        'tchannel.inbound.calls.latency',
        'timing',
        now - self.inreq.start,
        new stat.InboundCallsLatencyTags(
            self.inreq.callerName,
            self.inreq.serviceName,
            self.inreq.endpoint
        )
    );

    var res = errFrame.bodyRW.lazy.readCode(errFrame);
    if (res.err) {
        self.logger.error('failed to read error frame code', self.extendLogInfo({
            error: res.err
        }));
        return;
    }
    var code = res.value;
    var codeName = v2.ErrorResponse.CodeNames[code] || 'unknown';

    if (self.inreq.circuit) {
        if (errors.isUnhealthy(codeName)) {
            self.inreq.circuit.state.onRequestUnhealthy();
        } else {
            self.inreq.circuit.state.onRequestHealthy();
        }
    }

    self.channel.emitFastStat(
        'tchannel.outbound.calls.system-errors',
        'counter',
        1,
        new stat.OutboundCallsSystemErrorsTags(
            self.inreq.serviceName,
            self.inreq.callerName,
            self.inreq.endpoint,
            codeName,
            0
        )
    );

    self.channel.emitFastStat(
        'tchannel.inbound.calls.system-errors',
        'counter',
        1,
        new stat.InboundCallsSystemErrorsTags(
            self.inreq.callerName,
            self.inreq.serviceName,
            self.inreq.endpoint,
            codeName
        )
    );

    res = errFrame.bodyRW.lazy.readMessage(errFrame);
    if (res.err) {
        self.logger.error('failed to read error frame message', self.extendLogInfo({
            error: res.err
        }));
        return;
    }
    var message = res.value;

    // TODO: thinner logErrorFrame that doesn't need to instantiate an error
    // just to log an error frame
    var CodeErrorType = v2.ErrorResponse.CodeErrors[code];
    var err = new CodeErrorType({
        originalId: errFrame.id,
        message: message
    });
    self.logError(err, errors.classify(err) || 'UnexpectedError');
};

LazyRelayOutReq.prototype._observeCallResFrame =
function _observeCallResFrame(frame, now) {
    var self = this;

    self.channel.emitFastStat(
        'tchannel.inbound.response.size',
        'counter',
        frame.size,
        new stat.InboundResponseSizeTags(
            self.inreq.callerName,
            self.inreq.serviceName,
            self.inreq.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.response.size',
        'counter',
        frame.size,
        new stat.OutboundResponseSizeTags(
            self.inreq.serviceName,
            self.inreq.callerName,
            self.inreq.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.inbound.calls.latency',
        'timing',
        now - self.inreq.start,
        new stat.InboundCallsLatencyTags(
            self.inreq.callerName,
            self.inreq.serviceName,
            self.inreq.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.calls.per-attempt-latency',
        'timing',
        now - self.start,
        new stat.OutboundCallsPerAttemptLatencyTags(
            self.inreq.serviceName,
            self.inreq.callerName,
            self.inreq.endpoint,
            self.remoteAddr,
            0
        )
    );

    if (self.inreq.circuit) {
        self.inreq.circuit.state.onRequestHealthy();
    }

    var res = frame.bodyRW.lazy.readFlags(frame);
    if (res.err) {
        self.logger.error('failed to read error frame code', self.extendLogInfo({
            error: res.err
        }));
        return;
    }

    var flags = res.value;
    var ok = flags === 0;

    if (ok) {
        self.channel.emitFastStat(
            'tchannel.inbound.calls.success',
            'counter',
            1,
            new stat.InboundCallsSuccessTags(
                self.inreq.callerName,
                self.inreq.serviceName,
                self.inreq.endpoint
            )
        );

        self.channel.emitFastStat(
            'tchannel.outbound.calls.success',
            'counter',
            1,
            new stat.OutboundCallsSuccessTags(
                self.inreq.serviceName,
                self.inreq.callerName,
                self.inreq.endpoint
            )
        );
    } else {
        self.channel.emitFastStat(
            'tchannel.inbound.calls.app-errors',
            'counter',
            1,
            new stat.InboundCallsAppErrorsTags(
                self.inreq.callerName,
                self.inreq.serviceName,
                self.inreq.endpoint,
                'unknown'
            )
        );

        self.channel.emitFastStat(
            'tchannel.outbound.calls.per-attempt.app-errors',
            'counter',
            1,
            new stat.OutboundCallsPerAttemptAppErrorsTags(
                self.inreq.serviceName,
                self.inreq.callerName,
                self.inreq.endpoint,
                'unknown',
                0
            )
        );
    }
};

LazyRelayOutReq.prototype._observeCallResContFrame =
function _observeCallResContFrame(frame, now) {
    var self = this;

    self.channel.emitFastStat(
        'tchannel.inbound.response.size',
        'counter',
        frame.size,
        new stat.InboundResponseSizeTags(
            self.inreq.callerName,
            self.inreq.serviceName,
            self.inreq.endpoint
        )
    );

    self.channel.emitFastStat(
        'tchannel.outbound.response.size',
        'counter',
        frame.size,
        new stat.OutboundResponseSizeTags(
            self.inreq.serviceName,
            self.inreq.callerName,
            self.inreq.endpoint
        )
    );
};

function logError(logger, err, codeName, extendLogInfo) {
    var level = errors.logLevel(err, codeName);

    var info = extendLogInfo({
        error: err,
        isErrorFrame: err.isErrorFrame
    });

    if (err.isErrorFrame) {
        if (level === 'warn') {
            logger.warn('forwarding error frame', info);
        } else if (level === 'info') {
            logger.info('forwarding expected error frame', info);
        }
    } else if (level === 'error') {
        logger.error('unexpected error while forwarding', info);
    } else if (level === 'warn') {
        logger.warn('error while forwarding', info);
    } else if (level === 'info') {
        logger.info('expected error while forwarding', info);
    }
}
