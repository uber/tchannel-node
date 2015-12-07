// Copyright (c) 2015 Uber Technologies, Inc.

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
/* eslint no-console:0 no-process-exit:0 */

var Statsd = require('uber-statsd-client');
var FastStats = require('fast-stats').Stats;
var process = require('process');
var setTimeout = require('timers').setTimeout;
var Buffer = require('buffer').Buffer;
var console = require('console');

process.title = 'nodejs-benchmarks-multi_bench';

var readBenchConfig = require('./read-bench-config.js');
var TChannel = require('../channel');
var CheatChannel = require('./cheat-channel/channel.js');
var Reporter = require('../tcollector/reporter.js');
var base2 = require('../test/lib/base2');
var LCGStream = require('../test/lib/rng_stream');
var errors = require('../errors.js');

// TODO: disentangle the global closure of numClients and numRequestss and move
// these after the harness class declaration
var argv = readBenchConfig({
    alias: {
        m: 'multiplicity',
        c: 'numClients',
        r: 'numRequests',
        p: 'pipeline',
        s: 'sizes'
    },
    boolean: ['relay', 'trace', 'bad']
}, {
    multiplicity: 1,
    numClients: 5,
    numRequests: 20000,
    pipeline: '10,100,1000,20000',
    sizes: '4,4096'
});

var multiplicity = parseInt(argv.multiplicity, 10);
var numClients = parseInt(argv.numClients, 10);
var numRequests = parseInt(argv.numRequests, 10);
var maxPerLoop = parseInt(argv.maxPerLoop, 10);
argv.pipeline = parseIntList(argv.pipeline);
argv.sizes = parseIntList(argv.sizes);

var CHEAT_CLIENT = argv.cheatClient;

var DESTINATION_SERVER;
var TRACE_SERVER;
var CLIENT_PORT = argv.clientPort;

if (argv.relay) {
    DESTINATION_SERVER = '127.0.0.1:' + argv.relayServerPort;
} else {
    DESTINATION_SERVER = '127.0.0.1:' + argv.benchPort;
}

if (argv.trace) {
    TRACE_SERVER = '127.0.0.1:7037';
}

// -- test harness

function Test(args) {
    this.args = args;

    this.arg1 = new Buffer(args.command);
    this.command = args.command;
    this.arg2 = args.arg2 || null;
    this.arg3 = args.arg3 || null;

    this.callback = null;
    this.clients = [];
    this.channels = [];
    this.clientsReady = 0;
    this.commandsSent = 0;
    this.commandsCompleted = 0;
    this.maxPipeline = this.args.pipeline || numRequests;
    this.maxPerLoop = maxPerLoop || 5000;
    this.clientOptions = args.clientOptions || {
        returnBuffers: false
    };

    this.connectLatency = new FastStats();
    this.readyLatency = new FastStats();
    this.commandLatency = new FastStats();

    this.expectedError = args.expectedError;
}

Test.prototype.copy = function copy() {
    return new Test(this.args);
};

Test.prototype.run = function run(callback) {
    var self = this;
    var i;

    this.callback = callback;

    var counter = numClients;
    for (i = 0; i < numClients; i++) {
        self.newClient(i, onReady);
    }

    function onReady(err) {
        if (err) {
            // TODO: wrap error "failed to setup clients"
            callback(err);
            return;
        }

        counter--;
        if (counter === 0) {
            self.start(callback);
        }
    }
};

