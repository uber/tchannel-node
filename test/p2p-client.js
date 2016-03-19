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

var path = require('path');

var allocCluster = require('./lib/alloc-cluster.js');
var PeerToPeerClient = require('../p2p-client.js');
var HyperbahnClient = require('../hyperbahn-client.js');

var THRIFT_FILE = path.join(__dirname, 'anechoic-chamber.thrift');

allocCluster.test('Making a thrift request', {
    numPeers: 2
}, function t(cluster, assert) {
    setupPair(cluster);

    var clientThrift = cluster.client.getThriftSync({
        serviceName: 'server',
        thriftFile: THRIFT_FILE,
        hostList: [cluster.channels[1].hostPort]
    });
    assert.ok(clientThrift, 'expected to be able to make a thrift');

    clientThrift.request({
        hasNoParent: true
    }).send('Chamber::echo', null, {
        value: 10
    }, function onResponse(err, resp) {
        assert.ifError(err, 'request() has no error');

        assert.ok(resp, 'request() has response');
        assert.equal(resp.ok, true, 'response is ok');
        assert.equal(resp.body, 10, 'response body is 10');

        cluster.destroy();
        assert.end();
    });
});

function setupPair(cluster) {
    cluster.logger.whitelist(
        'info', 'HyperbahnClient advertisement timeout disabled'
    );

    var clientChannel = cluster.channels[0];
    var clientHype = HyperbahnClient({
        tchannel: clientChannel,
        serviceName: 'client',
        callerName: 'client',
        hostPortList: []
    });
    var serverChannel = cluster.channels[1];
    var serverHype = HyperbahnClient({
        tchannel: serverChannel,
        serviceName: 'server',
        callerName: 'server',
        hostPortList: []
    });

    cluster.client = new PeerToPeerClient({
        tchannel: clientChannel,
        callerName: 'client',
        hyperbahnClient: clientHype
    });
    cluster.server = new PeerToPeerClient({
        tchannel: serverChannel,
        callerName: 'server',
        hyperbahnClient: serverHype
    });

    var _destroy = cluster.destroy;
    cluster.destroy = destroy;

    var serverChan = serverChannel.makeSubChannel({
        serviceName: 'server'
    });
    var serverThrift = serverChan.TChannelAsThrift({
        entryPoint: THRIFT_FILE,
        channel: serverChan
    });
    serverThrift.register('Chamber::echo', {}, echo);

    return cluster;

    function destroy() {
        _destroy();

        clientHype.destroy();
        serverHype.destroy();
    }

    function echo(context, req, arg2, arg3, cb) {
        cb(null, {
            ok: true,
            body: arg3.value
        });
    }
}
