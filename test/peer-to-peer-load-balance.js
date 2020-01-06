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

var collectParallel = require('collect-parallel/array');
var setTimeout = require('timers').setTimeout;
var metrics = require('metrics');

var allocCluster = require('./lib/alloc-cluster.js');
var BatchClient = require('./lib/batch-client.js');
var CollapsedAssert = require('./lib/collapsed-assert.js');

// skip flappy test
false && allocCluster.test('p2p requests from 40 -> 40', {
    numPeers: 40
}, function t(cluster, assert) {
    setup(cluster);

    collectParallel(cluster.batches, function runRequests(batch, _, cb) {
        batch.sendRequests(cb);
    }, onBatches);

    /*eslint max-statements: [2, 40]*/
    function onBatches(err, results) {
        var cassert = CollapsedAssert();
        cassert.ifError(err);

        var statuses = [];
        for (var i = 0; i < results.length; i++) {
            cassert.ifError(results[i].err, 'expect no batch error');
            cassert.ifError(results[i].value.errors.length > 0,
                'expect zero errors in batch');
            statuses.push(results[i].value);
        }
        cassert.report(assert, 'expected no errors');

        var statusTable = findServerHostDistribution(statuses);

        var uniqHosts = Object.keys(statusTable);
        if (uniqHosts.length < 35) {
            checkConnections();
            checkDistributions(statusTable);
        } else {
            assert.ok(true, 'SKIP: suprisingly large number of peers reached');
        }

        assert.end();
    }

    function checkConnections() {
        var cassert = CollapsedAssert();
        var distribution = new metrics.Histogram();
        for (var i = 0; i < cluster.batches.length; i++) {
            var connCount = countConnections(cluster.batches[i]);
            distribution.update(connCount);

            cassert.ok(
                connCount >= 1 &&
                connCount <= 5,
                'expected a small number of connections'
            );
        }

        var info = distribution.printObj();
        cassert.ok(info.min <= 2, 'expected low minimum');
        cassert.ok(info.max <= 5, 'expected low maximum');
        cassert.ok(info.sum <= 100, 'expected low total connections');
        cassert.ok(info.p75 <= 2, 'expected low p75');
        // console.log('conn distribution', info);

        cassert.report(assert, 'expected batch connections to be fine');
    }

    function checkDistributions(statusTable) {
        var uniqHosts = Object.keys(statusTable);
        assert.ok(uniqHosts.length <= 35,
            'Expected host reached (' + uniqHosts.length + ') to <= 35');

        var distribution = new metrics.Histogram();
        for (var i = 0; i < uniqHosts.length; i++) {
            distribution.update(statusTable[uniqHosts[i]]);
        }

        var info = distribution.printObj();

        var cassert = CollapsedAssert();
        cassert.ok(info.min <= 50,
            'expected minimum to be no more then 50'
        );
        cassert.equal(info.sum, 1000,
            'expected 1000 requests to be made'
        );
        cassert.ok(info.median >= 48,
            'expected median (' + info.median + ') to be larger then 49'
        );
        cassert.ok(info.max >= 100, 'expected maximum to be huge');
        cassert.ok(info.p75 >= 50, 'expected P75 to be huge');
        cassert.ok(info.p95 > 80, 'expected P95 to be huge');
        cassert.ok(info.variance >= 500,
            'expected variance (' + info.variance + ') to be huge'
        );
        // console.log('conn distribution', info);

        cassert.report(assert, 'expected request distribution to be ok');
    }
});

