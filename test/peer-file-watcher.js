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

var os = require('os');
var fs = require('fs');
var path = require('path');
var setTimeout = require('timers').setTimeout;
var setImmediate = require('timers').setImmediate;

var allocCluster = require('./lib/alloc-cluster');

allocCluster.test('make p2p requests', {
    numPeers: 5
}, function t(cluster, assert) {
    setup(cluster);

    fs.writeFileSync(
        '/tmp/p2p-hosts.json',
        JSON.stringify(cluster.serverHosts), 'utf8'
    );

    var chan = cluster.client.makeSubChannel({
        serviceName: 'server',
        peerFile: '/tmp/p2p-hosts.json'
    });

    sendRequests(chan, 100, onResponse);
    function onResponse(err, resps) {
        assert.ifError(err);

        var table = {};
        for (var i = 0; i < resps.length; i++) {
            var addr = resps[i].remoteAddr;

            if (table[addr] === undefined) {
                table[addr] = 1;
            } else {
                table[addr]++;
            }
        }

        for (i = 0; i < cluster.serverHosts.length; i++) {
            assert.equal(table[cluster.serverHosts[i]], 25,
                'expected 25 requests to each downstream');
        }

        fs.unlinkSync('/tmp/p2p-hosts.json');
        assert.end();
    }
});

allocCluster.test('changing the peer list', {
    numPeers: 7
}, function t(cluster, assert) {
    setup(cluster);

    cluster.logger.whitelist('info', 'ChannelWatcher: Removing old peer');
    cluster.logger.whitelist('info', 'draining peer');

    var firstPeers = [];
    var secondPeers = [];

    for (var i = 0; i < 4; i++) {
        firstPeers[i] = cluster.serverHosts[i];
        secondPeers[i] = cluster.serverHosts[i + 2];
    }

    fs.writeFileSync(
        '/tmp/p2p-hosts.json',
        JSON.stringify(firstPeers), 'utf8'
    );

    var chan = cluster.client.makeSubChannel({
        serviceName: 'server',
        peerFile: '/tmp/p2p-hosts.json',
        refreshInterval: 500,
        minConnections: 4
    });

    sendRequests(chan, 100, onResponse);

    function onResponse(err, resps) {
        assert.ifError(err);

        var table = collectResponses(resps);

        for (i = 0; i < firstPeers.length; i++) {
            assert.equal(table[firstPeers[i]], 25,
                'expected 25 requests to each of first peers');
        }

        fs.writeFileSync(
            '/tmp/p2p-hosts.json',
            JSON.stringify(secondPeers), 'utf8'
        );

        setTimeout(delay, 700);
    }

    function delay() {
        rollingSendRequsets(chan, 100, onResponse2);
    }

    function onResponse2(err, resps) {
        assert.ifError(err);

        var table = collectResponses(resps);
        var total = 0;

        for (i = 0; i < secondPeers.length; i++) {
            var count = table[secondPeers[i]];
            assert.ok(
                count > 12.5 && count < 37.5,
                'expected between 12.5 & 37.5 requests (' + count +
                ') to each of second peers'
            );

            total += table[secondPeers[i]];
        }

        assert.equal(total, 100, 'expected 100 reqs to 4 hosts');

        fs.unlinkSync('/tmp/p2p-hosts.json');
        assert.end();
    }
});

function collectResponses(resps) {
    var table = {};

    for (var i = 0; i < resps.length; i++) {
        var addr = resps[i].remoteAddr;

        if (table[addr] === undefined) {
            table[addr] = 1;
        } else {
            table[addr]++;
        }
    }

    return table;
}

allocCluster.test('add a peer and request', {
    numPeers: 5
}, function t(cluster, assert) {
    setup(cluster);

    var hostsfilePath = path.join(os.tmpdir(), 'channel-watch-test.json');
    fs.writeFileSync(hostsfilePath, JSON.stringify([]));

    var chan = cluster.client.makeSubChannel({
        serviceName: 'server',
        peerFile: hostsfilePath,
        refreshInterval: 500,
        requestDefaults: {
            headers: {
                cn: 'client',
                as: 'raw'
            }
        }
    });

    chan.request({
        serviceName: 'server',
        hasNoParent: true
    }).send('echo', 'a', 'b', onResponse);

    function onResponse(err) {
        assert.ok(err, 'expect request error');
        assert.equal(err.type, 'tchannel.no-peer-available',
            'expected no peer available');

        fs.writeFileSync(hostsfilePath, JSON.stringify([cluster.hosts[1]]));

        // wait for watch to reload the file
        setTimeout(function onDelay() {
            chan.request({
                serviceName: 'server',
                hasNoParent: true
            }).send('echo', 'a', 'b', onResponse2);
        }, 700);
    }

    function onResponse2(err, res, arg2, arg3) {
        assert.ifError(err, 'request with peer should not fail');
        assert.equal(res.ok, true, 'response should be ok');
        assert.equal(String(arg2), 'a', 'arg2 should be correct');
        assert.equal(String(arg3), 'b server by 1',
            'arg3 should be correct');
        assert.end();
    }
});

