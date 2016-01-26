// Copyright (c) 2015 Uber Technologies, Inc.

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
/* eslint max-params: [2, 7] */
/* eslint max-statements: [1, 50] */

var bufrw = require('bufrw');
var Buffer = require('buffer').Buffer;
var process = global.process;

var errors = require('../errors');
var ArgsRW = require('./args');
var Checksum = require('./checksum');
var header = require('./header');
var Tracing = require('./tracing');
var Frame = require('./frame');
var CallFlags = require('./call_flags');
var argsrw = new ArgsRW();

var CN_BUFFER = new Buffer('cn');
var CN_VALUE = CN_BUFFER.readUInt16BE(0, false);

var ResponseCodes = {
    OK: 0x00,
    Error: 0x01
};

var NODE_VERSION = process.versions.node;
var NODE_VERSION_PARTS = NODE_VERSION.split('.');

var fastBufferToString = allNodeToString;
if (NODE_VERSION_PARTS[1] === '10' && NODE_VERSION_PARTS[2] >= '32') {
    fastBufferToString = node10ToString;
}

function node10ToString(fastBuf, start, end) {
    var slowBuf = fastBuf.parent;

    return slowBuf.utf8Slice(
        start + fastBuf.offset,
        end + fastBuf.offset
    );
}

function allNodeToString(buf, start, end) {
    return buf.toString('utf8', start, end);
}

module.exports.Request = CallRequest;
module.exports.Response = CallResponse;

// TODO: validate transport header names?
// TODO: Checksum-like class for tracing

// flags:1 ttl:4 tracing:24 traceflags:1 service~1 nh:1 (hk~1 hv~1){nh} csumtype:1 (csum:4){0,1} (arg~2)*
function CallRequest(flags, ttl, tracing, service, headers, csum, args) {
    this.type = CallRequest.TypeCode;
    this.flags = flags || 0;
    this.ttl = ttl || 0;
    this.tracing = tracing || Tracing.emptyTracing;
    this.service = service || '';
    this.headers = headers || {};
    this.csum = Checksum.objOrType(csum);
    this.args = args || [];
    this.cont = null;
}

CallRequest.Cont = require('./cont').RequestCont;
CallRequest.TypeCode = 0x03;
CallRequest.RW = bufrw.Base(callReqLength, readCallReqFrom, writeCallReqInto);

CallRequest.RW.lazy = {};

CallRequest.RW.lazy.flagsOffset = Frame.Overhead;
CallRequest.RW.lazy.readFlags = function readFlags(frame) {
    // flags:1
    return bufrw.UInt8.readFrom(frame.buffer, CallRequest.RW.lazy.flagsOffset);
};

CallRequest.RW.lazy.ttlOffset = CallRequest.RW.lazy.flagsOffset + 1;
CallRequest.RW.lazy.readTTL = function readTTL(frame) {
    // ttl:4
    var res = bufrw.UInt32BE.readFrom(frame.buffer, CallRequest.RW.lazy.ttlOffset);
    if (!res.err && res.value <= 0) {
        res.err = errors.InvalidTTL({
            ttl: res.value,
            isParseError: true
        });
    }
    return res;
};
CallRequest.RW.lazy.writeTTL = function writeTTL(ttl, frame) {
    // ttl:4
    return bufrw.UInt32BE.writeInto(ttl, frame.buffer, CallRequest.RW.lazy.ttlOffset);
};

CallRequest.RW.lazy.tracingOffset = CallRequest.RW.lazy.ttlOffset + 4;
CallRequest.RW.lazy.readTracing = function lazyReadTracing(frame) {
    // tracing:24 traceflags:1
    return Tracing.RW.readFrom(frame.buffer, CallRequest.RW.lazy.tracingOffset);
};

CallRequest.RW.lazy.serviceOffset = CallRequest.RW.lazy.tracingOffset + 25;
CallRequest.RW.lazy.readService = function lazyReadService(frame) {
    if (frame.cache.serviceRes !== null) {
        return frame.cache.serviceRes;
    }
    // service~1
    var res = bufrw.str1.readFrom(
        frame.buffer, CallRequest.RW.lazy.serviceOffset
    );
    frame.cache.serviceRes = res;
    frame.cache.headerStartOffset = res.offset;

    return res;
};

