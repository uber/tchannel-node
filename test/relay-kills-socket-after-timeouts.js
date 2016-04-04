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

var hookupPeerScoreObs = require('./lib/peer_score_obs.js');
var CollapsedAssert = require('./lib/collapsed-assert.js');
var allocCluster = require('./lib/alloc-cluster.js');
var BatchClient = require('./lib/batch-client.js');
var RelayHandler = require('../relay_handler');

var debug = false; // TODO: less jank affordance

/* eslint max-statements: [2, 60], complexity: [2, 30] */

allocCluster.test('send some requests to timed out peer through relay', {
    numPeers: 7
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');
    cluster.logger.whitelist('warn', 'destroying socket from timeouts');
    cluster.logger.whitelist('warn', 'error while forwarding');
    cluster.logger.whitelist('warn', 'resetting connection');
    cluster.logger.whitelist('warn', 'Got a connection error');

    // Not much to do here lol
    cluster.logger.whitelist('warn', 'stale tombstone');

    var testContext = TimeoutTestContext(cluster);

    setupRelayMesh(cluster);
    setupServerEndpoints(cluster, testContext);

    var BATCH_SIZE = 20;
    var TOTAL_REQUESTS = 500;

    var relays = cluster.channels.slice(1, 4);
    for (var i = 0; i < relays.length; i++) {
        var relay = relays[i];

        if (debug) {
            relay.setObservePeerScoreEvents(true);
            hookupPeerScoreObs(assert.comment,
                               relay,
                               cluster.channels.slice(4, 7));
        }
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
        var EXPECTED_REMAINDER = TOTAL_REQUESTS * 0.5;
        testContext.populateResults(r);

        assert.equal(testContext.serverCounts[1], testContext.errors.length,
            'expected number of reqs to bad server to equal errors');

        assert.ok(
            testContext.serverCounts[0] > EXPECTED_REMAINDER * 0.85 &&
            testContext.serverCounts[0] < EXPECTED_REMAINDER * 1.15,
            'Expected healthy server to take majority of requests, ' +
                'count (' + testContext.serverCounts[0] + ') should be > ' +
                EXPECTED_REMAINDER * 0.85 + ' and < ' + EXPECTED_REMAINDER * 1.15
        );
        assert.ok(
            testContext.serverCounts[2] > EXPECTED_REMAINDER * 0.85 &&
            testContext.serverCounts[2] < EXPECTED_REMAINDER * 1.15,
            'Expected healthy server to take majority of requests, ' +
            'count (' + testContext.serverCounts[2] + ') should be > ' +
                EXPECTED_REMAINDER * 0.85 + ' and < ' + EXPECTED_REMAINDER * 1.15
        );

        assert.ok(
            testContext.errors.length > EXPECTED * 0.25 &&
            testContext.errors.length < EXPECTED * 1.5,
            'Expected to have roughly ' + EXPECTED +
                ' errors but got ' + testContext.errors.length
        );

        assert.equal(
            TOTAL_REQUESTS, testContext.errors.length + testContext.results.length,
            'expected ' + TOTAL_REQUESTS + ' requests to happen'
        );

        var cassert = CollapsedAssert();
        for (var j = 0; j < r.errors.length; j++) {
            var error = r.errors[j];

            cassert.equal(error.type, 'tchannel.request.timeout');
            cassert.equal(error.isErrorFrame, undefined);
        }
        cassert.report(assert, 'expected errors to be local to client');

        setTimeout(finish, 750);
    }

    function finish() {
        var cassert;

        cassert = testContext.checkErrorLogs();
        cassert.report(assert, 'error logs should be correct');

        cassert = testContext.checkConnTimeoutLogs();
        cassert.report(assert, 'the connection timeout logs are correct');

        assert.ok(cluster.logger.isEmpty(), 'should have no logs');

        assert.end();
    }
});

