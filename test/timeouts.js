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

var TimeMock = require('time-mock');
var setTimeout = require('timers').setTimeout;

var allocCluster = require('./lib/alloc-cluster.js');
var timers = TimeMock(Date.now());

allocCluster.test('requests will timeout', {
    numPeers: 2,
    channelOptions: {
        timers: timers
    }
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var sub = one.makeSubChannel({
        serviceName: 'server'
    });

    sub.register('/normal-proxy', normalProxy);
    sub.register('/timeout', timeout);

    var twoSub = two.makeSubChannel({
        serviceName: 'server',
        peers: [one.hostPort]
    });

    twoSub
        .request({
            serviceName: 'server',
            hasNoParent: true,
            headers: {
                'as': 'raw',
                cn: 'wat'
            },
            timeout: 1000
        })
        .send('/normal-proxy', 'h', 'b', onResp);

    function onResp(err, res, arg2, arg3) {
        assert.ifError(err);

        assert.equal(String(arg2), 'h');
        assert.equal(String(arg3), 'b');

        twoSub
            .request({
                serviceName: 'server',
                hasNoParent: true,
                headers: {
                    'as': 'raw',
                    cn: 'wat'
                },
                timeout: 1000
            })
            .send('/timeout', 'h', 'b', onTimeout);

        var twoConn = two.peers.get(one.hostPort).connections[0];

        var adv = Math.max(1001, (
            twoConn.options.timeoutCheckInterval +
            (twoConn.options.timeoutFuzz / 2) + 1
        ));

        // timers module has weird semantics
        // TODO: less magic
        var newTime = timers.now() + adv;
        timers.now = function now() {
            return newTime;
        };

        timers.advance(adv);
    }

    function onTimeout(err) {
        assert.equal(err && err.type, 'tchannel.request.timeout', 'expected timeout error');
        // one.peers.get(two.hostPort).connections[0].onTimeoutCheck();
        cluster.assertEmptyState(assert);
        assert.end();
    }

    function normalProxy(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    }
    function timeout(/* head, body, hostInfo, cb */) {
        // do not call cb();
    }
});

allocCluster.test('requests will timeout even for slow conn', {
    numPeers: 3
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var three = cluster.channels[2];

    cluster.logger.whitelist(
        'info', 'error for timed out outgoing response'
    );
    cluster.logger.whitelist(
        'info', 'ignoring outresponse.send on a closed connection'
    );
    cluster.logger.whitelist(
        'info', 'OutResponse.send() after inreq timed out'
    );

    // server
    var sub = one.makeSubChannel({
        serviceName: 'server'
    });
    sub.register('/normal-proxy', normalProxy);
    sub.register('/slow-proxy', slowProxy);

    one.connectionEvent.on(function onConnectionEvent(conn) {
        var socket = conn.socket;

        socket.pause();
        setTimeout(function delaySocket() {
            socket.resume();
        }, 300);
    });

    // client
    var twoSub = two.makeSubChannel({
        serviceName: 'server',
        peers: [one.hostPort]
    });
    var start = 0;

    // make normal request
    twoSub
        .request({
            serviceName: 'server',
            hasNoParent: true,
            headers: {
                'as': 'raw',
                cn: 'wat'
            },
            timeout: 500
        })
        .send('/normal-proxy', 'h', 'b', onResp);

    function onResp(err, res, arg2, arg3) {
        assert.ifError(err);

        assert.equal(String(arg2), 'h');
        assert.equal(String(arg3), 'b');

        doSecond();
    }

    function doSecond() {
        // another client
        var threeSub = three.makeSubChannel({
            serviceName: 'server',
            peers: [one.hostPort]
        });

        // slow request
        start = Date.now();
        threeSub
            .request({
                serviceName: 'server',
                hasNoParent: true,
                headers: {
                    'as': 'raw',
                    cn: 'wat'
                },
                timeout: 500
            })
            .send('/slow-proxy', 'h', 'b', onTimeout);
    }

    function onTimeout(err) {
        assert.ok(
            (err && err.type) === 'tchannel.request.timeout' ||
            (err && err.type) === 'tchannel.timeout',
            'expected timeout error'
        );

        var delta = Date.now() - start;

        if (typeof err.elapsed === 'number') {
            assert.ok(err.elapsed < 600, 'expected timeout within 600ms');
        }
        assert.ok(delta < 600, 'expected timeout within 600ms');

        if (delta > 600) {
            console.log('d', delta);
        }

        setTimeout(function delay() {
            cluster.assertEmptyState(assert);
            assert.end();
        }, 500);
    }

    function normalProxy(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    }
    function slowProxy(req, res, arg2, arg3) {
        setTimeout(function respond() {
            res.headers.as = 'raw';
            res.sendOk(arg2, arg3);
        }, 650);
    }
});

