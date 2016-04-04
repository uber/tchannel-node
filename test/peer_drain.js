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

var Ready = require('ready-signal');
var collectParallel = require('collect-parallel/array');

var allocCluster = require('./lib/alloc-cluster.js');

allocCluster.test('immediate peer.drain', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    setupTestClients(cluster, ['a'], runTest);
    setupServiceServer(server, 'a', 5);

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }

        var peer = server.peers.get(clients.a[0].hostPort);
        assert.timeoutAfter(50);
        peer.drain({
            reason: 'testdown'
        }, drained);
    }

    function drained() {
        assert.pass('immediate drain happened');
        waitForConnRemoved(2, cluster, finish);
        server.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }
        assert.pass('server closed');
    }

    function finish(err) {
        checkFinish(assert, err, cluster, 1);
    }
});

allocCluster.test('peer.drain server with a few incoming', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'draining peer');

    var server = cluster.channels[0];
    var client = null;
    var peer = null;

    var running = false;
    var outstanding = 2;

    setupTestClients(cluster, ['a'], runTest);
    setupServiceServer(server, 'a', 50);

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        client = clients.a[0];
        peer = server.peers.get(client.hostPort);

        assert.timeoutAfter(150);
        assert.comment('sending request 0');

        running = true;
        client.request().send('echo', 'such', 'mess0', onFirstReq);

        setTimeout(testdown, 3);
    }

    function testdown() {
        assert.comment('sending request 1');
        client.request().send('echo', 'such', 'mess1', onSecondReq);

        assert.comment('triggering drain');
        assert.equal(running, true, 'requests have not finished');

        peer.drain({
            reason: 'testdown'
        }, drained);
    }

    function onFirstReq(err, res) {
        assert.ifError(err);

        running = false;

        assert.equal(
            res && String(res.arg3), 'mess0',
            'res: expected arg3');

        outstanding--;
    }

    function onSecondReq(err, res) {
        console.log('declined!!!', err);

        running = false;

        assert.equal(
            err && err.type,
            'tchannel.declined',
            'err: expected declined');
        assert.equal(res && res.value, null, 'res: no value');

        outstanding--;
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);

        setTimeout(delayServerClose);
    }

    function delayServerClose() {
        server.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }

        assert.pass('server closed');
    }

    function finish(err) {
        assert.ifError(err);

        cluster.assertCleanState(assert, {
            channels: [
                // server has no peers
                {peers: []},
                // all client connections closed
                {peers: [{connections: []}]},
                {peers: [{connections: []}]},
                {peers: [{connections: []}]}
            ]
        });

        assert.equal(outstanding, 0, 'all requests finished');
        assert.end();
    }
});

