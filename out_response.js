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

var EventEmitter = require('./lib/event_emitter');
var stat = require('./stat-tags.js');
var inherits = require('util').inherits;

var errors = require('./errors');
var States = require('./reqres_states');

/*eslint max-statements: [2, 40]*/
function TChannelOutResponse(id, options) {
    options = options || {};
    var self = this;
    EventEmitter.call(self);
    self.errorEvent = self.defineEvent('error');
    self.spanEvent = self.defineEvent('span');
    self.finishEvent = self.defineEvent('finish');

    self.channel = options.channel;
    self.inreq = options.inreq;
    self.logger = options.logger;
    self.random = options.random;
    self.timers = options.timers;

    self.start = 0;
    self.end = 0;
    self.state = States.Initial;
    self.id = id || 0;
    self.code = options.code || 0;
    self.tracing = options.tracing || null;
    self.headers = options.headers || {};
    self.checksumType = options.checksumType || 0;
    self.checksum = options.checksum || null;
    self.ok = self.code === 0;
    self.span = options.span || null;
    self.streamed = false;
    self._argstream = null;
    self.arg1 = null;
    self.arg2 = null;
    self.arg3 = null;

    self.codeString = null;
    self.message = null;

    self.error = null;
}

inherits(TChannelOutResponse, EventEmitter);

TChannelOutResponse.prototype.type = 'tchannel.outgoing-response';

TChannelOutResponse.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    info.responseId = self.id;
    info.responseType = self.type;
    info.responseState = States.describe(self.state);
    info.responseOk = self.ok;
    info.responseCode = self.code;
    info.responseCodeString = self.codeString;
    info.responseErrorMessage = self.message;
    info.responseStart = self.start;
    info.responseEnd = self.end;
    info.responseHasArg3 = self.arg3 !== null && self.arg3 !== undefined;

    if (self.inreq) {
        info = self.inreq.extendLogInfo(info);
    }

    return info;
};

TChannelOutResponse.prototype._sendCallResponse = function _sendCallResponse(args, isLast) {
    var self = this;
    throw errors.UnimplementedMethod({
        className: self.constructor.name,
        methodName: '_sendCallResponse'
    });
};

TChannelOutResponse.prototype._sendCallResponseCont = function _sendCallResponseCont(args, isLast) {
    var self = this;
    throw errors.UnimplementedMethod({
        className: self.constructor.name,
        methodName: '_sendCallResponseCont'
    });
};

TChannelOutResponse.prototype._sendError = function _sendError(codeString, message) {
    var self = this;
    throw errors.UnimplementedMethod({
        className: self.constructor.name,
        methodName: '_sendError'
    });
};

TChannelOutResponse.prototype.sendParts = function sendParts(parts, isLast) {
    var self = this;
    switch (self.state) {
        case States.Initial:
            self.sendCallResponseFrame(parts, isLast);
            break;
        case States.Streaming:
            self.sendCallResponseContFrame(parts, isLast);
            break;
        case States.Done:
            self.emitError(errors.ResponseFrameState({
                attempted: 'arg parts',
                state: 'Done'
            }));
            break;
        case States.Error:
            // TODO: log warn
            break;
        default:
            self.channel.logger.error('TChannelOutResponse is in a wrong state', self.extendLogInfo({}));
            break;
    }
};

TChannelOutResponse.prototype.sendCallResponseFrame = function sendCallResponseFrame(args, isLast) {
    var self = this;
    switch (self.state) {
        case States.Initial:
            self.start = self.timers.now();
            self._sendCallResponse(args, isLast);
            if (self.span) {
                self.span.annotate('ss');
            }
            if (isLast) {
                self.state = States.Done;
            } else {
                self.state = States.Streaming;
            }
            break;
        case States.Streaming:
            self.emitError(errors.ResponseFrameState({
                attempted: 'call response',
                state: 'Streaming'
            }));
            break;
        case States.Done:
        case States.Error:
            var arg2 = args[1] || '';
            var arg3 = args[2] || '';

            self.emitError(errors.ResponseAlreadyDone({
                attempted: 'call response',
                state: self.state,
                method: 'sendCallResponseFrame',
                bufArg2: arg2.slice(0, 50),
                arg2: String(arg2).slice(0, 50),
                bufArg3: arg3.slice(0, 50),
                arg3: String(arg3).slice(0, 50)
            }));
            break;
        default:
            // TODO: log warn
            break;
    }
};

TChannelOutResponse.prototype.sendCallResponseContFrame = function sendCallResponseContFrame(args, isLast) {
    var self = this;
    switch (self.state) {
        case States.Initial:
            self.emitError(errors.ResponseFrameState({
                attempted: 'call response continuation',
                state: 'Initial'
            }));
            break;
        case States.Streaming:
            self._sendCallResponseCont(args, isLast);
            if (isLast) {
                self.state = States.Done;
            }
            break;
        case States.Done:
        case States.Error:
            self.emitError(errors.ResponseAlreadyDone({
                attempted: 'call response continuation',
                state: self.state,
                method: 'sendCallResponseContFrame'
            }));
            break;
        default:
            // TODO: log warn
            break;
    }
};

