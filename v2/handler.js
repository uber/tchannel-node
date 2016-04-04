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

/* eslint max-statements: [1, 40] max-params: [1, 11] */
/* eslint-disable curly */

var EventEmitter = require('../lib/event_emitter');
var Buffer = require('buffer').Buffer;
var stat = require('../stat-tags.js');
var util = require('util');
var assert = require('assert');
var process = require('process');

var HostPort = require('../host-port.js');
var OutRequest = require('./out_request').OutRequest;
var OutResponse = require('./out_response').OutResponse;
var StreamingOutRequest = require('./out_request').StreamingOutRequest;
var StreamingOutResponse = require('./out_response').StreamingOutResponse;
var InRequest = require('../in_request');
var InResponse = require('../in_response');
var States = require('../reqres_states');
var StreamingInRequest = require('../streaming_in_request');
var StreamingInResponse = require('../streaming_in_response');

var WriteResult = require('bufrw').WriteResult;

var v2 = require('./index');
var errors = require('../errors');

var TCHANNEL_LANGUAGE = 'node';
var TCHANNEL_LANGUAGE_VERSION = process.version.slice(1);
var TCHANNEL_VERSION = require('../package.json').version;

var SERVER_TIMEOUT_DEFAULT = 100;
var GLOBAL_WRITE_BUFFER = new Buffer(v2.Frame.MaxSize);

module.exports = TChannelV2Handler;

function TChannelV2Handler(options) {
    EventEmitter.call(this);
    this.errorEvent = this.defineEvent('error');
    this.errorFrameEvent = this.defineEvent('errorFrame');
    this.callIncomingErrorFrameEvent = this.defineEvent('callIncomingErrorFrame');
    this.callIncomingRequestEvent = this.defineEvent('callIncomingRequest');
    this.callIncomingResponseEvent = this.defineEvent('callIncomingResponse');
    this.cancelEvent = this.defineEvent('cancel');
    this.initRequestEvent = this.defineEvent('initRequest');
    this.initResponseEvent = this.defineEvent('initResponse');
    this.claimEvent = this.defineEvent('claim');
    this.pingIncomingRequestEvent = this.defineEvent('pingIncomingRequest');
    this.pingIncomingResponseEvent = this.defineEvent('pingIncomingResponse');
    this.writeErrorEvent = this.defineEvent('writeError'); // TODO: could use default throw behavior

    this.options = options || {};
    this.logger = this.options.logger;
    this.random = this.options.random;
    this.timers = this.options.timers;
    this.tracer = this.options.tracer;
    this.hostPort = this.options.hostPort;
    this.processName = this.options.processName;
    this.connection = this.options.connection;
    this.remoteName = null; // filled in by identify message
    this.lastSentFrameId = 0;
    // TODO: GC these... maybe that's up to TChannel itself wrt ops
    this.streamingReq = Object.create(null);
    this.streamingRes = Object.create(null);

    this.handleCallLazily = this.options.handleCallLazily || null;
    this.handleFrame = this.handleEagerFrame;

    this.requireAs = this.options.requireAs === false ? false : true;
    this.requireCn = this.options.requireCn === false ? false : true;

    var self = this;
    this.boundOnReqError = onReqError;
    this.boundOnResError = onResError;

    function onReqError(err, req) {
        self.onReqError(err, req);
    }

    function onResError(err, res) {
        self.onResError(err, res);
    }
}

util.inherits(TChannelV2Handler, EventEmitter);

TChannelV2Handler.prototype.justExtendLogInfo = function extendLogInfo(info) {
    info.handlerLastSentFrameId = this.lastSentFrameId;
    info.handlerIsLazy = this.handleFrame === this.handleLazyFrame;
    info.canHandleLazyCalls = !!this.handleCallLazily;
    info.handlerRequireAs = this.requireAs;
    info.handlerRequireCn = this.requireCn;
    return info;
};

TChannelV2Handler.prototype.extendLogInfo = function extendLogInfo(info) {
    info = this.justExtendLogInfo(info);

    // adds remoteName, hostPort, remoteAddr, etc
    info = this.connection.extendLogInfo(info);

    return info;
};

TChannelV2Handler.prototype.write = function write() {
    this.errorEvent.emit(this, new Error('write not implemented'));
};

