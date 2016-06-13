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

var parallel = require('run-parallel');
var collectParallel = require('collect-parallel/array');
var setTimeout = require('timers').setTimeout;

/*
    BatchClient takes a channel and a set of peers to talk
    to.

    It has a set of options including:
        - totalRequests
        - delay
        - batchSize

    If you want to do 100QPS you can set batchSize=1 and delay=10
    If you want to do 1000QPS you can set batchSize=50 and delay=50

*/
module.exports = BatchClient;

function BatchClient(channel, hosts, options) {
    if (!(this instanceof BatchClient)) {
        return new BatchClient(channel, hosts, options);
    }

    var self = this;

    self.channel = channel;
    self.hosts = hosts;
    self.totalRequests = options.totalRequests;
    self.batchSize = options.batchSize;
    self.delay = options.delay || 1;

    self.serviceName = 'server';
    self.endpoint = options.endpoint || 'echo';
    self.body = 'foobar';
    self.timeout = options.timeout || 500;

    self.subChannel = options.subChannel = self.channel.makeSubChannel({
        serviceName: self.serviceName,
        peers: self.hosts,
        minConnections: options.minConnections || null
    });

    self.requestOptions = {
        serviceName: self.serviceName,
        hasNoParent: true,
        timeout: self.timeout,
        retryFlags: options && options.retryFlags,
        retryLimit: options && options.retryLimit ? options.retryLimit : 5,
        headers: {
            cn: 'client',
            as: 'raw'
        }
    };
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

BatchClient.prototype._sendRequest = function _sendRequest(cb) {
    var self = this;

    var result = new BatchClientRequestResult(Date.now());

    var req = self.subChannel.request(self.requestOptions);
    req.send(self.endpoint, '', self.body, onResponse);

    function onResponse(err, resp) {
        result.handleResponse(err, resp, cb);
    }
};

BatchClient.prototype.sendRequests = function sendRequests(callback) {
    var self = this;

    var loop = new BatchClientLoop({
        start: Date.now(),
        batchClient: self,
        onFinish: callback
    });
    loop.runNext();
};

function BatchClientLoop(options) {
    var self = this;

    self.batchClient = options.batchClient;
    self.startTime = options.start;
    self.onFinish = options.onFinish;

    self.requestCounter = 0;
    self.responseCounter = 0;
    self.currentRun = 0;
    self.results = new BatchClientResults();

    self.boundRunAgain = boundRunAgain;

    function boundRunAgain() {
        self.runNext();
    }
}

BatchClientLoop.prototype.runNext = function runNext() {
    var self = this;

    if (self.requestCounter >= self.batchClient.totalRequests) {
        return;
    }

    self.currentRun++;
    self.requestCounter += self.batchClient.batchSize;

    var jobs = [];
    for (var i = 0; i < self.batchClient.batchSize; i++) {
        jobs[i] = self;
    }

    collectParallel(jobs, makeRequest, onResults);

    var targetTime = self.startTime + (
        self.currentRun * self.batchClient.delay
    );
    var delta = targetTime - Date.now();

    setTimeout(self.boundRunAgain, delta);

    function onResults(err, responses) {
        self.onResults(err, responses);
    }
};

BatchClientLoop.prototype.onResults = function onResults(err, responses) {
    var self = this;

    if (err) {
        return self.onFinish(err);
    }

    for (var j = 0; j < responses.length; j++) {
        self.responseCounter++;
        self.results.push(responses[j]);
    }

    if (self.responseCounter >= self.batchClient.totalRequests) {
        self.onFinish(null, self.results);
    }
};

function makeRequest(loop, _, callback) {
    loop.batchClient._sendRequest(callback);
}

function BatchClientResults() {
    var self = this;

    self.errors = [];
    self.results = [];
}

BatchClientResults.prototype.push = function push(result) {
    var self = this;

    if (result.err) {
        self.errors.push(result.err);
    } else {
        self.results.push(result.value);
    }
};

function BatchClientRequestResult(start) {
    var self = this;

    self.start = start;

    self.error = null;
    self.responseOk = null;
    self.responseId = null;
    self.duration = null;
    self.outReqHostPort = null;
}

BatchClientRequestResult.prototype.handleResponse =
function handleResponse(err, resp, callback) {
    var self = this;

    if (err && !err.isErrorFrame) {
        return callback(err);
    }

    self.error = err || null;
    self.responseOk = resp ? resp.ok : false;
    self.responseId = resp ? resp.id : 0;
    self.duration = Date.now() - self.start;
    self.outReqHostPort = resp ? resp.remoteAddr : null;

    callback(null, self);
};
