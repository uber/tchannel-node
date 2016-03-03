// Copyright (c) 2015 Uber Technologies, Inc.
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
var metrics = require('metrics');

var allocCluster = require('./lib/alloc-cluster.js');
var BatchClient = require('./lib/batch-client.js');
var CollapsedAssert = require('./lib/collapsed-assert.js');

allocCluster.test('p2p requests from 40 -> 40', {
    numPeers: 80
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
            cassert.ifError(results[i].err);
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
        cassert.equal(info.sum, 2000,
            'expected 2000 requests to be made'
        );
        cassert.ok(info.median >= 49,
            'expected median (' + info.median + ') to be huge'
        );
        cassert.ok(info.max >= 100, 'expected maximum to be huge');
        cassert.ok(info.p75 >= 50, 'expected P75 to be huge');
        cassert.ok(info.p95 > 80, 'expected P95 to be huge');
        cassert.ok(info.variance >= 800,
            'expected variance (' + info.variance + ') to be huge'
        );
        // console.log('conn distribution', info);

        cassert.report(assert, 'expected request distribution to be ok');
    }
});

allocCluster.test('p2p requests from 40 -> 40 with minConnections', {
    numPeers: 80,
    channelOptions: {
        choosePeerWithHeap: true
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
            cassert.ifError(results[i].err);
            statuses.push(results[i].value);
        }
        cassert.report(assert, 'expected no errors');

        var statusTable = findServerHostDistribution(statuses);

        checkConnections();
        checkDistributions(statusTable);

        assert.end();
    }

    function checkConnections() {
        var cassert = CollapsedAssert();
        var distribution = new metrics.Histogram();
        for (var i = 0; i < cluster.batches.length; i++) {
            var connCount = countConnections(cluster.batches[i]);
            distribution.update(connCount);

            cassert.ok(
                connCount >= 10 &&
                connCount <= 12,
                'expected roughly 10 connections'
            );
        }

        var info = distribution.printObj();
        cassert.ok(info.min <= 12, 'expected roughly 10 conns');
        cassert.ok(info.max >= 10, 'expected 10 conns');
        cassert.ok(info.sum >= 400, 'expected at least 400 conns');
        cassert.ok(info.p75 <= 12, 'expected p75 to be dcent');

        cassert.report(assert, 'expected batch connections to be fine');
    }

    function checkDistributions(statusTable) {
        var uniqHosts = Object.keys(statusTable);
        // assert.ok(uniqHosts.length <= 35,
        //     'Expected host reached (' + uniqHosts.length + ') to <= 35');

        var distribution = new metrics.Histogram();
        for (var i = 0; i < uniqHosts.length; i++) {
            distribution.update(statusTable[uniqHosts[i]]);
        }

        var info = distribution.printObj();

        var cassert = CollapsedAssert();
        cassert.ok(info.min <= 40,
            'expected minimum to be no more then 40'
        );
        cassert.equal(info.sum, 2000,
            'expected 2000 requests to be made'
        );
        cassert.ok(
            info.median >= 40 &&
            info.median <= 60,
            'expected median (' + info.median + ') to be within 40 & 60'
        );

        cassert.ok(
            info.mean >= 45 &&
            info.mean <= 55,
            'expected mean (' + info.mean + ') to be within 45 & 55'
        );

        cassert.ok(info.max <= 120,
            'expected maximum (' + info.max + ') to no more then 120'
        );
        cassert.ok(
            info.p75 >= 55 &&
            info.p75 <= 65,
            'expected P75 (' + info.p75 + ') to be within 55 & 65'
        );
        cassert.ok(info.p95 <= 95,
            'expected P95 (' + info.p95 + ') to be small'
        );

        cassert.ok(info.variance <= 400,
            'expected variance (' + info.variance + ') to be small'
        );
        // console.log('conn distribution', info);

        cassert.report(assert, 'expected request distribution to be ok');
    }
});

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

function setup(cluster, opts) {
    opts = opts || {};
    cluster.clients = cluster.channels.slice(0, 40);
    cluster.servers = cluster.channels.slice(40, 80);

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
                delay: 40,
                batchSize: 1,
                totalRequests: 50,
                minConnections: opts.minConnections || null
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
