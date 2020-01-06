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
/* eslint max-statements: [1, 30] */

Frame.Overhead = 0x10;
Frame.MaxSize = 0xffff;
Frame.MaxBodySize = Frame.MaxSize - Frame.Overhead;
Frame.MaxId = 0xfffffffe;
Frame.NullId = 0xffffffff;

Frame.Types = {};
module.exports = Frame;

var bufrw = require('bufrw');
var errors = require('../errors');

var Types = require('./index.js').Types;

function Frame(id, body) {
    this.isLazy = false;
    this.size = 0;
    this.type = (body && body.type) || 0;
    if (id === null || id === undefined) {
        this.id = Frame.NullId;
    } else {
        this.id = id;
    }
    this.body = body;
}

// size:2: type:1 reserved:1 id:4 reserved:8 ...
Frame.RW = bufrw.Base(frameLength, readFrameFrom, writeFrameInto, true);

function frameLength(destResult, frame) {
    var body = frame.body;
    var bodyRW = body.constructor.RW;

    var length = 0;
    length += bufrw.UInt16BE.width; // size:2:
    length += bufrw.UInt8.width;    // type:1
    length += 1;                    // reserved:1
    length += bufrw.UInt32BE.width; // id:4
    length += 8;                    // reserved:8 ...

    var res = bodyRW.poolByteLength(destResult, body);
    if (!res.err) {
        res.length += length;
    }
    return res;
}

function readFrameFrom(destResult, buffer, offset) {
    // TODO: pool Frame object
    var frame = new Frame();

    var res;

    res = bufrw.UInt16BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    frame.size = res.value;

    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    frame.type = res.value;

    var BodyType = Frame.Types[frame.type];
    if (!BodyType) {
        return destResult.reset(errors.InvalidFrameTypeError({
            typeNumber: frame.type
        }), offset - 1);
    }

    offset += 1;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    frame.id = res.value;

    offset += 8;

    res = BodyType.RW.poolReadFrom(destResult, buffer, offset);
    if (res.err) {
        if (frame.type === Types.CallRequest ||
            frame.type === Types.CallRequestCont
        ) {
            // TODO: wrapped?
            res.err.frameId = frame.id;
        }
        return res;
    }
    offset = res.offset;
    frame.body = res.value;

    res.value = frame;
    return res;
}

function writeFrameInto(destResult, frame, buffer, offset) {
    var body = frame.body;
    var bodyRW = body.constructor.RW;

    var start = offset;
    var end = offset;
    var res;

    // skip size, write later
    offset += bufrw.UInt16BE.width;

    res = bufrw.UInt8.poolWriteInto(destResult, frame.type, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    end = offset + 1;
    buffer.fill(0, offset, end);
    offset = end;

    res = bufrw.UInt32BE.poolWriteInto(destResult, frame.id, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    end = offset + 8;
    buffer.fill(0, offset, end);
    offset = end;

    res = bodyRW.poolWriteInto(destResult, body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    frame.size = res.offset - start;
    res = bufrw.UInt16BE.poolWriteInto(destResult, frame.size, buffer, start);
    if (res.err) return res;
    res.offset = offset;

    return res;
}

// TODO: pool below
Frame.fromBuffer = function fromBuffer(buffer) {
    return bufrw.fromBuffer(Frame.RW, buffer, 0);
};

Frame.prototype.byteLength = function byteLength() {
    return bufrw.byteLength(Frame.RW, this);
};

Frame.prototype.intoBuffer = function intoBuffer(buffer) {
    return bufrw.intoBuffer(Frame.RW, this, buffer);
};

Frame.prototype.toBuffer = function toBuffer() {
    return bufrw.toBuffer(Frame.RW, this);
};
