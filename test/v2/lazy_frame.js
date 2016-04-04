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

var Buffer = require('buffer').Buffer;
var bufrw = require('bufrw');
var test = require('tape');
var testRW = require('bufrw/test_rw');
var process = global.process;

var ReadResult = require('bufrw').ReadResult;
var WriteResult = require('bufrw').WriteResult;
var readRes = new ReadResult();
var writeRes = new WriteResult();

var TestBody = require('./lib/test_body.js');
var v2 = require('../../v2/index.js');

var Bytes = [
    0x00, 0x15,             // size: 2
    0x03,                   // type: 1
    0x00,                   // reserved:1
    0x00, 0x00, 0x00, 0x01, // id:4
    0x00, 0x00, 0x00, 0x00, // reserved:4
    0x00, 0x00, 0x00, 0x00, // reserved:4

    0x04, 0x64, 0x6f, 0x67, 0x65 // junk bytes
];
var _lazyFrame = new v2.LazyFrame(
    0x15, 0x03, 0x01,
    new Buffer(Bytes)
);
_lazyFrame.bodyRW = v2.Frame.Types[0x03].RW;

test('LazyFrame.RW: read/write', testRW.cases(v2.LazyFrame.RW, [
    [
        _lazyFrame, Bytes
    ]
]));

TestBody.testWith('LazyFrame.readFrom, invalid type', function t(assert) {
    var res = v2.LazyFrame.RW.readFrom(new Buffer([
        0x00, 0x15,             // size: 2
        0x50,                   // type: 1
        0x00,                   // reserved:1
        0x00, 0x00, 0x00, 0x01, // id:4
        0x00, 0x00, 0x00, 0x00, // reserved:4
        0x00, 0x00, 0x00, 0x00, // reserved:4

        0x04, 0x64, 0x6f, 0x67, 0x65 // junk bytes
    ]), 0);

    var err = res.err;

    assert.equal(err.type, 'tchannel.invalid-frame-type');
    assert.equal(err.typeNumber, 80);

    assert.end();
});

TestBody.testWith('LazyFrame.readBody', function t(assert) {
    var frame = v2.LazyFrame.RW.readFrom(new Buffer([
        0x00, 0x15,             // size: 2
        0x00,                   // type: 1
        0x00,                   // reserved:1
        0x00, 0x00, 0x00, 0x01, // id:4
        0x00, 0x00, 0x00, 0x00, // reserved:4
        0x00, 0x00, 0x00, 0x00, // reserved:4

        0x04, 0x64, 0x6f, 0x67, 0x65 // junk bytes
    ]), 0).value;

    assert.equal(frame.type, 0x00);

    var bodyRes = frame.readBody();
    assert.ok(bodyRes.value);

    assert.deepEqual(
        bodyRes.value.payload, new Buffer([0x64, 0x6f, 0x67, 0x65])
    );

    assert.end();
});

TestBody.testWith('LazyFrame.setId', function t(assert) {
    var frame = v2.LazyFrame.RW.readFrom(new Buffer([
        0x00, 0x15,             // size: 2
        0x00,                   // type: 1
        0x00,                   // reserved:1
        0x00, 0x00, 0x00, 0x01, // id:4
        0x00, 0x00, 0x00, 0x00, // reserved:4
        0x00, 0x00, 0x00, 0x00, // reserved:4

        0x04, 0x64, 0x6f, 0x67, 0x65 // junk bytes
    ]), 0).value;

    assert.equal(frame.id, 0x01);

    frame.setId(4);

    assert.equal(frame.id, 0x04);

    var buffer = new Buffer(frame.size);
    v2.LazyFrame.RW.writeInto(frame, buffer, 0);

    assert.deepEqual(
        buffer,
        new Buffer([
            0x00, 0x15,             // size: 2
            0x00,                   // type: 1
            0x00,                   // reserved:1
            0x00, 0x00, 0x00, 0x04, // id:4
            0x00, 0x00, 0x00, 0x00, // reserved:4
            0x00, 0x00, 0x00, 0x00, // reserved:4

            0x04, 0x64, 0x6f, 0x67, 0x65 // junk bytes
        ])
    );

    assert.end();
});

