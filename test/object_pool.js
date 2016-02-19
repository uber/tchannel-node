// Copyright (c) 2015 Uber Technologies, Inc.
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
var ObjectPool = require('../lib/object_pool');
var Timer = require('time-mock');

function Widget() {
    this.type = null;
    this.count = null;
}

Widget.prototype.reset = function reset(options) {
    this.type = options.type;
    this.count = options.count;
};

Widget.prototype.clear = function clear() {
    this.type = null;
    this.count = null;
}

ObjectPool.setup({
    Type: Widget,
    maxSize: 2
});

test('object pool happy', function t1(assert) {
    var timers = Timer(0);
    var stats = {};
    var statsd = {gauge: function (k, v) { stats[k] = v; }};

    ObjectPool.bootstrap({
        statsd: statsd,
        timers: timers,
        reportInterval: 500
    });

    var w = Widget.alloc();
    w.reset({type: 'foo', count: 10});

    assert.equal(ObjectPool.pools[0].freeList.length, 0, 'no free instances yet');
    assert.equal(ObjectPool.pools[0].outstanding, 1, '1 outstanding instace');

    var w2 = Widget.alloc();
    w2.reset({type: 'foo', count: 10});

    assert.equal(ObjectPool.pools[0].freeList.length, 0, 'no free instances yet');
    assert.equal(ObjectPool.pools[0].outstanding, 2, '2 outstanding instace');

    var w3 = Widget.alloc();
    w3.reset({type: 'foo', count: 10});

    assert.equal(ObjectPool.pools[0].freeList.length, 0, 'no free instances yet');
    assert.equal(ObjectPool.pools[0].outstanding, 3, '3 outstanding instace');

    w.free();
    // after w.free() the free list is still 0 because maxSize of the pool is 2

    assert.equal(ObjectPool.pools[0].freeList.length, 0, 'no free instances');
    assert.equal(ObjectPool.pools[0].outstanding, 2, '2 outstanding instace');

    w2.free();

    assert.equal(ObjectPool.pools[0].freeList.length, 1, '1 free instance');
    assert.equal(ObjectPool.pools[0].outstanding, 1, '1 outstanding instace');

    timers.advance(500);
    assert.deepEqual(stats, {
        'object-pools.Widget.free': 1,
        'object-pools.Widget.outstanding': 1
    });

    w = Widget.alloc();

    assert.ok(w2 === w, 'object was allocated from free list');
    assert.equal(w2.type, null, 'object type field was cleared');
    assert.equal(w2.count, null, 'object count field was cleared');

    assert.equal(ObjectPool.pools[0].freeList.length, 0, '0 free instances');
    assert.equal(ObjectPool.pools[0].outstanding, 2, '2 outstanding instace');

    w.free();
    w3.free();

    assert.equal(ObjectPool.pools[0].freeList.length, 2, '2 free instances');
    assert.equal(ObjectPool.pools[0].outstanding, 0, '0 outstanding instace');

    timers.advance(500);
    assert.deepEqual(stats, {
        'object-pools.Widget.free': 2,
        'object-pools.Widget.outstanding': 0
    });

    assert.end();
});
