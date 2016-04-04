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
var inherits = require('util').inherits;
var bufrw = require('bufrw');
var Buffer = require('buffer').Buffer;
var Checksum = require('./checksum');
var Flags = require('./call_flags');
var errors = require('../errors');

var Base = bufrw.Base;
var LengthResult = bufrw.LengthResult;

/* eslint-disable curly */

function ArgRW(sizerw) {
    Base.call(this);
    this.sizerw = sizerw;
    this.strrw = bufrw.String(this.sizerw, 'utf8');
    this.bufrw = bufrw.VariableBuffer(this.sizerw, true);
}

inherits(ArgRW, bufrw.Base);

ArgRW.prototype.poolByteLength = function poolByteLength(destResult, arg) {
    if (typeof arg === 'string') {
        return this.strrw.poolByteLength(destResult, arg);
    } else {
        return this.bufrw.poolByteLength(destResult, arg);
    }
};

ArgRW.prototype.poolWriteInto = function poolWriteInto(destResult, arg, buffer, offset) {
    if (typeof arg === 'string') {
        return this.strrw.poolWriteInto(destResult, arg, buffer, offset);
    } else {
        return this.bufrw.poolWriteInto(destResult, arg, buffer, offset);
    }
};

ArgRW.prototype.poolReadFrom = function poolReadFrom(destResult, buffer, offset) {
    return this.bufrw.poolReadFrom(destResult, buffer, offset);
};

var arg2 = new ArgRW(bufrw.UInt16BE);

function ArgsRW(argrw) {
    argrw = argrw || arg2;
    assert(argrw.sizerw && argrw.sizerw.width, 'invalid argrw');
    bufrw.Base.call(this);
    this.argrw = argrw;
    this.overhead = this.argrw.sizerw.width;
}
inherits(ArgsRW, bufrw.Base);

ArgsRW.prototype.poolByteLength = function poolByteLength(destResult, body) {
    var length = 0;
    var res;

    res = Checksum.RW.poolByteLength(destResult, body.csum);
    if (res.err) return res;
    length += res.length;

    if (body.args === null) {
        return destResult.reset(null, length);
    }

    if (!Array.isArray(body.args)) {
        return destResult.reset(null, errors.InvalidArgumentError({
            argType: typeof body.args,
            argConstructor: body.args.constructor.name
        }));
    }

    for (var i = 0; i < body.args.length; i++) {
        res = this.argrw.poolByteLength(destResult, body.args[i]);
        if (res.err) return res;
        length += res.length;
    }

    return destResult.reset(null, length);
};

var lenres = new LengthResult();
ArgsRW.prototype.poolWriteInto = function poolWriteInto(destResult, body, buffer, offset) {
    var start = offset;
    var res;

    lenres = Checksum.RW.poolByteLength(lenres, body.csum);
    if (lenres.err) return destResult.replace(lenres.err);
    offset += lenres.length;

    if (body.cont === null) {
        res = this.writeFragmentInto(destResult, body, buffer, offset);
        if (res.err) return res;
        offset = res.offset;
    } else {
        // assume that something else already did the fragmentation correctly
        for (var i = 0; i < body.args.length; i++) {
            res = this.argrw.poolWriteInto(destResult, body.args[i], buffer, offset);
            if (res.err) return res;
            var buf = buffer.slice(offset + this.overhead, res.offset);
            body.csum.update1(buf, body.csum.val);
            offset = res.offset;
        }
    }

    res = Checksum.RW.poolWriteInto(destResult, body.csum, buffer, start);
    if (!res.err) res.offset = offset;

    return res;
};

ArgsRW.prototype.poolReadFrom = function poolReadFrom(destResult, body, buffer, offset) {
    var res;

    // TODO: missing symmetry: verify csum (requires prior somehow)

    res = Checksum.RW.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.csum = res.value;

    body.args = [];
    while (offset < buffer.length) {
        res = this.argrw.poolReadFrom(destResult, buffer, offset);
        if (res.err) return res;
        offset = res.offset;
        body.args.push(res.value);
    }

    return destResult.reset(null, offset, body);
};

ArgsRW.prototype.writeFragmentInto = function writeFragmentInto(destResult, body, buffer, offset) {
    var res;
    var i = 0;
    var remain = buffer.length - offset;

    do {
        var arg = body.args[i] || Buffer(0);
        if (!Buffer.isBuffer(arg)) {
            arg = new Buffer(arg);
        }
        var min = this.overhead + arg.length ? 1 : 0;
        if (remain < min) break;
        var need = this.overhead + arg.length;
        if (need > remain) {
            var j = remain - this.overhead;
            body.args[i] = arg.slice(0, j);
            body.cont = new body.constructor.Cont(
                body.flags & Flags.Fragment,
                body.csum, // share on purpose
                body.args.splice(i + 1)
            );
            body.cont.args.unshift(arg.slice(j));
            body.flags |= Flags.Fragment;
            arg = body.args[i];
        }
        res = this.argrw.poolWriteInto(destResult, arg, buffer, offset);
        if (res.err) return res;
        var buf = buffer.slice(offset + this.overhead, res.offset);
        body.csum.update1(buf, body.csum.val);
        offset = res.offset;
        remain = buffer.length - offset;
    } while (remain >= this.overhead && ++i < body.args.length);

    return res || destResult.reset(null, offset);
};

module.exports = ArgsRW;
module.exports.ArgRW = ArgRW;