function setupLazyFrame() {
    var spanId = [0, 1];
    var parentId = [2, 3];
    var traceId = [4, 5];
    var tracing = new v2.Tracing(
        spanId, parentId, traceId
    );

    var frame = new v2.Frame(24,    // frame id
        new v2.CallRequest(
            42,                     // flags
            99,                     // ttl
            tracing,                // tracing
            'castle',               // service
            {                       // headers
                'cn': 'mario',      // headers.cn
                'as': 'plumber'     // headers.as
            },                      //
            v2.Checksum.Types.None, // csum
            ['door', 'key', 'turn'] // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    return buf;
}

test('CallRequest.lazy cache readServiceStr()', function t(assert) {
    var buf = setupLazyFrame();

    var counters = {
        slice: 0,
        toString: 0
    };
    introspectAndCountBuffer(buf, counters);

    assert.equal(counters.slice, 0);
    assert.equal(counters.toString, 0);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);
    assert.equal(counters.slice, 1);
    assert.equal(counters.toString, 0);

    var service1 = lazyFrame.bodyRW.lazy.readServiceStr(lazyFrame);

    assert.equal(service1, 'castle',
        'expected serviceName to be castle');
    assert.equal(counters.slice, 1,
        'should not call slice() in readService()');
    assert.equal(counters.toString, 1,
        'should call toString() in readService()');

    var service2 = lazyFrame.bodyRW.lazy.readServiceStr(lazyFrame);

    assert.equal(service2, 'castle',
        'expected serviceName to be castle');
    assert.equal(counters.slice, 1,
        'should not call slice() in second readService()');
    assert.equal(counters.toString, 1,
        'should not call toString() in second readService()');

    assert.end();
});

test('CallRequest.lazy cache readCallerNameStr()', function t(assert) {
    var buf = setupLazyFrame();

    var counters = {
        slice: 0,
        toString: 0
    };
    introspectAndCountBuffer(buf, counters);

    assert.equal(counters.slice, 0);
    assert.equal(counters.toString, 0);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);
    assert.equal(counters.slice, 1);
    assert.equal(counters.toString, 0);

    var callerName1 = lazyFrame.bodyRW.lazy.readCallerNameStr(lazyFrame);

    assert.equal(callerName1, 'mario',
        'expected endpoint to be mario');
    assert.equal(counters.slice, 1,
        'should not call slice() in readCallerName()');
    assert.equal(counters.toString, 1,
        'should call toString() in readCallerName()');

    var callerName2 = lazyFrame.bodyRW.lazy.readCallerNameStr(lazyFrame);

    assert.equal(callerName2, 'mario',
        'expected endpoint to be mario');
    assert.equal(counters.slice, 1,
        'should not call slice() in second readCallerName()');
    assert.equal(counters.toString, 1,
        'should not call toString() in second readCallerName()');

    assert.end();
});

test('CallRequest.lazy cache readArg1Str()', function t(assert) {
    var buf = setupLazyFrame();

    var counters = {
        slice: 0,
        toString: 0
    };
    introspectAndCountBuffer(buf, counters);

    assert.equal(counters.slice, 0);
    assert.equal(counters.toString, 0);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);
    assert.equal(counters.slice, 1);
    assert.equal(counters.toString, 0);

    var arg11 = lazyFrame.bodyRW.lazy.readArg1Str(lazyFrame);

    assert.equal(arg11, 'door',
        'expected endpoint to be door');
    assert.equal(counters.slice, 1,
        'should not call slice() in readCallerName()');
    assert.equal(counters.toString, 1,
        'should call toString() in readCallerName()');

    var arg12 = lazyFrame.bodyRW.lazy.readArg1Str(lazyFrame);

    assert.equal(arg12, 'door',
        'expected endpoint to be door');
    assert.equal(counters.slice, 1,
        'should not call slice() in second readCallerName()');
    assert.equal(counters.toString, 1,
        'should not call toString() in second readCallerName()');

    assert.end();
});

