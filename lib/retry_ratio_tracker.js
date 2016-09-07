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

module.exports = RetryRatioTracker;

var assert = require('assert');
var RateCounter = require('./rate_counter');

var RATE_INTERVAL = 1000;
var DEFAULT_RATE_COUNTER_NUM_OF_BUCKETS = 20;

function RetryRatioTracker(options) {
    assert(options.timers, 'options.timers required');

    if (!(this instanceof RetryRatioTracker)) {
        return new RetryRatioTracker(options);
    }

    var numOfBuckets = options.numOfBucketsInRateCounter || DEFAULT_RATE_COUNTER_NUM_OF_BUCKETS;
    var rateCounterOpts = {
        numBuckets: numOfBuckets
    };

    this.timers = options.timers;
    this.retryRateCounter = RateCounter(rateCounterOpts);
    this.requestRateCounter = RateCounter(rateCounterOpts);
    this.refreshCounterInterval = RATE_INTERVAL / numOfBuckets;

    this.refreshRateCounters();
}

RetryRatioTracker.prototype.currentRetryRatio = function currentRetryRatio() {
    if (this.requestRateCounter.rps === 0) {
        return 0;
    }
    return 1.0 * this.retryRateCounter.rps / this.requestRateCounter.rps;
};

RetryRatioTracker.prototype.incrementRequest = function incrementRequest(isRetry) {
    this.requestRateCounter.increment();
    if (isRetry) {
        this.retryRateCounter.increment();
    }
};

RetryRatioTracker.prototype.refreshRateCounters = function refreshRateCounters() {
    var self = this;
    self.requestRateCounter.refresh();
    self.retryRateCounter.refresh();
    this.refreshCountersTimer = this.timers.setTimeout(function refresh() {
        self.refreshRateCounters();
    }, this.refreshCounterInterval);
};

RetryRatioTracker.prototype.destroy = function destroy() {
    this.timers.clearTimeout(this.refreshCountersTimer);
    this.refreshCountersTimer = null;
};