// skip flappy test
false && allocCluster.test('p2p requests from 40 -> 40 with minConnections', {
    numPeers: 40,
    channelOptions: {
        choosePeerWithHeap: true,
        refreshConnectedPeersDelay: 100
    }
}, function t(cluster, assert) {
    setup(cluster, {
        minConnections: 10
    });

    collectParallel(cluster.batches, function runRequests(batch, _, cb) {
        batch.sendRequests(cb);
    }, onBatches);

    /*eslint max-statements: [2, 40]*/
    function onBatches(err, results) {
        var cassert = CollapsedAssert();
        cassert.ifError(err);

        var statuses = [];
        for (var i = 0; i < results.length; i++) {
            cassert.ifError(results[i].err, 'expect no batch error');
            cassert.ifError(results[i].value.errors.length > 0,
                'expect zero errors in batch');
            statuses.push(results[i].value);
        }
        cassert.report(assert, 'expected no errors');

        var statusTable = findServerHostDistribution(statuses);

        cassert = verifyConnections(cluster, 10, 12);
        cassert.report(assert, 'expected batch connections to be fine');

        cassert = verifyDistributions(statusTable, {
            min: 40,
            sum: 1000,
            median: [40, 60],
            mean: [45, 55],
            max: 120,
            p75: [50, 70],
            p95: 100,
            variance: 500
        });
        cassert.report(assert, 'expected request distribution to be ok');

        assert.end();
    }
});

allocCluster.test('p2p requests where minConns > no of servers', {
    numPeers: 25,
    channelOptions: {
        choosePeerWithHeap: true
    }
}, function t(cluster, assert) {
    setup(cluster, {
        minConnections: 6,
        servers: 5
    });

    collectParallel(cluster.batches, function runRequests(batch, _, cb) {
        batch.sendRequests(cb);
    }, onBatches);

    /*eslint max-statements: [2, 40]*/
    function onBatches(err, results) {
        var cassert = CollapsedAssert();
        cassert.ifError(err);

        var statuses = [];
        for (var i = 0; i < results.length; i++) {
            cassert.ifError(results[i].err, 'expect no batch error');
            cassert.ifError(results[i].value.errors.length > 0,
                'expect zero errors in batch');

            statuses.push(results[i].value);
        }
        cassert.report(assert, 'expected no errors');

        var statusTable = findServerHostDistribution(statuses);

        cassert = verifyConnections(cluster, 5, 5);
        cassert.report(assert, 'expected batch connections to be fine');

        cassert = verifyDistributions(statusTable, {
            min: 395,
            sum: 1000,
            median: [180, 220],
            mean: [195, 205],
            max: 300,
            p75: [200, 250],
            p95: 275
        });
        cassert.report(assert, 'expected request distribution to be ok');

        assert.end();
    }
});

allocCluster.test('p2p requests where half of servers down', {
    numPeers: 28,
    channelOptions: {
        choosePeerWithHeap: true
    }
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'resetting connection');

    setup(cluster, {
        minConnections: 5,
        servers: 8,
        retryLimit: 2
    });

    // Close half the servers...
    for (var j = 0; j < cluster.servers.length / 2; j++) {
        cluster.servers[j * 2].close();
    }

    collectParallel(cluster.batches, function runRequests(batch, _, cb) {
        batch.sendRequests(cb);
    }, onBatches);

    /*eslint max-statements: [2, 40]*/
    function onBatches(err, results) {
        var cassert = CollapsedAssert();
        cassert.ifError(err);

        var statuses = [];
        for (var i = 0; i < results.length; i++) {
            cassert.ifError(results[i].err, 'expect no batch error');
            cassert.ifError(results[i].value.errors.length > 5,
                'expect at most five error in batch(' +
                    results[i].value.errors.length + ')');

            statuses.push(results[i].value);
        }
        cassert.report(assert, 'expected no errors');

        var statusTable = findServerHostDistribution(statuses);

        cassert = verifyConnections(cluster, 4, 4);
        cassert.report(assert, 'expected batch connections to be fine');

        cassert = verifyDistributions(statusTable, {
            min: 495,
            sum: [985, 1000],
            median: [230, 270],
            mean: [245, 255],
            max: 350,
            p75: [250, 300],
            p95: 350
        });
        cassert.report(assert, 'expected request distribution to be ok');

        var logs = cluster.logger.items();
        assert.ok(logs.length <= 280 + 160,
            'expected conn reset logs (' + logs.length + ') to be <= 420');

        assert.end();
    }
});

