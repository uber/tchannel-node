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

module.exports = TChannelOutRequest;

var assert = require('assert');
var EventEmitter = require('./lib/event_emitter');
var stat = require('./stat-tags.js');
var inherits = require('util').inherits;
var parallel = require('run-parallel');
var process = require('process');

var errors = require('./errors');
var States = require('./reqres_states');

function TChannelOutRequest(id, options) {
    /*eslint max-statements: [2, 50], complexity: [2, 25]*/

    EventEmitter.call(this);
    this.errorEvent = this.defineEvent('error');
    this.responseEvent = this.defineEvent('response');
    this.finishEvent = this.defineEvent('finish');

    // TODO perhaps these ought not be options
    assert(options.channel, 'channel required');
    assert(options.peer, 'peer required');
    assert(id, 'id is required');

    this.retryCount = options.retryCount || 0;
    this.channel = options.channel;
    this.peer = options.peer;
    this.logical = options.logical || false;
    this.parent = options.parent || null;
    this.hasNoParent = options.hasNoParent || false;

    this.remoteAddr = options.remoteAddr || '';
    this.timeout = options.timeout || 0;
    this.tracing = options.tracing || null;
    this.serviceName = options.serviceName || '';
    this.callerName = options.headers && options.headers.cn || '';
    this.headers = options.headers || {};
    this.checksumType = options.checksumType || 0;
    this.checksum = options.checksum || null;
    this.forwardTrace = options.forwardTrace || false;

    // All self requests have id 0
    this.operations = null;
    this.timeHeapHandle = null;
    this.id = id;
    this.state = States.Initial;
    this.start = 0;
    this.end = 0;
    this.streamed = false;
    this.arg1 = null;
    this.endpoint = '';
    this.span = null;
    this.err = null;
    this.res = null;

    // set for requests created on draining connections
    this.drained = false;
    this.drainReason = '';

    if (options.channel.tracer && !this.forwardTrace) {
        // new span with new ids
        this.setupTracing(options);
    }
}

inherits(TChannelOutRequest, EventEmitter);

TChannelOutRequest.prototype.type = 'tchannel.outgoing-request';

TChannelOutRequest.prototype.setupTracing = function setupTracing(options) {
    var self = this;

    self.span = options.channel.tracer.setupNewSpan({
        outgoing: true,
        parentSpan: options.parent && options.parent.span,
        hasNoParent: options.hasNoParent,
        spanid: null,
        traceid: null,
        parentid: null,
        flags: options.trace ? 1 : 0,
        remoteName: self.remoteAddr,
        serviceName: self.serviceName,
        name: '' // fill this in later
    });

    self.tracing = self.span.getTracing();
};

TChannelOutRequest.prototype._sendCallRequest = function _sendCallRequest(args, isLast) {
    var self = this;
    throw errors.UnimplementedMethod({
        className: self.constructor.name,
        methodName: '_sendCallRequest'
    });
};

TChannelOutRequest.prototype._sendCallRequestCont = function _sendCallRequestCont(args, isLast) {
    var self = this;
    throw errors.UnimplementedMethod({
        className: self.constructor.name,
        methodName: '_sendCallRequestCont'
    });
};

TChannelOutRequest.prototype.emitPerAttemptErrorStat =
function emitPerAttemptErrorStat(err) {
    var self = this;

    if (err.isErrorFrame) {
        self.channel.emitFastStat(
            'tchannel.outbound.calls.per-attempt.system-errors',
            'counter',
            1,
            new stat.OutboundCallsSystemErrorsTags(
                self.serviceName,
                self.callerName,
                self.endpoint,
                err.codeName,
                self.retryCount
            )
        );
    } else {
        self.channel.emitFastStat(
            'tchannel.outbound.calls.per-attempt.operational-errors',
            'counter',
            1,
            new stat.OutboundCallsPerAttemptOperationalErrorsTags(
                self.serviceName,
                self.callerName,
                self.endpoint,
                err.type || 'unknown',
                self.retryCounts
            )
        );
    }
};

