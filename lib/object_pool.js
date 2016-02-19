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

function ObjectPool(options) {
    assert(typeof options === 'object', 'expected options object');

    this.Type = options.Type;
    assert(typeof this.Type === 'function', 'expected options.Type to be constructor function');
    assert(typeof this.Type.prototype.reset === 'function', 'expected options.Type to have reset method');

    this.maxSize = options.maxSize || 1000;
    assert(typeof this.maxSize === 'number', 'expected options.maxSize to be number');

    this.freeList = [];
    this.outstanding = 0;
    this.reused = 0;
}

ObjectPool.setup = function setup(options) {
    var pool = new ObjectPool(options);
    Type.alloc = alloc;

    Type.prototype.free = function freeThisObj() {
        pool.free(this);
    };

    return pool;

    function alloc() {
        var obj = pool.get();
        return obj;
    }
};