allocCluster.test('p2p requests where half the servers hickup', {
    numPeers: 28,
    channelOptions: {
        choosePeerWithHeap: true,
        connectionAttemptDelay: 100,
        maxConnectionAttemptDelay: 1000
    }
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'resetting connection');

    setup(cluster, {
        minConnections: 8,
        servers: 8,
        retryLimit: 2
    });

    collectParallel(cluster.batches, function runRequests(batch, _, cb) {
        batch.sendRequests(cb);
    }, onWarmup);

    function onWarmup(err, results) {
        assert.ifError(err);

        var cassert = verifyNoError(results);
        cassert.report(assert, 'expected no errors');

        cassert = verifyConnections(cluster, 8, 8);
        cassert.report(assert, 'expected batch connections to be fine');

        console.log('# --- sever connections');
        severConnections();
    }

    function noop() {}

    function severConnections() {
        for (var i = 0; i < cluster.servers.length / 2; i++) {
            var server = cluster.servers[i * 2];

            var peers = server.peers.values();
            for (var j = 0; j < peers.length; j++) {
                var peer = peers[j];
                peer.close(noop);
            }

            server._actualPort = server.serverSocket.address().port;
            server._onServerSocketConnection = server.onServerSocketConnection;
            server.onServerSocketConnection = destroySocket;
        }

        setTimeout(sendNextBatch, 500);
    }

    function destroySocket(sock) {
        sock.destroy();
    }

    function sendNextBatch() {
        collectParallel(cluster.batches, function runRequests(batch, _, cb) {
            batch.sendRequests(cb);
        }, onRequests);
    }

    function onRequests(err, results) {
        assert.ifError(err);

        var cassert = verifyNoError(results);
        cassert.report(assert, 'expected no errors');

        cassert = verifyConnections(cluster, 4, 5);
        cassert.report(assert, 'expected batch connections to be fine');

        console.log('# --- resurrect connections');
        resurrectServers();
    }

    function resurrectServers() {
        for (var i = 0; i < cluster.servers.length / 2; i++) {
            var server = cluster.servers[i * 2];

            server.onServerSocketConnection = server._onServerSocketConnection;
        }

        setTimeout(sendFinalBatch, 500);
    }

    function sendFinalBatch() {
        collectParallel(cluster.batches, function runRequests(batch, _, cb) {
            batch.sendRequests(cb);
        }, onFinalRequests);
    }

    function onFinalRequests(err, results) {
        assert.ifError(err);

        var cassert = verifyNoError(results);
        cassert.report(assert, 'expected no errors');

        cassert = verifyConnections(cluster, 8, 8);
        cassert.report(assert, 'expected batch connections to be fine');

        assert.end();
    }

    // Close half the servers...
    // for (var j = 0; j < cluster.servers.length / 2; j++) {
    //     cluster.servers[j * 2].close();
    // }

});

function verifyNoError(results) {
    var cassert = CollapsedAssert();

    var statuses = [];
    for (var i = 0; i < results.length; i++) {
        cassert.ifError(results[i].err, 'expect no batch error');
        cassert.ifError(results[i].value.errors.length > 0,
            'expect zero errors in batch');

        statuses.push(results[i].value);
    }

    return cassert;
}

function findServerHostDistribution(statuses) {
    var statusTable = {};
    for (var i = 0; i < statuses.length; i++) {
        var records = statuses[i].results;
        for (var j = 0; j < records.length; j++) {
            var record = records[j];
            if (!statusTable[record.outReqHostPort]) {
                statusTable[record.outReqHostPort] = 0;
            }
            statusTable[record.outReqHostPort]++;
        }
    }
    return statusTable;
}

function countConnections(batchClient) {
    var subChannel = batchClient.subChannel;
    var peers = subChannel.peers.values();

    var conns = [];
    for (var i = 0; i < peers.length; i++) {
        var peer = peers[i];
        for (var j = 0; j < peer.connections.length; j++) {
            conns.push(peer.connections[j]);
        }
    }

    return conns.length;
}