allocCluster.test('peer.drain server with a few incoming (with exempt service)', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {

    cluster.logger.whitelist('info', 'draining peer');
    cluster.logger.whitelist('info', 'ignoring outresponse.send on a closed connection');

    var server = cluster.channels[0];
    var clientA = null;
    var clientB = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a', 'b'], runTest);
    setupServiceServer(server, 'a', 5);
    setupServiceServer(server, 'b', 5);
    server.drainExempt = drainExemptB;

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        clientA = clients.a[0];
        clientB = clients.b[0];
        peer = server.peers.get(clientA.hostPort);

        assert.timeoutAfter(50);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkASend);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBSend);

        setTimeout(testdown, 1);

        function checkASend(err, res) {
            assert.ifError(err, 'service:a no error');
            assert.equal(res && String(res.arg3), 'mess1',
                         'service:a expected arg3');
            finish();
        }

        function checkBSend(err, res) {
            if (err) {
                assert.ok(err.type === 'tchannel.connection.reset' ||
                    err.type === 'tchannel.request.timeout',
                    'service:b expected connection reset or request timeout error');
            } else {
                assert.equal(String(res.arg3), 'mess1',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');

        finishCount++;
        peer.drain({
            reason: 'testdown'
        }, drained);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkADecline);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBRes);

        function checkADecline(err, res) {
            assert.equal(err && err.type, 'tchannel.declined',
                         'service:a expected declined');
            assert.equal(res, null,
                         'service:a no value');
            finish();
        }

        function checkBRes(err, res) {
            if (err) {
                assert.ok(err.type === 'tchannel.connection.reset' ||
                    err.type === 'tchannel.request.timeout',
                    'service:b expected connection reset error');
            } else {
                assert.equal(String(res.arg3), 'mess10',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function drainExemptB(req) {
        return req.serviceName === 'b';
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        server.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }
        assert.pass('server closed');

        var logs = cluster.logger.items().map(function eachLog(log) {
            return {
                level: log.levelName,
                msg: log.msg
            };
        });

        assert.ok(logs.length > 0, 'expected some logs');
        assert.deepEqual(logs[0], {
            level: 'info',
            msg: 'draining peer'
        }, 'expected draining log');

        for (var i = 1; i < logs.length; i++) {
            assert.deepEqual(logs[i], {
                level: 'info',
                msg: 'ignoring outresponse.send on a closed connection'
            }, 'expected zero or more sends after close');
        }
    }

    function finish(err) {
        finishCount = checkFinish(assert, err, cluster, finishCount);
    }
});

allocCluster.test('peer.drain client with a few outgoing', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    var drainClient = cluster.channels[1];
    var client = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a'], runTest);
    setupServiceServer(server, 'a', 5);

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        client = clients.a[0];
        peer = client.peers.get(server.hostPort);

        finishCount = 2;
        assert.timeoutAfter(50);
        reqN++;
        assert.comment('sending request ' + reqN);
        client.request().send('echo', 'such', 'mess' + reqN, sendDone);

        setTimeout(testdown, 1);
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');
        peer.drain({
            reason: 'testdown'
        }, drained);
        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        client.request().send('echo', 'such', 'mess' + reqN, afterDrainSendDone);
    }

    function sendDone(err, res) {
        assert.ifError(err, 'res: no error');
        assert.equal(
            res && String(res.arg3), 'mess1',
            'res: expected arg3');
        finish();
    }

    function afterDrainSendDone(err, res) {
        assert.equal(
            err && err.type,
            'tchannel.request.drained',
            'err: expected request drained');
        assert.equal(res, null, 'no res');
        finish();
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        drainClient.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }

        assert.pass('client closed');
    }

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount === 0) {
            // cluster.assertEmptyState(assert);
            // return;

            cluster.assertCleanState(assert, {
                channels: [
                    // server has no peers
                    {peers: [
                        {connections: []}
                    ]},
                    // all client connections closed
                    {peers: []}
                ]
            });

            assert.end();
        }
    }
});