Test.prototype.newClient = function newClient(id, callback) {
    var self = this;
    var port = CLIENT_PORT + id;

    var channelConstr = CHEAT_CLIENT ? CheatChannel : TChannel;

    var clientChan = channelConstr({
        statTags: {
            app: 'my-client'
        },
        emitConnectionMetrics: false,
        trace: true,
        statsd: new Statsd({
            host: '127.0.0.1',
            port: 7036
        })
    });

    // // useful for demonstrating (lack of) tombstone leak
    // var OpKindMonitor = require('../monitor').OpKindMonitor;
    // (new OpKindMonitor(clientChan, {
    //     log: console.error,
    //     desc: 'client:' + id,
    //     interval: 5000,
    // })).run();

    if (argv.trace && !CHEAT_CLIENT) {
        var reporter = Reporter({
            channel: clientChan.makeSubChannel({
                serviceName: 'tcollector',
                peers: [TRACE_SERVER]
            }),
            logger: clientChan.logger,
            callerName: 'my-client'
        });

        clientChan.tracer.reporter = function report(span) {
            reporter.report(span, {
                timeout: 10 * 1000
            });
        };
    }

    var client;
    if (CHEAT_CLIENT) {
        client = clientChan.createClient('benchmark', {
            ping: {
                headers: {
                    as: 'raw',
                    cn: 'multi_bench',
                    benchHeader1: 'bench value one',
                    benchHeader2: 'bench value two',
                    benchHeader3: 'bench value three'
                },
                ttl: 30 * 1000
            },
            get: {
                headers: {
                    as: 'raw',
                    cn: 'multi_bench',
                    benchHeader1: 'bench value one',
                    benchHeader2: 'bench value two',
                    benchHeader3: 'bench value three'
                },
                ttl: 30 * 1000
            },
            set: {
                headers: {
                    as: 'raw',
                    cn: 'multi_bench',
                    benchHeader1: 'bench value one',
                    benchHeader2: 'bench value two',
                    benchHeader3: 'bench value three'
                },
                ttl: 30 * 1000
            }
        });
    } else {
        client = clientChan.makeSubChannel({
            serviceName: 'benchmark',
            peers: [DESTINATION_SERVER]
        });
    }

    client.createTime = Date.now();
    clientChan.listen(port, '127.0.0.1', onListen);

    function onListen(err) {
        if (err) {
            return callback(err);
        }
        self.clients[id] = client;
        self.channels[id] = clientChan;
        // sending a ping to pre-connect the socket

        if (CHEAT_CLIENT) {
            client.sendPing({
                host: DESTINATION_SERVER,
                arg2: null,
                arg3: null
            }, pinged);
        } else {
            client
                .request({
                    serviceName: 'benchmark',
                    hasNoParent: true,
                    timeout: 30 * 1000,
                    headers: {
                        as: 'raw',
                        cn: 'multi_bench'
                    }
                })
                .send('ping', null, null, pinged);
        }

        function pinged(err2, frame) {
            if (err2) {
                return callback(err2);
            }

            if (CHEAT_CLIENT) {
                frame.readArg3str();
            }

            self.connectLatency.push(Date.now() - client.createTime);
            self.readyLatency.push(Date.now() - client.createTime);
            callback();
        }
    }
};

Test.prototype.start = function start(callback) {
    this.testStart = Date.now();
    this.fillPipeline(callback);
};

Test.prototype.fillPipeline = function fillPipeline(callback) {
    var pipeline = this.commandsSent - this.commandsCompleted;
    var maxPerLoop = this.maxPerLoop;
    var sendInLoop = 0;

    while (this.commandsSent < numRequests &&
        pipeline < this.maxPipeline &&
        sendInLoop < maxPerLoop
    ) {
        sendInLoop++;
        this.commandsSent++;
        pipeline++;
        this.sendNext();
    }

    if (this.commandsCompleted === numRequests) {
        this.printStats();
        this.stopClients(callback);
    }
};

Test.prototype.stopClients = function stopClients(callback) {
    var self = this;

    var count = 1;
    this.clients.forEach(function each(client, index) {
        count++;
        self.channels[index].close(closed);
    });
    closed();

    function closed() {
        if (--count <= 0) {
            self.callback(null);
        }
    }
};

Test.prototype.sendNext = function sendNext() {
    var self = this;
    var curClient = this.commandsSent % this.clients.length;
    var start = Date.now();

    if (CHEAT_CLIENT) {
        var client = this.clients[curClient];
        var opts = {
            host: DESTINATION_SERVER,
            arg2: this.arg2,
            arg3: this.arg3
        };

        if (this.command === 'ping') {
            client.sendPing(opts, done);
        } else if (this.command === 'get') {
            client.sendGet(opts, done);
        } else if (this.command === 'set') {
            client.sendSet(opts, done);
        }
    } else {
        var req = this.clients[curClient].request({
            serviceName: 'benchmark',
            hasNoParent: true,
            timeout: 30000,
            headers: {
                as: 'raw',
                cn: 'multi_bench',
                benchHeader1: 'bench value one',
                benchHeader2: 'bench value two',
                benchHeader3: 'bench value three'
            }
        });
        req.send(this.arg1, this.arg2, this.arg3, done);
    }

    function done(err, frame) {
        if (err) {
            if (!self.expectedError ||
                !self.expectedError(err)) {
                throw err;
            }
        }

        if (CHEAT_CLIENT) {
            frame.readArg3str();
        }

        self.commandsCompleted++;
        var delta = Date.now() - start;
        self.commandLatency.data.push(delta);
        self.commandLatency._add_cache(delta);
        self.fillPipeline(onRageQuit);
    }
};

