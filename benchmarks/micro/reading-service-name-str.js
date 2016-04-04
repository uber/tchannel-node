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

var process = global.process;
var bufrw = require('bufrw');
var setTimeout = require('timers').setTimeout;
var console = require('console');

/*eslint no-console: 0*/
var v2 = require('../../v2/index.js');

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

function main(mode, ITER) {
    var buf = bufrw.toBuffer(v2.Frame.RW, frame);

    runLoop(buf, mode, 1000);
    console.log('done warmup');
    setTimeout(pastWarmup, 250);

    function pastWarmup() {
        console.log('running bench', process.pid);
        var start = Date.now();
        runLoop(buf, mode, ITER);
        var end = Date.now();
        console.log('finised bench', end - start);
    }
}

function runLoop(buf, mode, ITER) {
    if (mode === 'optimized') {
        runOptimizedLoop(buf, ITER);
    } else if (mode === 'default') {
        runDefaultLoop(buf, ITER);
    } else {
        console.warn('noop');
    }
}

function runDefaultLoop(buf, ITER) {
    var resArr = new Array(10);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    for (var i = 0; i < ITER; i++) {
        var res = lazyFrame.bodyRW.lazy.readService(lazyFrame);

        resArr[i % 10] = new FrameData(res.value);

        // Naughty; reset cache
        lazyFrame.cache.serviceStr = null;
        lazyFrame.cache.headerStartOffset = null;
    }
}

function runOptimizedLoop(buf, ITER) {
    var resArr = new Array(10);
    var lazyFrame = bufrw.fromBuffer(v2.LazyFrame.RW, buf);

    for (var i = 0; i < ITER; i++) {
        var serviceName = lazyFrame.bodyRW.lazy.readServiceStr(lazyFrame);

        resArr[i % 10] = new FrameData(serviceName);

        // Naughty; reset cache
        lazyFrame.cache.serviceStr = null;
        lazyFrame.cache.headerStartOffset = null;
    }
}

function FrameData(serviceName) {
    this.serviceName = serviceName;
}

if (require.main === module) {
    var arg = process.argv[2];
    var mode = process.argv[3] || 'optimized';
    var ITERATIONS = 1000 * 1000 * 5;
    if (arg) {
        ITERATIONS = 1000 * 1000 * 5 * parseInt(arg, 10);
    }

    main(mode, ITERATIONS);
}
