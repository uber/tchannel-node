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

var CountedReadySignal = require('ready-signal/counted');
var series = require('run-series');
var parallel = require('run-parallel');
var allocCluster = require('./lib/alloc-cluster');
var TChannel = require('../channel');
var MockTimers = require('time-mock');

allocCluster.test('retries over conn failures', {
    numPeers: 3
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var clientChan = client.makeSubChannel({
        serviceName: 'server'
    });

    var server = cluster.channels[1];
    server.makeSubChannel({
        serviceName: 'server'
    }).register('echo', servedByFoo('server'));

    var dead = cluster.channels[2];

    clientChan.peers.add(server.hostPort);
    clientChan.peers.add(dead.hostPort);

    dead.close();

    parallel([
        makeRPC(),
        makeRPC(),
        makeRPC(),
        makeRPC(),
        makeRPC(),
        makeRPC(),
        makeRPC(),
        makeRPC(),
        makeRPC()
    ], onResult);

    function onResult(err) {
        assert.ifError(err);

        assert.end();
    }

    function makeRPC() {
        return function thunk(cb) {
            clientChan.request({
                serviceName: 'server',
                hasNoParent: true,
                headers: {
                    cn: 'client',
                    as: 'raw'
                }
            }).send('echo', '', '', cb);
        };
    }
});

allocCluster.test('request retries', {
    numPeers: 4
}, function t(cluster, assert) {
    // chan 1 declines
    cluster.channels[0]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', declineFoo);

    // chan 2 too busy
    cluster.channels[1]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', busyFoo);

    // chan 3 unexpected error
    cluster.channels[2]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', unexpectedErrorFoo);

    // success!
    cluster.channels[3]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', servedByFoo(4));

    var client = TChannel({
        timeoutFuzz: 0
    });
    var chan = client.makeSubChannel({
        serviceName: 'tristan',
        peers: cluster.hosts,
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            },
            serviceName: 'tristan'
        }
    });
    withConnectedClient(chan, cluster, onConnected);

    function onConnected() {
        var req = chan.request({
            hasNoParent: true,
            timeout: 100
        });
        req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
            onResponse(req, err, res, arg2, arg3);
        });
    }

    function onResponse(req, err, res, arg2, arg3) {
        if (err) return finish(err);

        assert.ok(req.outReqs.length >= 1 &&
            req.outReqs.length <= 4, 'expected at most 4 tries');

        var reqErrors = req.outReqs.filter(function isErr(r) {
            return r.err;
        });
        var reqResp = req.outReqs.filter(function isResp(r) {
            return r.res;
        });

        assert.equal(reqResp.length, 1);

        for (var i = 0; i < reqErrors.length; i++) {
            assert.ok(
                reqErrors[i].err.type === 'tchannel.declined' ||
                reqErrors[i].err.type === 'tchannel.busy' ||
                reqErrors[i].err.type === 'tchannel.unexpected',
                'expected error request'
            );
        }

        assert.ok(reqResp[0] &&
                  reqResp[0].res, 'expected to have 4th response');
        assert.deepEqual(reqResp[0] &&
                         reqResp[0].res.arg2, arg2, 'arg2 came form 4th response');
        assert.deepEqual(reqResp[0] &&
                         reqResp[0].res.arg3, arg3, 'arg3 came form 4th response');
        assert.equal(String(arg2), 'served by 4', 'served by expected server');
        assert.equal(String(arg3), 'HI', 'got expected response');

        finish();
    }

    function finish(err) {
        assert.ifError(err, 'no final error');

        cluster.assertEmptyState(assert);

        client.close();
        assert.end();
    }
});

