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
var allocCluster = require('./lib/alloc-cluster.js');

allocCluster.test('fragmented request times out', 2, function t(cluster, assert) {
    var client = setupClient(cluster);
    setupFragServer(cluster);

    var gotError = false;
    var gotResponse = false;

    client.waitForIdentified({
        host: cluster.channels[1].hostPort
    }, onIdentified);

    function onIdentified(err) {
        assert.ifError(err);

        var req = client.request({
            timeout: 100,
            hasNoParent: true,
            host: cluster.channels[1].hostPort
        });
        req.send('echo', '', '');
        req.errorEvent.on(onError);
        req.responseEvent.on(onResponse);

        setTimeout(onTimeout, 250);

        function onResponse(res) {
            gotResponse = res;
            assert.equal(res.flags, 0x01 | 0x02,
                'Expected streaming flag to be set');

            // Cleanup resources...
            delete req.handler.streamingRes[req.id];
        }
    }

    function onError(err) {
        gotError = err;
    }

    function onTimeout() {
        assert.ok(gotResponse, 'expected an rpc response');
        assert.ok(gotError, 'expected rpc to timeout');

        assert.end();
    }
});

allocCluster.test('streaming request does not time out', 2, function t(cluster, assert) {
    var client = setupClient(cluster);
    setupFragServer(cluster);

    var gotError = false;
    var gotResponse = false;

    client.waitForIdentified({
        host: cluster.channels[1].hostPort
    }, onIdentified);

    function onIdentified(err) {
        assert.ifError(err);

        var req = client.request({
            timeout: 100,
            streamed: true,
            hasNoParent: true,
            host: cluster.channels[1].hostPort
        });

        req.sendArg1('echo');
        req.arg2.end('');
        req.arg3.end('');

        req.errorEvent.on(onError);
        req.responseEvent.on(onResponse);

        setTimeout(onTimeout, 250);

        function onResponse(res) {
            gotResponse = res;
            assert.equal(res.flags, 0x01 | 0x02,
                'Expected streaming flag to be set');

            // Cleanup resources...
            delete req.handler.streamingRes[req.id];
        }
    }

    function onError(err) {
        gotError = err;
    }

    function onTimeout() {
        assert.ok(gotResponse, 'expected an rpc response');
        assert.ok(!gotError, 'expected rpc to NOT timeout');

        assert.end();
    }
});

function setupClient(cluster) {
    var client = cluster.channels[0];

    var subChan = client.makeSubChannel({
        serviceName: 'server',
        requestDefaults: {
            headers: {
                as: 'raw',
                cn: 'client'
            },
            serviceName: 'server'
        }
    });

    return subChan;
}

function setupFragServer(cluster, delay) {
    var server = cluster.channels[1];

    var subServe = server.makeSubChannel({
        serviceName: 'server'
    });

    subServe.handler = {
        handleRequest: handleRequest
    };

    function handleRequest(req, buildResponse) {
        req.connection.ops.popInReq(req.id);

        var res = buildResponse({
            streamed: true
        });

        res.headers.as = 'raw';
        res.arg2.end('');
        res.arg3.write('hello');
        // Never call res.arg3.end()
        // Example buggy server
    }
}
