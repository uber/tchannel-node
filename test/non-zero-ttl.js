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

var Buffer = require('buffer').Buffer;
var process = require('process');
var setTimeout = require('timers').setTimeout;

var allocCluster = require('./lib/alloc-cluster.js');
var RelayHandler = require('../relay_handler');

allocCluster.test('request() with zero timeout (client)', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    cluster.logger.whitelist('info', 'resetting connection');

    warmUpConnection(cluster, onIdentified);

    function onIdentified(err, conn) {
        assert.ifError(err);

        var req = buildRequest(conn, 0);
        req.send('echo', '', '', onResponse);
    }

    function onResponse(err, resp) {
        assert.ok(err);
        assert.equal(err.type, 'tchannel.connection.reset');
        assert.equal(err.message,
            'tchannel: tchannel write failure: Got an invalid ' +
                'ttl. Expected positive ttl but got 0'
        );

        assert.equal(resp, null);

        process.nextTick(checkLog);
    }

    function checkLog() {
        assert.equal(cluster.logger.items().length, 1);
        var logLine = cluster.logger.items()[0];
        assert.equal(logLine && logLine.levelName, 'info');
        assert.equal(logLine && logLine.meta.error.type,
            'tchannel.protocol.write-failed');

        assert.equal(logLine && logLine.meta.hostPort, client.hostPort,
            'error occurred on the client');

        assert.end();
    }
});

allocCluster.test('request() with negative timeout (client)', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'resetting connection');

    warmUpConnection(cluster, onIdentified);

    function onIdentified(err, conn) {
        assert.ifError(err);

        var req = buildRequest(conn, -10);
        req.send('echo', '', '', onResponse);
    }

    function onResponse(err, resp) {
        assert.ok(err);
        assert.equal(err.type, 'tchannel.connection.reset');
        assert.equal(err.message,
            'tchannel: tchannel write failure: Got an invalid ' +
                'ttl. Expected positive ttl but got -10'
        );

        assert.equal(resp, null);

        process.nextTick(checkLog);
    }

    function checkLog() {
        assert.equal(cluster.logger.items().length, 1);
        var logLine = cluster.logger.items()[0];
        assert.equal(logLine && logLine.levelName, 'info');
        assert.equal(logLine && logLine.meta.error.type,
            'tchannel.protocol.write-failed');

        assert.end();
    }
});

allocCluster.test('request() with zero timeout (server)', {
    numPeers: 2
}, function t(cluster, assert) {
    var client = cluster.channels[0];
    var server = cluster.channels[1];

    cluster.logger.whitelist('info', 'resetting connection');
    cluster.logger.whitelist('warn', 'got errorframe without call request');

    warmUpConnection(cluster, onIdentified);

    function onIdentified(err, conn) {
        assert.ifError(err);

        sendCallRequestFrame(conn, 0);
        setTimeout(checkLog, 50);
    }

    function checkLog() {
        assert.equal(cluster.logger.items().length, 2);

        var serverLine = cluster.logger.items()[0];
        assert.equal(serverLine && serverLine.levelName, 'info');
        assert.equal(serverLine && serverLine.msg, 'resetting connection');
        assert.equal(serverLine && serverLine.meta.error.type,
            'tchannel.protocol.read-failed');
        assert.ok(serverLine && serverLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );
        assert.equal(serverLine && serverLine.meta.hostPort, server.hostPort,
            'error occurred on the server');
        assert.equal(serverLine && serverLine.meta.remoteName, client.hostPort,
            'invalid frame came from the client');

        var clientLine = cluster.logger.items()[1];

        assert.equal(clientLine && clientLine.levelName, 'warn',
            'clientLine should be warning');
        assert.equal(clientLine && clientLine.msg,
            'got errorframe without call request',
            'clientLine message should be errorframe without call req');
        assert.equal(clientLine && clientLine.meta.error.type,
            'tchannel.protocol');
        assert.ok(clientLine && clientLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );
        assert.equal(clientLine && clientLine.meta.hostPort, client.hostPort,
            'error occurred on the server');
        assert.equal(clientLine && clientLine.meta.remoteName, server.hostPort,
            'invalid frame came from the client');

        var cpeers = client.peers.values();
        var speers = server.peers.values();

        assert.equal(cpeers.length, 1, 'client has one peer');
        assert.equal(speers.length, 1, 'server has one peer');

        var cconns = cpeers[0].connections;
        var sconns = speers[0].connections;

        assert.equal(cconns.length, 0, 'client has zero connections');
        assert.equal(sconns.length, 0, 'server has zero connections');

        assert.end();
    }
});