test('CallRequest.lazy cache readRoutingDelegateStr() miss', function t(assert) {
    var buf = setupLazyFrame();

    var counters = {
        slice: 0,
        toString: 0
    };
    introspectAndCountBuffer(buf, counters);

    assert.equal(counters.slice, 0);
    assert.equal(counters.toString, 0);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);
    assert.equal(counters.slice, 1);
    assert.equal(counters.toString, 0);

    var routingDelegate = lazyFrame.bodyRW.lazy.readRoutingDelegateStr(lazyFrame);

    assert.equal(routingDelegate, null,
        'expected routingDelegate to not exist');
    assert.equal(counters.slice, 1,
        'should not call slice() in readRoutingDelegateStr()');
    assert.equal(counters.toString, 0,
        'should not call toString() in readRoutingDelegateStr()');

    assert.end();
});

test('CallRequest.lazy cache readRoutingDelegateStr()', function t(assert) {
    var spanId = [0, 1];
    var parentId = [2, 3];
    var traceId = [4, 5];
    var tracing = new v2.Tracing(
        spanId, parentId, traceId
    );

    var frame = new v2.Frame(24,    // frame id
        new v2.CallRequest(
            42,                     // flags
            99,                     // ttl
            tracing,                // tracing
            'castle',               // service
            {                       // headers
                'cn': 'mario',      // headers.cn
                'rd': 'foobar',     // headers.rd
                'as': 'plumber'     // headers.as
            },                      //
            v2.Checksum.Types.None, // csum
            ['door', 'key', 'turn'] // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var counters = {
        slice: 0,
        toString: 0
    };
    introspectAndCountBuffer(buf, counters);

    assert.equal(counters.slice, 0);
    assert.equal(counters.toString, 0);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);
    assert.equal(counters.slice, 1);
    assert.equal(counters.toString, 0);

    var routingDelegate = lazyFrame.bodyRW.lazy.readRoutingDelegateStr(lazyFrame);

    assert.equal(routingDelegate, 'foobar',
        'expected routingDelegate to exist');
    assert.equal(counters.slice, 1,
        'should not call slice() in readRoutingDelegateStr()');
    assert.equal(counters.toString, 1,
        'should call toString() in readRoutingDelegateStr()');

    assert.end();
});

test('CallRequest.lazy cache', function t(assert) {
    var spanId = [0, 1];
    var parentId = [2, 3];
    var traceId = [4, 5];
    var tracing = new v2.Tracing(
        spanId, parentId, traceId
    );

    var frame = new v2.Frame(24,    // frame id
        new v2.CallRequest(
            42,                     // flags
            99,                     // ttl
            tracing,                // tracing
            'castle',               // service
            {                       // headers
                'cn': 'mario',      // headers.cn
                'as': 'plumber'     // headers.as
            },                      //
            v2.Checksum.Types.None, // csum
            ['door', 'key', 'turn'] // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var counters = {
        slice: 0,
        toString: 0
    };
    introspectAndCountBuffer(buf, counters);

    assert.equal(counters.slice, 0);
    assert.equal(counters.toString, 0);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);
    assert.equal(counters.slice, 1);
    assert.equal(counters.toString, 0);

    var service1 = lazyFrame.bodyRW.lazy.readServiceStr(lazyFrame);

    assert.equal(service1, 'castle',
        'expected serviceName to be castle');
    assert.equal(counters.slice, 1,
        'should not call slice() in readService()');
    assert.equal(counters.toString, 1,
        'should call toString() in readService()');

    var service2 = lazyFrame.bodyRW.lazy.readServiceStr(lazyFrame);

    assert.equal(service2, 'castle',
        'expected serviceName to be castle');
    assert.equal(counters.slice, 1,
        'should not call slice() in second readService()');
    assert.equal(counters.toString, 1,
        'should not call toString() in second readService()');

    var callerName1 = lazyFrame.bodyRW.lazy.readCallerNameStr(lazyFrame);

    assert.equal(callerName1, 'mario',
        'expected endpoint to be mario');
    assert.equal(counters.slice, 1,
        'should not call slice() in readCallerName()');
    assert.equal(counters.toString, 2,
        'should call toString() in readCallerName()');

    var callerName2 = lazyFrame.bodyRW.lazy.readCallerNameStr(lazyFrame);

    assert.equal(callerName2, 'mario',
        'expected endpoint to be mario');
    assert.equal(counters.slice, 1,
        'should not call slice() in second readCallerName()');
    assert.equal(counters.toString, 2,
        'should not call toString() in second readCallerName()');

    var endpoint1 = lazyFrame.bodyRW.lazy.readArg1Str(lazyFrame);

    assert.equal(endpoint1, 'door',
        'expected endpoint to be door');
    assert.equal(counters.slice, 1,
        'should not call slice() in readArg1Str()');
    assert.equal(counters.toString, 3,
        'should call toString() in readArg1Str()');

    var endpoint2 = lazyFrame.bodyRW.lazy.readArg1Str(lazyFrame);

    assert.equal(endpoint2, 'door',
        'expected endpoint to be door');
    assert.equal(counters.slice, 1,
        'should not call slice() in second readArg1Str()');
    assert.equal(counters.toString, 3,
        'should not call toString() in second readArg1Str()');

    assert.end();
});

