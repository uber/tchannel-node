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

var ReadResult = bufrw.ReadResult;
var WriteResult = bufrw.WriteResult;
var readRes = new ReadResult(); // shared read result

var CN_VALUE = new Buffer('cn').readUInt16BE(0, false);
var RD_VALUE = new Buffer('rd').readUInt16BE(0, false);

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

// Calls a pooled function and conveniently allocates a response object for it
function allocifyPoolFn(fn, ResultCons) {
    return allocFn;

    function allocFn(arg1, arg2, arg3) {
        return fn(new ResultCons(), arg1, arg2, arg3);
    }
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
CallRequest.RW = bufrw.Base(callReqLength, readCallReqFrom, writeCallReqInto, true);

CallRequest.RW.lazy = {};

CallRequest.RW.lazy.flagsOffset = Frame.Overhead;
CallRequest.RW.lazy.poolReadFlags = function poolReadFlags(destResult, frame) {
    // flags:1
    return bufrw.UInt8.poolReadFrom(destResult, frame.buffer, CallRequest.RW.lazy.flagsOffset);
};

CallRequest.RW.lazy.readFlags = allocifyPoolFn(CallRequest.RW.lazy.poolReadFlags, ReadResult);

CallRequest.RW.lazy.ttlOffset = CallRequest.RW.lazy.flagsOffset + 1;
CallRequest.RW.lazy.readTTL = function readTTL(frame) {
    if (frame.cache.ttlValue !== null) {
        return frame.cache.ttlValue;
    }

    var offset = CallRequest.RW.lazy.ttlOffset;
    if (frame.size < offset + 4) {
        return 0;
    }
    var ttl = frame.buffer.readUInt32BE(offset, false);

    frame.cache.ttlValue = ttl;

    return ttl;
};
CallRequest.RW.lazy.poolWriteTTL = function poolWriteTTL(destResult, ttl, frame) {
    // ttl:4
    return bufrw.UInt32BE.poolWriteInto(destResult, ttl, frame.buffer, CallRequest.RW.lazy.ttlOffset);
};

CallRequest.RW.lazy.writeTTL = allocifyPoolFn(CallRequest.RW.lazy.poolWriteTTL, WriteResult);

CallRequest.RW.lazy.tracingOffset = CallRequest.RW.lazy.ttlOffset + 4;
CallRequest.RW.lazy.poolReadTracing = function poolLazyReadTracing(destResult, frame) {
    // tracing:24 traceflags:1
    return Tracing.RW.poolReadFrom(destResult, frame.buffer, CallRequest.RW.lazy.tracingOffset);
};

CallRequest.RW.lazy.readTracing = allocifyPoolFn(CallRequest.RW.lazy.poolReadTracing, ReadResult);

CallRequest.RW.lazy.serviceOffset = CallRequest.RW.lazy.tracingOffset + 25;
CallRequest.RW.lazy.poolReadService = function poolLazyReadService(destResult, frame) {
    // service~1
    return bufrw.str1.poolReadFrom(destResult, frame.buffer, CallRequest.RW.lazy.serviceOffset);
};

CallRequest.RW.lazy.readService = allocifyPoolFn(CallRequest.RW.lazy.poolReadService, ReadResult);

CallRequest.RW.lazy.poolReadTracingValue = function poolReadTracingValue(destResult, frame) {
    if (frame.cache.tracingValue !== null) {
        return frame.cache.tracingValue;
    }

    var offset = CallRequest.RW.lazy.tracingOffset;

    if (frame.size < offset + 25) {
        return null;
    }

    var spanid1 = frame.buffer.readUInt32BE(offset, false);
    offset += 4;

    var spanid2 = frame.buffer.readUInt32BE(offset, false);
    offset += 4;

    var parentid1 = frame.buffer.readUInt32BE(offset, false);
    offset += 4;

    var parentid2 = frame.buffer.readUInt32BE(offset, false);
    offset += 4;

    var traceid1 = frame.buffer.readUInt32BE(offset, false);
    offset += 4;

    var traceid2 = frame.buffer.readUInt32BE(offset, false);
    offset += 4;

    var flags = frame.buffer.readUInt8(offset, false);
    offset += 1;

    // TODO: pool these objects
    var tracing = new TracingInfo(
        [spanid1, spanid2],
        [parentid1, parentid2],
        [traceid1, traceid2],
        flags
    );

    frame.cache.tracingValue = tracing;

    return tracing;
};

CallRequest.RW.lazy.readTracingValue = allocifyPoolFn(CallRequest.RW.lazy.poolReadTracingValue, ReadResult);

function TracingInfo(spanid, parentid, traceid, flags) {
    this.spanid = spanid;
    this.parentid = parentid;
    this.traceid = traceid;
    this.flags = flags;
}

CallRequest.RW.lazy.readServiceStr = function lazyReadServiceStr(frame) {
    if (frame.cache.serviceStr !== null) {
        return frame.cache.serviceStr;
    }

    var headerStartOffset = findHeaderStartOffset(frame);
    if (!headerStartOffset) {
        return null;
    }

    if (frame.size < headerStartOffset) {
        return null;
    }
    var serviceNameStr = fastBufferToString(
        frame.buffer,
        CallRequest.RW.lazy.serviceOffset + 1,
        headerStartOffset
    );

    frame.cache.serviceStr = serviceNameStr;

    return serviceNameStr;
};

function findHeaderStartOffset(frame) {
    if (frame.cache.headerStartOffset) {
        return frame.cache.headerStartOffset;
    }

    var offset = CallRequest.RW.lazy.serviceOffset;
    if (frame.size < offset + 1) {
        return 0;
    }
    var strLength = frame.buffer.readUInt8(offset, false);
    offset += strLength + 1;

    frame.cache.headerStartOffset = offset;
    return offset;
}

function scanAndSkipHeaders(frame) {
    var offset = findHeaderStartOffset(frame);
    if (!offset) {
        return false;
    }

    if (frame.size < offset + 1) {
        return false;
    }
    var nh = frame.buffer.readUInt8(offset, false);
    offset += 1;

    var cnValueOffset = 0;
    var rdValueOffset = 0;

    for (var i = 0; i < nh; i++) {
        if (frame.size < offset + 1) {
            return false;
        }
        var keyLength = frame.buffer.readUInt8(offset, false);
        offset += 1;
        if (frame.size < keyLength + offset) {
            return false;
        }

        var keyValue = null;

        if (!cnValueOffset && keyLength === 2) {
            keyValue = keyValue || frame.buffer.readUInt16BE(offset, false);
            if (keyValue === CN_VALUE) {
                cnValueOffset = offset + keyLength;
            }
        }

        if (!rdValueOffset && keyLength === 2) {
            keyValue = keyValue || frame.buffer.readUInt16BE(offset, false);
            if (keyValue === RD_VALUE) {
                rdValueOffset = offset + keyLength;
            }
        }

        offset += keyLength;

        if (frame.size < offset + 1) {
            return false;
        }
        var valueLength = frame.buffer.readUInt8(offset, false);
        offset += 1;
        if (frame.size < valueLength + offset) {
            return false;
        }

        offset += valueLength;
    }

    frame.cache.cnValueOffset = cnValueOffset;
    frame.cache.rdValueOffset = rdValueOffset;
    frame.cache.csumStartOffset = offset;
    return true;
}

CallRequest.RW.lazy.readCallerNameStr =
function readCallerNameStr(frame) {
    /*eslint complexity: [2, 20]*/
    if (frame.cache.callerNameStr !== null) {
        return frame.cache.callerNameStr;
    }

    if (frame.cache.cnValueOffset === null) {
        var success = scanAndSkipHeaders(frame);
        if (!success) {
            return null;
        }
    }

    var offset = frame.cache.cnValueOffset;
    if (!offset) {
        return null;
    }

    var callerNameStr = readUInt8String(frame, offset);
    if (!callerNameStr) {
        return null;
    }

    frame.cache.callerNameStr = callerNameStr;
    return callerNameStr;
};

CallRequest.RW.lazy.readRoutingDelegateStr =
function readRoutingDelegateStr(frame) {
    /*eslint complexity: [2, 20]*/
    if (frame.cache.routingDelegateStr !== null) {
        return frame.cache.routingDelegateStr;
    }

    if (frame.cache.rdValueOffset === null) {
        var success = scanAndSkipHeaders(frame);
        if (!success) {
            return null;
        }
    }

    var offset = frame.cache.rdValueOffset;
    if (!offset) {
        return null;
    }

    var routingDelegateStr = readUInt8String(frame, offset);
    if (!routingDelegateStr) {
        return null;
    }

    frame.cache.routingDelegateStr = routingDelegateStr;
    return routingDelegateStr;
};

function readUInt8String(frame, offset) {
    if (frame.size < offset + 1) {
        return null;
    }
    var valueLength = frame.buffer.readUInt8(offset, false);
    offset += 1;

    var end = offset + valueLength;
    if (frame.size < end) {
        return null;
    }

    return fastBufferToString(frame.buffer, offset, end);
}

CallRequest.RW.lazy.readArg1Str = function readArg1Str(frame) {
    if (frame.cache.arg1Str !== null) {
        return frame.cache.arg1Str;
    }

    if (!frame.cache.csumStartOffset) {
        var success = scanAndSkipHeaders(frame);
        if (!success) {
            frame.cache.lastError = 'Could not scan & skip headers';
            return null;
        }
    }

    var offset = frame.cache.csumStartOffset;

    if (frame.size < offset + 1) {
        frame.cache.lastError = 'Could not read csum type';
        return null;
    }
    var csumType = frame.buffer.readUInt8(offset, false);
    offset += 1;

    if (csumType !== Checksum.Types.None) {
        offset += Checksum.offsetWidth(csumType);
    }

    if (frame.size < offset + 2) {
        frame.cache.lastError = 'Could not read arg1 size';
        return null;
    }
    var arg1Length = frame.buffer.readUInt16BE(offset, false);
    offset += 2;

    var end = offset + arg1Length;

    if (frame.size < end) {
        frame.cache.lastError = 'Could not read arg1 itself';
        return null;
    }
    var arg1Str = fastBufferToString(frame.buffer, offset, end);

    frame.cache.arg1Str = arg1Str;

    return arg1Str;
};

CallRequest.RW.lazy.poolReadHeaders = function poolReadHeaders(destResult, frame) {
    // last fixed offset
    var offset = CallRequest.RW.lazy.serviceOffset;

    if (frame.cache.headerStartOffset !== null) {
        offset = frame.cache.headerStartOffset;
    } else {
        // SKIP service~1
        var res = bufrw.str1.sizerw.poolReadFrom(destResult, frame.buffer, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset + res.value;
        frame.cache.headerStartOffset = offset;
    }

    // READ nh:1 (hk~1 hv~1){nh}
    return header.header1.poolLazyRead(destResult, frame, offset);
};

CallRequest.RW.lazy.readHeaders = allocifyPoolFn(CallRequest.RW.lazy.poolReadHeaders, ReadResult);

CallRequest.RW.lazy.poolReadArg1 = function poolReadArg1(destResult, frame, headers) {
    var res = null;
    var offset = 0;

    // TODO: memoize computed offsets on frame between readService, readArg1,
    // and any others

    if (headers) {
        offset = headers.offset;
    } else {
        // last fixed offset
        offset = CallRequest.RW.lazy.serviceOffset;

        // SKIP service~1
        res = bufrw.str1.sizerw.poolReadFrom(destResult, frame.buffer, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset + res.value;

        // SKIP nh:1 (hk~1 hv~1){nh}
        res = header.header1.poolLazySkip(destResult, frame, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset;
    }

    // SKIP csumtype:1 (csum:4){0,1}
    res = Checksum.RW.poolLazySkip(destResult, frame, offset);
    if (res.err) {
        return res;
    }
    offset = res.offset;

    // READ arg~2
    return argsrw.argrw.poolReadFrom(destResult, frame.buffer, offset);
};

CallRequest.RW.lazy.readArg1 = allocifyPoolFn(CallRequest.RW.lazy.poolReadArg1, ReadResult);

CallRequest.RW.lazy.isFrameTerminal = function isFrameTerminal(frame) {
    var flags = CallRequest.RW.lazy.poolReadFlags(readRes, frame);
    var frag = flags.value & CallFlags.Fragment;
    return !frag;
};

function callReqLength(destResult, body) {
    var res;
    var length = 0;

    // flags:1
    length += bufrw.UInt8.width;

    // ttl:4
    length += bufrw.UInt32BE.width;

    // tracing:24 traceflags:1
    res = Tracing.RW.poolByteLength(destResult, body.tracing);
    if (res.err) return res;
    length += res.length;

    // service~1
    res = bufrw.str1.poolByteLength(destResult, body.service);
    if (res.err) return res;
    length += res.length;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.poolByteLength(destResult, body.headers);
    if (res.err) return res;
    length += res.length;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolByteLength(destResult, body);
    if (!res.err) res.length += length;

    return res;
}

function readCallReqFrom(destResult, buffer, offset) {
    var res;
    var body = new CallRequest();

    // flags:1
    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.flags = res.value;

    // ttl:4
    res = bufrw.UInt32BE.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;

    if (res.value <= 0) {
        return destResult.reset(errors.InvalidTTL({
            ttl: res.value,
            isParseError: true
        }), offset, body);
    }

    offset = res.offset;
    body.ttl = res.value;

    // tracing:24 traceflags:1
    res = Tracing.RW.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.tracing = res.value;

    // service~1
    res = bufrw.str1.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.service = res.value;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.headers = res.value;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolReadFrom(destResult, body, buffer, offset);
    if (!res.err) res.value = body;

    return res;
}

function writeCallReqInto(destResult, body, buffer, offset) {
    var start = offset;
    var res;

    // flags:1 -- filled in later after argsrw
    offset += bufrw.UInt8.width;

    if (body.ttl <= 0) {
        return destResult.reset(errors.InvalidTTL({
            ttl: body.ttl
        }), offset);
    }

    // ttl:4
    res = bufrw.UInt32BE.poolWriteInto(destResult, body.ttl, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // tracing:24 traceflags:1
    res = Tracing.RW.poolWriteInto(destResult, body.tracing, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // service~1
    res = bufrw.str1.poolWriteInto(destResult, body.service, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.poolWriteInto(destResult, body.headers, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // csumtype:1 (csum:4){0,1} (arg~2)* -- (may mutate body.flags)
    res = argsrw.poolWriteInto(destResult, body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // now we know the final flags, write them
    res = bufrw.UInt8.poolWriteInto(destResult, body.flags, buffer, start);
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
CallResponse.RW = bufrw.Base(callResLength, readCallResFrom, writeCallResInto, true);

CallResponse.RW.lazy = {};

CallResponse.RW.lazy.flagsOffset = Frame.Overhead;
CallResponse.RW.lazy.poolReadFlags = function poolReadFlags(destResult, frame) {
    // flags:1
    return bufrw.UInt8.poolReadFrom(destResult, frame.buffer, CallResponse.RW.lazy.flagsOffset);
};

CallResponse.RW.lazy.readFlags = allocifyPoolFn(CallResponse.RW.lazy.poolReadFlags, ReadResult);

CallResponse.RW.lazy.codeOffset = CallResponse.RW.lazy.flagsOffset + 1;
CallResponse.RW.lazy.poolReadCode = function poolReadCode(destResult, frame) {
    // code:1
    return bufrw.UInt8.poolReadFrom(destResult, frame.buffer, CallResponse.RW.lazy.codeOffset);
};
// TODO: readCode?

CallResponse.RW.lazy.tracingOffset = CallResponse.RW.lazy.codeOffset + 1;
CallResponse.RW.lazy.poolReadTracing = function poolLazyReadTracing(destResult, frame) {
    // tracing:24 traceflags:1
    return Tracing.RW.poolReadFrom(destResult, frame.buffer, CallResponse.RW.lazy.tracingOffset);
};

CallResponse.RW.lazy.readTracing = allocifyPoolFn(CallResponse.RW.lazy.poolReadTracing, ReadResult);

CallResponse.RW.lazy.headersOffset = CallResponse.RW.lazy.tracingOffset + 25;

CallResponse.RW.lazy.poolReadHeaders = function poolReadHeaders(destResult, frame) {
    // last fixed offset
    var offset = CallResponse.RW.lazy.headersOffset;

    // TODO: memoize computed offsets on frame between readService, readArg1,
    // and any others

    // READ nh:1 (hk~1 hv~1){nh}
    return header.header1.poolLazyRead(destResult, frame, offset);
};

CallResponse.RW.lazy.readHeaders = allocifyPoolFn(CallResponse.RW.lazy.readHeaders, ReadResult);

CallResponse.RW.lazy.poolReadArg1 = function poolReadArg1(destResult, frame, headers) {
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
        res = header.header1.poolLazySkip(destResult, frame, offset);
        if (res.err) {
            return res;
        }
        offset = res.offset;
    }

    // SKIP csumtype:1 (csum:4){0,1}
    res = Checksum.RW.poolLazySkip(destResult, frame, offset);
    if (res.err) {
        return res;
    }
    offset = res.offset;

    // READ arg~2
    return argsrw.argrw.poolReadFrom(destResult, frame.buffer, offset);
};

CallResponse.RW.lazy.readArg1 = allocifyPoolFn(CallResponse.RW.lazy.readarg1, ReadResult);

CallResponse.RW.lazy.isFrameTerminal = function isFrameTerminal(frame) {
    var flags = CallResponse.RW.lazy.poolReadFlags(readRes, frame);
    var frag = flags.value & CallFlags.Fragment;
    return !frag;
};

function callResLength(destResult, body) {
    var res;
    var length = 0;

    // flags:1
    length += bufrw.UInt8.width;
    // code:1
    length += bufrw.UInt8.width;

    // tracing:24 traceflags:1
    res = Tracing.RW.poolByteLength(destResult, body.tracing);
    if (res.err) return res;
    length += res.length;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.poolByteLength(destResult, body.headers);
    if (res.err) return res;
    length += res.length;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolByteLength(destResult, body);
    if (!res.err) res.length += length;

    return res;
}

function readCallResFrom(destResult, buffer, offset) {
    var res;
    var body = new CallResponse();

    // flags:1
    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.flags = res.value;

    // code:1
    res = bufrw.UInt8.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.code = res.value;

    // tracing:24 traceflags:1
    res = Tracing.RW.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.tracing = res.value;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.poolReadFrom(destResult, buffer, offset);
    if (res.err) return res;
    offset = res.offset;
    body.headers = res.value;

    // csumtype:1 (csum:4){0,1} (arg~2)*
    res = argsrw.poolReadFrom(destResult, body, buffer, offset);
    if (!res.err) res.value = body;

    return res;
}

function writeCallResInto(destResult, body, buffer, offset) {
    var start = offset;
    var res;

    // flags:1 -- filled in later after argsrw
    offset += bufrw.UInt8.width;

    // code:1
    res = bufrw.UInt8.poolWriteInto(destResult, body.code, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // tracing:24 traceflags:1
    res = Tracing.RW.poolWriteInto(destResult, body.tracing, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // nh:1 (hk~1 hv~1){nh}
    res = header.header1.poolWriteInto(destResult, body.headers, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // csumtype:1 (csum:4){0,1} (arg~2)* -- (may mutate body.flags)
    res = argsrw.poolWriteInto(destResult, body, buffer, offset);
    if (res.err) return res;
    offset = res.offset;

    // now we know the final flags, write them
    res = bufrw.UInt8.poolWriteInto(destResult, body.flags, buffer, start);
    if (!res.err) res.offset = offset;

    return res;
}

CallResponse.prototype.verifyChecksum = function verifyChecksum() {
    return this.csum.verify(this.args);
};