allocCluster.test('peer.drain client with a few outgoing (with exempt service)', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    var drainClient = cluster.channels[1];
    var clientA = null;
    var clientB = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a', 'b'], runTest);
    drainClient.drainExempt = drainExemptB;
    setupServiceServer(server, 'a', 5);
    setupServiceServer(server, 'b', 5);
    server.drainExempt = drainExemptB;

    cluster.logger.whitelist('info', 'resetting connection');
    // cluster.logger.whitelist('info', 'ignoring outresponse.send on a closed connection');

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        clientA = clients.a[0];
        clientB = clients.b[0];
        peer = clientA.peers.get(server.hostPort);

        assert.timeoutAfter(50);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkASend);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBSend);

        setTimeout(testdown, 1);

        function checkASend(err, res) {
            assert.ifError(err, 'service:a no error');
            assert.equal(res && String(res.arg3), 'mess1',
                         'service:a expected arg3');
            finish();
        }

        function checkBSend(err, res) {
            if (err) {
                assert.ok(err.type === 'tchannel.local.reset' ||
                    err.type === 'request.timeout',
                    'service:b expected local reset or request timeout error');
            } else {
                assert.equal(String(res.arg3), 'mess4',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');

        finishCount++;
        peer.drain({
            reason: 'testdown'
        }, drained);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkADecline );

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBRes);

        function checkADecline(err, res) {
            assert.equal(err && err.type, 'tchannel.request.drained',
                         'service:a expected request drained');
            assert.equal(res, null,
                         'service:a no value');
            finish();
        }

        function checkBRes(err, res) {
            if (err) {
                assert.equal(err.type, 'tchannel.local.reset',
                             'service:b expected local reset error');
            } else {
                assert.equal(String(res.arg3), 'mess10',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function drainExemptB(req) {
        return req.serviceName === 'b';
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        drainClient.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }

        assert.pass('client closed');
    }

    function checkLogs() {
        var logs = cluster.logger.items().map(function eachLog(log) {
            return {
                level: log.levelName,
                msg: log.msg
            };
        });

        // TODO: why not always get log
        if (logs.length > 0) {
            assert.deepEqual(logs[0], {
                level: 'info',
                msg: 'resetting connection'
            }, 'expected resetting connection log');
        }
    }

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount === 0) {
            // cluster.assertEmptyState(assert);
            // return;

            checkLogs();

            cluster.assertCleanState(assert, {
                channels: [
                    // server has no peers
                    {peers: [
                        {connections: []}
                    ]},
                    // all client connections closed
                    {peers: []}
                ]
            });

            assert.end();
        }
    }
});

allocCluster.test('peer.drain direction=in server', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'draining peer');

    var connsClosed = Ready();
    var finishCount = 0;
    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'a'
    });
    server.register('hello', hello);

    function hello(req, res, arg2, arg3) {
        if (req.connection.direction === 'out') {
            res.headers.as = 'raw';
            res.send('', 'noop');
            return;
        }

        var peer = server.peers.add(req.remoteAddr);
        peer.waitForIdentified(peer.connect(true), outConnIded);

        function outConnIded(err) {
            if (err) {
                finish(err);
                return;
            }

            finishCount++;
            peer.drain({
                direction: 'in',
                reason: 'switcheroo'
            }, drained);

            res.headers.as = 'raw';
            res.send('', 'switched');
        }

        function drained(err) {
            if (err) {
                finish(err);
                return;
            }
            waitForConnRemoved(2, cluster, connsClosed.signal);
            peer.closeDrainedConnections(finish);
            peer.clearDrain();
        }
    }

    var client = setupServiceClient(cluster.channels[1], 'a');
    client.peers.add(server.hostPort);

    assert.timeoutAfter(50);

    finishCount++;
    assert.comment('sending hello');
    client.request().send('hello', '', '', function sendDone(err, res) {
        assert.ifError(err, 'expected no error');
        assert.equal(res && String(res.arg3), 'switched', 'expected switcheroo');

        finishCount++;
        connsClosed(function thenSendAgain() {
            assert.comment('sending 2nd hello');
            client.request().send('hello', '', '', function sendDone(err, res) {
                assert.ifError(err, 'expected no error');
                assert.equal(res && String(res.arg3), 'noop', 'expected noop');
                finish();
            });
        });

        finish();
    });

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount > 0) {
            return;
        }

        if (finishCount < 0) {
            throw new Error('broken');
        }

        cluster.assertCleanState(assert, {
            channels: [
                // server has a peer with a single idle out conn
                {peers: [
                    {connections: [
                        {
                            remoteName: client.hostPort,
                            direction: 'out',
                            inReqs: 0,
                            outReqs: 0,
                            streamingReq: 0,
                            streamingRes: 0
                        }
                    ]}
                ]},
                // client has a peer with a single idle in conn
                {peers: [
                    {connections: [
                        {
                            remoteName: server.hostPort,
                            direction: 'in',
                            inReqs: 0,
                            outReqs: 0,
                            streamingReq: 0,
                            streamingRes: 0
                        }
                    ]}
                ]}
            ]
        });

        assert.end();
    }
});