allocCluster.test('send a lot of requests to timed out peer through relay', {
    numPeers: 7
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');
    cluster.logger.whitelist('warn', 'destroying socket from timeouts');
    cluster.logger.whitelist('warn', 'error while forwarding');
    cluster.logger.whitelist('warn', 'resetting connection');
    cluster.logger.whitelist('warn', 'Got a connection error');

    // Not much to do here lol
    cluster.logger.whitelist('warn', 'stale tombstone');

    var testContext = TimeoutTestContext(cluster);

    setupRelayMesh(cluster);
    setupServerEndpoints(cluster, testContext);

    var BATCH_SIZE = 20;
    var TOTAL_REQUESTS = 2500;

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

        var EXPECTED = TOTAL_REQUESTS * 0.02;
        var EXPECTED_REMAINDER = TOTAL_REQUESTS * 0.5;
        testContext.populateResults(r);

        assert.equal(testContext.serverCounts[1], testContext.errors.length,
            'expected number of reqs to bad server to equal errors');

        assert.ok(
            testContext.serverCounts[0] > EXPECTED_REMAINDER * 0.95 &&
            testContext.serverCounts[0] < EXPECTED_REMAINDER * 1.05,
            'Expected healthy server to take majority of requests, ' +
                'count (' + testContext.serverCounts[0] + ') should be > ' +
                EXPECTED_REMAINDER * 0.95 + ' and < ' + EXPECTED_REMAINDER * 1.05
        );
        assert.ok(
            testContext.serverCounts[2] > EXPECTED_REMAINDER * 0.95 &&
            testContext.serverCounts[2] < EXPECTED_REMAINDER * 1.05,
            'Expected healthy server to take majority of requests, ' +
            'count (' + testContext.serverCounts[0] + ') should be > ' +
                EXPECTED_REMAINDER * 0.95 + ' and < ' + EXPECTED_REMAINDER * 1.05
        );

        assert.ok(
            testContext.errors.length > EXPECTED * 0.25 &&
            testContext.errors.length < EXPECTED * 1.5,
            'Expected to have roughly ' + EXPECTED +
                ' errors but got ' + testContext.errors.length
        );

        assert.equal(
            TOTAL_REQUESTS, testContext.errors.length + testContext.results.length,
            'expected ' + TOTAL_REQUESTS + ' requests to happen'
        );

        var cassert = CollapsedAssert();
        for (var j = 0; j < r.errors.length; j++) {
            var error = r.errors[j];

            cassert.equal(error.type, 'tchannel.request.timeout');
            cassert.equal(error.isErrorFrame, undefined);
        }
        cassert.report(assert, 'expected errors to be local to client');

        setTimeout(finish, 750);
    }

    function finish() {
        var cassert;

        cassert = testContext.checkErrorLogs();
        cassert.report(assert, 'error logs should be correct');

        cassert = testContext.checkConnTimeoutLogs();
        cassert.report(assert, 'the connection timeout logs are correct');

        cluster.logger.popLogs('stale tombstone');
        assert.ok(cluster.logger.isEmpty(), 'should have no logs');

        assert.end();
    }
});

function TimeoutTestContext(cluster) {
    if (!(this instanceof TimeoutTestContext)) {
        return new TimeoutTestContext(cluster);
    }

    var self = this;

    self.cluster = cluster;
    self.serverCounts = {};
    self.hostPorts = {
        relays: [],
        servers: [],
        timeoutServer: null,
        client: self.cluster.channels[0].hostPort
    };
    self.results = null;
    self.errors = null;

    var relays = self.cluster.channels.slice(1, 4);
    for (var i = 0; i < relays.length; i++) {
        var relay = relays[i];

        self.hostPorts.relays.push(relay.hostPort);
    }

    var servers = self.cluster.channels.slice(4, 7);
    for (i = 0; i < servers.length; i++) {
        if (i === 1) {
            self.hostPorts.timeoutServer = servers[i].hostPort;
        }
        self.hostPorts.servers.push(servers[i].hostPort);
    }
}