Test.prototype.getStats = function getStats() {
    var s = this.commandLatency;
    var obj = {
        mean: s.amean(),
        median: s.median(),
        p75: s.percentile(75),
        p95: s.percentile(95),
        p99: s.percentile(99),
        p999: s.percentile(999),
        type: 'histogram',
        min: s.range()[0],
        max: s.range()[1],
        /*eslint camelcase: 0*/
        std_dev: s.stddev(),
        sum: s.sum,
        count: s.length
    };

    obj.descr = this.args.descr;
    obj.instanceNumber = argv.instanceNumber;
    obj.pipeline = this.args.pipeline;
    obj.numClients = this.clientsReady;
    obj.elapsed = Date.now() - this.testStart;
    obj.numRequests = numRequests;
    obj.rate = numRequests / (obj.elapsed / 1000);
    return obj;
};

Test.prototype.printStats = function printStats() {
    var obj = this.getStats();
    process.stdout.write(JSON.stringify(obj) + '\n');
};

// -- define tests

var tests = [];

if (!argv.skipPing) {
    argv.pipeline.forEach(function each(pipeline) {
        tests.push(new Test({
            descr: 'PING',
            command: 'ping',
            args: null,
            pipeline: pipeline
        }));
    });
}

var randBytes = new LCGStream({
    seed: 1234,
    limit: Infinity
});

argv.sizes.forEach(function each(size) {
    var sizeDesc = base2.pretty(size, 'B');
    var key = 'foo_rand000000000000';

    // 4 base64 encoded bytes per 3 raw bytes
    var buf = randBytes.read(Math.ceil(size / 4 * 3));
    if (!buf) {
        throw new Error('can\'t have size ' + sizeDesc);
    }

    // chop off any "==" trailer
    var str = buf.toString('base64').slice(0, size);

    var keyBuf = new Buffer(key + '0');
    var strBuf = new Buffer(str);

    var expectedErrorTypes = {};
    if (argv.expectedError) {
        argv.expectedError
            .split(/,\s*/)
            .forEach(function eachLine(errType) {
                expectedErrorTypes[errType] = true;
            });
    }
    if (argv.bad) {
        expectedErrorTypes.BadRequest = true;
    }

    argv.pipeline.forEach(function eachPipe(pipeline) {
        tests.push(new Test({
            descr: 'SET str ' + sizeDesc,
            command: 'set' + (argv.bad ? '_bad' : ''),
            arg2: key,
            arg3: str,
            pipeline: pipeline,
            expectedError: expectedError
        }));
        tests.push(new Test({
            descr: 'GET str ' + sizeDesc,
            command: 'get' + (argv.bad ? '_bad' : ''),
            arg2: key,
            pipeline: pipeline,
            expectedError: expectedError
        }));

        tests.push(new Test({
            descr: 'SET buf ' + sizeDesc,
            command: 'set' + (argv.bad ? '_bad' : ''),
            arg2: keyBuf,
            arg3: strBuf,
            pipeline: pipeline,
            expectedError: expectedError
        }));
        tests.push(new Test({
            descr: 'GET buf ' + sizeDesc,
            command: 'get' + (argv.bad ? '_bad' : ''),
            arg2: keyBuf,
            pipeline: pipeline,
            expectedError: expectedError
        }));
    });

    function expectedError(err) {
        var type = errors.classify(err) || err.type;
        return expectedErrorTypes[type] || false;
    }
});

function next(i, j, done) {
    if (i >= tests.length) {
        return done(null);
    }
    if (j >= multiplicity) {
        return next(i + 1, 0, done);
    }

    var test = tests[i].copy();
    test.run(function runit(err) {
        if (err) {
            done(err);
            return;
        }
        setTimeout(function delayNext() {
            next(i, j + 1, done);
        }, 1000);
    });
}

function onRageQuit(err) {
    if (err) {
        console.error(err);
        process.exit(1);
    }
}

next(0, 0, function finish(err) {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    process.exit(0);
});

function parseIntList(str) {
    if (typeof str === 'number') {
        return [str];
    }
    if (Array.isArray(str)) {
        return str;
    }
    return str
        .split(/\s*,\s*/)
        .map(function each(part) {
            return parseInt(part, 10);
        });
}