function introspectAndCountBuffer(buf, counters, wrapSlice) {
    var bufSlice = buf.slice;
    buf.slice = function proxySlice() {
        counters.slice++;
        var newBuf = bufSlice.apply(this, arguments);
        introspectAndCountBuffer(newBuf, counters, false);
        return newBuf;
    };

    var bufToString = buf.toString;
    buf.toString = function proxyToString() {
        counters.toString++;
        return bufToString.apply(this, arguments);
    };

    if (wrapSlice !== false) {
        var utf8Slice = buf.parent.utf8Slice;
        buf.parent.utf8Slice = function proxyUtf8Slice() {
            counters.toString++;
            return utf8Slice.apply(this, arguments);
        };
    }
}

test('CallRequest.RW.lazy', function t(assert) {
    var spanId = [0, 1];
    var parentId = [2, 3];
    var traceId = [4, 5];
    var tracing = new v2.Tracing(
        spanId, parentId, traceId
    );

    var frame = new v2.Frame(24,    // frame id
        new v2.CallRequest(         // frame body
            42,                     // flags
            99,                     // ttl
            tracing,                // tracing
            "castle",               // service
            {                       // headers
                "cn": "mario",      // headers.cn
                "as": "plumber"     // headers.as
            },                      //
            v2.Checksum.Types.None, // csum
            ["door", "key", "turn"] // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    // validate basic lazy frame properties
    assert.equal(lazyFrame.id, frame.id, 'expected frame id');
    assert.equal(lazyFrame.type, frame.type, 'expected frame type');
    assert.deepEqual(lazyFrame.buffer.parent, buf.parent,
        'frame carries a slice into the original read buffer');

    // validate call req lazy reading
    assertReadRes(
        v2.CallRequest.RW.lazy.poolReadFlags(readRes, lazyFrame),
        frame.body.flags,
        'CallRequest.RW.lazy.readFlags');
    assert.equal(
        v2.CallRequest.RW.lazy.readTTL(lazyFrame),
        frame.body.ttl,
        'CallRequest.RW.lazy.readTTL');
    assertReadRes(
        v2.CallRequest.RW.lazy.poolReadTracing(readRes, lazyFrame),
        tracing,
        'CallRequest.RW.lazy.readTracing');
    assertReadRes(
        v2.CallRequest.RW.lazy.poolReadService(readRes, lazyFrame),
        frame.body.service,
        'CallRequest.RW.lazy.readService');
    assertReadRes(
        v2.CallRequest.RW.lazy.poolReadArg1(readRes, lazyFrame),
        Buffer(frame.body.args[0]),
        'CallRequest.RW.lazy.readArg1');
    assert.equal(
        v2.CallRequest.RW.lazy.isFrameTerminal(lazyFrame),
        !(frame.body.flags & v2.CallFlags.Fragment),
        'CallRequest.RW.lazy.isFrameTerminal');

    // validate lazy header reading
    var res = v2.CallRequest.RW.lazy.poolReadHeaders(readRes, lazyFrame);
    assert.ifError(res.err, 'no error from v2.CallRequest.RW.lazy.readHeaders');
    var headers = res.value;
    if (headers) {
        // should fail fast because no key matches length 4
        assert.equal(
            headers.getValue(Buffer("nope")),
            undefined,
            'no "nope" header key');
        // should fail slow since all keys have length 2, but none match
        assert.equal(
            headers.getValue(Buffer("no")),
            undefined,
            'no "no" header key');
        // should have these two
        assert.deepEqual(
            headers.getValue(Buffer("cn")),
            Buffer('mario'),
            'expected header "cn" => "mario"');
        assert.deepEqual(
            headers.getValue(Buffer("as")),
            Buffer('plumber'),
            'expected header "as" => "plumber"');
        // readArg1 can re-use readHeaders work
        assertReadRes(
            v2.CallRequest.RW.lazy.poolReadArg1(readRes, lazyFrame, headers),
            Buffer(frame.body.args[0]),
            'CallRequest.RW.lazy.readArg1, with headers');
    }

    // validate call req lazy writing
    var newTTL = frame.body.ttl - 15;
    assert.ifError(
        v2.CallRequest.RW.lazy.poolWriteTTL(writeRes, newTTL, lazyFrame).err,
        'no error from v2.CallRequest.RW.lazy.writeTTL');
    var newFrame = bufrw.fromBuffer(v2.Frame.RW, lazyFrame.buffer);
    assert.equal(
        newFrame.body.ttl, newTTL,
        'expected new TTL to round trip through eager frame');

    assert.end();

    function assertReadRes(res, value, desc) {
        assert.ifError(res.err, 'no error from ' + desc);
        assert.deepEqual(res.value, value, 'expected value from ' + desc);
    }
});

test('CallResponse.RW.lazy', function t(assert) {
    var spanId = [0, 1];
    var parentId = [2, 3];
    var traceId = [4, 5];
    var tracing = new v2.Tracing(
        spanId, parentId, traceId
    );

    var frame = new v2.Frame(24,    // frame id
        new v2.CallResponse(        // frame body
            42,                     // flags
            1,                      // code
            tracing,                // tracing
            {                       // headers
                "as": "plumber"     // headers.as
            },                      //
            v2.Checksum.Types.None, // csum
            ["", "creak", "open"]   // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    // validate basic lazy frame properties
    assert.equal(lazyFrame.id, frame.id, 'expected frame id');
    assert.equal(lazyFrame.type, frame.type, 'expected frame type');
    assert.deepEqual(lazyFrame.buffer.parent, buf.parent,
        'frame carries a slice into the original read buffer');

    // validate call res lazy reading
    assertReadRes(
        v2.CallResponse.RW.lazy.poolReadFlags(readRes, lazyFrame),
        frame.body.flags,
        'CallResponse.RW.lazy.readFlags');
    assertReadRes(
        v2.CallResponse.RW.lazy.poolReadTracing(readRes, lazyFrame),
        tracing,
        'CallResponse.RW.lazy.readTracing');
    assert.equal(
        v2.CallResponse.RW.lazy.isFrameTerminal(lazyFrame),
        !(frame.body.flags & v2.CallFlags.Fragment),
        'CallResponse.RW.lazy.isFrameTerminal');
    assertReadRes(
        v2.CallResponse.RW.lazy.poolReadArg1(readRes, lazyFrame),
        Buffer(frame.body.args[0]),
        'CallResponse.RW.lazy.readArg1');

    // validate lazy header reading
    var res = v2.CallResponse.RW.lazy.poolReadHeaders(readRes, lazyFrame);
    assert.ifError(res.err, 'no error from v2.CallResponse.RW.lazy.readHeaders');
    var headers = res.value;
    if (headers) {
        // should fail fast because no key matches length 4
        assert.equal(
            headers.getValue(Buffer("nope")),
            undefined,
            'no "nope" header key');
        // should fail slow since all keys have length 2, but none match
        assert.equal(
            headers.getValue(Buffer("no")),
            undefined,
            'no "no" header key');
        // should have this one
        assert.deepEqual(
            headers.getValue(Buffer("as")),
            Buffer('plumber'),
            'expected header "as" => "plumber"');
        // readArg1 can re-use readHeaders work
        assertReadRes(
            v2.CallResponse.RW.lazy.poolReadArg1(readRes, lazyFrame, headers),
            Buffer(frame.body.args[0]),
            'CallResponse.RW.lazy.readArg1, with headers');
    }

    assert.end();

    function assertReadRes(res, value, desc) {
        assert.ifError(res.err, 'no error from ' + desc);
        assert.deepEqual(res.value, value, 'expected value from ' + desc);
    }
});

test('CallRequestCont.RW.lazy', function t(assert) {
    var frame = new v2.Frame(24,    // frame id
        new v2.CallRequestCont(     // frame body
            42,                     // flags
            v2.Checksum.Types.None, // csum
            ["key", "turn"]         // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    // validate basic lazy frame properties
    assert.equal(lazyFrame.id, frame.id, 'expected frame id');
    assert.equal(lazyFrame.type, frame.type, 'expected frame type');
    assert.deepEqual(lazyFrame.buffer.parent, buf.parent,
        'frame carries a slice into the original read buffer');

    // validate lazy reading
    assertReadRes(
        v2.CallRequestCont.RW.lazy.readFlags(lazyFrame),
        frame.body.flags,
        'CallRequestCont.RW.lazy.readFlags');
    assert.equal(
        v2.CallRequestCont.RW.lazy.isFrameTerminal(lazyFrame),
        !(frame.body.flags & v2.CallFlags.Fragment),
        'CallRequestCont.RW.lazy.isFrameTerminal');

    assert.end();

    function assertReadRes(res, value, desc) {
        assert.ifError(res.err, 'no error from ' + desc);
        assert.deepEqual(res.value, value, 'expected value from ' + desc);
    }
});

test('CallResponseCont.RW.lazy', function t(assert) {
    var frame = new v2.Frame(24,    // frame id
        new v2.CallResponseCont(    // frame body
            42,                     // flags
            v2.Checksum.Types.None, // csum
            ["key", "turn"]         // args
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    // validate basic lazy frame properties
    assert.equal(lazyFrame.id, frame.id, 'expected frame id');
    assert.equal(lazyFrame.type, frame.type, 'expected frame type');
    assert.deepEqual(lazyFrame.buffer.parent, buf.parent,
        'frame carries a slice into the original read buffer');

    // validate lazy reading
    assertReadRes(
        v2.CallResponseCont.RW.lazy.readFlags(lazyFrame),
        frame.body.flags,
        'CallResponseCont.RW.lazy.readFlags');
    assert.equal(
        v2.CallResponseCont.RW.lazy.isFrameTerminal(lazyFrame),
        !(frame.body.flags & v2.CallFlags.Fragment),
        'CallResponseCont.RW.lazy.isFrameTerminal');

    assert.end();

    function assertReadRes(res, value, desc) {
        assert.ifError(res.err, 'no error from ' + desc);
        assert.deepEqual(res.value, value, 'expected value from ' + desc);
    }
});

test('ErrorResponse.RW.lazy', function t(assert) {
    var spanId = [0, 1];
    var parentId = [2, 3];
    var traceId = [4, 5];
    var tracing = new v2.Tracing(
        spanId, parentId, traceId
    );

    var frame = new v2.Frame(24,         // frame id
        new v2.ErrorResponse(            // frame body
            v2.ErrorResponse.Codes.Busy, // code
            tracing,                     // tracing
            "mess"                       // message
        )
    );
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    // validate basic lazy frame properties
    assert.equal(lazyFrame.id, frame.id, 'expected frame id');
    assert.equal(lazyFrame.type, frame.type, 'expected frame type');
    assert.deepEqual(lazyFrame.buffer.parent, buf.parent,
        'frame carries a slice into the original read buffer');

    // validate error res lazy reading
    assertReadRes(
        v2.ErrorResponse.RW.lazy.readCode(lazyFrame),
        v2.ErrorResponse.Codes.Busy,
        'ErrorResponsequest.RW.lazy.readCode');
    assertReadRes(
        v2.ErrorResponse.RW.lazy.readTracing(lazyFrame),
        tracing,
        'ErrorResponsequest.RW.lazy.readTracing');
    assertReadRes(
        v2.ErrorResponse.RW.lazy.readMessage(lazyFrame),
        "mess",
        'ErrorResponsequest.RW.lazy.readMessage');
    assert.equal(
        v2.ErrorResponse.RW.lazy.isFrameTerminal(lazyFrame),
        !(frame.body.flags & v2.CallFlags.Fragment),
        'ErrorResponse.RW.lazy.isFrameTerminal');

    assert.end();

    function assertReadRes(res, value, desc) {
        assert.ifError(res.err, 'no error from ' + desc);
        assert.deepEqual(res.value, value, 'expected value from ' + desc);
    }
});
