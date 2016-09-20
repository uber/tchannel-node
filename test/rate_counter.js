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

var test = require('tape');
var RateCounter = require('../lib/rate_counter');
var Timer = require('time-mock');

test('basic counting', function t1(assert) {
    var counter = createRateCounter();

    assert.equal(counter.rate, 0, 'expected 0 before incrementing');

    counter.increment();
    assert.equal(counter.rate, 1, 'expected 1 after incrementing');
    counter.increment();
    assert.equal(counter.rate, 2, 'expected 1 after incrementing again');

    assert.end();
});

test('resets after forced refreshes', function t1(assert) {
    var counter = createRateCounter();

    var randomIncrements = Math.floor(Math.random() * 100);
    for (var i = 0; i < randomIncrements; i++) {
        counter.increment();
    }
    assert.equal(counter.rate, randomIncrements,
        'expected ' + randomIncrements + ' after incrementing');

    for (var i = 0; i < counter.numOfBuckets; i++) {
        counter._refresh();
    }

    assert.equal(counter.rate, 0, 'expected 0 after reset');

    counter.destroy();
    assert.end();
});

test('resets after scheduled refreshes', function t1(assert) {
    var counter = createRateCounter();

    var randomIncrements = Math.floor(Math.random() * 100);
    for (var i = 0; i < randomIncrements; i++) {
        counter.increment();
    }
    assert.equal(counter.rate, randomIncrements,
        'expected ' + randomIncrements + ' after incrementing');

    counter.timers.advance(counter.rateInterval);
    assert.equal(counter.rate, 0, 'expected 0 after reset');

    counter.destroy();
    assert.end();
});

test('rate changes over period', function t1(assert) {
    var counter = createRateCounter();

    // increase per 1ms over 2s
    for (var i = 0; i < counter.rateInterval * 2; i++) {
        if (i < counter.rateInterval) {
            // in the first minute, rate should be increasing
            assert.equal(counter.rate, i, 'expected ' + i + ' after incrementing');
        } else {
            // after the first minute, rate should no longer increase
            assert.ok(counter.rate >= 950 && counter.rate <= 1000,
                'expected stabling after one minute');
        }
        counter.increment();
        counter.timers.advance(1)
    }

    counter.destroy();
    assert.end();
});

function createRateCounter() {
    var options = {
        timers: Timer(0)
    };

    return new RateCounter(options);
}