TChannelV2Handler.prototype.writeCopy = function writeCopy(buffer, start, end) {
    // TODO: Optimize, allocating SlowBuffer here is slow
    var copy = new Buffer(end - start);
    buffer.copy(copy, 0, start, end);
    this.write(copy);
};

var writeRes = new WriteResult();
TChannelV2Handler.prototype.pushFrame = function pushFrame(frame) {
    var writeBuffer = GLOBAL_WRITE_BUFFER;
    var res = v2.Frame.RW.poolWriteInto(writeRes, frame, writeBuffer, 0);
    var err = res.err;
    if (err) {
        if (!Buffer.isBuffer(err.buffer)) {
            var bufCopy = new Buffer(res.offset);
            writeBuffer.copy(bufCopy, 0, 0, res.offset);
            err.buffer = bufCopy;
        }
        if (typeof err.offset !== 'number') err.offset = res.offset;
        this.writeErrorEvent.emit(this, err);
    } else {
        this.writeCopy(writeBuffer, 0, res.offset);
    }
};

TChannelV2Handler.prototype.nextFrameId = function nextFrameId() {
    this.lastSentFrameId = (this.lastSentFrameId + 1) % v2.Frame.MaxId;
    return this.lastSentFrameId;
};

TChannelV2Handler.prototype.useLazyFrames = function useLazyFrames(enabled) {
    if (enabled) {
        this.handleFrame = this.handleLazyFrame;
    } else {
        this.handleFrame = this.handleEagerFrame;
    }
};

TChannelV2Handler.prototype.handleLazyFrame = function handleLazyFrame(frame) {
    frame.start = Date.now();

    switch (frame.type) {
        // TODO: make some lazy type handlers?
        // case v2.Types.InitRequest:
        // case v2.Types.InitResponse:
        // case v2.Types.Cancel:
        // case v2.Types.Claim:
        // case v2.Types.PingRequest:
        // case v2.Types.PingResponse:

        case v2.Types.CallRequest:
        case v2.Types.CallResponse:
        case v2.Types.CallRequestCont:
        case v2.Types.CallResponseCont:
        case v2.Types.ErrorResponse:
            if (this.handleCallLazily && this.handleCallLazily(frame)) {
                return;
            }
            break;
        default:
            break;
    }

    var res = frame.readBody();
    if (res.err) {
        this.errorEvent.emit(this, res.err);
        return;
    }

    this.handleEagerFrame(frame);
};

/* eslint-disable complexity */
TChannelV2Handler.prototype.handleEagerFrame = function handleEagerFrame(frame) {
    switch (frame.body.type) {
        case v2.Types.InitRequest:
            return this.handleInitRequest(frame);
        case v2.Types.InitResponse:
            return this.handleInitResponse(frame);
        case v2.Types.CallRequest:
            return this.handleCallRequest(frame);
        case v2.Types.CallResponse:
            return this.handleCallResponse(frame);
        case v2.Types.Cancel:
            return this.handleCancel(frame);
        case v2.Types.CallRequestCont:
            return this.handleCallRequestCont(frame);
        case v2.Types.CallResponseCont:
            return this.handleCallResponseCont(frame);
        case v2.Types.Claim:
            return this.handleClaim(frame);
        case v2.Types.PingRequest:
            return this.handlePingRequest(frame);
        case v2.Types.PingResponse:
            return this.handlePingResponse(frame);
        case v2.Types.ErrorResponse:
            return this.handleError(frame);
        default:
            return this.errorEvent.emit(this, errors.TChannelUnhandledFrameTypeError({
                typeCode: frame.body.type
            }));
    }
};
/* eslint-enable complexity */

TChannelV2Handler.prototype.handleInitRequest = function handleInitRequest(reqFrame) {
    if (this.remoteName !== null) {
        return this.errorEvent.emit(this, errors.DuplicateInitRequestError());
    }
    var headers = reqFrame.body.headers;
    var init = {
        hostPort: headers.host_port,
        processName: headers.process_name,
        tchannelLanguage: headers.tchannel_language,
        tchannelLanguageVersion: headers.tchannel_language_version,
        tchannelVersion: headers.tchannel_version
    };

    var reason = HostPort.validateHostPort(init.hostPort, true);
    if (reason) {
        return this.errorEvent.emit(this, errors.InvalidInitHostPortError({
            hostPort: init.hostPort,
            reason: reason
        }));
    }

    this.sendInitResponse(reqFrame);
    this.remoteName = init.hostPort;
    this.initRequestEvent.emit(this, init);
};

