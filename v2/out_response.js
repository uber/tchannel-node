// Copyright (c) 2020 Uber Technologies, Inc.
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

/* eslint-disable curly */

var inherits = require('util').inherits;

var OutResponse = require('../out_response');
var StreamingOutResponse = require('../streaming_out_response');

var CallFlags = require('./call_flags');
var v2 = require('./index');
var errors = require('../errors');

function V2OutResponse(handler, id, options) {
    OutResponse.call(this, id, options);
    this.handler = handler;
}

inherits(V2OutResponse, OutResponse);

function V2StreamingOutResponse(handler, id, options) {
    StreamingOutResponse.call(this, id, options);
    this.handler = handler;
}

inherits(V2StreamingOutResponse, StreamingOutResponse);

V2OutResponse.prototype._sendCallResponse =
V2StreamingOutResponse.prototype._sendCallResponse =
function _sendCallResponse(args, isLast) {
    var flags = 0;
    if (args && args[0] && args[0].length > v2.MaxArg1Size) {
        this.errorEvent.emit(this, errors.Arg1OverLengthLimit({
            length: args[0].length,
            limit: v2.MaxArg1Size
        }));
        return;
    }
    if (!isLast) flags |= CallFlags.Fragment;
    this.handler.sendCallResponseFrame(this, flags, args);
};

V2OutResponse.prototype._sendCallResponseCont =
V2StreamingOutResponse.prototype._sendCallResponseCont =
function _sendCallResponseCont(args, isLast) {
    var flags = 0;
    if (!isLast) flags |= CallFlags.Fragment;
    this.handler.sendCallResponseContFrame(this, flags, args);
};

V2OutResponse.prototype._sendError =
V2StreamingOutResponse.prototype._sendError =
function _sendError(codeString, message) {
    this.handler.sendErrorFrame(this.id, this.tracing, codeString, message);
};

module.exports.OutResponse = V2OutResponse;
module.exports.StreamingOutResponse = V2StreamingOutResponse;
