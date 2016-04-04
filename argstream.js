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

/*
 * Provides federated streams for handling call arguments
 *
 * InArgStream is for handling incoming arg parts from call frames.  It handles
 * dispatching the arg chunks into .arg{1,2,3} streams.
 *
 * OutArgStream is for creating outgoing arg parts by writing to .arg{1,2,3}
 * streams.  It handles buffering as many parts as are written within one event
 * loop tick into an Array of arg chunks.  Such array is then flushed using
 * setImmediate.
 *
 * Due to the semantic complexity involved here, this code is tested by an
 * accompanying exhaistive search test in test/argstream.js.  This test has
 * both unit tests (disabled by default for speed) and an integration test.
 */

var inherits = require('util').inherits;
var EventEmitter = require('./lib/event_emitter');
var PassThrough = require('stream').PassThrough;
var Ready = require('ready-signal');
var Buffer = require('buffer').Buffer;
var setImmediate = require('timers').setImmediate;
var clearImmediate = require('timers').clearImmediate;

var errors = require('./errors');

function ArgStream() {
    EventEmitter.call(this);
    this.errorEvent = this.defineEvent('error');
    this.frameEvent = this.defineEvent('frame');
    this.finishEvent = this.defineEvent('finish');
    this.arg2 = new StreamArg();
    this.arg3 = new StreamArg();

    var self = this;
    this.arg2.on('error', passError);
    this.arg3.on('error', passError);
    this.arg3.on('start', onArg3Start);

    function passError(err) {
        self.errorEvent.emit(self, err);
    }

    function onArg3Start() {
        if (!self.arg2._writableState.ended) {
            self.arg2.end();
        }
    }
}

inherits(ArgStream, EventEmitter);

function InArgStream() {
    ArgStream.call(this);
    this.streams = [this.arg2, this.arg3];
    this._iStream = 0;
    this.finished = false;
    this._numFinished = 0;

    var self = this;
    this.arg2.on('finish', argFinished);
    this.arg3.on('finish', argFinished);

    function argFinished() {
        if (++self._numFinished >= 2 && !self.finished) {
            self.finished = true;
            self.finishEvent.emit(self);
        }
    }
}

inherits(InArgStream, ArgStream);

InArgStream.prototype.handleFrame = function handleFrame(parts, isLast) {
    var self = this;
    var stream = self.streams[self._iStream];

    if (self.finished) {
        // return new Error('unknown frame handling state');
        return errors.ArgStreamFinishedError();
    }

    for (var i = 0; i < parts.length; i++) {
        if (i > 0) {
            stream = advance();
        }
        if (!stream) {
            break;
        }
        if (parts[i].length) {
            stream.write(parts[i]);
        }
    }
    if (i < parts.length) {
        return errors.ArgStreamExceededFramePartsError();
    }

    if (isLast) {
        while (stream) {
            stream = advance();
        }
    }

    return null;

    function advance() {
        if (self._iStream < self.streams.length) {
            self.streams[self._iStream].end();
            self._iStream++;
        }
        return self.streams[self._iStream];
    }
};

function OutArgStream() {
    ArgStream.call(this);
    this._flushImmed = null;
    this.finished = false;
    this.frame = [Buffer(0)];
    this.currentArgN = 2;

    var self = this;
    this.arg2.on('data', onArg2Data);
    this.arg3.on('data', onArg3Data);
    this.arg2.on('finish', onArg2Finish);
    this.arg3.on('finish', onArg3Finish);

    function onArg2Data(chunk) {
        self._handleFrameChunk(2, chunk);
    }

    function onArg3Data(chunk) {
        self._handleFrameChunk(3, chunk);
    }

    function onArg2Finish() {
        self._handleFrameChunk(2, null);
    }

    function onArg3Finish() {
        if (!self.finished) {
            self._handleFrameChunk(3, null);
            self._flushParts(true);
            self.finished = true;
            self.finishEvent.emit(self);
        }
    }
}

inherits(OutArgStream, ArgStream);

OutArgStream.prototype._handleFrameChunk = function _handleFrameChunk(n, chunk) {
    var self = this;
    if (n < self.currentArgN) {
        self.errorEvent.emit(self, errors.ArgChunkOutOfOrderError({
            current: self.currentArgN,
            got: n
        }));
    } else if (n > self.currentArgN) {
        if (n - self.currentArgN > 1) {
            self.errorEvent.emit(self, errors.ArgChunkGapError({
                current: self.currentArgN,
                got: n
            }));
        }
        self.currentArgN++;
        self.frame.push(chunk);
    } else if (chunk === null) {
        if (++self.currentArgN <= 3) {
            self.frame.push(Buffer(0));
        }
    } else {
        self._appendFrameChunk(chunk);
    }
    self.deferFlushParts();
};

OutArgStream.prototype._appendFrameChunk = function _appendFrameChunk(chunk) {
    var self = this;
    var i = self.frame.length - 1;
    var buf = self.frame[i];
    if (buf.length) {
        self.frame[i] = Buffer.concat([buf, chunk]);
    } else {
        self.frame[i] = chunk;
    }
};

OutArgStream.prototype.deferFlushParts = function deferFlushParts() {
    var self = this;
    if (!self._flushImmed) {
        self._flushImmed = setImmediate(function flushParts() {
            self._flushParts();
        });
    }
};

OutArgStream.prototype._flushParts = function _flushParts(isLast) {
    var self = this;
    if (self._flushImmed) {
        clearImmediate(self._flushImmed);
        self._flushImmed = null;
    }
    if (self.finished) {
        return;
    }
    isLast = Boolean(isLast);
    var frame = self.frame;
    self.frame = [Buffer(0)];
    if (frame.length) {
        self.frameEvent.emit(self, [frame, isLast]);
    }
};

function StreamArg(options) {
    PassThrough.call(this, options);
    this.started = false;
    this.buf = null;
    this.onValueReady = boundOnValueReady;

    var self = this;

    function boundOnValueReady(callback) {
        self._onValueReady(callback);
    }
}
inherits(StreamArg, PassThrough);

StreamArg.prototype._write = function _write(chunk, encoding, callback) {
    var self = this;
    if (!self.started) {
        self.started = true;
        self.emit('start');
    }
    PassThrough.prototype._write.call(self, chunk, encoding, callback);
};

StreamArg.prototype._onValueReady = function onValueReady(callback) {
    var self = this;
    self.onValueReady = Ready();
    bufferStreamData(self, self.onValueReady.signal);
    self.onValueReady(callback);
};

function bufferStreamData(stream, callback) {
    var parts = [];
    stream.on('data', onData);
    stream.on('error', finish);
    stream.on('end', finish);
    function onData(chunk) {
        parts.push(chunk);
    }
    function finish(err) {
        stream.removeListener('data', onData);
        stream.removeListener('error', finish);
        stream.removeListener('end', finish);
        var buf = Buffer.concat(parts);
        stream.buf = buf;
        if (err === undefined) {
            err = null;
        }
        callback(err, buf);
    }
}

module.exports.InArgStream = InArgStream;
module.exports.OutArgStream = OutArgStream;
