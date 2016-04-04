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

var STAT_EMIT_PERIOD = 100;

BatchStatsd.clean = clean;
BatchStatsd.cleanHostPort = cleanHostPort;
BatchStatsd.BaseStat = BaseStat;

var LENGTH_ARRAYS = {};

function BatchStatsd(options) {
    assert(options.logger, 'options.logger required');
    assert(options.timers, 'options.timers required');

    // required: 'app'
    // optional: 'host', 'cluster', 'version'
    assert(!options.baseTags || options.baseTags.app,
        'the stats must have the "app" tag');

    this.statsd = options.statsd;
    this.logger = options.logger;
    this.timers = options.timers;
    this.baseTags = new StatTags(options.baseTags);

    this.statsQueue = [];
    this.batchStatTimer = null;
    this.boundFlushStats = boundFlushStats;

    var self = this;

    function boundFlushStats() {
        self.flushStats();
    }
}

BatchStatsd.prototype.pushStat = function pushStat(name, type, value, tags) {
    var self = this;

    tags.app = self.baseTags.app;
    tags.host = self.baseTags.host;
    tags.cluster = self.baseTags.cluster;
    tags.version = self.baseTags.version;

    var stat = new BaseStat(name, type, value, tags);

    self.statsQueue.push(stat);

    return stat;
};

BatchStatsd.prototype.handleStat = function handleStat(stat) {
    var self = this;

    if (!self.statsd) {
        return;
    }

    var key = stat.tags.toStatKey(stat.name);

    if (stat.type === 'counter') {
        self.statsd.increment(key, stat.value);
    } else if (stat.type === 'gauge') {
        self.statsd.gauge(key, stat.value);
    } else if (stat.type === 'timing') {
        self.statsd.timing(key, stat.value);
    } else {
        self.logger.error('Trying to emit an invalid stat object', {
            statType: stat.type,
            statName: stat.name
        });
    }
};

BatchStatsd.prototype.flushStats = function flushStats() {
    var self = this;

    if (self.batchStatTimer) {
        self.timers.clearTimeout(self.batchStatTimer);
    }

    for (var i = 0; i < self.statsQueue.length; i++) {
        self.handleStat(self.statsQueue[i]);
    }
    self.statsQueue.length = 0;

    self.batchStatTimer = self.timers.setTimeout(
        self.boundFlushStats, STAT_EMIT_PERIOD
    );
};

BatchStatsd.prototype.destroy = function destroy() {
    var self = this;

    self.flushStats();

    self.timers.clearTimeout(self.batchStatTimer);
};

module.exports = BatchStatsd;

function BaseStat(name, type, value, tags) {
    var self = this;

    self.name = name;
    self.type = type;
    self.value = value;
    self.tags = tags || {};
}

function StatTags(opts) {
    var self = this;

    self.app = '';
    self.host = '';
    self.cluster = '';
    self.version = '';

    if (opts) {
        if (opts.app) {
            self.app = opts.app;
        }
        if (opts.host) {
            self.host = opts.host;
        }
        if (opts.cluster) {
            self.cluster = opts.cluster;
        }
        if (opts.version) {
            self.version = opts.version;
        }
    }
}

function clean(str, field) {
    var copy;

    if (!str) {
        return field;
    }

    copy = LENGTH_ARRAYS[str.length];
    if (!copy) {
        copy = LENGTH_ARRAYS[str.length] = [];
    }

    for (var i = 0; i < str.length; i++) {
        var char = str[i];

        if (char === ':' ||
            char === '/' ||
            char === '.' ||
            char === '{' ||
            char === '}'
        ) {
            copy[i] = '-';
        } else {
            copy[i] = char;
        }
    }

    return copy.join('');
}

function cleanHostPort(str, field) {
    var copy;

    if (!str) {
        return field;
    }

    var length = str.indexOf(':');

    copy = LENGTH_ARRAYS[length];
    if (!copy) {
        copy = LENGTH_ARRAYS[length] = [];
    }
    for (var i = 0; i < length; i++) {
        var char = str[i];

        if (char === '/' ||
            char === '.' ||
            char === '{' ||
            char === '}'
        ) {
            copy[i] = '-';
        } else {
            copy[i] = char;
        }
    }

    return copy.join('');
}
