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

var assert = require('assert');
var bufrw = require('bufrw');
var errors = require('../errors');

var Frame = require('./frame.js');
var Types = require('./index.js').Types;

module.exports = LazyFrame;

function LazyFrame(size, type, id, buffer) {
    this.isLazy = true;
    this.size = size;
    this.type = type;
    this.id = id;
    this.buffer = buffer;
    this.start = null;

    this.body = null;
    this.bodyRW = null;
    this.cache = new CallRequestCache();
    this.circuit = null;
}

function CallRequestCache() {
    this.serviceStr = null;
    this.callerNameStr = null;
    this.routingDelegateStr = null;
    this.arg1Str = null;
    this.ttlValue = null;
    this.tracingValue = null;

    this.headerStartOffset = null;
    this.csumStartOffset = null;

    this.cnValueOffset = null;
    this.rdValueOffset = null;

    this.lastError = null;
}

// size:2 type:1 reserved:1 id:4 reserved:8 ...
LazyFrame.RW = bufrw.Base(lazyFrameLength, readLazyFrameFrom, writeLazyFrameInto);

LazyFrame.TypeOffset = 2;
LazyFrame.IdOffset = 2 + 1 + 1;
LazyFrame.BodyOffset = Frame.Overhead;

LazyFrame.prototype.setId = function setId(id) {
    assert.ok(this.buffer, 'must have a buffer supplied');
    this.id = id;
    this.buffer.writeUInt32BE(this.id, LazyFrame.IdOffset);
};

LazyFrame.prototype.readBody = function readBody() {
    if (this.body) {
        return bufrw.ReadResult.just(this.body);
    }

    if (!this.buffer) {
        // TODO: typed error
        return bufrw.ReadResult.error(new Error('no buffer to read from'));
    }

    var res = this.bodyRW.readFrom(this.buffer, LazyFrame.BodyOffset);

    if (res.err) {
        if (this.type === Types.CallRequest ||
            this.type === Types.CallRequestCont
        ) {
            // TODO: wrapped?
            res.err.frameId = this.id;
        }
    } else {
        this.body = res.value;
    }

    return res;
};

function lazyFrameLength(lazyFrame) {
    return bufrw.LengthResult.just(lazyFrame.size);
}

function readLazyFrameFrom(buffer, offset) {
    var start = offset;

    // size:2:
    if (buffer.length < offset + 2) {
        return bufrw.ReadResult.shortError(
            offset + 2, buffer.length, offset
        );
    }
    var size = buffer.readUInt16BE(offset);
    offset += size;

    if (buffer.length < offset) {
        return bufrw.ReadResult.shortError(
            offset, buffer.length, start
        );
    }
    var frameBuffer = buffer.slice(start, offset);

    // type:1
    var type = frameBuffer.readUInt8(LazyFrame.TypeOffset);

    // id:4
    var id = frameBuffer.readUInt32BE(LazyFrame.IdOffset);

    var lazyFrame = new LazyFrame(size, type, id, frameBuffer);
    var BodyType = Frame.Types[lazyFrame.type];

    if (!BodyType) {
        return bufrw.ReadResult.error(errors.InvalidFrameTypeError({
            typeNumber: lazyFrame.type
        }), offset + LazyFrame.TypeOffset);
    }

    lazyFrame.bodyRW = BodyType.RW;

    return bufrw.ReadResult.just(offset, lazyFrame);
}

function writeLazyFrameInto(lazyFrame, buffer, offset) {
    if (!lazyFrame.buffer) {
        return bufrw.WriteResult.error(errors.CorruptWriteLazyFrame({
            context: 'missing buffer'
        }));
    }

    var remain = buffer.length - offset;
    if (lazyFrame.size > remain) {
        return bufrw.WriteResult.shortError(lazyFrame.size, remain, offset);
    }

    offset += lazyFrame.buffer.copy(buffer, offset, 0, lazyFrame.size);
    return bufrw.WriteResult.just(offset);
}