TChannelOutResponse.prototype.responseAlreadyDone = function responseAlreadyDone() {
    var self = this;

    if (self.state === States.Done || self.state === States.Error) {
        var errorEvent = self.errorEvent || {};
        var listener = !!errorEvent.listener;
        var listeners = 0;
        if (errorEvent.listeners && errorEvent.listeners.length) {
            listeners = errorEvent.listeners.length;
        }

        self.logger.error('responseAlreadyDone detected!!', self.extendLogInfo({
            haveErrorListener: listener,
            numberOfErrorListenerrs: listeners
        }));
        return true;
    } else {
        return false;
    }
};

TChannelOutResponse.prototype.sendError = function sendError(codeString, message) {
    var self = this;

    if (self.inreq.connection && // because selfpeer/connection
        self.inreq.connection.closing) {
        self.logger.info('ignoring outresponse.sendError on a closed connection', self.extendLogInfo({
            codeString: codeString,
            errorMessage: message
        }));
        return;
    }

    if (self.state === States.Done || self.state === States.Error) {
        self.emitError(errors.ResponseAlreadyDone({
            attempted: 'error frame',
            currentState: self.state,
            method: 'sendError',
            codeString: codeString,
            errMessage: message
        }));
    } else {
        if (self.span) {
            self.span.annotate('ss');
        }
        self.state = States.Error;

        self.codeString = codeString;
        self.message = message;
        self.channel.emitFastStat(
            'tchannel.inbound.calls.system-errors',
            'counter',
            1,
            new stat.InboundCallsSystemErrorsTags(
                self.inreq.callerName,
                self.inreq.serviceName,
                String(self.inreq.arg1),
                self.codeString
            )
        );
        self._sendError(codeString, message);
        self.emitFinish();
    }
};

TChannelOutResponse.prototype.emitError = function emitError(err) {
    var self = this;

    if (self.inreq && self.inreq.circuit) {
        self.inreq.circuit.state.onRequestError(err);
    }

    self.error = err;
    self.errorEvent.emit(self, err);
};

TChannelOutResponse.prototype.emitFinish = function emitFinish() {
    var self = this;
    var now = self.timers.now();

    if (self.end) {
        self.logger.warn('out response double emitFinish', self.extendLogInfo({
            now: now
        }));
        return;
    }

    self.end = now;

    var latency = self.end - self.inreq.start;

    self.channel.emitFastStat(
        'tchannel.inbound.calls.latency',
        'timing',
        latency,
        new stat.InboundCallsLatencyTags(
            self.inreq.callerName,
            self.inreq.serviceName,
            self.inreq.endpoint
        )
    );

    if (self.span) {
        self.spanEvent.emit(self, self.span);
    }

    if (self.inreq && self.inreq.circuit) {
        // TODO distingiush res.ok?
        // note that incoming requests do not have responseEvent and clear out
        // their response upon finish.
        if (errors.isUnhealthy(self.codeString)) {
            self.inreq.circuit.state.onRequestUnhealthy();
        } else {
            self.inreq.circuit.state.onRequestHealthy();
        }
    }

    self.finishEvent.emit(self);
};

TChannelOutResponse.prototype.setOk = function setOk(ok) {
    var self = this;
    if (self.state !== States.Initial) {
        self.emitError(errors.ResponseAlreadyStarted({
            state: self.state,
            method: 'setOk',
            ok: ok
        }));
        return false;
    }
    self.ok = ok;
    self.code = ok ? 0 : 1; // TODO: too coupled to v2 specifics?
    return true;
};

TChannelOutResponse.prototype.sendOk = function sendOk(res1, res2) {
    var self = this;
    self.setOk(true);
    self.send(res1, res2);
};

TChannelOutResponse.prototype.sendNotOk = function sendNotOk(res1, res2) {
    var self = this;
    if (self.state === States.Error) {
        self.logger.error('cannot send application error, already sent error frame', self.extendLogInfo({
            res1: res1,
            res2: res2
        }));
    } else {
        self.setOk(false);
        self.send(res1, res2);
    }
};

TChannelOutResponse.prototype.send = function send(res1, res2) {
    var self = this;

    /* send calls after finish() should be swallowed */
    if (self.end) {
        var inreqErrClass = self.inreq &&
                            self.inreq.err &&
                            errors.classify(self.inreq.err);

        switch (inreqErrClass) {
            case 'Timeout':
                self.logger.info('OutResponse.send() after inreq timed out', self.extendLogInfo({}));
                break;
            default:
                self.logger.warn('OutResponse called send() after end', self.extendLogInfo({}));
        }
        return self;
    }

    self.arg2 = res1;
    self.arg3 = res2;

    if (self.ok) {
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
    } else {
        // TODO: add outResponse.setErrorType()
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
    }

    // TODO: may be spam, consider dropping
    if (self.inreq.connection && // because selfpeer/connection
        self.inreq.connection.closing) {
        self.logger.info('ignoring outresponse.send on a closed connection', self.extendLogInfo({}));
    } else {
        self.sendCallResponseFrame([self.arg1, res1, res2], true);
    }

    self.emitFinish();

    return self;
};

module.exports = TChannelOutResponse;
