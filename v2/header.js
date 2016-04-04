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
/* eslint max-statements: [1, 30] */

var bufrw = require('bufrw');
var inherits = require('util').inherits;
var errors = require('../errors');

// TODO: different struct pattern that doesn't realize a temporary list of
// [key, val] tuples may be better. At the very least, such structure would
// allow for more precise error reporting.

function HeaderRW(countrw, keyrw, valrw, options) {
    this.countrw = countrw;
    this.keyrw = keyrw;
    this.valrw = valrw;
    this.maxHeaderCount = options.maxHeaderCount;
    this.maxKeyLength = options.maxKeyLength;
    bufrw.Base.call(this);
}
inherits(HeaderRW, bufrw.Base);

HeaderRW.prototype.poolByteLength = function poolByteLength(destResult, headers) {
    var length = 0;
    var keys = Object.keys(headers);
    var res;

    if (keys.length > this.maxHeaderCount) {
        return destResult.reset(errors.TooManyHeaders({
            count: keys.length,
            maxHeaderCount: this.maxHeaderCount
        }));
    }

    length += this.countrw.width;

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        res = this.keyrw.byteLength(key);
        if (res.err) return res;
        length += res.length;

        res = this.valrw.byteLength(headers[key]);
        if (res.err) return res;
        if (res.length > this.maxKeyLength) {
            return destResult.reset(errors.TransportHeaderTooLong({
                maxLength: this.maxKeyLength,
                headerName: key
            }));
        }
        length += res.length;
    }

    return destResult.reset(null, length);
};

HeaderRW.prototype.poolWriteInto = function poolWriteInto(destResult, headers, buffer, offset) {
    var keys = Object.keys(headers);
    var res;

    res = this.countrw.poolWriteInto(destResult, keys.length, buffer, offset);

    if (keys.length > this.maxHeaderCount) {
        return destResult.reset(errors.TooManyHeaders({
            count: keys.length,
            maxHeaderCount: this.maxHeaderCount,
            offset: offset,
            endOffset: res.offset
        }), offset);
    }

    for (var i = 0; i < keys.length; i++) {
        if (res.err) return res;
        offset = res.offset;

        var key = keys[i];
        res = this.keyrw.writeInto(key, buffer, offset);
        if (res.err) return res;

        var keyByteLength = res.offset - offset;
        if (keyByteLength > this.maxKeyLength) {
            return destResult.reset(errors.TransportHeaderTooLong({
                maxLength: this.maxKeyLength,
                headerName: key,
                offset: offset,
                endOffset: res.offset
            }), offset);
        }
        offset = res.offset;

        // TODO consider supporting buffers
        if (typeof headers[key] !== 'string') {
            return destResult.reset(errors.InvalidHeaderTypeError({
                name: key,
                headerType: typeof headers[key]
            }), offset);
        }

        res = this.valrw.poolWriteInto(destResult, headers[key], buffer, offset);
    }

    return res;
};

HeaderRW.prototype.poolReadFrom = function poolReadFrom(destResult, buffer, offset) {
    var headers = {};
    var start = 0;
    var n = 0;
    var key = '';
    var val = '';
    var res;

    res = this.countrw.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    n = res.value;

    if (n > this.maxHeaderCount) {
        return destResult.reset(errors.TooManyHeaders({
            count: n,
            maxHeaderCount: this.maxHeaderCount,
            offset: offset,
            endOffset: res.offset
        }), offset, headers);
    }

    for (var i = 0; i < n; i++) {
        start = offset;

        res = this.keyrw.poolReadFrom(destResult, buffer, offset);
        if (res.err) return res;
        key = res.value;

        if (!key.length) {
            return destResult.reset(errors.NullKeyError({
                offset: offset,
                endOffset: res.offset
            }), offset, headers);
        } else if (res.offset - offset > this.maxKeyLength) {
            return destResult.reset(errors.TransportHeaderTooLong({
                maxLength: this.maxKeyLength,
                headerName: key,
                offset: offset,
                endOffset: res.offset
            }), offset, headers);
        }
        offset = res.offset;

        res = this.valrw.poolReadFrom(destResult, buffer, offset);
        if (res.err) return res;
        val = res.value;

        if (headers[key] !== undefined) {
            return destResult.reset(errors.DuplicateHeaderKeyError({
                offset: start,
                endOffset: res.offset,
                key: key,
                value: val,
                priorValue: headers[key]
            }), offset, headers);
        }
        offset = res.offset;

        headers[key] = val;
    }

    return destResult.reset(null, offset, headers);
};