TimeoutTestContext.prototype.updateServerCount =
function updateServerCount(serverId) {
    var self = this;

    if (!self.serverCounts[serverId]) {
        self.serverCounts[serverId] = 0;
    }

    self.serverCounts[serverId]++;
};

TimeoutTestContext.prototype.populateResults =
function populateResults(r) {
    var self = this;

    self.errors = [];
    self.results = [];

    for (var j = 0; j < r.errors.length; j++) {
        self.errors.push(r.errors[j]);
    }
    for (j = 0; j < r.results.length; j++) {
        if (r.results[j].error) {
            self.errors.push(r.results[j].error);
        } else {
            self.results.push(r.results[j]);
        }
    }
};

TimeoutTestContext.prototype.checkConnTimeoutLogs =
function checkConnTimeoutLogs() {
    var self = this;

    var destroyingSocketLogs = self.cluster.logger
        .popLogs('destroying socket from timeouts');
    var connResetLogs = self.cluster.logger
        .popLogs('resetting connection');
    var connErrorLogs = self.cluster.logger
        .popLogs('Got a connection error');

    var cassert = CollapsedAssert();

    cassert.ok(destroyingSocketLogs.length > 0,
        'expected at least one socket to be destroyed');

    var seenRelays = [];
    var seenGUIDs = [];

    for (var j = 0; j < destroyingSocketLogs.length; j++) {
        var logMeta = destroyingSocketLogs[j].meta;
        cassert.equal(logMeta.error.type, 'tchannel.connection-stale.timeout',
            'expected error to be stale timeout');
        cassert.equal(logMeta.error.period, 1500,
            'stale timeout period is correct');
        cassert.ok(self.hostPorts.relays.indexOf(logMeta.hostPort) > -1,
            'expected log to come from relay process');
        cassert.equal(self.hostPorts.timeoutServer, logMeta.remoteName,
            'expected dead connection to be timeout server');

        var isValidClose = (
            logMeta.connClosing === false &&
            seenRelays.indexOf(logMeta.hostPort) === -1
        ) || (
            logMeta.connClosing === true &&
            seenRelays.indexOf(logMeta.hostPort) > -1
        );

        cassert.equal(isValidClose, true,
            'each connection should only close once');

        seenRelays.push(logMeta.hostPort);
        if (seenGUIDs.indexOf(logMeta.connGUID) === -1) {
            seenGUIDs.push(logMeta.connGUID);
        }
    }

    for (j = 0; j < connResetLogs.length; j++) {
        var resetLogMeta = connResetLogs[j].meta;

        cassert.equal(resetLogMeta.error.type, 'tchannel.connection-stale.timeout',
            'expected error to be stale timeout');
        cassert.ok(self.hostPorts.relays.indexOf(resetLogMeta.hostPort) > -1,
            'expected log to come from relay process');
    }

    for (j = 0; j < connErrorLogs.length; j++) {
        var connErrorLogMeta = connErrorLogs[j].meta;

        cassert.equal(connErrorLogMeta.error.type, 'tchannel.connection-stale.timeout',
            'expected error to be stale timeout');
        cassert.equal(self.hostPorts.timeoutServer, connErrorLogMeta.remoteName,
            'expected conn error remote to be timeout server');
    }

    cassert.ok(connResetLogs.length <= 3,
        'expected only three unique connections to be reset');
    cassert.ok(seenGUIDs.length <= 3,
        'expected only three unique sockets to be closed at most');
    cassert.ok(connErrorLogs.length <= 3,
        'expected only three connection errors');

    return cassert;
};

