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

var process = require('process');
process.title = 'nodejs-benchmarks-bench_server';

var readBenchConfig = require('./read-bench-config.js');
var assert = require('assert');
var Statsd = require('uber-statsd-client');
var setTimeout = require('timers').setTimeout;

var Reporter = require('../tcollector/reporter.js');
var TChannel = require('../channel');
var RandomSample = require('./random_sample.js');

var argv = readBenchConfig({
    boolean: ['trace']
}, {
    pingOverhead: 'none',
    setOverhead: 'none',
    getOverhead: 'none'
});

var SERVER_HOST = '127.0.0.1';

assert(argv.port, 'port needed');
assert(argv.instances, 'instances needed');

var overhead = {};
overhead.ping = parseOverhead(argv.pingOverhead);
overhead.set = parseOverhead(argv.setOverhead);
overhead.get = parseOverhead(argv.getOverhead);

assert('trace' in argv, 'trace option needed');
if (argv.trace) {
    assert(argv.traceRelayHostPort, 'traceRelayHostPort needed');
}

var INSTANCES = parseInt(argv.instances, 10);
var STATS_PORT = parseInt(argv.statsdPort, 10);

function BenchServer(port) {
    if (!(this instanceof BenchServer)) {
        return new BenchServer(port);
    }

    var self = this;

    self.port = port;
    self.server = TChannel({
        statTags: {
            app: 'my-server'
        },
        trace: true,
        logger: require('debug-logtron')('server'),
        traceSample: argv.trace ? 1 : 0.01,
        emitConnectionMetrics: false,
        statsd: new Statsd({
            host: '127.0.0.1',
            port: STATS_PORT
        })
    });

    if (argv.trace) {
        self.setupReporter();
    }

    self.serverChan = self.server.makeSubChannel({
        traceSample: argv.trace ? 1 : 0.01,
        serviceName: 'benchmark'
    });

    self.keys = {};

    self.registerEndpoints();
}

BenchServer.prototype.setupReporter = function setupReporter() {
    var self = this;

    var reporter = Reporter({
        channel: self.server.makeSubChannel({
            serviceName: 'tcollector',
            peers: [argv.traceRelayHostPort]
        }),
        logger: self.server.logger,
        callerName: 'my-server'
    });

    self.server.tracer.reporter = function report(span) {
        reporter.report(span, {
            timeout: 10 * 1000
        });
    };
};

BenchServer.prototype.registerEndpoints = function registerEndpoints() {
    var self = this;

    var pingEndpoint = onPing;
    var setEndpoint = onSet;
    var getEndpoint = onGet;

    if (overhead.ping) {
        pingEndpoint = withDelay(onPing, overhead.ping);
    }
    if (overhead.set) {
        setEndpoint = withDelay(onSet, overhead.set);
    }
    if (overhead.get) {
        getEndpoint = withDelay(onGet, overhead.get);
    }

    self.serverChan.register('ping', pingEndpoint);
    self.serverChan.register('set', setEndpoint);
    self.serverChan.register('get', getEndpoint);

    self.serverChan.register('bad_set', onBad);
    self.serverChan.register('bad_get', onBad);

    function onSet(req, res, arg2, arg3) {
        var key = arg2.toString('utf8');
        var val = arg3.toString('utf8');
        self.keys[key] = val;
        res.headers.as = 'raw';
        res.sendOk('ok', 'really ok');
    }

    function onGet(req, res, arg2, arg3) {
        var key = arg2.toString('utf8');
        res.headers.as = 'raw';
        if (self.keys[key] !== undefined) {
            var val = self.keys[key];
            res.sendOk(val.length.toString(10), val);
        } else {
            res.sendNotOk('key not found', key);
        }
    }
};

function onPing(req, res) {
    res.headers.as = 'raw';
    res.sendOk('pong', null);
}

function onBad(req, res, arg2, arg3) {
    res.headers.as = 'raw';
    res.sendError('BadRequest', 'parse error');
}

BenchServer.prototype.listen = function listen() {
    var self = this;

    self.server.listen(self.port, SERVER_HOST);
};

for (var i = 0; i < INSTANCES; i++) {
    var port = parseInt(argv.port, 10) + i;

    var benchServer = BenchServer(port);
    benchServer.listen();
}

function parseOverhead(str) {
    if (str === 'none') {
        return null;
    } else {
        return RandomSample.fromString(str);
    }
}

function withDelay(handler, delay) {
    return delayedHandler;

    function delayedHandler(req, res, arg2, arg3) {
        var t = delay();
        setTimeout(runHandler, t);
        function runHandler() {
            handler(req, res, arg2, arg3);
        }
    }
}

// setInterval(function () {
//  Object.keys(keys).forEach(function (key) {
//      console.log(key + '=' + keys[key].length + ' bytes');
//  });
// }, 1000);
