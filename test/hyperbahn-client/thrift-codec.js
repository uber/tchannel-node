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

var test = require('tape');
var path = require('path');

var TChannel = require('../../');
var HyperbahnClient = require('../../hyperbahn/index.js');

test('calling getThrift', function t(assert) {
    var hypeClient = makeHyperbahnClient();
    var hypeServer = makeHyperbahnClient();

    var thriftClient = hypeClient.getThriftSync({
        serviceName: 'foo',
        thriftFile: path.join(__dirname, '..', 'anechoic-chamber.thrift')
    });
    var thriftServer = hypeServer.getThriftSync({
        serviceName: 'foo',
        thriftFile: path.join(__dirname, '..', 'anechoic-chamber.thrift')
    });

    assert.equal(
        thriftClient.spec.getSources().entryPoint,
        thriftServer.spec.getSources().entryPoint,
        'client and server have the same entrypoint'
    );

    thriftServer.register('Chamber::echo', {}, echo);

    var counter = 2;
    hypeClient.tchannel.listen(0, '127.0.0.1', onListen);
    hypeServer.tchannel.listen(0, '127.0.0.1', onListen);

    function onListen() {
        if (--counter === 0) {
            sendRequests();
        }
    }

    function sendRequests() {
        thriftClient.channel.peers.add(hypeServer.tchannel.hostPort);

        thriftClient.request({
            hasNoParent: true
        }).send('Chamber::echo', null, {
            value: 10
        }, function onResponse(err, resp) {
            assert.ifError(err, 'request() has no error');

            assert.ok(resp, 'request() has response');
            assert.equal(resp.ok, true, 'response is ok');
            assert.equal(resp.body, 10, 'response body is 10');

            hypeClient.tchannel.close();
            hypeServer.tchannel.close();
            assert.end();
        });
    }

    function echo(context, req, arg2, arg3, cb) {
        cb(null, {
            ok: true,
            body: arg3.value
        });
    }
});

function makeHyperbahnClient() {
    var channel = TChannel();

    return HyperbahnClient({
        tchannel: channel,
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });
}