allocCluster.test('maxRetryRatio limits retries', {
    numPeers: 4
}, function t(cluster, assert) {
    // chan 1 declines
    cluster.channels[0]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', declineFoo);

    // chan 2 too busy
    cluster.channels[1]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', busyFoo);

    // chan 3 unexpected error
    cluster.channels[2]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', unexpectedErrorFoo);

    // success!
    cluster.channels[3]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', servedByFoo(4));

    var mockTimers = MockTimers(Date.now());

    var client = TChannel({
        timeoutFuzz: 0
    });

    var chan = client.makeSubChannel({
        serviceName: 'tristan',
        peers: cluster.hosts,
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            },
            serviceName: 'tristan'
        },
        enableMaxRetryRatio: true,
        maxRetryRatio: 1.0,
        timers: mockTimers
    });

    withConnectedClient(chan, cluster, onConnected);

    function onConnected() {
        series([
            alwaysAllowRetries,
            completelyDisabledRetries,
            onlyAllowMaxThirtyPercentRetries,
            retryCounterGetsResetAfterRateInterval
        ], finish);

        function alwaysAllowRetries(next) {
            var req = chan.request({
                hasNoParent: true,
                timeout: 100
            });
            req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                var tries = req.outReqs.length;
                assert.true(tries >= 1 && tries <= 4, 'expected 1 to 4 tries');
                assert.equal(chan.retryRatioTracker.retryRateCounter.rate, tries - 1, "retry counts do not match");
                assert.equal(chan.retryRatioTracker.requestRateCounter.rate, 1, "request counts do not match");
                next();
            });
        }

        function completelyDisabledRetries(next) {
            resetRetryBudget(-1);
            var req = chan.request({
                hasNoParent: true
            });
            req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                assert.equal(req.outReqs.length, 1, 'expected 1 tries');
                assert.equal(chan.retryRatioTracker.retryRateCounter.rate, 0, 'retry counts do not match');
                assert.equal(chan.retryRatioTracker.requestRateCounter.rate, 1, 'try counts do not match');
                next();
            });
        }

        function onlyAllowMaxThirtyPercentRetries(next) {
            var maxRetryRatio = 0.3;
            resetRetryBudget(maxRetryRatio);

            var totalNonRetries = 100;
            var totalRetries = 0;
            var makeRequestFuncs = [];
            for (var i = 0; i < totalNonRetries; i++) {
                makeRequestFuncs.push(function sendReq(subNext) {
                    var req = chan.request({
                        hasNoParent: true
                    });
                    req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                        var tries = req.outReqs.length;
                        totalRetries += tries - 1;
                        subNext();
                    });
                });
            }
            series(makeRequestFuncs, function checkRetries() {
                assert.true(totalRetries >= 25 && totalRetries <= 30,
                    'total retries exceed the max retry ratio');
                assert.true(1.0 * totalRetries / totalNonRetries <= maxRetryRatio,
                    'total retries exceed the max retry ratio');
                assert.equal(totalRetries, chan.retryRatioTracker.retryRateCounter.rate, 'retry counts do not match');
                assert.equal(totalNonRetries, chan.retryRatioTracker.requestRateCounter.rate, 'try counts do not match');
                next();
            })
        }

        function retryCounterGetsResetAfterRateInterval(next) {
            resetRetryBudget(1.0);

            var makeRequestFuncs = [];
            for (var i = 0; i < 10; i++) {
                makeRequestFuncs.push(function sendReq(subNext) {
                    var req = chan.request({
                        hasNoParent: true
                    });
                    req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                        var tries = req.outReqs.length;
                        assert.true(tries >= 1 && tries <= 4, 'expected 1 to 4 tries');
                        assert.equal(chan.retryRatioTracker.retryRateCounter.rate, tries - 1, 'retry counts do not match');
                        assert.equal(chan.retryRatioTracker.requestRateCounter.rate, 1, 'try counts do not match');
                        mockTimers.advance(30 * 1000); // to reset counters
                        assert.equal(chan.retryRatioTracker.retryRateCounter.rate, 0, 'retry counter should be 0 after reset');
                        assert.equal(chan.retryRatioTracker.requestRateCounter.rate, 0, 'try counter should be 0 after reset');
                        subNext();
                    });
                });
            }
            series(makeRequestFuncs, next);
        }

        function finish() {
            cluster.assertEmptyState(assert);
            client.close();
            assert.end();
        }

        function resetRetryBudget(newMaxRetryRatio) {
            chan.maxRetryRatio = newMaxRetryRatio;
            mockTimers.advance(30 * 1000); // to cleanup counters;
        }
    }
});

allocCluster.test('request application retries', {
    numPeers: 2
}, function t(cluster, assert) {
    // chan 1 returns retryable application error
    cluster.channels[0]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', fooLolError);

    // chan 2 returns non-retryable application error
    cluster.channels[1]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', fooStopError);

    var client = TChannel({
        timeoutFuzz: 0,
        random: alwaysReturn0
    });
    var chan = client.makeSubChannel({
        serviceName: 'tristan',
        peers: cluster.hosts,
        requestDefaults: {
            serviceName: 'tristan',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        },
        // just to make sure maxRetryRatio isn't applied to app retry
        enableMaxRetryRatio: true,
        maxRetryRatio: 0
    });
    withConnectedClient(chan, cluster, onConnected);

    function onConnected() {
        var req = chan.request({
            timeout: 100,
            hasNoParent: true,
            shouldApplicationRetry: shouldApplicationRetry
        });
        req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
            onResponse(req, err, res, arg2, arg3);
        });
    }

    function onResponse(req, err, res, arg2, arg3) {
        if (err) return finish(err);

        assert.equal(req.outReqs.length, 2, 'expected 2 tries');

        assert.ok(
            req.outReqs[0].res &&
            !req.outReqs[0].res.ok,
            'expected first res notOk');
        assert.equal(
            req.outReqs[0].res &&
            String(req.outReqs[0].res.arg3),
            'lol',
            'expected first res arg3');

        assert.ok(req.outReqs[1].res, 'expected to have 2nd response');
        assert.ok(!res.ok, 'expected to have not been ok');
        assert.equal(String(arg3), 'stop', 'got expected response');

        finish();
    }

    function shouldApplicationRetry(req, res, retry, done) {
        if (res.streamed) {
            res.arg2.onValueReady(function arg2ready(err, arg2) {
                if (err) {
                    done(err);
                } else {
                    decideArg2(arg2);
                }
            });
        } else {
            decideArg2(res.arg2);
        }
        function decideArg2(arg2) {
            if (String(arg2) === 'meh') {
                retry();
            } else {
                done();
            }
        }
    }

    function finish(err) {
        assert.ifError(err, 'no final error');

        cluster.assertEmptyState(assert);

        client.close();
        assert.end();
    }
});