TChannelV2Handler.prototype.handleInitResponse = function handleInitResponse(resFrame) {
    if (this.remoteName !== null) {
        return this.errorEvent.emit(this, errors.DuplicateInitResponseError());
    }
    var headers = resFrame.body.headers;
    var init = {
        hostPort: headers.host_port,
        processName: headers.process_name,
        tchannelLanguage: headers.tchannel_language,
        tchannelLanguageVersion: headers.tchannel_language_version,
        tchannelVersion: headers.tchannel_version
    };
    this.remoteName = init.hostPort;
    this.initResponseEvent.emit(this, init);
};

TChannelV2Handler.prototype.handleCallRequest = function handleCallRequest(reqFrame) {
    if (this.remoteName === null) {
        this.errorEvent.emit(this, errors.CallReqBeforeInitReqError());
        return;
    }

    var req = this.buildInRequest(reqFrame);

    var err = this.checkCallReqFrame(reqFrame);
    if (err) {
        req.errorEvent.emit(req, err);
        return;
    }

    if (this._handleCallFrame(req, reqFrame, this.streamingReq)) {
        this.callIncomingRequestEvent.emit(this, req);
    }

    var channel = this.connection.channel;
    channel.emitFastStat(
        'tchannel.inbound.request.size',
        'counter',
        reqFrame.size,
        new stat.InboundRequestSizeTags(
            req.callerName,
            req.serviceName,
            req.endpoint
        )
    );

    this.emitBytesRecvd(reqFrame);
};

TChannelV2Handler.prototype.emitBytesRecvd =
function emitBytesRecvd(frame) {
    var channel = this.connection.channel;
    if (channel.emitConnectionMetrics) {
        channel.emitFastStat(
            'tchannel.connections.bytes-recvd',
            'counter',
            frame.size,
            new stat.ConnectionsBytesRcvdTags(
                channel.hostPort || '0.0.0.0:0',
                this.connection.socketRemoteAddr
            )
        );
    }
};

TChannelV2Handler.prototype.checkCallResFrame = function checkCallResFrame(resFrame) {
    if (!resFrame.body ||
        !resFrame.body.headers ||
        !resFrame.body.headers.as
    ) {
        if (this.requireAs) {
            return errors.InAsHeaderRequired({
                frame: 'response'
            });
        } else {
            this.logger.warn('Expected "as" for incoming response', this.extendLogInfo({
                code: resFrame.body.code,
                endpoint: String(resFrame.body.args[0])
            }));
        }
    }

    return this.checkCallFrameArgs(resFrame);
};

TChannelV2Handler.prototype.checkCallReqFrame = function checkCallReqFrame(reqFrame) {
    if (!reqFrame.body ||
        !reqFrame.body.headers ||
        !reqFrame.body.headers.as
    ) {
        if (this.requireAs) {
            return errors.InAsHeaderRequired({
                frame: 'request'
            });
        } else {
            this.logger.warn('Expected "as" header for incoming req', this.extendLogInfo({
                arg1: String(reqFrame.body.args[0]),
                serviceName: reqFrame.body.service,
                callerName: reqFrame.body.headers.cn
            }));
        }
    }

    if (!reqFrame.body ||
        !reqFrame.body.headers ||
        !reqFrame.body.headers.cn
    ) {
        if (this.requireCn) {
            return errors.InCnHeaderRequired();
        } else {
            this.logger.warn('Expected "cn" header for incoming req', this.extendLogInfo({
                arg1: String(reqFrame.body.args[0]),
                serviceName: reqFrame.body.service
            }));
        }
    }

    return this.checkCallFrameArgs(reqFrame);
};

TChannelV2Handler.prototype.checkCallFrameArgs = function checkCallFrameArgs(frame) {
    if (frame.body.args &&
        frame.body.args[0] &&
        frame.body.args[0].length > v2.MaxArg1Size
    ) {
        return errors.Arg1OverLengthLimit({
            length: frame.body.args[0].length,
            limit: v2.MaxArg1Size
        });
    }

    return null;
};

