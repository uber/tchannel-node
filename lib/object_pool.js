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

var assert = require('assert');

/*
    ObjectPool.setup({
        Type: LazyRelayInreq,
        maxSize: 5000
    });
*/

module.exports = ObjectPool;

function ObjectPool(options) {
    assert(typeof options === 'object', 'expected options object');

    this.Type = options.Type;
    assert(typeof this.Type === 'function', 'expected options.Type to be constructor function');
    assert(typeof this.Type.prototype.reset === 'function', 'expected options.Type to have reset method');
    assert(typeof this.Type.prototype.clear === 'function', 'expected options.Type to have clear method');

    this.maxSize = options.maxSize || 1000;
    assert(typeof this.maxSize === 'number', 'expected options.maxSize to be number');

    this.name = options.name || this.Type.name;
    assert(typeof this.name === 'string', 'expected options.name to be string');

    this.freeList = [];
    this.outstanding = 0;
}

ObjectPool.statsd = null;
ObjectPool.reportInterval = null;
ObjectPool.timers = null;
ObjectPool.pools = [];
ObjectPool.timer = null;

ObjectPool.setup = function setup(options) {
    var pool = new ObjectPool(options);
    options.Type.alloc = alloc;

    options.Type.prototype.free = function freeThisObj() {
        pool.free(this);
    };

    ObjectPool.pools.push(pool);

    return pool;

    function alloc() {
        var obj = pool.get();
        return obj;
    }
};

ObjectPool.bootstrap = function bootstrap(options) {
    assert(typeof options === 'object', 'expected options object');

    assert(
        typeof options.statsd === 'object' &&
        typeof options.statsd.gauge === 'function',
        'expected options.statsd to be statsd instance'
    );
    ObjectPool.statsd = options.statsd;

    assert(
        typeof options.reportInterval === 'number',
        'expected options.reportInterval to be number'
    );
    ObjectPool.reportInterval = options.reportInterval;


    assert(
        typeof options.timers === 'object' && 
        typeof options.timers.setTimeout === 'function',
        'expected options.timers to be timers object'
    );
    ObjectPool.timers = options.timers;

    ObjectPool.timer = ObjectPool.timers.setTimeout(
        ObjectPool.reportStats, 
        ObjectPool.reportInterval
    );
};

ObjectPool.destroy = function destroy() {
    ObjectPool.timers.clearTimeout(ObjectPool.timer);
};

ObjectPool.reportStats = function reportStats() {
    // Iterate over pools
    // report their current size
    var i;
    var pool;
    for (i = 0; i < ObjectPool.pools.length; i++) {
        pool = ObjectPool.pools[i];
        if (ObjectPool.statsd) {
            ObjectPool.statsd.gauge(
                'object-pools.' + pool.name + '.free',
                pool.freeList.length 
            );

            // This stat is how we infer the maxSize property
            ObjectPool.statsd.gauge(
                'object-pools.' + pool.name + '.outstanding',
                pool.outstanding
            );
        }
    }

    ObjectPool.timer = ObjectPool.timers.setTimeout(
        ObjectPool.reportStats, 
        ObjectPool.reportInterval
    );
};

ObjectPool.prototype.get = function get() {
    this.outstanding += 1;
    if (this.freeList.length) {
        var inst = this.freeList.pop();
        assert(inst._objectPoolIsFreed, 'instance retreived from pool is free');
        inst._objectPoolIsFreed = false;
        return inst;
    } else {
        var inst = new this.Type();
        inst._objectPoolIsFreed = false;
        return inst;
    }
};

ObjectPool.prototype.free = function free(inst) {
    assert(!inst._objectPoolIsFreed, 'object pool double free');
    inst._objectPoolIsFreed = true;

    inst.clear();
    if (this.outstanding <= this.maxSize) {
        this.freeList.push(inst);
    }
    this.outstanding -= 1;
};
