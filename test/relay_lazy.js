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

var allocCluster = require('./lib/alloc-cluster');
var TChannel = require('../channel');
var RelayHandler = require('../relay_handler');

allocCluster.test('send lazy relay requests', {
    numPeers: 2
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];

    one.setLazyHandling(true);
    one.setLazyRelaying(true);
    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: [two.hostPort]
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);
    oneToTwo.handler.handleRequest = failWrap(
         oneToTwo.handler.handleRequest,
         assert, 'handle requests eagerly');

    var twoSvc = two.makeSubChannel({
        serviceName: 'two'
    });
    twoSvc.register('echo', echo);

    var client = TChannel({
        logger: one.logger,
        timeoutFuzz: 0
    });
    var twoClient = client.makeSubChannel({
        serviceName: 'two',
        peers: [one.hostPort],
        requestDefaults: {
            serviceName: 'two',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    twoClient.request({
        hasNoParent: true
    }).send('echo', 'foo', 'bar', function done(err, res, arg2, arg3) {
        assert.ifError(err, 'no unexpected error');
        assert.equal(String(arg2), 'foo', 'expected arg2');
        assert.equal(String(arg3), 'bar', 'expected arg3');

        client.close();
        assert.end();
    });
});

allocCluster.test('send lazy relay with tiny timeout', {
    numPeers: 2
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];

    one.setLazyHandling(true);
    one.setLazyRelaying(true);
    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: [two.hostPort]
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);
    oneToTwo.handler.handleRequest = failWrap(
         oneToTwo.handler.handleRequest,
         assert, 'handle requests eagerly');

    var twoSvc = two.makeSubChannel({
        serviceName: 'two'
    });
    twoSvc.register('echo', echo);

    var client = TChannel({
        logger: one.logger,
        timeoutFuzz: 0
    });
    var twoClient = client.makeSubChannel({
        serviceName: 'two',
        peers: [one.hostPort],
        requestDefaults: {
            serviceName: 'two',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    twoClient.waitForIdentified({
        host: one.hostPort
    }, onIdentified);

    function onIdentified(err1) {
        assert.ifError(err1);

        twoClient.request({
            hasNoParent: true,
            host: one.hostPort,
            timeout: 15
        }).send('echo', 'foo', 'bar', function done(err2, res, arg2, arg3) {
            assert.ifError(err2, 'no unexpected error');
            assert.equal(String(arg2), 'foo', 'expected arg2');
            assert.equal(String(arg3), 'bar', 'expected arg3');

            client.close();
            assert.end();
        });
    }
});

allocCluster.test('lazy relay respects ttl', {
    numPeers: 3
}, function t(cluster, assert) {
    var relay = cluster.channels[0];
    var source = cluster.channels[1];
    var dest = cluster.channels[2];

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);
    var relayChan = relay.makeSubChannel({
        serviceName: 'dest',
        peers: [dest.hostPort]
    });
    relayChan.handler = new RelayHandler(relayChan);
    relayChan.handler.handleRequest = failWrap(
         relayChan.handler.handleRequest,
         assert, 'handle requests eagerly');

    var destChan = dest.makeSubChannel({
        serviceName: 'dest'
    });
    destChan.register('echoTTL', echoTTL);

    var sourceChan = source.makeSubChannel({
        serviceName: 'dest',
        peers: [relay.hostPort],
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    sourceChan.request({
        serviceName: 'dest',
        hasNoParent: true,
        timeout: 250
    }).send('echoTTL', null, null, onResponse);

    function onResponse(err, res, arg2, arg3) {
        assert.ifError(err);
        assert.ok(res.ok);

        var ttl = Number(String(arg3));
        assert.ok(ttl >= 200 && ttl <= 250);

        assert.end();
    }
});

allocCluster.test('lazy relay an error frame', {
    numPeers: 4
}, function t(cluster, assert) {
    cluster.logger.whitelist('warn', 'forwarding error frame');

    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var three = cluster.channels[2];
    var four = cluster.channels[3];

    one.setLazyHandling(true);
    one.setLazyRelaying(true);
    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: [two.hostPort, three.hostPort]
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);
    oneToTwo.handler.handleRequest = failWrap(
         oneToTwo.handler.handleRequest,
         assert, 'handle requests eagerly');

    four.setLazyHandling(true);
    four.setLazyRelaying(true);
    var fourToTwo = four.makeSubChannel({
        serviceName: 'two',
        peers: [two.hostPort, three.hostPort]
    });
    fourToTwo.handler = new RelayHandler(fourToTwo);
    fourToTwo.handler.handleRequest = failWrap(
         fourToTwo.handler.handleRequest,
         assert, 'handle requests eagerly');

    var twoSvc2 = three.makeSubChannel({
        serviceName: 'two'
    });
    twoSvc2.register('decline', declineError);

    var twoSvc = two.makeSubChannel({
        serviceName: 'two'
    });
    twoSvc.register('decline', declineError);

    var client = TChannel({
        logger: one.logger,
        timeoutFuzz: 0
    });
    var twoClient = client.makeSubChannel({
        serviceName: 'two',
        peers: [one.hostPort, four.hostPort],
        requestDefaults: {
            serviceName: 'two',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    twoClient.request({
        hasNoParent: true,
        headers: {
            as: 'raw',
            cn: 'wat'
        }
    }).send('decline', 'foo', 'bar', function done(err, res, arg2, arg3) {
        assert.equal(err.type, 'tchannel.declined', 'expected declined error');

        assert.ok(cluster.logger.items().length >= 1, 'expected some logs');
        client.close();

        setTimeout(finish, 1);
    });

    function finish() {
        assert.end();
    }
});

allocCluster.test('lazy relay request times out', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');

    var relay = cluster.channels[0];
    var source = cluster.channels[1];
    var dest = cluster.channels[2];

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);
    var relayChan = relay.makeSubChannel({
        serviceName: 'dest',
        peers: [dest.hostPort]
    });
    relayChan.handler = new RelayHandler(relayChan);
    relayChan.handler.handleRequest = failWrap(
         relayChan.handler.handleRequest,
         assert, 'handle requests eagerly');

    var destChan = dest.makeSubChannel({
        serviceName: 'dest'
    });
    destChan.register('limbo', limbo);

    var sourceChan = source.makeSubChannel({
        serviceName: 'dest',
        peers: [relay.hostPort],
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    var relayOutPeer = relayChan.peers.get(dest.hostPort);
    relayOutPeer.waitForIdentified = function punchWaitForIdentified() {
        return -1;
    };

    sourceChan.request({
        serviceName: 'dest',
        hasNoParent: true,
        timeout: 100
    }).send('limbo', null, null, onResponse);

    function onResponse(err, res, arg2, arg3) {
        assert.ok(err && (
                  err.type === 'tchannel.timeout' ||
                  err.type === 'tchannel.request.timeout'),
                  'expected timeout error');
        assert.notOk(res, 'expected no response');

        setTimeout(finish, 100);
    }

    function finish() {
        var logs = cluster.logger.items();
        assert.equal(logs.length, 1);

        var relayLine = logs[0];
        assert.equal(relayLine.msg, 'expected error while forwarding');
        assert.equal(relayLine.levelName, 'info');
        assert.equal(relayLine.meta.error.type, 'tchannel.request.timeout');

        assert.equal(relayLine.meta.hostPort, relay.hostPort, 'hostPort is relay');
        assert.equal(relayLine.meta.remoteName, source.hostPort);

        assert.end();
    }
});

allocCluster.test('relay request declines on no peer', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'no relay peer available');

    var relay = cluster.channels[0];
    var source = cluster.channels[1];

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);
    var relayChan = relay.makeSubChannel({
        serviceName: 'dest',
        peers: []
    });
    relayChan.handler = new RelayHandler(relayChan);
    relayChan.handler.handleRequest = failWrap(
         relayChan.handler.handleRequest,
         assert, 'handle requests eagerly');

    var sourceChan = source.makeSubChannel({
        serviceName: 'dest',
        peers: [relay.hostPort],
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    sourceChan.request({
        serviceName: 'dest',
        hasNoParent: true,
        timeout: 100
    }).send('echo', null, null, onResponse);

    function onResponse(err, res, arg2, arg3) {
        assert.equal(err && err.type,
                     'tchannel.declined',
                     'expected declined error');
        assert.notOk(res, 'expected no response');

        var logs = cluster.logger.items();
        assert.equal(logs.length, 1);

        var relayLine = logs[0];
        assert.equal(relayLine.msg, 'no relay peer available');
        assert.equal(relayLine.levelName, 'info');

        assert.equal(relayLine.meta.hostPort, relay.hostPort);
        assert.equal(relayLine.meta.remoteName, source.hostPort);

        assert.end();
    }
});

allocCluster.test('relay request handles channel close correctly', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('warn', 'error while forwarding');

    var relay = cluster.channels[0];
    var source = cluster.channels[1];
    var dest = cluster.channels[2];

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);
    var relayChan = relay.makeSubChannel({
        serviceName: 'dest',
        peers: [dest.hostPort]
    });
    relayChan.handler = new RelayHandler(relayChan);
    relayChan.handler.handleRequest = failWrap(
         relayChan.handler.handleRequest,
         assert, 'handle requests eagerly');

    var destChan = dest.makeSubChannel({
        serviceName: 'dest'
    });
    destChan.register('killRelay', killRelay);

    var sourceChan = source.makeSubChannel({
        serviceName: 'dest',
        peers: [relay.hostPort],
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    sourceChan.request({
        serviceName: 'dest',
        hasNoParent: true,
        timeout: 100
    }).send('killRelay', null, null, onResponse);

    function killRelay() {
        relay.close();
    }

    function onResponse(err, res, arg2, arg3) {
        assert.equal(err && err.type,
                     'tchannel.connection.reset',
                     'expected connection error');
        assert.notOk(res, 'expected no response');
        process.nextTick(finish);
    }

    function finish() {
        dest.close();

        var items = cluster.logger.items();
        assert.equal(items.length, 1);

        var relayLine = items[0];
        assert.equal(relayLine.msg, 'error while forwarding');
        assert.equal(relayLine.levelName, 'warn');

        assert.equal(relayLine.meta.error.type, 'tchannel.local.reset');
        assert.equal(relayLine.meta.hostPort, relay.hostPort);
        assert.equal(relayLine.meta.remoteName, source.hostPort);

        assert.end();
    }
});

function declineError(req, res, arg2, arg3) {
    res.sendError('Declined', 'lul');
}

function echo(req, res, arg2, arg3) {
    res.headers.as = 'raw';
    res.sendOk(arg2, arg3);
}

function echoTTL(req, res) {
    res.headers.as = 'raw';
    res.sendOk(null, String(req.timeout));
}

function limbo() {
}

function failWrap(method, assert, desc) {
    return function failWrapper() {
        assert.fail('should not ' + desc);
        method.apply(this, arguments);
    };
}
