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

var setTimeout = require('timers').setTimeout;

var CollapsedAssert = require('./lib/collapsed-assert.js');
var allocCluster = require('./lib/alloc-cluster.js');
var BatchClient = require('./lib/batch-client.js');
var RelayHandler = require('../relay_handler');

allocCluster.test('send requests to timed out peer through eager relay', {
    numPeers: 7
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');

    var client = cluster.channels[0];

    setupRelayMesh(cluster);
    setupServerEndpoints(cluster);

    var BATCH_SIZE = 20;
    var TOTAL_REQUESTS = 200;
    var _errors;
    var _results;

    var relays = cluster.channels.slice(1, 4);
    for (var i = 0; i < relays.length; i++) {
        var relay = relays[i];

        relay.setLazyHandling(false);
        relay.setLazyRelaying(false);
    }

    var batchClient = setupBatchClient(cluster, {
        retryFlags: {
            never: true
        },
        batchSize: BATCH_SIZE,
        delay: 100,
        totalRequests: TOTAL_REQUESTS
    });
    batchClient.warmUp(onWarm);

    function onWarm(err) {
        assert.ifError(err);

        batchClient.sendRequests(onResults);
    }

    function onResults(err, r) {
        assert.ifError(err);

        var EXPECTED = TOTAL_REQUESTS * 0.1;

        _errors = [];
        _results = [];

        for (var j = 0; j < r.errors.length; j++) {
            _errors.push(r.errors[j]);
        }
        for (j = 0; j < r.results.length; j++) {
            if (r.results[j].error) {
                _errors.push(r.results[j].error);
            } else {
                _results.push(r.results[j]);
            }
        }

        assert.ok(
            _errors.length > EXPECTED * 0.25 &&
            _errors.length < EXPECTED * 1.5,
            'Expected to have roughly ' + EXPECTED +
                ' errors but got ' + _errors.length
        );

        assert.equal(
            TOTAL_REQUESTS, _errors.length + _results.length,
            'expected ' + TOTAL_REQUESTS + ' requests to happen'
        );

        var cassert = CollapsedAssert();
        for (j = 0; j < r.errors.length; j++) {
            var error = r.errors[j];

            cassert.equal(error.type, 'tchannel.request.timeout');
            cassert.equal(error.isErrorFrame, undefined);
        }
        cassert.report(assert, 'expected errors to be local to client');

        setTimeout(finish, 750);
    }

    function finish() {
        /*eslint max-statements: [2, 40] */
        var errorFrameLogs = cluster.logger
            .popLogs('forwarding expected error frame');
        var errorLogs = cluster.logger
            .popLogs('expected error while forwarding');

        // console.log('logs?', {
        //     errors: _errors.length,
        //     results: _results.length,
        //     errorFrameLogs: errorFrameLogs.length,
        //     errorLogs: errorLogs.length
        // });

        assert.ok(
            errorLogs.length + errorFrameLogs.length >= _errors.length,
            'Should get at least one log line per client error'
        );

        var j;
        var errorIds = {};
        var resultIds = {};
        var remoteAddr;

        for (i = 0; i < _errors.length; i++) {
            remoteAddr = _errors[i].remoteAddr;
            if (!errorIds[remoteAddr]) {
                errorIds[remoteAddr] = [];
            }

            var id = _errors[i].id || _errors[i].originalId;
            errorIds[remoteAddr].push(id);
        }

        for (i = 0; i < _results.length; i++) {
            remoteAddr = _results[i].outReqHostPort;
            if (!resultIds[remoteAddr]) {
                resultIds[remoteAddr] = [];
            }

            resultIds[remoteAddr].push(_results[i].responseId);
        }

        // console.log('client', client.hostPort, {
        //     errorIds: errorIds,
        //     resultIds: resultIds
        // });

        var cassert = CollapsedAssert();

        for (j = 0; j < errorFrameLogs.length; j++) {
            var frameLogLine = errorFrameLogs[j].meta;
            cassert.equal(
                frameLogLine.inRequestRemoteAddr, client.hostPort,
                'error frame should fail from client'
            );

            if (frameLogLine.inRequestType === 'tchannel.incoming-request') {
                var ids = errorIds[frameLogLine.hostPort];
                cassert.ok(ids.indexOf(frameLogLine.inRequestId) > -1,
                    'error frame should be for request: ' + frameLogLine.inRequestId
                );
            }
        }

        for (j = 0; j < errorLogs.length; j++) {
            var errorLogLine = errorLogs[j].meta;
            cassert.equal(
                errorLogLine.inRequestRemoteAddr, client.hostPort,
                'error log should fail from client'
            );

            if (errorLogLine.inRequestType === 'tchannel.incoming-request') {
                ids = errorIds[errorLogLine.hostPort];
                cassert.ok(ids.indexOf(errorLogLine.inRequestId) > -1,
                    'error log should be for requiest: ' + errorLogs.inRequestId
                );
            }
        }

        assert.ok(cluster.logger.isEmpty(), 'should have no logs');
        cassert.report(assert, 'error logs should be correct');

        // TODO why the fuck no connection reset.

        assert.end();
    }
});

function setupRelayMesh(cluster) {
    var relays = cluster.channels.slice(1, 4);
    var servers = cluster.channels.slice(4, 7);

    var peers = [];
    for (var i = 0; i < servers.length; i++) {
        peers.push(servers[i].hostPort);
    }

    for (var j = 0; j < relays.length; j++) {
        var relay = relays[j];

        var relayToServer = relay.makeSubChannel({
            serviceName: 'server',
            peers: peers.slice()
        });
        relayToServer.handler = new RelayHandler(relayToServer);
    }
}

function setupServerEndpoints(cluster) {
    var servers = cluster.channels.slice(4, 7);

    for (var i = 0; i < servers.length; i++) {
        var channel = servers[i];
        var subChan = channel.makeSubChannel({
            serviceName: 'server'
        });

        if (i === 1) {
            subChan.register('echo', timeout);
        } else {
            subChan.register('echo', echo(i));
        }
    }

    function echo(index) {
        return function echoHandler(req, res, arg2, arg3) {
            res.headers.as = 'raw';
            res.sendOk(arg2, arg3 + ' from ' + index);
        };
    }

    function timeout() {
        /* do nothing to emulate time out */
    }
}

function setupBatchClient(cluster, opts) {
    var client = cluster.channels[0];
    var relays = cluster.channels.slice(1, 4);

    var relayPeers = [];
    for (var i = 0; i < relays.length; i++) {
        relayPeers.push(relays[i].hostPort);
    }

    return BatchClient(client, relayPeers, opts);
}
