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
var Checksum = require('./checksum');
var ArgsRW = require('./args');
var Frame = require('./frame');
var CallFlags = require('./call_flags');
var argsrw = new ArgsRW();

/* eslint-disable curly */

// flags:1 csumtype:1 (csum:4){0,1} (arg~2)+
function CallRequestCont(flags, csum, args) {
    this.type = CallRequestCont.TypeCode;
    this.flags = flags || 0;
    this.csum = Checksum.objOrType(csum);
    this.args = args || [];
    this.cont = null;
}

CallRequestCont.TypeCode = 0x13;
CallRequestCont.Cont = CallRequestCont;
CallRequestCont.RW = bufrw.Base(callReqContLength, readCallReqContFrom, writeCallReqContInto, true);

CallRequestCont.RW.lazy = {};

CallRequestCont.RW.lazy.flagsOffset = Frame.Overhead;
CallRequestCont.RW.lazy.readFlags = function readFlags(frame) {
    // flags:1
    return bufrw.UInt8.readFrom(frame.buffer, CallRequestCont.RW.lazy.flagsOffset);
};

CallRequestCont.RW.lazy.isFrameTerminal = function isFrameTerminal(frame) {
    var flags = CallRequestCont.RW.lazy.readFlags(frame);
    var frag = flags.value & CallFlags.Fragment;
    return !frag;
};

function callReqContLength(destResult, body) {
    var res;
    var length = 0;

    // flags:1
    length += bufrw.UInt8.width;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolByteLength(destResult, body);
    if (!res.err) res.length += length;

    return res;
}

function readCallReqContFrom(destResult, buffer, offset) {
    var res;
    // TODO: allow these to be pooled
    var body = new CallRequestCont();

    // flags:1
    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.flags = res.value;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolReadFrom(destResult, body, buffer, offset);
    if (!res.err) res.value = body;

    return res;
}

function writeCallReqContInto(destResult, body, buffer, offset) {
    var start = offset;
    var res;

    // flags:1 -- skip for now, write args frist
    offset += bufrw.UInt8.width;

    // csumtype:1 (csum:4){0,1} (arg~2)* -- (may mutate body.flags)
    res = argsrw.poolWriteInto(destResult, body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // now we know the final flags, write them
    res = bufrw.UInt8.poolWriteInto(destResult, body.flags, buffer, start);
    if (!res.err) res.offset = offset;

    return res;
}

CallRequestCont.prototype.verifyChecksum = function verifyChecksum(prior) {
    return this.csum.verify(this.args, prior);
};

// flags:1 csumtype:1 (csum:4){0,1} (arg~2)+
function CallResponseCont(flags, csum, args) {
    this.type = CallResponseCont.TypeCode;
    this.flags = flags || 0;
    this.csum = Checksum.objOrType(csum);
    this.args = args || [];
    this.cont = null;
}

CallResponseCont.TypeCode = 0x14;
CallResponseCont.Cont = CallResponseCont;
CallResponseCont.RW = bufrw.Base(callResContLength, readCallResContFrom, writeCallResContInto, true);

CallResponseCont.RW.lazy = {};

CallResponseCont.RW.lazy.flagsOffset = Frame.Overhead;
CallResponseCont.RW.lazy.readFlags = function readFlags(frame) {
    // flags:1
    return bufrw.UInt8.readFrom(frame.buffer, CallResponseCont.RW.lazy.flagsOffset);
};

CallResponseCont.RW.lazy.isFrameTerminal = function isFrameTerminal(frame) {
    var flags = CallResponseCont.RW.lazy.readFlags(frame);
    var frag = flags.value & CallFlags.Fragment;
    return !frag;
};

function callResContLength(destResult, body) {
    var res;
    var length = 0;

    // flags:1
    length += bufrw.UInt8.width;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolByteLength(destResult, body);
    if (!res.err) res.length += length;

    return res;
}

function readCallResContFrom(destResult, buffer, offset) {
    var res;
    var body = new CallResponseCont();

    // flags:1
    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.flags = res.value;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolReadFrom(destResult, body, buffer, offset);
    if (!res.err) res.value = body;

    return res;
}

function writeCallResContInto(destResult, body, buffer, offset) {
    var start = offset;
    var res;

    // flags:1 -- skip for now, write args frist
    offset += bufrw.UInt8.width;

    // csumtype:1 (csum:4){0,1} (arg~2)* -- (may mutate body.flags)
    res = argsrw.poolWriteInto(destResult, body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // now we know the final flags, write them
    res = bufrw.UInt8.poolWriteInto(destResult, body.flags, buffer, start);
    if (!res.err) res.offset = offset;

    return res;
}

CallResponseCont.prototype.verifyChecksum = function verifyChecksum(prior) {
    return this.csum.verify(this.args, prior);
};

module.exports.RequestCont = CallRequestCont;
module.exports.ResponseCont = CallResponseCont;