TChannelOutRequest.prototype.emitPerAttemptResponseStat =
function emitPerAttemptResponseStat(res) {
    var self = this;

    if (!res.ok) {
        self.channel.emitFastStat(
            'tchannel.outbound.calls.per-attempt.app-errors',
            'counter',
            1,
            new stat.OutboundCallsPerAttemptAppErrorsTags(
                self.serviceName,
                self.callerName,
                self.endpoint,
                'unknown',
                self.retryCount
            )
        );
    // Only emit success if peer-to-peer request or relay
    } else if (self.logical === false) {
        self.channel.emitFastStat(
            'tchannel.outbound.calls.success',
            'counter',
            1,
            new stat.OutboundCallsSuccessTags(
                self.serviceName,
                self.callerName,
                self.endpoint
            )
        );
    }
};

TChannelOutRequest.prototype.emitPerAttemptLatency =
function emitPerAttemptLatency() {
    var self = this;

    var latency = self.end - self.start;

    self.channel.emitFastStat(
        'tchannel.outbound.calls.per-attempt-latency',
        'timing',
        latency,
        new stat.OutboundCallsPerAttemptLatencyTags(
            self.serviceName,
            self.callerName,
            self.endpoint,
            self.remoteAddr,
            self.retryCount
        )
    );
};

TChannelOutRequest.prototype.emitError = function emitError(err) {
    var self = this;

    if (self.end) {
        self.channel.logger.warn('Unexpected error after end for OutRequest', self.extendLogInfo({
            hasOldResponse: !!self.res,
            oldError: self.err,
            error: err
        }));
    } else {
        self.end = self.channel.timers.now();
    }

    self.err = err;
    self.emitPerAttemptLatency();
    self.emitPerAttemptErrorStat(err);

    self.peer.invalidateScore('outreq.emitError');

    self.errorEvent.emit(self, err);
};

TChannelOutRequest.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    info.outRequestId = self.id;
    // TODO: .start / .end
    info.outRequestType = self.type;
    info.outRequestState = States.describe(self.state);
    info.outRequestRemoteAddr = self.remoteAddr;
    info.serviceName = self.serviceName;
    info.callerName = self.callerName;
    info.outRequestErr = self.err;

    if (self.endpoint !== null) {
        info.outRequestArg1 = self.endpoint;
    } else {
        info.outRequestArg1 = String(self.arg1);
    }

    // TODO: delegate to self.res.extendLogInfo ?
    // TODO: add hasOldResponse: !!self.res ?

    return info;
};

TChannelOutRequest.prototype.emitResponse = function emitResponse(res) {
    var self = this;

    self.res = res;
    self.res.span = self.span;

    if (!self.res.streamed) {
        self.markEnd();
    } else {
        self.res.finishEvent.on(onFinished);
    }

    self.responseEvent.emit(self, self.res);

    function onFinished() {
        self.markEnd();
    }
};

TChannelOutRequest.prototype.markEnd = function markEnd() {
    var self = this;

    self.peer.invalidateScore('outreq.emitResponse');

    if (self.end) {
        self.channel.logger.warn('Unexpected response after end for OutRequest', self.extendLogInfo({
            hasOldResponse: !!self.res
        }));
    } else {
        self.end = self.channel.timers.now();
    }

    self.emitPerAttemptLatency();
    self.emitPerAttemptResponseStat(self.res);
};

TChannelOutRequest.prototype.sendParts = function sendParts(parts, isLast) {
    var self = this;

    if (self.drained) {
        self.emitError(errors.RequestDrained({
            reason: self.drainReason
        }));
        return;
    }

    switch (self.state) {
        case States.Initial:
            self.sendCallRequestFrame(parts, isLast);
            break;
        case States.Streaming:
            self.sendCallRequestContFrame(parts, isLast);
            break;
        case States.Done:
            // TODO: could probably happen normally, like say if a
            // streaming request is cancelled
            self.emitError(errors.RequestFrameState({
                attempted: 'arg parts',
                state: 'Done'
            }));
            break;
        case States.Error:
            // TODO: log warn
            break;
        default:
            // TODO: log warn
            break;
    }
};

TChannelOutRequest.prototype.sendCallRequestFrame = function sendCallRequestFrame(args, isLast) {
    var self = this;
    switch (self.state) {
        case States.Initial:
            self.start = self.channel.timers.now();
            if (self.span) {
                self.span.annotate('cs');
            }
            self._sendCallRequest(args, isLast);
            if (isLast) {
                self.state = States.Done;
            } else {
                self.state = States.Streaming;
            }
            break;
        case States.Streaming:
            self.emitError(errors.RequestFrameState({
                attempted: 'call request',
                state: 'Streaming'
            }));
            break;
        case States.Done:
            self.emitError(errors.RequestAlreadyDone({
                attempted: 'call request'
            }));
            break;
        default:
            // TODO: log warn
            break;
    }
};