allocCluster.test('peer.drain direction=out client', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'draining peer');

    var finishCount = 0;
    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'a'
    });
    server.register('hello', hello);

    function hello(req, res, arg2, arg3) {
        if (req.connection.direction === 'out') {
            res.headers.as = 'raw';
            res.send('', 'noop');
            return;
        }

        var peer = server.peers.add(req.remoteAddr);
        peer.waitForIdentified(peer.connect(true), outConnIded);

        function outConnIded(err) {
            if (err) {
                finish(err);
                return;
            }

            res.headers.as = 'raw';
            res.send('', 'switched');
        }
    }

    var client = setupServiceClient(cluster.channels[1], 'a');
    var peer = client.peers.add(server.hostPort);

    assert.timeoutAfter(50);

    finishCount++;
    assert.comment('sending hello');
    client.request().send('hello', '', '', function sendDone(err, res) {
        assert.ifError(err, 'expected no error');
        assert.equal(res && String(res.arg3), 'switched', 'expected switcheroo');

        finishCount++;
        peer.drain({
            direction: 'out',
            reason: 'switcheroo'
        }, drained);

        function drained(err) {
            if (err) {
                finish(err);
                return;
            }
            finishCount++;
            waitForConnRemoved(2, cluster, thenSendAgain);
            peer.closeDrainedConnections(finish);
        }

        function thenSendAgain() {
            assert.comment('sending 2nd hello');
            client.request().send('hello', '', '', function sendDone(err, res) {
                assert.ifError(err, 'expected no error');
                assert.equal(res && String(res.arg3), 'noop', 'expected noop');
                finish();
            });
        }

        finish();
    });

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount > 0) {
            return;
        }

        if (finishCount < 0) {
            throw new Error('broken');
        }

        cluster.assertCleanState(assert, {
            channels: [
                // server has a peer with a single idle out conn
                {peers: [
                    {connections: [
                        {
                            remoteName: client.hostPort,
                            direction: 'out',
                            inReqs: 0,
                            outReqs: 0,
                            streamingReq: 0,
                            streamingRes: 0
                        }
                    ]}
                ]},
                // client has a peer with a single idle in conn
                {peers: [
                    {connections: [
                        {
                            remoteName: server.hostPort,
                            direction: 'in',
                            inReqs: 0,
                            outReqs: 0,
                            streamingReq: 0,
                            streamingRes: 0
                        }
                    ]}
                ]}
            ]
        });

        assert.end();
    }
});

allocCluster.test('peer.drain direction=in server with a timeout', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'draining peer');

    var connsClosed = Ready();
    var finishCount = 0;
    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'a'
    });
    server.register('hello', hello);
    server.register('limbo', limbo);

    function hello(req, res, arg2, arg3) {
        if (req.connection.direction === 'out') {
            res.headers.as = 'raw';
            res.send('', 'noop');
            return;
        }

        var peer = server.peers.add(req.remoteAddr);
        peer.waitForIdentified(peer.connect(true), outConnIded);

        function outConnIded(err) {
            if (err) {
                finish(err);
                return;
            }

            finishCount++;
            peer.drain({
                direction: 'in',
                timeout: 25,
                reason: 'switcheroo'
            }, drained);

            res.headers.as = 'raw';
            res.send('', 'switched');
        }

        function drained(err) {
            assert.equal(err && err.type, 'tchannel.drain.peer.timed-out',
                         'expected drain to timeout');
            waitForConnRemoved(2, cluster, connsClosed.signal);
            peer.closeDrainedConnections(finish);
            peer.clearDrain();
        }
    }

    function limbo() {
    }

    var client = setupServiceClient(cluster.channels[1], 'a');
    client.peers.add(server.hostPort);

    assert.timeoutAfter(100);

    finishCount++;
    assert.comment('sending limbo');
    client.request({
        timeout: 500
    }).send('limbo', '', '', function sendDone(err, res) {
        assert.equal(err && err.type, 'tchannel.connection.reset',
                     'expected tchannel.connection.reset error');
        assert.ok(!res, 'no res value');
        finish();
    });

    finishCount++;
    assert.comment('sending hello');
    client.request().send('hello', '', '', function sendDone(err, res) {
        assert.ifError(err, 'expected no error');
        assert.equal(res && String(res.arg3), 'switched', 'expected switcheroo');

        finishCount++;
        connsClosed(function thenSendAgain() {
            assert.comment('sending 2nd hello');
            client.request().send('hello', '', '', function sendDone(err, res) {
                assert.ifError(err, 'expected no error');
                assert.equal(res && String(res.arg3), 'noop', 'expected noop');
                finish();
            });
        });

        finish();
    });

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount > 0) {
            return;
        }

        if (finishCount < 0) {
            throw new Error('broken');
        }

        cluster.assertCleanState(assert, {
            channels: [
                // server has a peer with a single idle out conn
                {peers: [
                    {connections: [
                        {
                            remoteName: client.hostPort,
                            direction: 'out',
                            inReqs: 0,
                            outReqs: 0,
                            streamingReq: 0,
                            streamingRes: 0
                        }
                    ]}
                ]},
                // client has a peer with a single idle in conn
                {peers: [
                    {connections: [
                        {
                            remoteName: server.hostPort,
                            direction: 'in',
                            inReqs: 0,
                            outReqs: 0,
                            streamingReq: 0,
                            streamingRes: 0
                        }
                    ]}
                ]}
            ]
        });

        assert.end();
    }
});