allocCluster.test('duplicate host entry', {
    numPeers: 2
}, function t(cluster, assert) {
    setup(cluster);

    var hostsfilePath = path.join(os.tmpdir(), 'channel-watch-test.json');
    fs.writeFileSync(hostsfilePath, JSON.stringify([
        cluster.hosts[1],
        cluster.hosts[1]
    ]));

    var chan = cluster.client.makeSubChannel({
        serviceName: 'server',
        peerFile: hostsfilePath,
        refreshInterval: 500,
        requestDefaults: {
            headers: {
                cn: 'client',
                as: 'raw'
            }
        }
    });

    chan.request({
        serviceName: 'server',
        hasNoParent: true
    }).send('echo', 'a', 'b', onResponse);

    function onResponse(err, res) {
        assert.ifError(err, 'request with peer should not fail');
        assert.equal(res.ok, true, 'response should be ok');

        assert.equal(chan.peers.keys().length, 1,
            'steve should only have one peer');

        assert.end();
    }
});

allocCluster.test('remove a peer and request', {
    numPeers: 2
}, function t(cluster, assert) {
    setup(cluster);

    cluster.logger.whitelist('info', 'ChannelWatcher: Removing old peer');
    cluster.logger.whitelist('info', 'draining peer');

    var hostsfilePath = path.join(os.tmpdir(), 'channel-watch-test.json');
    fs.writeFileSync(hostsfilePath, JSON.stringify([cluster.hosts[1]]));

    var chan = cluster.client.makeSubChannel({
        serviceName: 'server',
        peerFile: hostsfilePath,
        refreshInterval: 500,
        requestDefaults: {
            headers: {
                cn: 'client',
                as: 'raw'
            }
        }
    });

    chan.request({
        serviceName: 'server',
        hasNoParent: true
    }).send('echo', 'a', 'b', onResponse);

    function onResponse(err, res, arg2, arg3) {
        assert.ifError(err, 'request with peer should not fail');
        assert.equal(res.ok, true, 'response should be ok');
        assert.equal(String(arg2), 'a', 'arg2 should be correct');
        assert.equal(String(arg3), 'b server by 1', 'arg3 should be correct');

        fs.writeFileSync(hostsfilePath, JSON.stringify([]));

        // wait for watch to reload the file
        setTimeout(function onDelay() {
            chan.request({
                serviceName: 'steve',
                hasNoParent: true
            }).send('echo', 'a', 'b', onResponse2);
        }, 700);
    }

    function onResponse2(err) {
        assert.ok(err, 'expect request error');
        assert.equal(err.type, 'tchannel.no-peer-available',
            'expected no peer available');

        assert.end();
    }
});

function sendRequests(channel, count, cb) {
    var responses = [];

    for (var i = 0; i < count; i++) {
        channel.request({
            serviceName: 'server',
            hasNoParent: true,
            timeout: 500,
            headers: {
                cn: 'client',
                as: 'raw'
            }
        }).send('echo', 'a', 'body', onResponse);
    }

    function onResponse(err, resp) {
        if (err) {
            if (cb !== null) {
                cb(err);
                cb = null;
            }
            return;
        }

        responses.push(resp);
        if (responses.length === count) {
            cb(null, responses);
        }
    }
}

function rollingSendRequsets(channel, count, cb) {
    var responses = [];

    var index = 0;

    setImmediate(fireOnce);

    function fireOnce() {
        channel.request({
            serviceName: 'server',
            hasNoParent: true,
            timeout: 500,
            headers: {
                cn: 'client',
                as: 'raw'
            }
        }).send('echo', 'a', 'body', onResponse);

        index++;

        if (index < count) {
            setImmediate(fireOnce);
        }
    }

    function onResponse(err, resp) {
        if (err) {
            if (cb !== null) {
                cb(err);
                cb = null;
            }
            return;
        }

        responses.push(resp);
        if (responses.length === count) {
            cb(null, responses);
        }
    }
}

function setup(cluster) {
    cluster.logger.whitelist(
        'info', 'ChannelWatcher: Loading peer list from file sync'
    );
    cluster.logger.whitelist(
        'info', 'ChannelWatcher: Loaded peers'
    );
    cluster.logger.whitelist(
        'info', 'ChannelWatcher: Loading peer list from file async'
    );

    cluster.client = cluster.channels[0];

    cluster.servers = cluster.channels.slice(1);
    cluster.serverHosts = [];

    for (var i = 0; i < cluster.servers.length; i++) {
        cluster.serverHosts.push(cluster.servers[i].hostPort);
        makeServer(cluster.servers[i], i);
    }
}

function makeServer(channel, index) {
    var chanNum = index + 1;

    var serverChan = channel.makeSubChannel({
        serviceName: 'server'
    });

    serverChan.register('echo', function echo(req, res, head, body) {
        res.headers.as = 'raw';
        res.sendOk(head, body + ' server by ' + chanNum);
    });
}
