// Copyright (c) 2020 Uber Technologies, Inc.
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

var v2 = require('../v2/index.js');
var allocCluster = require('./lib/alloc-cluster.js');

var ReadResult = require('bufrw').ReadResult;

// Node.js deprecated Buffer in favor of Buffer.alloc and Buffer.from.
// istanbul ignore next
var bufferFrom = Buffer.from || Buffer;

var readRes = new ReadResult();

allocCluster.test('channel.handler: lazy call handling', 2, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];

    var client = one.makeSubChannel({
        serviceName: 'bob'
    });

    var server = two.makeSubChannel({
        serviceName: 'bob'
    });

    var clientPeer = client.peers.add(two.hostPort);
    clientPeer.waitForIdentified(onIdentified);

    server.setLazyHandling(true);
    server.handler.handleLazily = handleCallLazily;

    function handleCallLazily(conn, frame) {
        var res = frame.bodyRW.lazy.poolReadService(readRes, frame);
        if (res.err) {
            throw res.err;
        }
        assert.equal(res.value, 'bob', 'expected called service name');

        res = frame.bodyRW.lazy.poolReadArg1(readRes, frame);
        if (res.err) {
            throw res.err;
        }
        assert.deepEqual(res.value, bufferFrom('such'), 'expected called arg1');

        conn.handler.sendCallBodies(frame.id, new v2.CallResponse(
            0,                       // flags
            0,                       // code
            v2.Tracing.emptyTracing, // tracing
            {                        // headers
                'as': 'troll'        //
            },                       //
            v2.Checksum.Types.None,  // checksum
            ['', 'yeah', 'lol']      // args
        ), null, null, null);

        return true;
    }

    function onIdentified(err) {
        if (err) {
            assert.end(err);
            return;
        }

        client.request({
            serviceName: 'bob',
            hasNoParent: true,
            headers: {
                cn: 'bobClient',
                as: 'troll'
            }
        }).send('such', 'lols', '4u', onResponse);
    }

    function onResponse(err, res) {
        if (err) {
            assert.end(err);
            return;
        }

        assert.deepEqual(res.arg2, bufferFrom('yeah'), 'expected res arg2');
        assert.deepEqual(res.arg3, bufferFrom('lol'), 'expected res arg3');

        assert.end();
    }
});
