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

var inherits = require('util').inherits;

var OutArgStream = require('./argstream').OutArgStream;
var pipelineStreams = require('./lib/pipeline_streams');
var TChannelOutRequest = require('./out_request');
var States = require('./reqres_states');

function StreamingOutRequest(id, options) {
    TChannelOutRequest.call(this, id, options);
    this.streamed = true;
    this._argstream = new OutArgStream();
    this.arg2 = this._argstream.arg2;
    this.arg3 = this._argstream.arg3;

    var self = this;
    this._argstream.errorEvent.on(passError);
    this._argstream.frameEvent.on(onFrame);
    this._argstream.finishEvent.on(onFinish);

    function passError(err) {
        self.errorEvent.emit(self, err);
    }

    function onFrame(tup) {
        var parts = tup[0];
        var isLast = tup[1];
        if (self.state === States.Initial) {
            parts.unshift(self.arg1);
        }
        self.sendParts(parts, isLast);
    }

    function onFinish() {
        self.finishEvent.emit(self);
    }
}

inherits(StreamingOutRequest, TChannelOutRequest);

StreamingOutRequest.prototype.type = 'tchannel.outgoing-request.streaming';

StreamingOutRequest.prototype.sendArg1 = function sendArg1(arg1) {
    var self = this;

    TChannelOutRequest.prototype.sendArg1.call(self, arg1);
    self._argstream.deferFlushParts();
};

StreamingOutRequest.prototype.send = function send(arg1, arg2, arg3, callback) {
    var self = this;

    if (callback) {
        self.hookupCallback(callback);
    }

    self.sendArg1(arg1);
    self.arg2.end(arg2);
    self.arg3.end(arg3);

    return self;
};

StreamingOutRequest.prototype.sendStreams = function sendStreams(arg1, arg2, arg3, callback) {
    var self = this;

    if (callback) {
        self.hookupStreamCallback(callback);
    }

    self.sendArg1(arg1);
    pipelineStreams([arg2, arg3], [self.arg2, self.arg3]);

    return self;
};

module.exports = StreamingOutRequest;