allocCluster.test('request() with zero ttl through eager relay (server)', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'resetting connection');
    cluster.logger.whitelist('warn', 'got errorframe without call request');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];
    var server = cluster.channels[2];

    relay.setLazyHandling(false);
    relay.setLazyRelaying(false);

    var relayToServer = relay.makeSubChannel({
        serviceName: 'server',
        peers: [server.hostPort]
    });
    relayToServer.handler = new RelayHandler(relayToServer);

    warmUpConnection(cluster, onIdentified);

    function onIdentified(err, conn) {
        assert.ifError(err);

        sendCallRequestFrame(conn, 0);
        setTimeout(checkLog, 50);
    }

    function checkLog() {
        assert.equal(cluster.logger.items().length, 2);

        var relayLine = cluster.logger.items()[0];
        assert.equal(relayLine && relayLine.levelName, 'info');
        assert.equal(relayLine && relayLine.msg, 'resetting connection');
        assert.equal(relayLine && relayLine.meta.error.type,
            'tchannel.protocol.read-failed');
        assert.ok(relayLine && relayLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );
        assert.equal(relayLine && relayLine.meta.hostPort, relay.hostPort,
            'error occurred on the relay');
        assert.equal(relayLine && relayLine.meta.remoteName, client.hostPort,
            'invalid frame came from the client');

        var clientLine = cluster.logger.items()[1];

        assert.equal(clientLine && clientLine.levelName, 'warn');
        assert.equal(clientLine && clientLine.msg,
            'got errorframe without call request');
        assert.equal(clientLine && clientLine.meta.error.type,
            'tchannel.protocol');
        assert.ok(clientLine && clientLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );
        assert.equal(clientLine && clientLine.meta.hostPort, client.hostPort,
            'error occurred on the server');
        assert.equal(clientLine && clientLine.meta.remoteName, relay.hostPort,
            'invalid frame came from the client');

        assert.end();
    }
});

allocCluster.test('request() with zero ttl through lazy relay (server)', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'resetting connection');
    cluster.logger.whitelist('warn', 'error while forwarding');
    cluster.logger.whitelist('warn', 'got errorframe without call request');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];
    var server = cluster.channels[2];

    relay.setLazyHandling(true);
    relay.setLazyRelaying(true);

    var relayToServer = relay.makeSubChannel({
        serviceName: 'server',
        peers: [server.hostPort]
    });
    relayToServer.handler = new RelayHandler(relayToServer);

    warmUpConnection(cluster, onIdentified);

    function onIdentified(err, conn) {
        assert.ifError(err);

        sendCallRequestFrame(conn, 0);
        setTimeout(checkLog, 50);
    }

    function checkLog() {
        assert.equal(cluster.logger.items().length, 3);

        var relayLine = cluster.logger.items()[0];
        assert.equal(relayLine && relayLine.levelName, 'warn');
        assert.equal(relayLine && relayLine.msg, 'error while forwarding');
        assert.equal(relayLine && relayLine.meta.error.type,
            'tchannel.protocol.invalid-ttl');
        assert.ok(relayLine && relayLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );

        assert.equal(relayLine && relayLine.meta.hostPort, relay.hostPort,
            'error occurred on the relay');
        assert.equal(relayLine && relayLine.meta.remoteName, client.hostPort,
            'invalid frame came from the client');

        var clientLine = cluster.logger.items()[2];

        assert.equal(clientLine && clientLine.levelName, 'warn');
        assert.equal(clientLine && clientLine.msg,
            'got errorframe without call request');
        assert.equal(clientLine && clientLine.meta.error.type,
            'tchannel.protocol');
        assert.ok(clientLine && clientLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );
        assert.equal(clientLine && clientLine.meta.hostPort, client.hostPort,
            'error occurred on the server');
        assert.equal(clientLine && clientLine.meta.remoteName, relay.hostPort,
            'invalid frame came from the client');

        var connLine = cluster.logger.items()[1];
        assert.equal(connLine && connLine.levelName, 'info');
        assert.equal(connLine && connLine.msg, 'resetting connection');
        assert.equal(connLine && connLine.meta.error.type,
            'tchannel.protocol.invalid-ttl');
        assert.ok(connLine && connLine.meta.error.message.indexOf(
            'Expected positive ttl but got 0') > -1,
            'expected log line to complain about non-positive ttl'
        );
        assert.equal(connLine && connLine.meta.hostPort, relay.hostPort,
            'error occurred on the relay');
        assert.equal(connLine && connLine.meta.remoteName, client.hostPort,
            'invalid frame came from the client');

        assert.end();
    }
});