TChannelV2Handler.prototype.handleCallResponse = function handleCallResponse(resFrame) {
    if (this.remoteName === null) {
        this.errorEvent.emit(this, errors.CallResBeforeInitResError());
        return;
    }

    var res = this.buildInResponse(resFrame);

    var err = this.checkCallResFrame(resFrame);
    if (err) {
        res.errorEvent.emit(res, err);
        return;
    }

    var req = this.connection.ops.getOutReq(res.id);

    var channel = this.connection.channel;

    channel.emitFastStat(
        'tchannel.inbound.response.size',
        'counter',
        resFrame.size,
        new stat.InboundResponseSizeTags(
            req ? req.callerName : '',
            req ? req.serviceName : '',
            req ? req.endpoint : ''
        )
    );

    this.emitBytesRecvd(resFrame);

    res.remoteAddr = this.remoteName;
    if (this._handleCallFrame(res, resFrame, this.streamingRes)) {
        this.callIncomingResponseEvent.emit(this, res);
    }
};

// TODO  we should implement clearing of this.streaming{Req,Res}
TChannelV2Handler.prototype.handleCancel = function handleCancel(frame) {
    this.cancelEvent.emit(this, frame);
};

TChannelV2Handler.prototype.handleCallRequestCont = function handleCallRequestCont(reqFrame, callback) {
    if (this.remoteName === null) {
        return this.errorEvent.emit(this, errors.CallReqContBeforeInitReqError());
    }
    var id = reqFrame.id;
    var req = this.streamingReq[id];
    if (!req) {
        // TODO: maybe we should send an error frame directed at the missing
        // request id?  Currently the handler -> connection boundary only
        // supports "close them all" error handling.  If instead we added an
        // option for errors classified as 'BadRequest' to resolve through
        // something like `var refId = errors.badRequestRefId(err); if (refId
        // !== undefined) ...` then we could support it.
        return this.errorEvent.emit(this, errors.OrphanCallRequestCont({
            frameId: id
        }));
    }

    this._handleCallFrame(req, reqFrame, this.streamingReq);

    var channel = this.connection.channel;
    channel.emitFastStat(
        'tchannel.inbound.request.size',
        'counter',
        reqFrame.size,
        new stat.InboundRequestSizeTags(
            req.callerName,
            req.serviceName,
            req.endpoint
        )
    );

    this.emitBytesRecvd(reqFrame);
};

TChannelV2Handler.prototype.handleCallResponseCont = function handleCallResponseCont(resFrame) {
    if (this.remoteName === null) {
        return this.errorEvent.emit(this, errors.CallResContBeforeInitResError());
    }
    var id = resFrame.id;
    var res = this.streamingRes[id];
    if (!res) {
        // TODO: see note in #handleCallRequestCont
        return this.errorEvent.emit(this, errors.OrphanCallResponseCont({
            frameId: id
        }));
    }

    var req = this.connection.ops.getOutReq(res.id);
    var channel = this.connection.channel;

    channel.emitFastStat(
        'tchannel.inbound.response.size',
        'counter',
        resFrame.size,
        new stat.InboundResponseSizeTags(
            req ? req.callerName : '',
            req ? req.serviceName : '',
            req ? req.endpoint : ''
        )
    );

    this.emitBytesRecvd(resFrame);

    this._handleCallFrame(res, resFrame, this.streamingRes);
};

TChannelV2Handler.prototype.handleClaim = function handleClaim(frame) {
    this.claimEvent.emit(this, frame);
};

TChannelV2Handler.prototype.handlePingRequest = function handlePingRequest(pingFrame) {
    this.pingIncomingRequestEvent.emit(this, pingFrame);
    this.sendPingReponse(pingFrame);
};

TChannelV2Handler.prototype.handlePingResponse = function handlePingResponse(pingFrame) {
    this.pingIncomingResponseEvent.emit(this, pingFrame);
};

TChannelV2Handler.prototype.handleError = function handleError(errFrame, callback) {
    if (errFrame.id === v2.Frame.NullId) {
        // error frame not associated with a prior frame
        this.errorFrameEvent.emit(this, errFrame);
        return;
    }

    delete this.streamingReq[errFrame.id];
    delete this.streamingRes[errFrame.id];
    this.callIncomingErrorFrameEvent.emit(this, errFrame);
};

