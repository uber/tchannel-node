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

/* eslint-disable curly */
/* eslint max-statements: [1, 31] */

var bufrw = require('bufrw');
var Buffer = require('buffer').Buffer;

module.exports = Tracing;

var emptySpanId = Buffer(8);
var emptyParentId = Buffer(8);
var emptyTraceId = Buffer(8);
emptySpanId.fill(0);
emptyParentId.fill(0);
emptyTraceId.fill(0);

function Tracing(spanid, parentid, traceid, flags) {
    this.spanid = spanid || [0, 0];
    this.parentid = parentid || [0, 0];
    this.traceid = traceid || [0, 0];
    this.flags = flags || 0;
}

Tracing.RW = bufrw.Base(tracingByteLength, readTracingFrom, writeTracingInto, true);

function tracingByteLength(destResult) {
    return destResult.reset(
        null,
        8 + // spanid:8
        8 + // parentid:8
        8 + // traceid:8
        1   // flags:1
    );
}

function writeTracingInto(destResult, tracing, buffer, offset) {
    var res;

    res = bufrw.UInt32BE.poolWriteInto(destResult, tracing.spanid[0], buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    res = bufrw.UInt32BE.poolWriteInto(destResult, tracing.spanid[1], buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    res = bufrw.UInt32BE.poolWriteInto(destResult, tracing.parentid[0], buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    res = bufrw.UInt32BE.poolWriteInto(destResult, tracing.parentid[1], buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    res = bufrw.UInt32BE.poolWriteInto(destResult, tracing.traceid[0], buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    res = bufrw.UInt32BE.poolWriteInto(destResult, tracing.traceid[1], buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    res = bufrw.UInt8.poolWriteInto(destResult, tracing.flags, buffer, offset);

    return res;
}

function readTracingFrom(destResult, buffer, offset) {
    var tracing = new Tracing();
    var res;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.spanid[0] = res.value;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.spanid[1] = res.value;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.parentid[0] = res.value;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.parentid[1] = res.value;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.traceid[0] = res.value;

    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.traceid[1] = res.value;

    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    tracing.flags = res.value;

    return destResult.reset(null, offset, tracing);
}

Tracing.emptyTracing = new Tracing();
