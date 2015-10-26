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
var assert = require('assert');

var SIZE_BYTE_LENGTH = 2;

module.exports = FrameParser;

function FrameParser(context, onFrameBuffer) {
    if (!(this instanceof FrameParser)) {
        return new FrameParser(context, onFrameBuffer);
    }

    var self = this;

    self.remainderBuffer = null;
    self.hasTempRemainderBuffer = false;
    self.remainderOffset = 0;

    self.frameLength = 0;

    self._context = context;
    self._onFrameBuffer = onFrameBuffer;
}

/*eslint max-statements: [2, 25]*/
FrameParser.prototype.write =
function write(networkBuffer) {
    var self = this;

    var networkBufferLength = networkBuffer.length;
    assert(networkBufferLength > 0, 'Cannot write() empty buffer');

    var maximumBytesAvailable = self.remainderOffset + networkBufferLength;
    if (maximumBytesAvailable < SIZE_BYTE_LENGTH) {
        self._addRemainder(networkBuffer, 0, networkBufferLength);
        return;
    }

    if (self.frameLength === 0) {
        self._readInitialFrameLength(networkBuffer);
    }

    if (self.frameLength > maximumBytesAvailable) {
        self._addRemainder(networkBuffer, 0, networkBufferLength);
        return;
    }

    var startOfBuffer = 0;

    while (self.frameLength <= maximumBytesAvailable) {
        var amountToRead = self.frameLength - self.remainderOffset;
        var endOfBuffer = startOfBuffer + amountToRead;

        self._pushFrameBuffer(networkBuffer, startOfBuffer, endOfBuffer);
        startOfBuffer = endOfBuffer;

        if (networkBufferLength - startOfBuffer < SIZE_BYTE_LENGTH) {
            break;
        }

        maximumBytesAvailable = networkBufferLength - startOfBuffer;
        self.frameLength = networkBuffer.readUInt16BE(startOfBuffer);
    }

    if (startOfBuffer < networkBufferLength) {
        self._addRemainder(networkBuffer, startOfBuffer, networkBufferLength);
    }
};

FrameParser.prototype._addRemainder =
function _addRemainder(networkBuffer, start, end) {
    var self = this;

    if (self.frameLength === 0) {
        // Maybe allocate a new FastBuffer (cheap)
        var rawFrameBuffer = maybeSlice(networkBuffer, start, end);

        assert(self.remainderBuffer === null,
            'Cannot assign remainderBuffer twice');
        self.remainderBuffer = rawFrameBuffer;
        self.remainderOffset = rawFrameBuffer.length;
        self.hasTempRemainderBuffer = true;
        return;
    }

    if (self.remainderBuffer === null || self.hasTempRemainderBuffer) {
        var oldRemainder = self.remainderBuffer;

        // Allocate a SlowBuffer (expensive)
        self.remainderBuffer = new Buffer(self.frameLength);
        self.hasTempRemainderBuffer = false;

        if (oldRemainder) {
            oldRemainder.copy(self.remainderBuffer, 0);
        }
    }

    networkBuffer.copy(self.remainderBuffer, self.remainderOffset, start, end);
    self.remainderOffset += (end - start);
};

FrameParser.prototype._pushFrameBuffer =
function _pushFrameBuffer(networkBuffer, start, end) {
    var self = this;

    var frameBuffer;
    if (self.remainderOffset === 0) {
        // Maybe allocate a new FastBuffer (cheap)
        frameBuffer = maybeSlice(networkBuffer, start, end);
    } else {
        self._addRemainder(networkBuffer, start, end);

        frameBuffer = self.remainderBuffer;

        self.remainderBuffer = null;
        self.hasTempRemainderBuffer = false;
        self.remainderOffset = 0;
    }

    self._onFrameBuffer(self._context, frameBuffer);
    self.frameLength = 0;
};

FrameParser.prototype._readInitialFrameLength =
function _readInitialFrameLength(networkBuffer) {
    var self = this;

    if (self.remainderOffset === 0) {
        self.frameLength = networkBuffer.readUInt16BE(0);
    } else if (self.remainderOffset === 1) {
        self.frameLength = self.remainderBuffer[0] << 8 | networkBuffer[0];
    } else if (self.remainderOffset >= 2) {
        self.frameLength = self.remainderBuffer.readUInt16BE(0);
    }
};

function maybeSlice(buf, start, end) {
    var slice;
    if (start === 0 && end === buf.length) {
        slice = buf;
    } else {
        slice = buf.slice(start, end);
    }

    return slice;
}
