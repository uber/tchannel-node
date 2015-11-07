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

var BatchClient = require('./lib/batch-client');
var allocCluster = require('./lib/alloc-cluster');
var RelayHandler = require('../relay_handler');
var CollapsedAssert = require('./lib/collapsed-assert');

allocCluster.test('sending a 1000 requests', {
    numPeers: 3
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'expected error while forwarding');
    cluster.logger.whitelist('info', 'forwarding expected error frame');

    // cluster.logger.whitelist('info', 'popOutReq received for unknown or lost id');
    // cluster.logger.whitelist('info', 'ignoring outresponse.sendError on a closed connection');

    var client = cluster.channels[0];
    var relay = cluster.channels[1];
    var server = cluster.channels[2];

    var subServer = server.makeSubChannel({
        serviceName: 'server'
    });
    var subRelay = relay.makeSubChannel({
        serviceName: 'server',
        peers: [server.hostPort]
    });
    subRelay.handler = new RelayHandler(subRelay);

    subServer.register('bleed', noop);

    var batchClient = BatchClient(client, [relay.hostPort], {
        totalRequests: 1000,
        batchSize: 50,
        delay: 50,
        endpoint: 'bleed'
    });

    batchClient.sendRequests(onResults);

    function onResults(err, data) {
        assert.ifError(err);

        assert.equal(data.errors.length + data.results.length, 1000);

        var cassert = CollapsedAssert();

        for (var i = 0; i < data.errors.length; i++) {
            cassert.equal(data.errors[i].type, 'tchannel.request.timeout');
        }

        for (var j = 0; j < data.results.length; j++) {
            cassert.equal(data.results[j].responseOk, false);
            cassert.equal(data.results[j].error.type, 'tchannel.timeout');
        }

        cassert.report(assert, 'all response are errors');

        setTimeout(finish, 750);
    }

    function finish() {
        console.log('counters', {
            IN_REQ_ALLOC_COUNTER: IN_REQ_ALLOC_COUNTER,
            TIMEOUT_COUNTER: TIMEOUT_COUNTER,
            NOT_SEND_COUNTER: NOT_SEND_COUNTER,
            POP_IN_REQUEST_COUNTER: POP_IN_REQUEST_COUNTER,
            EMIT_FINISH_COUNTER: EMIT_FINISH_COUNTER,
            serverHostPort: server.hostPort,
            relayHostPort: relay.hostPort
        });

        assert.end();
    }
});

function noop() {
    /* timeout on purpose */
}
