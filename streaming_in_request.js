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

var parallel = require('run-parallel');
var InRequest = require('./in_request');
var inherits = require('util').inherits;
var errors = require('./errors');
var Buffer = require('buffer').Buffer;

var States = require('./reqres_states');
var InArgStream = require('./argstream').InArgStream;

// Node.js deprecated Buffer in favor of Buffer.alloc and Buffer.from.
// istanbul ignore next
var bufferAlloc = Buffer.alloc || Buffer;

var emptyBuffer = bufferAlloc(0);

function StreamingInRequest(id, options) {
    InRequest.call(this, id, options);

    this.streamed = true;
    this._argstream = new InArgStream();
    this.arg2 = this._argstream.arg2;
    this.arg3 = this._argstream.arg3;

    var self = this;
    this._argstream.errorEvent.on(passError);
    this._argstream.finishEvent.on(onFinish);

    function passError(err) {
        self.errorEvent.emit(self, err);
    }

    function onFinish() {
        self.emitFinish();
    }
}

inherits(StreamingInRequest, InRequest);

StreamingInRequest.prototype.type = 'tchannel.incoming-request.streaming';

StreamingInRequest.prototype.handleFrame = function handleFrame(parts, isLast) {
    var self = this;

    if (self.state === States.Initial) {
        if (parts.length < 2) {
            return errors.Arg1Fragmented();
        }

        self.arg1 = parts.shift() || emptyBuffer;
        self.endpoint = String(self.arg1);
        if (self.span) {
            self.span.name = self.endpoint;
        }
        self.state = States.Streaming;
    } else if (self.state !== States.Streaming) {
        return errors.ArgStreamUnknownFrameHandlingStateError();
    }

    var err = self._argstream.handleFrame(parts, isLast);
    if (err) {
        return err;
    }

    if (!isLast && self.state !== States.Streaming) {
        return errors.ArgStreamUnknownFrameHandlingStateError();
    }

    return null;
};

// TODO: deprecated, remove
StreamingInRequest.prototype.withArg1 = function withArg1(callback) {
    var self = this;
    callback(null, self.arg1);
};

StreamingInRequest.prototype.withArg2 = function withArg2(callback) {
    var self = this;
    self.arg2.onValueReady(callback);
};

StreamingInRequest.prototype.withArg23 = function withArg23(callback) {
    var self = this;
    parallel({
        arg2: self.arg2.onValueReady,
        arg3: self.arg3.onValueReady
    }, compatCall);
    function compatCall(err, args) {
        callback(err, args.arg2, args.arg3);
    }
};

module.exports = StreamingInRequest;