CallRequest.RW.lazy.readServiceStr = function lazyReadServiceStr(frame) {
    if (frame.cache.serviceStr !== null) {
        return frame.cache.serviceStr;
    }

    if (frame.size < CallRequest.RW.lazy.serviceOffset + 1) {
        return null;
    }
    var strLength = frame.buffer.readUInt8(
        CallRequest.RW.lazy.serviceOffset, false
    );
    var end = CallRequest.RW.lazy.serviceOffset + 1 + strLength;

    if (frame.size < end) {
        return null;
    }
    var serviceNameStr = fastBufferToString(
        frame.buffer,
        CallRequest.RW.lazy.serviceOffset + 1,
        end
    );

    frame.cache.serviceStr = serviceNameStr;
    frame.cache.headerStartOffset = end;

    return serviceNameStr;
};

CallRequest.RW.lazy.readHeaders = function readHeaders(frame) {
    // last fixed offset
    var offset = CallRequest.RW.lazy.serviceOffset;

    if (frame.cache.headerStartOffset !== null) {
        offset = frame.cache.headerStartOffset;
    } else {
        // SKIP service~1
        var res = bufrw.str1.sizerw.readFrom(frame.buffer, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset + res.value;
    }

    // READ nh:1 (hk~1 hv~1){nh}
    res = header.header1.lazyRead(frame, offset);

    frame.cache.csumStartOffset = res.offset;

    return res;
};

CallRequest.RW.lazy.readCallerNameStr =
function readCallerNameStr(frame) {
    /*eslint complexity: [2, 20]*/
    if (frame.cache.callerNameStr !== null) {
        return frame.cache.callerNameStr;
    }

    var offset = null;

    if (frame.cache.headerStartOffset !== null) {
        offset = frame.cache.headerStartOffset;
    } else {
        offset = CallRequest.RW.lazy.serviceOffset;

        if (frame.size < offset + 1) {
            return null;
        }
        var strLength = frame.buffer.readUInt8(offset, false);
        offset += strLength + 1;
    }

    if (frame.size < offset + 1) {
        return null;
    }
    var nh = frame.buffer.readUInt8(offset, false);
    offset += 1;

    var valueOffset = null;

    for (var i = 0; i < nh; i++) {
        if (frame.size < offset + 1) {
            return null;
        }
        var keyLength = frame.buffer.readUInt8(offset, false);
        offset += 1;
        if (frame.size < keyLength + offset) {
            return null;
        }

        if (!valueOffset &&
            keyLength === 2 &&
            frame.buffer.readUInt16BE(offset, false) === CN_VALUE
        ) {
            valueOffset = offset + keyLength;
        }

        offset += keyLength;

        if (frame.size < offset + 1) {
            return null;
        }
        var valueLength = frame.buffer.readUInt8(offset, false);
        offset += 1;
        if (frame.size < valueLength + offset) {
            return null;
        }

        offset += valueLength;
    }

    if (!valueOffset) {
        return null;
    }

    frame.cache.csumStartOffset = offset;

    offset = valueOffset;
    if (frame.size < offset + 1) {
        return null;
    }
    valueLength = frame.buffer.readUInt8(offset, false);
    offset += 1;

    var end = offset + valueLength;
    if (frame.size < end) {
        return null;
    }

    var callerNameStr = fastBufferToString(
        frame.buffer, offset, end
    );

    frame.cache.callerNameStr = callerNameStr;

    return callerNameStr;
};

CallRequest.RW.lazy.readArg1 = function readArg1(frame) {
    var res = null;
    var offset = 0;

    // TODO: memoize computed offsets on frame between readService, readArg1,
    // and any others

    offset = getHeadersOffset(frame);

    // SKIP csumtype:1 (csum:4){0,1}
    res = Checksum.RW.lazySkip(frame, offset);
    if (res.err) {
        return res;
    }
    offset = res.offset;

    // READ arg~2
    return argsrw.argrw.readFrom(frame.buffer, offset);
};

CallRequest.RW.lazy.readArg1Str = function readArg1Str(frame) {
    if (frame.cache.arg1Str !== null) {
        return frame.cache.arg1Str;
    }

    var offset = 0;

    // TODO: memoize computed offsets on frame between readService, readArg1,
    // and any others

    if (!frame.cache.csumStartOffset) {
        CallRequest.RW.lazy.readCallerNameStr(frame);
    }
    offset = frame.cache.csumStartOffset;

    if (frame.size < offset + 1) {
        return null;
    }
    var csumType = frame.buffer.readUInt8(offset, false);
    offset += 1;

    if (csumType !== 0x00) {
        offset += 4;
    }

    if (frame.size < offset + 2) {
        return null;
    }
    var arg1Length = frame.buffer.readUInt16BE(offset, false);
    offset += 2;

    var end = offset + arg1Length;

    if (frame.size < end) {
        return null;
    }
    var arg1Str = fastBufferToString(frame.buffer, offset, end);

    frame.cache.arg1Str = arg1Str;

    return arg1Str;
};

function getHeadersOffset(frame) {
    var res = null;
    var offset = 0;

    if (frame.cache.csumStartOffset !== null) {
        offset = frame.cache.csumStartOffset;
    } else {
        // last fixed offset
        offset = CallRequest.RW.lazy.serviceOffset;

        // SKIP service~1
        res = bufrw.str1.sizerw.readFrom(frame.buffer, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset + res.value;

        // SKIP nh:1 (hk~1 hv~1){nh}
        res = header.header1.lazySkip(frame, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset;
    }

    return offset;
}

CallRequest.RW.lazy.isFrameTerminal = function isFrameTerminal(frame) {
    var flags = CallRequest.RW.lazy.readFlags(frame);
    var frag = flags.value & CallFlags.Fragment;
    return !frag;
};

function callReqLength(body) {
    var res;
    var length = 0;

    // flags:1
    length += bufrw.UInt8.width;

    // ttl:4
    length += bufrw.UInt32BE.width;

    // tracing:24 traceflags:1
    res = Tracing.RW.byteLength(body.tracing);
    if (res.err) return res;
    length += res.length;

    // service~1
    res = bufrw.str1.byteLength(body.service);
    if (res.err) return res;
    length += res.length;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.byteLength(body.headers);
    if (res.err) return res;
    length += res.length;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.byteLength(body);
    if (!res.err) res.length += length;

    return res;
}

function readCallReqFrom(buffer, offset) {
    var res;
    var body = new CallRequest();

    // flags:1
    res = bufrw.UInt8.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.flags = res.value;

    // ttl:4
    res = bufrw.UInt32BE.readFrom(buffer, offset);
    if (res.err) return res;

    if (res.value <= 0) {
        return bufrw.ReadResult.error(errors.InvalidTTL({
            ttl: res.value,
            isParseError: true
        }), offset, body);
    }

    offset = res.offset;
    body.ttl = res.value;

    // tracing:24 traceflags:1
    res = Tracing.RW.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.tracing = res.value;

    // service~1
    res = bufrw.str1.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.service = res.value;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.headers = res.value;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.readFrom(body, buffer, offset);
    if (!res.err) res.value = body;

    return res;
}

function writeCallReqInto(body, buffer, offset) {
    var start = offset;
    var res;

    // flags:1 -- filled in later after argsrw
    offset += bufrw.UInt8.width;

    if (body.ttl <= 0) {
        return bufrw.WriteResult.error(errors.InvalidTTL({
            ttl: body.ttl
        }), offset);
    }

    // ttl:4
    res = bufrw.UInt32BE.writeInto(body.ttl, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // tracing:24 traceflags:1
    res = Tracing.RW.writeInto(body.tracing, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // service~1
    res = bufrw.str1.writeInto(body.service, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.writeInto(body.headers, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // csumtype:1 (csum:4){0,1} (arg~2)* -- (may mutate body.flags)
    res = argsrw.writeInto(body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // now we know the final flags, write them
    res = bufrw.UInt8.writeInto(body.flags, buffer, start);
    if (!res.err) res.offset = offset;

    return res;
}

CallRequest.prototype.verifyChecksum = function verifyChecksum() {
    return this.csum.verify(this.args);
};

// flags:1 code:1 tracing:24 traceflags:1 nh:1 (hk~1 hv~1){nh} csumtype:1 (csum:4){0,1} (arg~2)*
function CallResponse(flags, code, tracing, headers, csum, args) {
    this.type = CallResponse.TypeCode;
    this.flags = flags || 0;
    this.code = code || CallResponse.Codes.OK;
    this.tracing = tracing || Tracing.emptyTracing;
    this.headers = headers || {};
    this.csum = Checksum.objOrType(csum);
    this.args = args || [];
    this.cont = null;
}

CallResponse.Cont = require('./cont').ResponseCont;
CallResponse.TypeCode = 0x04;
CallResponse.Codes = ResponseCodes;
CallResponse.RW = bufrw.Base(callResLength, readCallResFrom, writeCallResInto);

CallResponse.RW.lazy = {};

CallResponse.RW.lazy.flagsOffset = Frame.Overhead;
CallResponse.RW.lazy.readFlags = function readFlags(frame) {
    // flags:1
    return bufrw.UInt8.readFrom(frame.buffer, CallResponse.RW.lazy.flagsOffset);
};

CallResponse.RW.lazy.codeOffset = CallResponse.RW.lazy.flagsOffset + 1;
// TODO: readCode?

CallResponse.RW.lazy.tracingOffset = CallResponse.RW.lazy.codeOffset + 1;
CallResponse.RW.lazy.readTracing = function lazyReadTracing(frame) {
    // tracing:24 traceflags:1
    return Tracing.RW.readFrom(frame.buffer, CallResponse.RW.lazy.tracingOffset);
};

CallResponse.RW.lazy.headersOffset = CallResponse.RW.lazy.tracingOffset + 25;

CallResponse.RW.lazy.readHeaders = function readHeaders(frame) {
    // last fixed offset
    var offset = CallResponse.RW.lazy.headersOffset;

    // TODO: memoize computed offsets on frame between readService, readArg1,
    // and any others

    // READ nh:1 (hk~1 hv~1){nh}
    return header.header1.lazyRead(frame, offset);
};

CallResponse.RW.lazy.readArg1 = function readArg1(frame, headers) {
    var res = null;
    var offset = 0;

    if (headers) {
        offset = headers.offset;
    } else {
        // last fixed offset
        offset = CallResponse.RW.lazy.headersOffset;

        // TODO: memoize computed offsets on frame between readService, readArg1,
        // and any others

        // SKIP nh:1 (hk~1 hv~1){nh}
        res = header.header1.lazySkip(frame, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset;
    }

    // SKIP csumtype:1 (csum:4){0,1}
    res = Checksum.RW.lazySkip(frame, offset);
    if (res.err) {
        return res;
    }
    offset = res.offset;

    // READ arg~2
    return argsrw.argrw.readFrom(frame.buffer, offset);
};

CallResponse.RW.lazy.isFrameTerminal = function isFrameTerminal(frame) {
    var flags = CallResponse.RW.lazy.readFlags(frame);
    var frag = flags.value & CallFlags.Fragment;
    return !frag;
};

function callResLength(body) {
    var res;
    var length = 0;

    // flags:1
    length += bufrw.UInt8.width;
    // code:1
    length += bufrw.UInt8.width;

    // tracing:24 traceflags:1
    res = Tracing.RW.byteLength(body.tracing);
    if (res.err) return res;
    length += res.length;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.byteLength(body.headers);
    if (res.err) return res;
    length += res.length;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.byteLength(body);
    if (!res.err) res.length += length;

    return res;
}

function readCallResFrom(buffer, offset) {
    var res;
    var body = new CallResponse();

    // flags:1
    res = bufrw.UInt8.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.flags = res.value;

    // code:1
    res = bufrw.UInt8.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.code = res.value;

    // tracing:24 traceflags:1
    res = Tracing.RW.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.tracing = res.value;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.readFrom(buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.headers = res.value;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.readFrom(body, buffer, offset);
    if (!res.err) res.value = body;

    return res;
}

function writeCallResInto(body, buffer, offset) {
    var start = offset;
    var res;

    // flags:1 -- filled in later after argsrw
    offset += bufrw.UInt8.width;

    // code:1
    res = bufrw.UInt8.writeInto(body.code, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // tracing:24 traceflags:1
    res = Tracing.RW.writeInto(body.tracing, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.writeInto(body.headers, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // csumtype:1 (csum:4){0,1} (arg~2)* -- (may mutate body.flags)
    res = argsrw.writeInto(body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // now we know the final flags, write them
    res = bufrw.UInt8.writeInto(body.flags, buffer, start);
    if (!res.err) res.offset = offset;

    return res;
}

CallResponse.prototype.verifyChecksum = function verifyChecksum() {
    return this.csum.verify(this.args);
};
