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

var allocCluster = require('./lib/alloc-cluster');
var RelayHandler = require('../relay_handler');

allocCluster.test('relay will clamp ttl to 2 minutes', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('warn', 'Clamping timeout to maximum ttl allowed');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];
    var server = cluster.channels[2];

    var subClient = client.makeSubChannel({
        serviceName: 'server',
        peers: [relay.hostPort],
        requestDefaults: {
            hasNoParent: true,
            headers: {
                as: 'raw',
                cn: 'client'
            }
        }
    });
    var subServer = server.makeSubChannel({
        serviceName: 'server'
    });
    var subRelay = relay.makeSubChannel({
        serviceName: 'server',
        peers: [server.hostPort]
    });
    subRelay.handler = new RelayHandler(subRelay);

    subServer.register('echo', echo);

    subClient.request({
        serviceName: 'server',
        timeout: 5 * 60 * 1000
    }).send('echo', 'a', 'b', onResponse);

    function echo(req, res, arg2, arg3) {
        assert.equal(req.timeout, 2 * 60 * 1000);

        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    }

    function onResponse(err, resp) {
        assert.ifError(err);

        assert.equal(resp.ok, true);

        var items = cluster.logger.items();
        assert.equal(items.length, 1);

        var logLine = items[0];
        assert.equal(logLine.levelName, 'warn');
        assert.equal(logLine.msg, 'Clamping timeout to maximum ttl allowed');

        assert.equal(logLine.meta.maximumTTL, 2 * 60 * 1000);
        assert.ok(logLine.meta.timeout > 2 * 60 * 1000);

        assert.end();
    }
});