TChannelV2Handler.prototype._checkCallFrame = function _checkCallFrame(r, frame) {
    // TODO: this obsoletes similar checks in StreamingIn{Request,Response}#handleFrame
    if (r.state === States.Done) {
        return errors.UnexpectedCallFrameAfterDone({
            frameId: frame.id,
            frameType: frame.body.type
        });
    } else if (r.state === States.Error) {
        return errors.UnexpectedCallFrameAfterError({
            frameId: frame.id,
            frameType: frame.body.type
        });
    }

    var checksum = r.checksum;
    if (checksum.type !== frame.body.csum.type) {
        return errors.ChecksumTypeChanged({
            initialChecksumType: checksum.type,
            newChecksumType: frame.body.csum.type
        });
    }

    return frame.body.verifyChecksum(checksum.val);
};

TChannelV2Handler.prototype._handleCallFrame = function _handleCallFrame(r, frame, streamingColl) {
    var isLast = true;
    var err = this._checkCallFrame(r, frame);

    if (!err) {
        // TODO: refactor r.handleFrame to just take the whole frame? or should
        // it be (checksum, args)
        isLast = !(frame.body.flags & v2.CallFlags.Fragment);
        r.checksum = frame.body.csum;
        err = r.handleFrame(frame.body.args, isLast);
    }

    if (err) {
        // TODO wrap context
        r.errorEvent.emit(r, err);
        delete streamingColl[r.id];
        return false;
    }

    if (isLast) {
        delete streamingColl[r.id];
    } else if (!streamingColl[r.id]) {
        streamingColl[r.id] = r;
    } else {
        assert(streamingColl[r.id] === r);
    }

    return true;
};

TChannelV2Handler.prototype.sendInitRequest = function sendInitRequest() {
    var id = this.nextFrameId(); // TODO: assert(id === 1)?
    var hostPort = this.hostPort || '0.0.0.0:0';
    var processName = this.processName;
    /* eslint-disable camelcase */
    var body = new v2.InitRequest(v2.VERSION, {
        host_port: hostPort,
        process_name: processName,
        tchannel_language: TCHANNEL_LANGUAGE,
        tchannel_language_version: TCHANNEL_LANGUAGE_VERSION,
        tchannel_version: TCHANNEL_VERSION
    });
    /* eslint-enable camelcase */
    var reqFrame = new v2.Frame(id, body);
    this.pushFrame(reqFrame);
};

TChannelV2Handler.prototype.sendInitResponse = function sendInitResponse(reqFrame) {
    var id = reqFrame.id;
    var hostPort = this.hostPort;
    var processName = this.processName;
    /* eslint-disable camelcase */
    var body = new v2.InitResponse(v2.VERSION, {
        host_port: hostPort,
        process_name: processName,
        tchannel_language: TCHANNEL_LANGUAGE,
        tchannel_language_version: TCHANNEL_LANGUAGE_VERSION,
        tchannel_version: TCHANNEL_VERSION
    });
    /* eslint-enable camelcase */
    var resFrame = new v2.Frame(id, body);
    this.pushFrame(resFrame);
};

TChannelV2Handler.prototype.sendCallRequestFrame =
function sendCallRequestFrame(req, flags, args) {
    if (this.remoteName === null) {
        this.errorEvent.emit(this, errors.SendCallReqBeforeIdentifiedError());
        return null;
    }

    var err = this.verifyCallRequestFrame(req, args);
    if (err) {
        return err;
    }

    var reqBody = new v2.CallRequest(
        flags, req.timeout, req.tracing, req.serviceName, req.headers,
        req.checksum.type, args
    );
    req.checksum = this.sendCallBodies(
        req.id, reqBody, null,
        'tchannel.outbound.request.size', new stat.OutboundRequestSizeTags(
            req.serviceName,
            req.callerName,
            req.endpoint
        ));

    return null;
};

TChannelV2Handler.prototype.emitBytesSent =
function emitBytesSent(size) {
    var channel = this.connection.channel;
    if (channel.emitConnectionMetrics) {
        channel.emitFastStat(
            'tchannel.connections.bytes-sent',
            'counter',
            size,
            new stat.ConnectionsBytesSentTags(
                channel.hostPort || '0.0.0.0:0',
                this.connection.socketRemoteAddr
            )
        );
    }
};

