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

var parallel = require('run-parallel');

var allocCluster = require('./lib/alloc-cluster');

allocCluster.test('add a peer and request', {
    numPeers: 2
}, function t(cluster, assert) {
    var steve = cluster.channels[0];
    var bob = cluster.channels[1];

    var hostsfilePath = path.join(os.tmpdir(), 'channel-watch-test.json');
    fs.writeFileSync(hostsfilePath, JSON.stringify([]));

    setupEcho(steve, 'steve');
    bob = bob.makeSubChannel({
        serviceName: 'steve',
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        },
        filePath: hostsfilePath
    });

    bob.request({
        serviceName: 'steve',
        hasNoParent: true
    }).send('echo', 'a', 'b', onResponse);

    function onResponse(err) {
        assert.ok(err, 'expect request error');
        assert.equal(err.type, 'tchannel.no-peer-available',
            'expected no peer available');

        fs.writeFileSync(hostsfilePath, JSON.stringify([cluster.hosts[0]]));
        // wait for watch to reload the file
        setTimeout(function() {
            bob.request({
                serviceName: 'steve',
                hasNoParent: true
            }).send('echo', 'a', 'b', onResponse2);
        }, 6000);
    }

    function onResponse2(err, res, arg2, arg3) {
        assert.ifError(err, 'request with peer should not fail');
        assert.equal(res.ok, true, 'response should be ok');
        assert.equal(String(arg2), 'a', 'arg2 should be correct');
        assert.equal(String(arg3), 'b', 'arg3 should be correct');

        assert.end();
    }
});

allocCluster.test('duplicate host entry', {
    numPeers: 2
}, function t(cluster, assert) {
    var steve = cluster.channels[0];
    var bob = cluster.channels[1];

    var hostsfilePath = path.join(os.tmpdir(), 'channel-watch-test.json');
    fs.writeFileSync(hostsfilePath, JSON.stringify([cluster.hosts[0], cluster.hosts[0]]));

    setupEcho(steve, 'steve');
    bob = bob.makeSubChannel({
        serviceName: 'steve',
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        },
        filePath: hostsfilePath
    });

    bob.request({
        serviceName: 'steve',
        hasNoParent: true
    }).send('echo', 'a', 'b', onResponse2);

    function onResponse2(err, res) {
        assert.ifError(err, 'request with peer should not fail');
        assert.equal(res.ok, true, 'response should be ok');

        assert.equal(steve.peers.keys().length, 1,
            'steve should only have one peer');

        assert.end();
    }
});

allocCluster.test('remove a peer and request', {
    numPeers: 2
}, function t(cluster, assert) {
    var steve = cluster.channels[0];
    var bob = cluster.channels[1];

    var hostsfilePath = path.join(os.tmpdir(), 'channel-watch-test.json');
    fs.writeFileSync(hostsfilePath, JSON.stringify([cluster.hosts[0]]));

    setupEcho(steve, 'steve');
    bob = bob.makeSubChannel({
        serviceName: 'steve',
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        },
        filePath: hostsfilePath
    });

    bob.request({
        serviceName: 'steve',
        hasNoParent: true
    }).send('echo', 'a', 'b', onResponse);

    function onResponse(err, res, arg2, arg3) {
        assert.ifError(err, 'request with peer should not fail');
        assert.equal(res.ok, true, 'response should be ok');
        assert.equal(String(arg2), 'a', 'arg2 should be correct');
        assert.equal(String(arg3), 'b', 'arg3 should be correct');

        fs.writeFileSync(hostsfilePath, JSON.stringify([]));
        // wait for watch to reload the file
        setTimeout(function() {
            bob.request({
                serviceName: 'steve',
                hasNoParent: true
            }).send('echo', 'a', 'b', onResponse2);
        }, 6000);
    }

    function onResponse2(err) {
        assert.ok(err, 'expect request error');
        assert.equal(err.type, 'tchannel.no-peer-available',
            'expected no peer available');

        assert.end();
    }
});

function setupEcho(channel, serviceName) {
    var c = channel.makeSubChannel({
        serviceName: serviceName
    });
    c.register('echo', function echo(req, res, arg2, arg3) {
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    });
}
