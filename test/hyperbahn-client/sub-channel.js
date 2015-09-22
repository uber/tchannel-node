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

var test = require('tape');

var TChannel = require('../../');
var HyperbahnClient = require('../../hyperbahn/index.js');

test('getting client subChannel without serviceName', function t(assert) {
    var client = HyperbahnClient({
        tchannel: TChannel(),
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });

    assert.throws(function throwIt() {
        client.getClientChannel();
    }, /must pass serviceName/);

    assert.throws(function throwIt() {
        client.getClientChannel({});
    }, /must pass serviceName/);

    client.tchannel.close();
    assert.end();
});

test('getting a client subChannel', function t(assert) {
    var client = HyperbahnClient({
        tchannel: TChannel(),
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });

    var subChannel = client.getClientChannel({
        serviceName: 'bar'
    });

    assert.equal(subChannel.topChannel, client.tchannel);

    client.tchannel.close();
    assert.end();
});

test('double getting a client subChannel', function t(assert) {
    var channel = TChannel();
    var client = HyperbahnClient({
        tchannel: channel,
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });

    client.getClientChannel({
        serviceName: 'bar'
    });

    assert.throws(function throwIt() {
        client.getClientChannel({
            serviceName: 'bar'
        });
    });

    channel.makeSubChannel({
        serviceName: 'lul'
    });

    assert.throws(function throwIt() {
        client.getClientChannel({
            serviceName: 'lul'
        });
    });

    channel.close();
    assert.end();
});

test('calling self with two sub channels', function t(assert) {
    function ChannelApp() {
        if (!(this instanceof ChannelApp)) {
            return new ChannelApp();
        }

        var self = this;

        self.channel = TChannel();
        self.serverChan = self.channel.makeSubChannel({
            serviceName: 'my-app'
        });
        self.hyperbahn = HyperbahnClient({
            tchannel: self.channel,
            serviceName: 'my-app',
            callerName: 'my-app',
            hostPortList: []
        });

        self.clientChan = self.hyperbahn.getClientChannel({
            serviceName: 'my-app',
            channelName: 'my-app-client'
        });
    }

    ChannelApp.prototype.start = function start(onListen) {
        var self = this;

        self.channel.listen(0, '127.0.0.1', onListen);
    };

    ChannelApp.prototype.close = function close() {
        var self = this;

        self.channel.close();
    };

    var a = ChannelApp();
    var b = ChannelApp();
    var count = 2;

    a.start(onStarted);
    b.start(onStarted);

    function onStarted() {
        if (--count === 0) {
            runRequests();
        }
    }

    function runRequests() {
        a.serverChan.register('echo', function echo(req, res, arg2, arg3) {
            res.headers.as = 'raw';
            res.sendOk(arg2, arg3);
        });

        b.clientChan.peers.add(a.channel.hostPort);

        b.clientChan.request({
            hasNoParent: true,
            headers: {
                as: 'raw'
            }
        }).send('echo', 'a', 'b', onResponse);

        function onResponse(err, resp, arg2, arg3) {
            assert.ifError(err);

            assert.ok(resp.ok);
            assert.equal(arg2.toString(), 'a');
            assert.equal(arg3.toString(), 'b');

            a.close();
            b.close();

            assert.end();
        }
    }
});
