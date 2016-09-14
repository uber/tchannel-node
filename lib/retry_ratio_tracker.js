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

var RateCounter = require('./rate_counter');

var DEFAULT_RATE_COUNTER_INTERVAL = 30 * 1000;
var DEFAULT_RATE_COUNTER_NUM_OF_BUCKETS = 30 * 20;

function RetryRatioTracker(options) {
    var rateCounterOpts = {
        rateInterval: options.rateCounterInterval || DEFAULT_RATE_COUNTER_INTERVAL,
        numBuckets: options.rateCounterNumOfBuckets || DEFAULT_RATE_COUNTER_NUM_OF_BUCKETS,
        timers: options.timers
    };

    this.retryRateCounter = new RateCounter(rateCounterOpts);
    this.requestRateCounter = new RateCounter(rateCounterOpts); // counts non-retry requests only
}

RetryRatioTracker.prototype.isWarmedUp = function isWarmedUp() {
    return this.requestRateCounter.isWarmedUp() && this.retryRateCounter.isWarmedUp();
};

RetryRatioTracker.prototype.currentRetryRatio = function currentRetryRatio() {
    if (this.requestRateCounter.rate === 0) {
        return 0;
    }
    return 1.0 * this.retryRateCounter.rate / this.requestRateCounter.rate;
};

RetryRatioTracker.prototype.incrementRequest = function incrementRequest(isRetry) {
    if (isRetry) {
        this.retryRateCounter.increment();
    } else {
        this.requestRateCounter.increment();
    }
};

RetryRatioTracker.prototype.destroy = function destroy() {
    this.retryRateCounter.destroy();
    this.requestRateCounter.destroy();
};
