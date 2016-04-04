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

var assert = require('assert');
var stat = require('../stat-tags');

var DEFAULT_MAX_SIZE = 1000;

module.exports = ObjectPool;

function ObjectPool(options) {
    assert(typeof options === 'object', 'expected options object');

    this.Type = options.Type;
    assert(typeof this.Type === 'function', 'expected options.Type to be constructor function');
    assert(typeof this.Type.prototype.reset === 'function', 'expected options.Type to have reset method');
    assert(typeof this.Type.prototype.clear === 'function', 'expected options.Type to have clear method');

    this.maxSize = options.maxSize || DEFAULT_MAX_SIZE;
    assert(typeof this.maxSize === 'number', 'expected options.maxSize to be number');

    this.name = options.name || this.Type.name;
    assert(typeof this.name === 'string', 'expected options.name to be string');

    this.freeList = [];
    this.outstanding = 0;

    this.freeListStatTags = new stat.ObjectPoolTags(
        this.name,
        'free'
    );

    this.outstandingStatTags = new stat.ObjectPoolTags(
        this.name,
        'outstanding'
    );

    // only used in debug mode
    this.outstandingList = [];
}

ObjectPool.channel = null;
ObjectPool.reportInterval = null;
ObjectPool.timers = null;
ObjectPool.pools = [];
ObjectPool.timer = null;
ObjectPool.refs = 0;
ObjectPool.debug = false;

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
    if (ObjectPool.refs >= 1) {
        ObjectPool.refs += 1;
        return;
    }

    ObjectPool.refs += 1;

    assert(typeof options === 'object', 'expected options object');

    assert(
        typeof options.channel === 'object' &&
        typeof options.channel.emitFastStat === 'function',
        'expected options.channel to be TChannel instance'
    );
    ObjectPool.channel = options.channel;

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

    if (typeof options.debug === 'boolean') {
        ObjectPool.debug = options.debug;
    }

    ObjectPool.timer = ObjectPool.timers.setTimeout(
        ObjectPool.reportStats,
        ObjectPool.reportInterval
    );
};

ObjectPool.unref = function unref() {
    ObjectPool.refs = Math.max(0, ObjectPool.refs - 1);
    if (ObjectPool.refs === 0) {
        ObjectPool.timers.clearTimeout(ObjectPool.timer);
        ObjectPool.timer = null;
    }
};

ObjectPool.reportStats = function reportStats() {
    // Iterate over pools, report their current size

    var i;
    for (i = 0; i < ObjectPool.pools.length; i++) {
        ObjectPool.pools[i].reportStats(ObjectPool.channel);
    }

    ObjectPool.timer = ObjectPool.timers.setTimeout(
        ObjectPool.reportStats,
        ObjectPool.reportInterval
    );
};

ObjectPool.prototype.reportStats = function reportStats(channel) {
    channel.emitFastStat(
        'tchannel.object-pool',
        'gauge',
        this.freeList.length,
        this.freeListStatTags
    );

    channel.emitFastStat(
        'tchannel.object-pool',
        'gauge',
        this.outstanding,
        this.outstandingStatTags
    );
};

ObjectPool.prototype.get = function get() {
    var inst;
    this.outstanding += 1;
    if (this.freeList.length) {
        inst = this.freeList.pop();
        assert(inst._objectPoolIsFreed, 'instance retreived from pool is free');
        inst._objectPoolIsFreed = false;

        if (ObjectPool.debug) {
            this.outstandingList.push(inst);
        }

        return inst;
    } else {
        inst = new this.Type();
        inst._objectPoolIsFreed = false;

        if (ObjectPool.debug) {
            this.outstandingList.push(inst);
        }

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

    var i;
    if (ObjectPool.debug) {
        for (i = 0; i < this.outstandingList.length; i++) {
            if (this.outstandingList[i] === inst) {
                this.outstandingList.splice(i, 1);
                return;
            }
        }
    }
};
