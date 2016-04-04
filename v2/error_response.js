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

var bufrw = require('bufrw');
var Frame = require('./frame');
var Tracing = require('./tracing');

var errors = require('../errors');

// TODO: enforce message ID of this frame is Frame.NullId when
// errorBody.code.ProtocolError = ErrorResponse.Codes.ProtocolError

// code:1 tracing:25 message~2
function ErrorResponse(code, tracing, message) {
    this.code = code || 0;
    this.tracing = tracing || Tracing.emptyTracing;
    this.type = ErrorResponse.TypeCode;
    this.message = message || '';
}

ErrorResponse.TypeCode = 0xff;

var Codes = Object.create(null);
// 0x00 not a valid value for "code", do not use.
Codes.Timeout = 0x01;
Codes.Cancelled = 0x02;
Codes.Busy = 0x03;
Codes.Declined = 0x04;
Codes.UnexpectedError = 0x05;
Codes.BadRequest = 0x06;
Codes.NetworkError = 0x07;
Codes.Unhealthy = 0x08;
Codes.ProtocolError = 0xff;

var CodeNames = Object.create(null);
CodeNames[Codes.Timeout] = 'Timeout';
CodeNames[Codes.Cancelled] = 'Cancelled';
CodeNames[Codes.Busy] = 'Busy';
CodeNames[Codes.Declined] = 'Declined';
CodeNames[Codes.UnexpectedError] = 'UnexpectedError';
CodeNames[Codes.BadRequest] = 'BadRequest';
CodeNames[Codes.NetworkError] = 'NetworkError';
CodeNames[Codes.ProtocolError] = 'ProtocolError';
CodeNames[Codes.Unhealthy] = 'Unhealthy';

