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

var parallel = require('run-parallel');

var BatchClient = require('./lib/batch-client.js');
var allocCluster = require('./lib/alloc-cluster.js');

allocCluster.test('sending requests to servers synchronously has perfect distribution', {
    numPeers: 5
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 4;

    var clientChannel = client.makeSubChannel({
        serviceName: 'server',
        peers: servers.map(getHostPort)
    });

    servers.forEach(makeServer);

    var callReqThunks = [];
    for (var i = 0; i < 200; i++) {
        var req = clientChannel.request({
            serviceName: 'server',
            hasNoParent: true,
            timeout: 500,
            headers: {
                cn: 'client',
                as: 'raw'
            }
        });

        callReqThunks.push(req.send.bind(req, 'foo', 'a', 'b'));
    }

    parallel(callReqThunks, onResults);

    function onResults(err, responses) {
        assert.ifError(err, 'expect no req error');

        // TODO: one of these tests isn't like the others...
        var results = responses.map(function each(res) {
            return {
                response: res,
                error: null
            };
        });

        var byServer = collectByResult(results);
        var keys = Object.keys(byServer);
        assert.equal(keys.length, numPeers,
                     'expected ' + numPeers + ' servers');

        for (var k = 0; k < keys.length; k++) {
            var count = byServer[keys[k]];

            assert.equal(count, 50, 'count for ' + keys[k] + ' is ' + count);
        }
        assert.end();
    }
});

allocCluster.test('sending requests to servers over time has good distribution', {
    numPeers: 26
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 25;
    var numRequests = 800;
    var numExpectedReqs = numRequests / numPeers;

    var batchClient = new BatchClient(client, servers.map(getHostPort));

    servers.forEach(makeServer);

    batchClient.warmUp(onWarmedup);

    function onWarmedup(err1) {
        assert.ifError(err1, 'expect no initialize error');

        batchClient.sendRequests({
            totalRequests: numRequests,
            batchSize: 15
        }, onResults);
    }

    function onResults(err, data) {
        assert.ifError(err, 'expect no batch error');
        assert.equal(data.errors.length, 0, 'expected no client error');

        var byServer = collectByResult(data.results);
        assert.equal(Object.keys(byServer).length, numPeers,
                     'expected ' + numPeers + ' servers');

        verifyCountsWithinRange(assert, byServer, function expectedBalance(key) {
            return [
                numExpectedReqs * 0.5,
                numExpectedReqs * 1.5
            ];
        });

        assert.end();
    }
});

allocCluster.test('sending requests to servers with bad request', {
    numPeers: 26
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 25;
    var numRequests = 800;
    var numExpectedReqs = numRequests / numPeers;

    var batchClient = new BatchClient(client, servers.map(getHostPort));

    makeErrorServer(servers.shift(), 0, 'BadRequest');
    servers.forEach(makeServer);

    batchClient.warmUp(onWarmedup);

    function onWarmedup(err1) {
        assert.ifError(err1, 'expect no initialize error');

        batchClient.sendRequests({
            totalRequests: numRequests,
            batchSize: 15
        }, onResults);
    }

    function onResults(err, data) {
        assert.ifError(err, 'expect no batch error');
        assert.equal(data.errors.length, 0, 'expected no client error');

        var byServer = collectByResult(data.results);
        assert.equal(Object.keys(byServer).length, numPeers,
                     'expected ' + numPeers + ' servers');

        verifyCountsWithinRange(byServer, function expectedBalance(key) {
            return [
                numExpectedReqs * 0.5,
                numExpectedReqs * 1.5
            ];
        });

        assert.end();
    }
});

allocCluster.test('sending requests to servers with declined', {
    numPeers: 26
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 25;
    var numRequests = 800;
    var numExpectedReqs = numRequests / numPeers;

    var batchClient = new BatchClient(client, servers.map(getHostPort), {
        retryFlags: {
            never: true
        }
    });

    makeErrorServer(servers.shift(), 0, 'Declined');
    servers.forEach(makeServer);

    batchClient.warmUp(onWarmedup);

    function onWarmedup(err1) {
        assert.ifError(err1, 'expect no initialize error');

        batchClient.sendRequests({
            totalRequests: numRequests,
            batchSize: 15
        }, onResults);
    }

    function onResults(err, data) {
        assert.ifError(err, 'expect no batch error');
        assert.equal(data.errors.length, 0, 'expected no client error');

        var byServer = collectByResult(data.results);
        assert.equal(Object.keys(byServer).length, numPeers,
                     'expected ' + numPeers + ' servers');

        verifyCountsWithinRange(byServer, function expectedBalance(key) {
            // If its the error frame
            if (key.indexOf('oops') === 0) {
                return [1, 2];
            } else {
                return [numExpectedReqs * 0.5,
                        numExpectedReqs * 1.5];
            }
        });

        assert.end();
    }
});

