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

var DebugLogtron = require('debug-logtron');
var test = require('tape');

var TChannel = require('../../channel.js');
var TChannelJSON = require('../../as/json');

var openTracing = require('opentracing');
var logger = DebugLogtron('tchannel');

test('basic json tracing test', function (assert) {

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
    var tchannelJSON = TChannelJSON();

    var context = {};

    tchannelJSON.register(server, 'echo', context, echo);
    function echo(context, req, head, body, callback) {
        callback(null, {
            ok: true,
            head: head,
            body: body
        });
    }

    server.listen(9999, '127.0.0.1', onListening);

    function onListening() {
        var clientChan = client.makeSubChannel({
            serviceName: 'server',
            peers: [server.hostPort]
        });
        tchannelJSON.send(clientChan.request({
            headers: {
                cn: 'client'
            },
            serviceName: 'server',
            hasNoParent: true
        }), 'echo', {
            head: 'object'
        }, {
            body: 'object'
        }, onResponse);

        function onResponse(err, resp) {
            if (err) {
                console.log('got error', err);
                assert.ifError("Should not receive an err", err)
            } else {
                assert.equal(resp.ok, true);
                console.log('got resp', resp);
            }
            assert.end();

            server.close();
            client.close();
        }
    }
});