function verifyConnections(cluster, min, max) {
    var MIN = min;
    var MAX = max;
    var COUNT = cluster.batches.length;

    var cassert = CollapsedAssert();
    var distribution = new metrics.Histogram();
    for (var i = 0; i < cluster.batches.length; i++) {
        var connCount = countConnections(cluster.batches[i]);
        distribution.update(connCount);

        cassert.ok(
            connCount >= MIN &&
            connCount <= MAX,
            'expected connections(' + connCount + ') to be ' +
                '>= ' + MIN + ' and <= ' + MAX
        );
    }

    var info = distribution.printObj();
    cassert.ok(info.min <= MAX,
        'expected min connections(' + info.min + ') to be <= ' + MAX);
    cassert.ok(info.max >= MIN,
        'expected max conns(' + info.max + ') to be >= ' + MIN);
    cassert.ok(info.sum >= COUNT * MIN,
        'expected sum of conns(' + info.sum + ') to be at ' +
            COUNT * MIN + ' conns');
    cassert.ok(info.p75 <= MAX,
        'expected p75(' + info.p75 + ') to be <= ' + MAX);

    return cassert;
}

function verifyDistributions(statusTable, opts) {
    var uniqHosts = Object.keys(statusTable);

    var distribution = new metrics.Histogram();
    for (var i = 0; i < uniqHosts.length; i++) {
        distribution.update(statusTable[uniqHosts[i]]);
    }

    var info = distribution.printObj();

    var cassert = CollapsedAssert();
    cassert.ok(info.min <= opts.min,
        'expected minimum(' + info.min + ') to be no more then ' + opts.min
    );

    if (Array.isArray(opts.sum)) {
        cassert.ok(
            info.sum >= opts.sum[0] &&
            info.sum <= opts.sum[1],
            'expected sum(' + info.sum + ') to be within ' +
                opts.sum[0] + ' & ' + opts.sum[1]
        );
    } else {
        cassert.equal(info.sum, opts.sum,
            'expected sum(' + info.sum + ') to be ' + opts.sum
        );
    }

    cassert.ok(
        info.median >= opts.median[0] &&
        info.median <= opts.median[1],
        'expected median(' + info.median + ') to be within ' +
            opts.median[0] + ' & ' + opts.median[1]
    );

    cassert.ok(
        info.mean >= opts.mean[0] &&
        info.mean <= opts.mean[1],
        'expected mean(' + info.mean + ') to be within ' +
            opts.mean[0] + ' & ' + opts.mean[1]
    );

    cassert.ok(info.max <= opts.max,
        'expected maximum(' + info.max + ') to no more then ' + opts.max
    );
    cassert.ok(
        info.p75 >= opts.p75[0] &&
        info.p75 <= opts.p75[1],
        'expected P75(' + info.p75 + ') to be within ' +
            opts.p75[0] + ' & ' + opts.p75[1]
    );
    cassert.ok(info.p95 <= opts.p95,
        'expected P95 (' + info.p95 + ') to be less than ' + opts.p95
    );

    if (opts.variance) {
        cassert.ok(info.variance <= opts.variance,
            'expected variance(' + info.variance + ') to be less than ' + opts.variance
        );
    }

    return cassert;
}

function setup(cluster, opts) {
    opts = opts || {};
    var NUM_CLIENTS = opts.clients || 20;
    var NUM_SERVERS = opts.servers || cluster.channels.length - NUM_CLIENTS;

    cluster.clients = cluster.channels.slice(0, NUM_CLIENTS);
    cluster.servers = cluster.channels.slice(
        NUM_CLIENTS, NUM_CLIENTS + NUM_SERVERS
    );

    var i;
    for (i = 0; i < cluster.servers.length; i++) {
        makeServer(cluster.servers[i], i);
    }

    cluster.serverHosts = [];
    for (i = 0; i < cluster.servers.length; i++) {
        cluster.serverHosts.push(cluster.servers[i].hostPort);
    }

    cluster.batches = [];
    for (i = 0; i < cluster.clients.length; i++) {
        cluster.batches.push(new BatchClient(
            cluster.clients[i], cluster.serverHosts, {
                delay: 200,
                batchSize: 2,
                timeout: 1500,
                totalRequests: 50,
                minConnections: opts.minConnections || null,
                retryLimit: opts.retryLimit || null
            }
        ));
    }
}

function makeServer(channel, index) {
    var chanNum = index + 1;

    var serverChan = channel.makeSubChannel({
        serviceName: 'server'
    });

    serverChan.register('echo', function echo(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3 + ' served by ' + chanNum);
    });
}