HeaderRW.prototype.poolLazyRead = function poolLazyRead(destResult, frame, offset) {
    // TODO: conspire with Call(Request,Response) to memoize headers start/end
    // offsets, maybe even start of each key?

    var res = this.countrw.poolReadFrom(destResult, frame.buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // TODO: Pool these KeyVals objects
    var keyvals = new KeyVals(frame.buffer, res.value);
    for (var i = 0; i < keyvals.length; i++) {
        res = this.keyrw.sizerw.poolReadFrom(destResult, frame.buffer, offset);
        if (res.err) return res;
        var keyOffset = res.offset;
        var keyLength = res.value;
        offset = res.offset + res.value;

        res = this.valrw.sizerw.poolReadFrom(destResult, frame.buffer, offset);
        if (res.err) return res;
        var valOffset = res.offset;
        var valLength = res.value;
        offset = res.offset + res.value;

        keyvals.add(keyOffset, keyLength, valOffset, valLength);
    }

    keyvals.offset = offset;

    return destResult.reset(null, offset, keyvals);
};

HeaderRW.prototype.poolLazySkip = function poolLazySkip(destResult, frame, offset) {
    // TODO: conspire with Call(Request,Response) to memoize headers start/end
    // offsets, maybe even start of each key?

    var res = this.countrw.poolReadFrom(destResult, frame.buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    var n = res.value;

    for (var i = 0; i < n; i++) {
        res = this.keyrw.sizerw.poolReadFrom(destResult, frame.buffer, offset);
        if (res.err) return res;
        offset = res.offset + res.value;

        res = this.valrw.sizerw.poolReadFrom(destResult, frame.buffer, offset);
        if (res.err) return res;
        offset = res.offset + res.value;
    }

    return destResult.reset(null, offset, null);
};

module.exports = HeaderRW;

// nh:1 (hk~1 hv~1){nh}
module.exports.header1 = new HeaderRW(bufrw.UInt8, bufrw.str1, bufrw.str1, {
    maxHeaderCount: 128,
    maxKeyLength: 16
});

// nh:2 (hk~2 hv~2){nh}
module.exports.header2 = new HeaderRW(bufrw.UInt16BE, bufrw.str2, bufrw.str2, {
    maxHeaderCount: Infinity,
    maxKeyLength: Infinity
});

function KeyVals(buffer, length) {
    this.length = length;
    this.buffer = buffer;
    this.data = new Array(this.length * 4);
    this.index = 0;
    this.offset = 0;
}

KeyVals.prototype.add =
function add(keyOffset, keyLength, valOffset, valLength) {
    if (this.index < this.data.length) {
        this.data[this.index++] = keyOffset;
        this.data[this.index++] = keyLength;
        this.data[this.index++] = valOffset;
        this.data[this.index++] = valLength;
    }
};

KeyVals.prototype.getValue =
function getValue(key) {
    // assert Buffer.isBuffer(key)

    for (
        var i = 0;
        i < this.data.length;
        i += 4
    ) {
        var keyLength = this.data[i + 1];
        if (key.length !== keyLength) {
            continue;
        }

        var keyOffset = this.data[i];
        var found = true;
        for (
            var j = 0, offset = keyOffset;
            j < keyLength;
            j++, offset++
        ) {
            if (key[j] !== this.buffer[offset]) {
                found = false;
                break;
            }
        }
        if (found) {
            var valOffset = this.data[i + 2];
            var valLength = this.data[i + 3];
            return this.buffer.slice(
                valOffset,
                valOffset + valLength
            );
        }
    }

    return undefined;
};
