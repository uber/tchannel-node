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

var fs = require('fs');
var path = require('path');

var DebugLogtron = require('debug-logtron');
var test = require('tape');

var TChannel = require('../../channel.js');
var TChannelAsThrift = require('../../as/thrift');

var openTracing = require('opentracing');
var logger = DebugLogtron('tchannel');

test('basic thrift tracing test', function (assert) {

    var spans = [];

    var oTracer = openTracing;

    function traceReporter(span) {
        spans.push(span);
        logger.debug(span.toString());
    }

    var server = TChannel({
        serviceName: 'server',
        logger: logger,
        traceReporter: traceReporter,
        traceSample: 1,
        trace: true,
        openTracer: oTracer
    });
    var client = TChannel({
        logger: logger,
        traceReporter: traceReporter,
        traceSample: 1,
        trace: true,
        openTracer: oTracer
    });

    var echoChannel = client.makeSubChannel({
        serviceName: 'echo',
        peers: ['127.0.0.1:4040']
    });
    var thriftPath = path.join(__dirname, '../anechoic-chamber.thrift');
    var tchannelThrift = TChannelAsThrift({
        channel: echoChannel,
        entryPoint: thriftPath
    });


    var context = {};
    tchannelThrift.register(server, 'Chamber::echo', context, echo);
    function echo(context, req, head, body, callback) {
        callback(null, {
            ok: true,
            head: head,
            body: body.value
        });
    }

    server.listen(4040, '127.0.0.1', onListening);
    function onListening() {
        var outHead = {};
        tchannelThrift.send(echoChannel.request({
            serviceName: 'server',
            headers: {
                cn: 'echo'
            },
            hasNoParent: true
        }), 'Chamber::echo', outHead, {
            value: 10
        }, function onResponse(err, res) {
            if (err) {
                assert.ifError(err);
            } else {
                assert.ok(res.ok);
                assert.equal(res.headers.as, 'thrift');
                assert.notEqual(res.headers.as, 'echo');
                assert.equal(res.body, 10);
            }
            assert.end();

            server.close();
            client.close();

        });
    }
});