function warmUpConnection(cluster, cb) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];

    var clientChan = one.makeSubChannel({
        serviceName: 'server'
    });

    clientChan.waitForIdentified({
        host: two.hostPort
    }, function onIdentified(err) {
        if (err) {
            return cb(err);
        }

        var peer = clientChan.peers.get(two.hostPort);
        var conn = peer.getIdentifiedOutConnection();

        cb(null, conn);
    });
}

function buildRequest(conn, ttl) {
    var peer = conn.channel.peers.get(conn.socketRemoteAddr);

    var req = conn.buildOutRequest({
        channel: conn.channel,
        peer: peer,
        remoteAddr: conn.remoteName,
        timeout: ttl,
        tracer: conn.tracer,
        serviceName: 'server',
        host: conn.socketRemoteAddr,
        hasNoParent: true,
        checksumType: null,
        timers: conn.channel.timers,
        headers: {
            as: 'raw',
            cn: 'wat'
        }
    });
    conn.ops.addOutReq(req);

    return req;
}

function sendCallRequestFrame(conn, ttl, onWrite) {
    /* eslint no-inline-comments: 0*/

    var callFrameBytes = [
        0x00, 0x00,             // length:2
        0x03,                   // type:1
        0x00,                   // reserved
        0x00, 0x00, 0x00, 0x03, // id:4
        0x00, 0x00, 0x00, 0x00, // reserved:8
        0x00, 0x00, 0x00, 0x00, // ...

        0x00,                   // flags:1
        ttl >>> 24 & 0xff,      // ttl:4
        ttl >>> 16 & 0xff,      // ...
        ttl >>> 8 & 0xff,       // ...
        ttl & 0xff,             // ...
        0x00, 0x01, 0x02, 0x03, // tracing:24
        0x04, 0x05, 0x06, 0x07, // ...
        0x08, 0x09, 0x0a, 0x0b, // ...
        0x0c, 0x0d, 0x0e, 0x0f, // ...
        0x10, 0x11, 0x12, 0x13, // ...
        0x14, 0x15, 0x16, 0x17, // ...
        0x18,                   // traceflags:1
        0x06,                   // service~1
        0x73, 0x65, 0x72, 0x76, // ...
        0x65, 0x72,             // ...
        0x00,                   // nh:1
        0x02,  // csumtype:1
        0x8e, 0x09, 0xa1, 0xbd, // (csum:4){0,1}
        0x00, 0x02, 0x6f, 0x6e, // arg1~2
        0x00, 0x02, 0x74, 0x6f, // arg2~2
        0x00, 0x02, 0x74, 0x65  // arg3~2
    ];

    // Assign length of frame
    callFrameBytes[1] = callFrameBytes.length;

    var buffer = new Buffer(callFrameBytes);
    conn.socket.write(buffer, onWrite);
}