function TimeoutError(opts) {
    this.name = 'TchannelTimeoutError';
    this.fullType = 'tchannel.timeout';
    this.type = 'tchannel.timeout';
    this.message = 'TChannel timeout';
    this.isErrorFrame = true;
    this.codeName = 'Timeout';
    this.errorCode = Codes.Timeout;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function CancelledError(opts) {
    this.name = 'TchannelCancelledError';
    this.fullType = 'tchannel.cancelled';
    this.type = 'tchannel.cancelled';
    this.message = 'TChannel cancelled';
    this.isErrorFrame = true;
    this.codeName = 'Cancelled';
    this.errorCode = Codes.Cancelled;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function BusyError(opts) {
    this.name = 'TchannelBusyError';
    this.fullType = 'tchannel.busy';
    this.type = 'tchannel.busy';
    this.message = 'TChannel busy';
    this.isErrorFrame = true;
    this.codeName = 'Busy';
    this.errorCode = Codes.Busy;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function DeclinedError(opts) {
    this.name = 'TchannelDeclinedError';
    this.fullType = 'tchannel.declined';
    this.type = 'tchannel.declined';
    this.message = 'TChannel declined';
    this.isErrorFrame = true;
    this.codeName = 'Declined';
    this.errorCode = Codes.Declined;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function UnexpectedErrorError(opts) {
    this.name = 'TchannelUnexpectedError';
    this.fullType = 'tchannel.unexpected';
    this.type = 'tchannel.unexpected';
    this.message = 'TChannel unexpected error';
    this.isErrorFrame = true;
    this.codeName = 'UnexpectedError';
    this.errorCode = Codes.UnexpectedError;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function BadRequestError(opts) {
    this.name = 'TchannelBadRequestError';
    this.fullType = 'tchannel.bad-request';
    this.type = 'tchannel.bad-request';
    this.message = 'TChannel BadRequest';
    this.isErrorFrame = true;
    this.codeName = 'BadRequest';
    this.errorCode = Codes.BadRequest;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function NetworkErrorError(opts) {
    this.name = 'TchannelNetworkError';
    this.fullType = 'tchannel.network';
    this.type = 'tchannel.network';
    this.message = 'TChannel network error';
    this.isErrorFrame = true;
    this.codeName = 'NetworkError';
    this.errorCode = Codes.NetworkError;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function ProtocolErrorError(opts) {
    this.name = 'TchannelProtocolError';
    this.fullType = 'tchannel.protocol';
    this.type = 'tchannel.protocol';
    this.message = 'TChannel protocol error';
    this.isErrorFrame = true;
    this.codeName = 'ProtocolError';
    this.errorCode = Codes.ProtocolError;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

function UnhealthyError(opts) {
    this.name = 'TchannelUnhealthyError';
    this.fullType = 'tchannel.unhealthy';
    this.type = 'tchannel.unhealthy';
    this.message = 'TChannel unhealthy';
    this.isErrorFrame = true;
    this.codeName = 'Unhealthy';
    this.errorCode = Codes.Unhealthy;
    this.originalId = null;
    this.remoteAddr = null;
    if (opts) {
        if (opts.message !== undefined) {
            this.message = opts.message;
        }
        if (opts.originalId !== undefined) {
            this.originalId = opts.originalId;
        }
        if (opts.remoteAddr !== undefined) {
            this.remoteAddr = opts.remoteAddr;
        }
    }
}

var CodeErrors = Object.create(null);
CodeErrors[Codes.Timeout] = TimeoutError;
CodeErrors[Codes.Cancelled] = CancelledError;
CodeErrors[Codes.Busy] = BusyError;
CodeErrors[Codes.Declined] = DeclinedError;
CodeErrors[Codes.UnexpectedError] = UnexpectedErrorError;
CodeErrors[Codes.BadRequest] = BadRequestError;
CodeErrors[Codes.NetworkError] = NetworkErrorError;
CodeErrors[Codes.ProtocolError] = ProtocolErrorError;
CodeErrors[Codes.Unhealthy] = UnhealthyError;

ErrorResponse.Codes = Codes;
ErrorResponse.CodeNames = CodeNames;
ErrorResponse.CodeErrors = CodeErrors;

ErrorResponse.RW = bufrw.Struct(ErrorResponse, [
    {call: {poolWriteInto: function writeGuard(destResult, body, buffer, offset) {
        if (CodeNames[body.code] === undefined) {
            return destResult.reset(errors.InvalidErrorCodeError({
                errorCode: body.code,
                tracing: body.tracing
            }), offset);
        }
        return destResult.reset(null, offset);
    }}},
    {name: 'code', rw: bufrw.UInt8},    // code:1
    {name: 'tracing', rw: Tracing.RW},  // tracing:25
    {name: 'message', rw: bufrw.str2},  // message~2
    {call: {poolWriteInto: function writeGuard(destResult, body, buffer, offset) {
        if (CodeNames[body.code] === undefined) {
            destResult.reset(errors.InvalidErrorCodeError({
                errorCode: body.code,
                tracing: body.tracing
            }), offset);
        }
        return destResult.reset(null, offset);
    }}}
]);

ErrorResponse.RW.lazy = {};

ErrorResponse.RW.lazy.isFrameTerminal = function isFrameTerminal() {
    return true;
};

ErrorResponse.RW.lazy.codeOffset = Frame.Overhead;
ErrorResponse.RW.lazy.readCode = function readCode(frame) {
    // code:1
    return bufrw.UInt8.readFrom(frame.buffer, ErrorResponse.RW.lazy.codeOffset);
};

ErrorResponse.RW.lazy.tracingOffset = ErrorResponse.RW.lazy.codeOffset + 1;
ErrorResponse.RW.lazy.readTracing = function readTracing(frame) {
    // tracing:25
    return Tracing.RW.readFrom(frame.buffer, ErrorResponse.RW.lazy.tracingOffset);
};

ErrorResponse.RW.lazy.mesasgeOffset = ErrorResponse.RW.lazy.tracingOffset + 25;
ErrorResponse.RW.lazy.readMessage = function readMessage(frame) {
    // mesasge~2
    return bufrw.str2.readFrom(frame.buffer, ErrorResponse.RW.lazy.mesasgeOffset);
};

module.exports = ErrorResponse;