TChannelOutRequest.prototype.sendCallRequestContFrame = function sendCallRequestContFrame(args, isLast) {
    var self = this;
    switch (self.state) {
        case States.Initial:
            self.emitError(errors.RequestFrameState({
                attempted: 'call request continuation',
                state: 'Initial'
            }));
            break;
        case States.Streaming:
            self._sendCallRequestCont(args, isLast);
            if (isLast) {
                self.state = States.Done;
            }
            break;
        case States.Done:
            self.emitError(errors.RequestAlreadyDone({
                attempted: 'call request continuation'
            }));
            break;
        default:
            // TODO: log warn
            break;
    }
};

TChannelOutRequest.prototype.sendArg1 = function sendArg1(arg1) {
    var self = this;

    if (self.drained) {
        self.emitError(errors.RequestDrained({
            reason: self.drainReason
        }));
        return self;
    }

    self.arg1 = arg1;
    self.endpoint = String(arg1);
    if (self.span) {
        self.span.name = self.endpoint;
    }

    return self;
};

TChannelOutRequest.prototype.send = function send(arg1, arg2, arg3, callback) {
    var self = this;

    if (callback) {
        self.hookupCallback(callback);
    }

    if (self.drained) {
        self.emitError(errors.RequestDrained({
            reason: self.drainReason
        }));
        return self;
    }

    self.sendArg1(arg1);

    if (self.span) {
        self.span.annotateBinary('as', self.headers.as);
        self.span.annotateBinary('cn', self.callerName);
    }

    if (self.logical === false && self.retryCount === 0) {
        self.emitOutboundCallsSent();
    }

    self.sendCallRequestFrame([arg1, arg2, arg3], true);
    self.finishEvent.emit(self);
    return self;
};

TChannelOutRequest.prototype.emitOutboundCallsSent =
function emitOutboundCallsSent() {
    var self = this;

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

TChannelOutRequest.prototype.hookupStreamCallback =
function hookupStreamCallback(callback) {
    var self = this;
    var called = false;

    self.errorEvent.on(onError);
    self.responseEvent.on(onResponse);

    function onError(err) {
        if (called) {
            return;
        }
        called = true;
        callback(err, null, null);
    }

    function onResponse(res) {
        if (called) {
            return;
        }
        called = true;
        callback(null, self, res);
    }

    return self;
};

TChannelOutRequest.prototype.hookupCallback =
function hookupCallback(callback) {
    var self = this;

    if (callback.canStream) {
        return self.hookupStreamCallback(callback);
    }
    var called = false;

    self.errorEvent.on(onError);
    self.responseEvent.on(onResponse);

    function onError(err) {
        if (called) {
            return;
        }
        called = true;
        callback(err, null, null);
    }

    function onResponse(res) {
        if (called) {
            return;
        }
        called = true;
        if (!res.streamed) {
            callback(null, res, res.arg2, res.arg3);
            return;
        }
        parallel({
            arg2: res.arg2.onValueReady,
            arg3: res.arg3.onValueReady
        }, compatCall);
        function compatCall(err, args) {
            callback(err, res, args.arg2, args.arg3);
        }
    }

    return self;
};

TChannelOutRequest.prototype.onTimeout = function onTimeout(now) {
    var self = this;
    var timeoutError;

    if (self.err) {
        self.channel.logger.warn('unexpected onTimeout for errored out request', self.extendLogInfo({
            hasOldResponse: !!self.res,
            timeoutTime: now
        }));
    }

    if (!self.res || self.res.state === States.Initial ||
        self.res.state === States.Streaming
    ) {
        timeoutError = errors.RequestTimeoutError({
            id: self.id,
            start: self.start,
            elapsed: now - self.start,
            logical: self.logical,
            timeout: self.timeout,
            remoteAddr: self.remoteAddr
        });
        if (self.operations) {
            self.operations.checkLastTimeoutTime(now);
            self.operations.popOutReq(self.id);
        }

        process.nextTick(deferOutReqTimeoutErrorEmit);
    } else if (self.operations) {
        self.operations.checkLastTimeoutTime(now);
        self.operations.popOutReq(self.id);
    }

    function deferOutReqTimeoutErrorEmit() {
        self.emitError(timeoutError);
    }
};
