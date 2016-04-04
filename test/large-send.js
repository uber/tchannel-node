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

var allocCluster = require('./lib/alloc-cluster.js');

allocCluster.test('large arg3 on utf8 non-English characters', 2, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];

    var bigStr = '';
    for (var i = 0; i < 150000; i++) {
        bigStr += '正';
    }

    two = two.makeSubChannel({
        serviceName: 'server',
        peers: [one.hostPort]
    });

    one.makeSubChannel({
        serviceName: 'server'
    }).register('foo', function foo(req, res, arg2, arg3) {
        assert.ok(bigStr === arg3.toString(), 'send should work');
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3.toString());
    });

    two.request({
        serviceName: 'server',
        timeout: 1500,
        hasNoParent: true,
        headers: {
            cn: 'test',
            as: 'raw'
        }
    }).send('foo', '', bigStr, function onResp(err, res, arg2, arg3) {
        if (err) {
            assert.end(err);
        } else {
            assert.ok(bigStr === arg3.toString(), 'response should work');
            assert.end();
        }
    });
});