TChannelV2Handler.prototype.verifyCallRequestFrame =
function verifyCallRequestFrame(req, args) {
    if (!req.headers || !req.headers.as) {
        if (this.requireAs) {
            return errors.OutAsHeaderRequired();
        } else {
            this.logger.error('Expected "as" header to be set for request', this.justExtendLogInfo(req.extendLogInfo({
            })));
        }
    }

    if (!req.callerName) {
        if (this.requireCn) {
            return errors.OutCnHeaderRequired();
        } else {
            this.logger.error('Expected "cn" header to be set for request', this.justExtendLogInfo(req.extendLogInfo({
            })));
        }
    }

    return null;
};

TChannelV2Handler.prototype.sendCallResponseFrame =
function sendCallResponseFrame(res, flags, args) {
    if (this.remoteName === null) {
        this.errorEvent.emit(this, errors.SendCallResBeforeIdentifiedError());
        return null;
    }

    var err = this.validateCallResponseFrame(res);
    if (err) {
        return err;
    }

    var req = res.inreq;
    var resBody = new v2.CallResponse(
        flags, res.code, res.tracing, res.headers,
        res.checksum.type, args);
    res.checksum = this.sendCallBodies(
        res.id, resBody, null,
        'tchannel.outbound.response.size', new stat.OutboundResponseSizeTags(
            req.serviceName,
            req.callerName,
            req.endpoint
        ));
};

TChannelV2Handler.prototype.validateCallResponseFrame =
function validateCallResponseFrame(res) {
    if (this.requireAs) {
        // TODO: consider returning typed error like for req frame validate
        assert(res.headers && res.headers.as,
            'Expected the "as" transport header to be set for response');
    } else if (!res.headers || !res.headers.as) {
        this.logger.error('Expected "as" header to be set for response', this.justExtendLogInfo(res.extendLogInfo({
        })));
    }

    return null;
};

TChannelV2Handler.prototype.sendCallRequestContFrame = function sendCallRequestContFrame(req, flags, args) {
    if (this.remoteName === null) {
        this.errorEvent.emit(this, errors.SendCallReqContBeforeIdentifiedError());
        return;
    }

    var reqBody = new v2.CallRequestCont(flags, req.checksum.type, args);
    req.checksum = this.sendCallBodies(
        req.id, reqBody, req.checksum,
        'tchannel.outbound.request.size', new stat.OutboundRequestSizeTags(
            req ? req.serviceName : '',
            req ? req.callerName : '',
            req ? req.endpoint : ''
        ));
};

TChannelV2Handler.prototype.sendCallResponseContFrame = function sendCallResponseContFrame(res, flags, args) {
    if (this.remoteName === null) {
        this.errorEvent.emit(this, errors.SendCallResContBeforeIdentifiedError());
        return;
    }

    var req = res.inreq;
    var resBody = new v2.CallResponseCont(flags, res.checksum.type, args);
    res.checksum = this.sendCallBodies(
        res.id, resBody, res.checksum,
        'tchannel.outbound.response.size', new stat.OutboundResponseSizeTags(
            req.serviceName,
            req.callerName,
            req.endpoint
        ));
};

TChannelV2Handler.prototype.sendCallBodies =
function sendCallBodies(id, body, checksum, chanStat, tags) {
    var channel = this.connection.channel;
    var frame;

    var size = 0;
    /* eslint-disable no-cond-assign */
    do {
        if (checksum) {
            body.csum = checksum;
        }

        frame = new v2.Frame(id, body);
        this.pushFrame(frame);
        size += frame.size;
        checksum = body.csum;
    } while (body = body.cont);
    /* eslint-enable no-cond-assign */

    if (chanStat) {
        channel.emitFastStat(chanStat, 'counter', size, tags);
    }
    this.emitBytesSent(size);

    return checksum;
};

TChannelV2Handler.prototype.sendPingRequest = function sendPingRequest() {
    var id = this.nextFrameId();
    var body = new v2.PingRequest();
    var reqFrame = new v2.Frame(id, body);
    this.pushFrame(reqFrame);
    return id;
};

TChannelV2Handler.prototype.sendPingReponse = function sendPingReponse(res) {
    var body = new v2.PingResponse();
    var resFrame = new v2.Frame(res.id, body);
    this.pushFrame(resFrame);
};

