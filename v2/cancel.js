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

var bufrw = require('bufrw');
var Tracing = require('./tracing');

// ttl:4 tracing:25 why~2
function Cancel(ttl, tracing, why) {
    this.type = Cancel.TypeCode;
    this.ttl = ttl || 0;
    this.tracing = tracing || Tracing.emptyTracing;
    this.why = why || '';
}

Cancel.TypeCode = 0xc0;

Cancel.RW = bufrw.Struct(Cancel, [
    {name: 'ttl', rw: bufrw.UInt32BE}, // ttl:4
    {name: 'tracing', rw: Tracing.RW}, // tracing:25
    {name: 'why', rw: bufrw.str2}      // why~2
]);

module.exports = Cancel;
