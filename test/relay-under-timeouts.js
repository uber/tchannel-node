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

var setTimeout = require('timers').setTimeout;

var BatchClient = require('./lib/batch-client');
var allocCluster = require('./lib/alloc-cluster');
var RelayHandler = require('../relay_handler');
var CollapsedAssert = require('./lib/collapsed-assert');

allocCluster.test('sending a 1000 requests through eager relay', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];

    setupRelay(cluster);
    setupTimeoutServer(cluster);

    relay.setLazyHandling(false);
    relay.setLazyRelaying(false);

    var batchClient = BatchClient(client, [relay.hostPort], {
        totalRequests: 1000,
        batchSize: 50,
        delay: 50,
        endpoint: 'bleed'
    });
    batchClient.sendRequests(onResults);

    function onResults(err, data) {
        assert.ifError(err);

        assert.equal(data.errors.length + data.results.length, 1000);

        var cassert = CollapsedAssert();

        for (var i = 0; i < data.errors.length; i++) {
            cassert.equal(data.errors[i].type, 'tchannel.request.timeout');
        }

        for (var j = 0; j < data.results.length; j++) {
            cassert.equal(data.results[j].responseOk, false);
            cassert.equal(data.results[j].error.type, 'tchannel.timeout');
        }

        cassert.report(assert, 'all response are errors');

        setTimeout(finish, 750);
    }

    function finish() {
        assert.end();
    }
});

allocCluster.test('sending a 1000 requests through lazy relay', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];

    setupRelay(cluster);
    setupTimeoutServer(cluster);

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);

    var batchClient = BatchClient(client, [relay.hostPort], {
        totalRequests: 1000,
        batchSize: 50,
        delay: 50,
        endpoint: 'bleed'
    });
    batchClient.sendRequests(onResults);

    function onResults(err, data) {
        assert.ifError(err);

        assert.equal(data.errors.length + data.results.length, 1000);

        var cassert = CollapsedAssert();

        for (var i = 0; i < data.errors.length; i++) {
            cassert.equal(data.errors[i].type, 'tchannel.request.timeout');
        }

        for (var j = 0; j < data.results.length; j++) {
            cassert.equal(data.results[j].responseOk, false);
            cassert.equal(data.results[j].error.type, 'tchannel.timeout');
        }

        cassert.report(assert, 'all response are errors');

        setTimeout(finish, 750);
    }

    function finish() {
        assert.end();
    }
});

allocCluster.test('sending N requests to black hole with eager relay', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];

    setupRelay(cluster);
    setupTimeoutServer(cluster);

    relay.setLazyHandling(false);
    relay.setLazyRelaying(false);

    var batchClient = BatchClient(client, [relay.hostPort], {
        totalRequests: 1000,
        batchSize: 50,
        delay: 50,
        endpoint: 'silent'
    });
    batchClient.sendRequests(onResults);

    function onResults(err, data) {
        assert.ifError(err);

        assert.equal(data.errors.length + data.results.length, 1000);

        var cassert = CollapsedAssert();

        for (var i = 0; i < data.errors.length; i++) {
            cassert.equal(data.errors[i].type, 'tchannel.request.timeout');
        }

        for (var j = 0; j < data.results.length; j++) {
            cassert.equal(data.results[j].responseOk, false);
            cassert.equal(data.results[j].error.type, 'tchannel.timeout');
        }

        cassert.report(assert, 'all response are errors');

        setTimeout(finish, 750);
    }

    function finish() {
        assert.end();
    }
});

allocCluster.test('sending N requests to black hole with lazy relay', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];

    setupRelay(cluster);
    setupTimeoutServer(cluster);

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);

    var batchClient = BatchClient(client, [relay.hostPort], {
        totalRequests: 1000,
        batchSize: 50,
        delay: 50,
        endpoint: 'silent'
    });
    batchClient.sendRequests(onResults);

    function onResults(err, data) {
        assert.ifError(err);

        assert.equal(data.errors.length + data.results.length, 1000);

        var cassert = CollapsedAssert();

        for (var i = 0; i < data.errors.length; i++) {
            cassert.equal(data.errors[i].type, 'tchannel.request.timeout');
        }

        for (var j = 0; j < data.results.length; j++) {
            cassert.equal(data.results[j].responseOk, false);
            cassert.equal(data.results[j].error.type, 'tchannel.timeout');
        }

        cassert.report(assert, 'all response are errors');

        setTimeout(finish, 750);
    }

    function finish() {
        assert.end();
    }
});

function setupRelay(cluster) {
    var relay = cluster.channels[1];
    var server = cluster.channels[2];

    var subRelay = relay.makeSubChannel({
        serviceName: 'server',
        peers: [server.hostPort]
    });
    subRelay.handler = new RelayHandler(subRelay);
}

function setupTimeoutServer(cluster) {
    var server = cluster.channels[2];

    var subServer = server.makeSubChannel({
        serviceName: 'server'
    });

    subServer.register('bleed', bleed);
    subServer.register('silent', silent);

    function bleed(req) {
        /* timeout on purpose */
    }

    function silent(req) {
        /* do not even Timeout error frame */
        req.connection.ops.popInReq(req.id);
    }
}