TChannelV2Handler.prototype.sendErrorFrame = function sendErrorFrame(id, tracing, codeString, message) {
    var code = v2.ErrorResponse.Codes[codeString];
    if (code === undefined) {
        this.logger.error('invalid error frame code string', this.extendLogInfo({
            codeString: codeString
        }));
        code = v2.ErrorResponse.Codes.UnexpectedError;
        message = 'UNKNOWN CODE(' + codeString + '): ' + message;
    }
    var errBody = new v2.ErrorResponse(code, tracing, message);
    var errFrame = new v2.Frame(id, errBody);
    this.pushFrame(errFrame);
};

TChannelV2Handler.prototype.buildOutRequest = function buildOutRequest(options) {
    var id = this.nextFrameId();

    if (options.checksumType === null) {
        options.checksumType = v2.Checksum.Types.CRC32C;
    }
    if (!options.checksum) {
        options.checksum = new v2.Checksum(options.checksumType);
    }
    if (!options.headers.re) {
        options.headers.re = v2.encodeRetryFlags(options.retryFlags);
    }

    if (options.streamed) {
        return new StreamingOutRequest(this, id, options);
    } else {
        return new OutRequest(this, id, options);
    }
};

TChannelV2Handler.prototype.buildOutResponse = function buildOutResponse(req, options) {
    if (!options) options = {};

    options.inreq = req;
    options.channel = req.channel;
    options.logger = this.logger;
    options.random = this.random;
    options.timers = this.timers;

    options.tracing = req.tracing;
    options.span = req.span;
    options.checksumType = req.checksum.type;
    if (!options.checksum) {
        options.checksum = new v2.Checksum(req.checksum.type);
    }
    if (options.streamed) {
        return new StreamingOutResponse(this, req.id, options);
    } else {
        return new OutResponse(this, req.id, options);
    }
};

TChannelV2Handler.prototype.buildInRequest = function buildInRequest(reqFrame) {
    var opts = new InRequestOptions(
        this.connection.channel,
        reqFrame.body.ttl || SERVER_TIMEOUT_DEFAULT,
        reqFrame.body.tracing,
        reqFrame.body.service,
        reqFrame.body.headers,
        new v2.Checksum(reqFrame.body.csum.type),
        v2.parseRetryFlags(reqFrame.body.headers.re),
        this.connection,
        this.hostPort,
        this.tracer,
        reqFrame.body.flags
    );

    var req;
    if (reqFrame.body.flags & v2.CallFlags.Fragment) {
        req = new StreamingInRequest(reqFrame.id, opts);
    } else {
        req = new InRequest(reqFrame.id, opts);
    }

    req.errorEvent.on(this.boundOnReqError);

    return req;
};

TChannelV2Handler.prototype.onReqError = function onReqError(err, req) {
    var codeName = errors.classify(err);
    if (codeName &&
        codeName !== 'ProtocolError'
    ) {
        // TODO: move req to error state?
        if (!req.res) {
            req.res = this.buildOutResponse(req);
        }
        req.res.sendError(codeName, err.message);
    } else {
        this.errorEvent.emit(this, err);
    }
};

TChannelV2Handler.prototype.onResError = function onResError(err, res) {
    // TODO: wrap errors to clarify "errors on responses to req..." ?
    var req = this.connection.ops.getOutReq(res.id);
    req.errorEvent.emit(req, err);
};

TChannelV2Handler.prototype.buildInResponse = function buildInResponse(resFrame) {
    var opts = {
        logger: this.logger,
        random: this.random,
        timers: this.timers,
        code: resFrame.body.code,
        checksum: new v2.Checksum(resFrame.body.csum.type),
        streamed: resFrame.body.flags & v2.CallFlags.Fragment,
        flags: resFrame.body.flags,
        headers: resFrame.body.headers
    };

    var res;
    if (opts.streamed) {
        res = new StreamingInResponse(resFrame.id, opts);
    } else {
        res = new InResponse(resFrame.id, opts);
    }

    res.errorEvent.on(this.boundOnResError);

    return res;
};

function InRequestOptions(
    channel, timeout, tracing, serviceName, headers, checksum,
    retryFlags, connection, hostPort, tracer, flags
) {
    this.channel = channel;
    this.timeout = timeout;
    this.tracing = tracing;
    this.serviceName = serviceName;
    this.headers = headers;
    this.checksum = checksum;
    this.retryFlags = retryFlags;
    this.connection = connection;
    this.hostPort = hostPort;
    this.tracer = tracer;
    this.flags = flags;
}