allocCluster.test('requests will timeout per attempt', {
    numPeers: 2,
    channelOptions: {
        timers: timers
    }
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var sub = one.makeSubChannel({
        serviceName: 'server'
    });

    sub.register('/normal-proxy', normalProxy);
    sub.register('/timeout', timeout);

    var twoSub = two.makeSubChannel({
        serviceName: 'server',
        peers: [one.hostPort]
    });

    twoSub
        .request({
            serviceName: 'server',
            hasNoParent: true,
            headers: {
                'as': 'raw',
                cn: 'wat'
            },
            timeout: 1000
        })
        .send('/normal-proxy', 'h', 'b', onResp);

    function onResp(err, res, arg2, arg3) {
        assert.ifError(err);

        assert.equal(String(arg2), 'h');
        assert.equal(String(arg3), 'b');

        twoSub
            .request({
                serviceName: 'server',
                hasNoParent: true,
                headers: {
                    'as': 'raw',
                    cn: 'wat'
                },
                timeout: 3000,
                timeoutPerAttempt: 1000
            })
            .send('/timeout', 'h', 'b', onTimeout);

        var twoConn = two.peers.get(one.hostPort).connections[0];

        var adv = Math.max(1001, (
            twoConn.options.timeoutCheckInterval +
            (twoConn.options.timeoutFuzz / 2) + 1
        ));

        // timers module has weird semantics
        // TODO: less magic
        var newTime = timers.now() + adv;
        timers.now = function now() {
            return newTime;
        };

        timers.advance(adv);
    }

    function onTimeout(err) {
        assert.equal(err && err.type, 'tchannel.request.timeout', 'expected timeout error');
        assert.ok(err && err.logical, 'the timeout should be from logical request');
        cluster.assertEmptyState(assert);
        assert.end();
    }

    function normalProxy(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    }
    function timeout(/* head, body, hostInfo, cb */) {
        // do not call cb();
    }
});

allocCluster.test('requests can succeed after timeout per attempt', {
    numPeers: 3,
    channelOptions: {
        timers: timers
    }
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var three = cluster.channels[2];
    var sub = one.makeSubChannel({
        serviceName: 'server'
    });
    var sub3 = three.makeSubChannel({
        serviceName: 'server'
    });

    sub.register('/normal-proxy', normalProxy);
    sub.register('/timeout', timeout);
    sub3.register('/normal-proxy', normalProxy);
    sub3.register('/timeout', timeout);

    var twoSub = two.makeSubChannel({
        serviceName: 'server',
        peers: [
            one.hostPort,
            three.hostPort
        ]
    });

    twoSub
        .request({
            serviceName: 'server',
            hasNoParent: true,
            headers: {
                'as': 'raw',
                cn: 'wat'
            },
            timeout: 1000
        })
        .send('/normal-proxy', 'h', 'b', onResp);

    var req;
    function onResp(err, res, arg2, arg3) {
        assert.ifError(err);

        assert.equal(String(arg2), 'h');
        assert.equal(String(arg3), 'b');

        req = twoSub
            .request({
                serviceName: 'server',
                hasNoParent: true,
                headers: {
                    'as': 'raw',
                    cn: 'wat'
                },
                timeout: 3000,
                timeoutPerAttempt: 1000,
                retryLimit: 1
            });
        req.send('/timeout', 'h', 'b', done);
    }

    function done(err, res, arg2, arg3) {
        assert.ifError(err);

        assert.equal(String(arg2), 'h');
        assert.equal(String(arg3), 'b');
        assert.equal(req.outReqs[0].err && req.outReqs[0].err.type, 'tchannel.request.timeout', 'expected timeout error');
        assert.ok(req.outReqs[0].err && req.outReqs[0].err.logical, 'the timeout should be from logical request');

        cluster.assertEmptyState(assert);
        assert.end();
    }

    function normalProxy(req2, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    }
    var count = 0;
    function timeout(req2, res, arg2, arg3) {
        count++;
        if (count === 2) {
            res.headers.as = 'raw';
            res.sendOk(arg2, arg3);
        } else {
            var adv = 1001;
            var newTime = timers.now() + adv;
            timers.now = function now() {
                return newTime;
            };

            timers.advance(adv);
        }
    }
});
