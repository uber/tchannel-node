'use strict';

/* @flow */

var Buffer = require('buffer').Buffer;
var assert = require('assert');

var SIZE_BYTE_LENGTH = 2;

/*::
import * as type from './parser.h.js';
declare var FrameParser : Class<type.FrameParser>
*/

module.exports = FrameParser;

function FrameParser(context, onFrameBuffer) {
    var self/*:FrameParser*/ = this;

    self.remainderBuffer = null;
    self.hasTempRemainderBuffer = false;
    self.remainderOffset = 0;

    self.frameLength = 0;

    self._context = context;
    self._onFrameBuffer = onFrameBuffer;
}

FrameParser.prototype.write =
function write(networkBuffer, start, end) {
    var self/*:FrameParser*/ = this;
    // console.log('FrameParser.write()');

    var networkBufferLength = end - start;
    var endOfNetworkBuffer = end;
    assert(networkBufferLength > 0, 'Cannot write() empty buffer');

    var startOfBuffer = start;

    var maximumBytesAvailable = self.remainderOffset + networkBufferLength;
    if (maximumBytesAvailable < SIZE_BYTE_LENGTH) {
        self._addRemainder(networkBuffer, startOfBuffer, endOfNetworkBuffer);
        return;
    }

    if (self.frameLength === 0) {
        self._readInitialFrameLength(networkBuffer, startOfBuffer);
    }

    if (self.frameLength > maximumBytesAvailable) {
        self._addRemainder(networkBuffer, startOfBuffer, endOfNetworkBuffer);
        return;
    }

    while (self.frameLength <= maximumBytesAvailable) {
        // console.log('FrameParser() while loop', {
        //     frameLength: self.frameLength,
        //     maximumBytesAvailable: maximumBytesAvailable,
        //     startOfBuffer: startOfBuffer,
        //     networkBufferLength: networkBufferLength
        // });
        var amountToRead = self.frameLength - self.remainderOffset;
        var endOfBuffer = startOfBuffer + amountToRead;

        self._pushFrameBuffer(networkBuffer, startOfBuffer, endOfBuffer);
        startOfBuffer = endOfBuffer;

        if (endOfNetworkBuffer - startOfBuffer < SIZE_BYTE_LENGTH) {
            // console.log('FrameParser() break', {
            //     endOfNetworkBuffer: endOfNetworkBuffer,
            //     startOfBuffer: startOfBuffer
            // });
            break;
        }

        maximumBytesAvailable = endOfNetworkBuffer - startOfBuffer;
        self.frameLength = networkBuffer.readUInt16BE(startOfBuffer, false);
    }

    if (startOfBuffer < endOfNetworkBuffer) {
        self._addRemainder(networkBuffer, startOfBuffer, endOfNetworkBuffer);
    }
};

FrameParser.prototype._addRemainder =
function _addRemainder(networkBuffer, start, end) {
    var self/*:FrameParser*/ = this;
    // console.log('FrameParser()._addRemainder');

    if (self.frameLength === 0) {
        // Maybe allocate a new FastBuffer (cheap)
        var rawFrameBuffer = maybeSlice(networkBuffer, start, end);

        assert(self.remainderBuffer === null,
            'Cannot assign remainderBuffer twice');
        self.remainderBuffer = rawFrameBuffer;
        self.remainderOffset = rawFrameBuffer.length;
        self.hasTempRemainderBuffer = true;
        return self.remainderBuffer;
    }

    var remainderBuffer = self.remainderBuffer;
    if (remainderBuffer === null || self.hasTempRemainderBuffer) {
        var oldRemainder = self.remainderBuffer;

        // Allocate a SlowBuffer (expensive)
        remainderBuffer = self.remainderBuffer = new Buffer(self.frameLength);
        self.hasTempRemainderBuffer = false;

        if (oldRemainder) {
            oldRemainder.copy(remainderBuffer, 0);
        }
    }

    networkBuffer.copy(remainderBuffer, self.remainderOffset, start, end);
    self.remainderOffset += (end - start);

    return remainderBuffer;
};

FrameParser.prototype._pushFrameBuffer =
function _pushFrameBuffer(networkBuffer, start, end) {
    var self/*:FrameParser*/ = this;

    var frameBuffer = networkBuffer;
    if (self.remainderOffset !== 0) {
        frameBuffer = self._addRemainder(networkBuffer, start, end);

        start = 0;
        end = frameBuffer.length;

        self.remainderBuffer = null;
        self.hasTempRemainderBuffer = false;
        self.remainderOffset = 0;
    }

    // console.log('FrameParser._onFrameBuffer()');
    self._onFrameBuffer(self._context, frameBuffer, start, end);
    self.frameLength = 0;
};

FrameParser.prototype._readInitialFrameLength =
function _readInitialFrameLength(networkBuffer, start) {
    var self/*:FrameParser*/ = this;

    if (self.remainderOffset === 0) {
        self.frameLength = networkBuffer.readUInt16BE(start, false);
    } else if (self.remainderBuffer && self.remainderOffset === 1) {
        self.frameLength = self.remainderBuffer[0] << 8 | networkBuffer[start];
    } else if (self.remainderBuffer && self.remainderOffset >= 2) {
        self.frameLength = self.remainderBuffer.readUInt16BE(0, false);
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
