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

var parallel = require('run-parallel');

function BatchClient(channel, hosts) {
    if (!(this instanceof BatchClient)) {
        return new BatchClient(channel, hosts);
    }

    var self = this;

    self.channel = channel;
    self.hosts = hosts;

    self.subChannel = self.channel.makeSubChannel({
        serviceName: 'server',
        peers: self.hosts
    });
}

BatchClient.prototype.warmUp = function warmUp(callback) {
    var self = this;

    var waiting = [];
    for (var l = 0; l < self.hosts.length; l++) {
        var host = self.hosts[l];

        waiting.push(self.subChannel.waitForIdentified.bind(self.subChannel, {
            host: host
        }));
    }

    parallel(waiting, callback);
};

BatchClient.prototype.sendRequests = function sendRequests(options, callback) {
    var self = this;

    var totalRequests = options.totalRequests;
    var batchSize = options.batchSize;

    var callReqThunks = [];
    for (var i = 0; i < totalRequests; i++) {
        var req = self.subChannel.request({
            serviceName: 'server',
            hasNoParent: true,
            timeout: 500,
            headers: {
                cn: 'client',
                as: 'raw'
            }
        });

        callReqThunks.push(makeThunk(req));
    }

    var errorList = [];
    var resultList = [];
    (function loop() {
        if (callReqThunks.length === 0) {
            return callback(null, {
                errors: errorList,
                results: resultList
            });
        }

        var parts = callReqThunks.slice(0, batchSize);
        callReqThunks = callReqThunks.slice(batchSize);

        parallel(parts, onPartial);

        function onPartial(err2, results) {
            if (err2) {
                errorList.push(err2);
            }
            // assert.ifError(err2, 'expect no req err');

            resultList = resultList.concat(results);
            loop();
        }
    }());

    function makeThunk(request) {
        return thunk;

        function thunk(cb) {
            request.send('foo', 'a', 'b', onResponse);

            function onResponse(err, resp) {
                if (err && !err.isErrorFrame) {
                    return cb(err);
                }

                cb(null, {
                    error: err || null,
                    response: resp || null
                });
            }
        }
    }
};

module.exports = BatchClient;