allocCluster.test('sending requests to servers with declined over time', {
    numPeers: 26
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 25;
    var batchSize = 20;
    var numRequests = 800;
    var batchDelay = 40;
    var numExpectedReqs = numRequests / numPeers;

    var batchClient = new BatchClient(client, servers.map(getHostPort), {
        retryFlags: {
            never: true
        }
    });

    makeErrorServer(servers.shift(), 0, 'Declined');
    servers.forEach(makeServer);

    batchClient.warmUp(onWarmedup);

    function onWarmedup(err1) {
        assert.ifError(err1, 'expect no initialize error');

        batchClient.sendRequests({
            totalRequests: numRequests,
            batchSize: batchSize,
            delay: batchDelay
        }, onResults);
    }

    function onResults(err, data) {
        assert.ifError(err, 'expect no batch error');
        assert.equal(data.errors.length, 0, 'expected no client error');

        var EXPECTED_ERROR = Math.ceil(
            (numRequests / batchSize) * (batchDelay / 1000)
        );

        var byServer = collectByResult(data.results);

        assert.equal(Object.keys(byServer).length, numPeers,
                     'expected ' + numPeers + ' servers');

        verifyCountsWithinRange(byServer, function expectedBalance(key) {
            // If its the error frame
            if (key.indexOf('oops') === 0) {
                return [EXPECTED_ERROR,
                        EXPECTED_ERROR + 1];
            } else {
                return [numExpectedReqs * 0.5,
                        numExpectedReqs * 1.5];
            }
        });

        assert.end();
    }
});

allocCluster.test('sending requests to servers with busy', {
    numPeers: 26
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 25;
    var numRequests = 800;
    var numExpectedReqs = numRequests / numPeers;

    var batchClient = new BatchClient(client, servers.map(getHostPort), {
        retryFlags: {
            never: true
        }
    });

    makeErrorServer(servers.shift(), 0, 'Busy');
    servers.forEach(makeServer);

    batchClient.warmUp(onWarmedup);

    function onWarmedup(err1) {
        assert.ifError(err1, 'expect no initialize error');

        batchClient.sendRequests({
            totalRequests: numRequests,
            batchSize: 15
        }, onResults);
    }

    function onResults(err, data) {
        assert.ifError(err, 'expect no batch error');
        assert.equal(data.errors.length, 0, 'expected no client error');

        var byServer = collectByResult(data.results);

        assert.equal(Object.keys(byServer).length, numPeers,
                     'expected ' + numPeers + ' servers');

        verifyCountsWithinRange(byServer, function expectedBalance(key) {
            // If its the error frame
            if (key.indexOf('oops') === 0) {
                return [1, 2];
            } else {
                return [numExpectedReqs * 0.5,
                        numExpectedReqs * 1.5];
            }
        });

        assert.end();
    }
});

allocCluster.test('sending requests to servers with busy over time', {
    numPeers: 26
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var servers = cluster.channels.slice(1);

    var numPeers = 25;
    var batchSize = 20;
    var numRequests = 800;
    var batchDelay = 40;
    var numExpectedReqs = numRequests / numPeers;

    var batchClient = new BatchClient(client, servers.map(getHostPort), {
        retryFlags: {
            never: true
        }
    });

    makeErrorServer(servers.shift(), 0, 'Busy');
    servers.forEach(makeServer);

    batchClient.warmUp(onWarmedup);

    function onWarmedup(err1) {
        assert.ifError(err1, 'expect no initialize error');

        batchClient.sendRequests({
            totalRequests: numRequests,
            batchSize: batchSize,
            delay: batchDelay
        }, onResults);
    }

    function onResults(err, data) {
        assert.ifError(err, 'expect no batch error');
        assert.equal(data.errors.length, 0, 'expected no client error');

        var EXPECTED_ERROR = Math.ceil(
            (numRequests / batchSize) * (batchDelay / 1000)
        );

        var byServer = collectByResult(data.results);
        assert.equal(Object.keys(byServer).length, numPeers,
                     'expected ' + numPeers + ' servers');

        verifyCountsWithinRange(byServer, function expectedBalance(key) {
            // If its the error frame
            if (key.indexOf('oops') === 0) {
                return [EXPECTED_ERROR,
                        EXPECTED_ERROR + 1];
            } else {
                return [numExpectedReqs * 0.5,
                        numExpectedReqs * 1.5];
            }
        });

        assert.end();
    }
});

function makeServer(channel, index) {
    var chanNum = index + 1;

    var serverChan = channel.makeSubChannel({
        serviceName: 'server'
    });

    serverChan.register('foo', function foo(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3 + ' served by ' + chanNum);
    });
}

function makeErrorServer(channel, index, codeName) {
    var chanNum = index + 1;

    var serverChan = channel.makeSubChannel({
        serviceName: 'server'
    });

    serverChan.register('foo', function foo(req, res, arg2, arg3) {
        res.sendError(codeName, 'oops from ' + chanNum);
    });
}

function getHostPort(c) {
    return c.hostPort;
}

function collectByResult(results) {
    var byKey = {};
    for (var j = 0; j < results.length; j++) {
        var res = results[j];

        var key = '';
        if (res && res.response) {
            key = String(res.response.arg3);
        } else if (res && res.error) {
            key = String(res.error.message);
        }

        if (!byKey[key]) {
            byKey[key] = 1;
        } else {
            byKey[key]++;
        }
    }
    return byKey;
}

function verifyCountsWithinRange(assert, byServer, expectedRange) {
    var keys = Object.keys(byServer);
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var count = byServer[key];
        var range = expectedRange(key);
        var desc = 'count (' + count + ') for ' + key;
        assert.ok(count >= range[0], desc + ' is >= ' + range[0]);
        assert.ok(count <= range[1], desc + ' is <= ' + range[1]);
    }
}