allocCluster.test('retryFlags work', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster.channels[0]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', handlerSeries([
            fooTimeout, // chan 1 timeout
            fooTimeout, // chan 1 timeout
            busyFoo,    // chan 1 busy
        ]));

    cluster.channels[1]
        .makeSubChannel({serviceName: 'tristan'})
        .register('foo', servedByFoo(2));

    var client = TChannel({
        timeoutFuzz: 0,
        random: alwaysReturn0
    });
    var chan = client.makeSubChannel({
        serviceName: 'tristan',
        peers: cluster.hosts,
        requestDefaults: {
            serviceName: 'tristan',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    series([

        function defaultToNotRetryingTimeout(next) {
            var req = chan.request({
                hasNoParent: true,
                timeout: 100
            });
            req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                assert.equal(req.outReqs.length, 1, 'expected 1 tries');
                assert.equal(err && err.type, 'tchannel.timeout', 'expected timeout error');
                next();
            });
        },

        function canRetryTimeout(next) {
            var req = chan.request({
                hasNoParent: true,
                retryFlags: {
                    never: false,
                    onConnectionError: true,
                    onTimeout: true
                }
            });
            req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                if (err) return finish(err);

                assert.equal(req.outReqs.length, 2, 'expected 2 tries');

                assert.equal(
                    req.outReqs[0].err &&
                    req.outReqs[0].err.type,
                    'tchannel.timeout',
                    'expected first timeout error');

                assert.ok(res.ok, 'expected to have notOk');
                assert.ok(req.outReqs[1].res, 'expected to have 2nd response');
                assert.equal(String(arg3), 'HI', 'got expected response');

                next();
            });
        },

        function canOptOutFully(next) {
            var req = chan.request({
                hasNoParent: true,
                timeout: 100,
                retryFlags: {
                    never: true,
                    onConnectionError: false,
                    onTimeout: false
                }
            });
            req.send('foo', '', 'hi', function done(err, res, arg2, arg3) {
                assert.equal(req.outReqs.length, 1, 'expected 1 tries');
                assert.equal(err && err.type, 'tchannel.busy', 'expected busy error');
                next();
            });
        }

    ], finish);

    function finish(err) {
        assert.ifError(err, 'no final error');

        cluster.assertEmptyState(assert);

        client.close();
        assert.end();
    }
});

function handlerSeries(handlers) {
    var i = 0;
    return seriesHandler;
    function seriesHandler(req, res, arg2, arg3) {
        var handler = handlers[i];
        i = (i + 1) % handlers.length;
        handler(req, res, arg2, arg3);
    }
}

function fooTimeout(req, res, arg2, arg3) {
    res.sendError('Timeout', 'no luck');
}

function declineFoo(req, res, arg2, arg3) {
    res.sendError('Declined', 'magic 8-ball says no');
}

function busyFoo(req, res, arg2, arg3) {
    res.sendError('Busy', "can't talk");
}

function unexpectedErrorFoo(req, res, arg2, arg3) {
    res.sendError('UnexpectedError', 'wat');
}

function servedByFoo(name) {
    return echoFoo;
    function echoFoo(req, res, arg2, arg3) {
        var str = String(arg3).toUpperCase();
        res.headers.as = 'raw';
        res.sendOk('served by ' + name, str);
    }
}

function fooLolError(req, res, arg2, arg3) {
    res.headers.as = 'raw';
    res.sendNotOk('meh', 'lol');
}

function fooStopError(req, res, arg2, arg3) {
    res.headers.as = 'raw';
    res.sendNotOk('no', 'stop');
}

// TODO: useful to pull back into alloc-cluster?
function withConnectedClient(chan, cluster, callback) {
    var ready = CountedReadySignal(cluster.channels.length);
    cluster.channels.forEach(function each(server, i) {
        var peer = chan.peers.add(server.hostPort);
        var conn = peer.connect(server.hostPort);
        conn.on('identified', ready.signal);
    });
    ready(callback);
}

function alwaysReturn0() {
    return 0;
}