function setupTestClients(cluster, services, callback) {
    var clients = {};
    var serverRoot = cluster.channels[0];

    for (var i = 0; i < services.length; i++) {
        var service = services[i];
        var clis = clients[service] = [];
        for (var j = 1; j < cluster.channels.length; j++) {
            var client = setupServiceClient(cluster.channels[j], service);
            clis.push(client);
            client.peers.add(serverRoot.hostPort);
        }
    }

    collectParallel(cluster.channels.slice(1), idEach, ided);

    function idEach(chan, i, done) {
        var peer = chan.peers.add(serverRoot.hostPort);
        peer.waitForIdentified(done);
    }

    function ided(err, res) {
        for (var i = 0; i < res.length; i++) {
            if (res[i].err) {
                callback(res[i].err, clients);
                return;
            }
        }
        callback(null, clients);
    }
}

function setupServiceServer(rootchan, service, delay) {
    var chan = rootchan.makeSubChannel({
        serviceName: service
    });
    chan.register('echo', echo);

    return chan;

    function echo(req, res, arg2, arg3) {
        req.channel.timers.setTimeout(respond, delay);

        function respond() {
            res.headers.as = 'raw';
            res.send(arg2, arg3);
        }
    }
}

function setupServiceClient(rootchan, service) {
    return rootchan.makeSubChannel({
        serviceName: service,
        requestDefaults: {
            timeout: 100,
            hasNoParent: true,
            retryflags: {
                never: true
            },
            serviceName: service,
            headers: {
                as: 'raw',
                cn: service + 'Client'
            }
        }
    });
}

function checkFinish(assert, err, cluster, finishCount) {
    assert.ifError(err, 'no unexpected error');

    if (--finishCount === 0) {
        cluster.assertCleanState(assert, {
            channels: [
                // server has no peers
                {peers: []},
                // all client connections closed
                {peers: [{connections: []}]},
                {peers: [{connections: []}]},
                {peers: [{connections: []}]}
            ]
        });

        assert.end();
    }

    return finishCount;
}

function waitForConnRemoved(count, cluster, callback) {
    cluster.channels.forEach(function eachChannel(chan) {
        var peers = chan.peers.values();
        peers.forEach(function eachPeer(peer) {
            peer.on('removeConnection', removed);
        });
    });

    var called = false;
    function removed() {
        if (called) {
            return;
        }
        if (--count <= 0) {
            called = true;
            callback(null);
        }
    }
}
