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

var test = require('tape');
var Claim = require('../../v2/claim.js');
var testRW = require('bufrw/test_rw');
var Tracing = require('../../v2/tracing.js');

var testTracing = new Tracing(
    [66051, 67438087],
    [134810123, 202182159],
    [269554195, 336926231],
    24
);

test('Claim.RW: read/write payload', testRW.cases(Claim.RW, [

    // simple example payload
    [
        new Claim(42, testTracing), [
            0x00, 0x00, 0x00, 0x2a, // ttl:4
            0x00, 0x01, 0x02, 0x03, // tracing:24
            0x04, 0x05, 0x06, 0x07, // ...
            0x08, 0x09, 0x0a, 0x0b, // ...
            0x0c, 0x0d, 0x0e, 0x0f, // ...
            0x10, 0x11, 0x12, 0x13, // ...
            0x14, 0x15, 0x16, 0x17, // ...
            0x18                    // traceflags:1
        ]
    ]

]));