TimeoutTestContext.prototype.checkErrorLogs =
function checkErrorLogs() {
    var self = this;

    var errorFrameLogs = self.cluster.logger
        .popLogs('forwarding expected error frame');
    var errorLogs = self.cluster.logger
        .popLogs('expected error while forwarding');
    var connErrorLogs = self.cluster.logger
        .popLogs('error while forwarding');

    var cassert = CollapsedAssert();

    cassert.ok(
        (
            errorLogs.length +
            errorFrameLogs.length +
            connErrorLogs.length
        ) >= self.errors.length,
        'Should get at least one log line per client error'
    );

    var j;
    var errorIds = {};
    var resultIds = {};
    var remoteAddr;

    for (var i = 0; i < self.errors.length; i++) {
        remoteAddr = self.errors[i].remoteAddr;
        if (!errorIds[remoteAddr]) {
            errorIds[remoteAddr] = [];
        }

        var id = self.errors[i].id || self.errors[i].originalId;
        errorIds[remoteAddr].push(id);
    }

    for (i = 0; i < self.results.length; i++) {
        remoteAddr = self.results[i].outReqHostPort;
        if (!resultIds[remoteAddr]) {
            resultIds[remoteAddr] = [];
        }

        resultIds[remoteAddr].push(self.results[i].responseId);
    }

    for (j = 0; j < errorFrameLogs.length; j++) {
        var frameLogLine = errorFrameLogs[j].meta;
        cassert.equal(
            frameLogLine.inRequestRemoteAddr, self.hostPorts.client,
            'error frame should fail from client'
        );

        if (frameLogLine.inRequestType === 'tchannel.incoming-request') {
            var ids = errorIds[frameLogLine.hostPort];
            cassert.ok(ids.indexOf(frameLogLine.inRequestId) > -1,
                'error frame log should be for request: ' + frameLogLine.inRequestId
            );
        }
    }

    for (j = 0; j < errorLogs.length; j++) {
        var errorLogLine = errorLogs[j].meta;
        cassert.equal(
            errorLogLine.inRequestRemoteAddr, self.hostPorts.client,
            'error log should fail from client'
        );

        if (errorLogLine.inRequestType === 'tchannel.incoming-request') {
            ids = errorIds[errorLogLine.hostPort];
            cassert.ok(ids.indexOf(errorLogLine.inRequestId) > -1,
                'error log should be for request: ' + errorLogLine.inRequestId
            );
        }
    }

    for (j = 0; j < connErrorLogs.length; j++) {
        var connErrorLogLine = connErrorLogs[j].meta;

        cassert.equal(
            connErrorLogLine.error.type,
            'tchannel.connection.reset',
            'expected error type to be connection reset'
        );
        cassert.equal(
            connErrorLogLine.error.fullType,
            'tchannel.connection.reset~!~tchannel.connection-stale.timeout',
            'expected error full type to be stale timeout'
        );
        cassert.equal(
            connErrorLogLine.inRequestRemoteAddr, self.hostPorts.client,
            'conn error log should fail from client'
        );

        if (connErrorLogLine.inRequestType === 'tchannel.incoming-request') {
            ids = errorIds[connErrorLogLine.hostPort];
            cassert.ok(ids.indexOf(connErrorLogLine.inRequestId) > -1,
                'conn error log should be for request: ' + connErrorLogLine.inRequestId
            );
        }
    }

    return cassert;
};

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
        relayToServer.setPreferConnectionDirection('out');
        relayToServer.handler = new RelayHandler(relayToServer);
    }
}

function setupServerEndpoints(cluster, timeoutContext) {
    var servers = cluster.channels.slice(4, 7);

    for (var i = 0; i < servers.length; i++) {
        var channel = servers[i];
        var subChan = channel.makeSubChannel({
            serviceName: 'server'
        });

        if (i === 1) {
            subChan.register('echo', timeout(i));
        } else {
            subChan.register('echo', echo(i));
        }
    }

    function echo(index) {
        return function echoHandler(req, res, arg2, arg3) {
            timeoutContext.updateServerCount(index);

            res.headers.as = 'raw';
            res.sendOk(arg2, arg3 + ' from ' + index);
        };
    }

    function timeout(index) {
        return function timeoutHandler(req) {
            timeoutContext.updateServerCount(index);

            req.connection.ops.popInReq(req.id);
            // do nothing to emulate time out
        };
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
