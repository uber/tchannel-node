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

var assert = require('assert');
var farm32 = require('farmhash').fingerprint32;
var crc32 = require('crc').crc32;
var crc32c = require('sse4_crc32').calculate;
var bufrw = require('bufrw');
var bufrwErrors = require('bufrw/errors');
var errors = require('../errors');

module.exports = Checksum;

// csumtype:1 (csum:4){0,1}
function Checksum(type, val) {
    this.type = type;
    this.val = val || 0;
    switch (this.type) {
        case 0x00:
            this._compute = this._computeNone;
            break;
        case 0x01:
            this._compute = this._computeCrc32;
            break;
        case 0x02:
            this._compute = this._computeFarm32;
            break;
        case 0x03:
            this._compute = this._computeCrc32C;
            break;
        default:
            assert(false, 'invalid checksum type ' + this.type);
    }
}

Checksum.objOrType = function objOrType(arg) {
    if (arg instanceof Checksum) {
        return arg;
    }
    if (arg === undefined || arg === null) {
        return new Checksum(Checksum.Types.None);
    }
    assert(typeof arg === 'number',
           'expected a Checksum object or a valid checksum type');
    switch (arg) {
        case 0x00:
        case 0x01:
        case 0x02:
        case 0x03:
            return new Checksum(arg);
        default:
            assert(false, 'expected a Checksum object or a valid checksum type');
    }
};

Checksum.offsetWidth = function offsetWidth(type) {
    switch (type) {
        case 0x00:
            return 0;
        case 0x01:
        case 0x02:
        case 0x03:
            return 4;
        default:
            assert(false, 'expected valid checksum type');
    }
};

Checksum.Types = Object.create(null);
Checksum.Types.None = 0x00;
Checksum.Types.CRC32 = 0x01;
Checksum.Types.Farm32 = 0x02;
Checksum.Types.CRC32C = 0x03;

// csumtype:1 (csum:4){0,1}

var rwCases = Object.create(null);
rwCases[Checksum.Types.None] = bufrw.Null;
rwCases[Checksum.Types.CRC32] = bufrw.UInt32BE;
rwCases[Checksum.Types.Farm32] = bufrw.UInt32BE;
rwCases[Checksum.Types.CRC32C] = bufrw.UInt32BE;

Checksum.RW = bufrw.Switch(bufrw.UInt8, rwCases, {
    cons: Checksum,
    valKey: 'type',
    dataKey: 'val'
});

Checksum.RW.poolLazySkip = function poolLazySkip(destResult, frame, offset) {
    var res = bufrw.UInt8.poolReadFrom(destResult, frame.buffer, offset);
    if (res.err) {
        return res;
    }
    offset = res.offset;

    var caseRW = rwCases[res.value];
    if (!caseRW) {
        res.err = bufrwErrors.InvalidSwitchValue({
            value: res.value
        });
        return res;
    }

    offset += caseRW.width;
    res.offset = offset;
    res.value = null;
    return res;
};

Checksum.prototype.compute = function compute(args, prior) {
    if (typeof prior !== 'number') prior = 0;
    if (this.type === Checksum.Types.None) {
        return 0;
    } else {
        var csum = prior;
        for (var i = 0; i < args.length; i++) {
            csum = this._compute(args[i], csum);
        }
        return csum;
    }
};

Checksum.prototype._computeNone = function _computeNone() {
    return 0;
};

Checksum.prototype._computeCrc32 = function _computeCrc32(arg, prior) {
    if (prior === 0) prior = undefined;
    return crc32(arg, prior);
};

Checksum.prototype._computeCrc32C = function _computeCrc32C(arg, prior) {
    return crc32c(arg, prior);
};

Checksum.prototype._computeFarm32 = function _computeFarm32(arg, prior) {
    return farm32(arg, prior);
};

Checksum.prototype.update1 = function update1(arg, prior) {
    this.val = this._compute(arg, prior);
};

Checksum.prototype.update = function update(args, prior) {
    this.val = this.compute(args, prior);
};

Checksum.prototype.verify = function verify(args, prior) {
    if (this.type === Checksum.Types.None) {
        return null;
    }
    var val = this.compute(args, prior);
    if (val === this.val) {
        return null;
    } else {
        return errors.ChecksumError({
            checksumType: this.type,
            expectedValue: this.val,
            actualValue: val
        });
    }
};
