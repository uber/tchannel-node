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

var uuid = require('uuid');
var setTimeout = require('timers').setTimeout;
var path = require('path');
var fs = require('fs');
var process = global.process;
var console = require('console');
var metrics = require('metrics');

var TChannelJSON = require('../as/json');
var TChannel = require('../');

var FIXTURE_FILE_NAME = path.join(__dirname, 'fixtures', 'object_v0.json');
var CACHE_SIZE = 100;
var TIME_DELAY = 5;
var TIME_DRIFT = 5;
var NV_MAGIC_CONST = 4 * Math.exp(-0.5) / Math.sqrt(2.0);
var PORT = 9000;

var KEYS = [];
for (var j = 0; j < CACHE_SIZE; j++) {
    KEYS.push(uuid());
}

function Server() {
    this.channel = new TChannel({
        serviceName: 'server'
    });

    this.jsonCodec = new TChannelJSON();
    this.jsonCodec.register(
        this.channel, 'get_obj', this, getObjectHandler
    );
    this.jsonCodec.register(
        this.channel, 'get_histogram', this, getHistogramHandle
    );
    this.jsonCodec.register(
        this.channel, 'clear_histogram', this, clearHistogramHandle
    );

    this.pendingHistogram = new metrics.Histogram();

    this.cache = Object.create(null);
    this.populateCache();
}

function getObjectHandler(ctx, req, _, body, cb) {
    ctx.getObject(req, _, body, cb);
}
function getHistogramHandle(ctx, req, _, body, cb) {
    ctx.getHistogram(req, _, body, cb);
}
function clearHistogramHandle(ctx, req, _, body, cb) {
    ctx.clearHistogram(req, _, body, cb);
}

Server.prototype.populateCache = function populateCache() {
    var fixture = fs.readFileSync(FIXTURE_FILE_NAME, 'utf8');

    for (var i = 0; i < CACHE_SIZE; i++) {
        this.cache[KEYS[i]] = JSON.parse(fixture);
    }
};

Server.prototype.start = function start() {
    this.channel.listen(PORT, '127.0.0.1');
};

Server.prototype.getObject = function getObject(treq, h, b, cb) {
    var req = new GetObjectRequest(this, cb);
    req.processRequest();
};

Server.prototype.getHistogram = function getHistogram(treq, h, b, cb) {
    cb(null, {
        ok: true,
        body: {
            info: this.pendingHistogram.printObj(),
            values: this.pendingHistogram.values()
        }
    });
};

Server.prototype.clearHistogram = function clearHistogram(treq, h, b, cb) {
    this.pendingHistogram = new metrics.Histogram();
    cb(null, {
        ok: true,
        body: 'ok'
    });
};

function sampleNormalRandom(mu, sigma) {
    for (;;) {
        var u1 = Math.random();
        var u2 = 1.0 - Math.random();
        var z = NV_MAGIC_CONST * (u1 - 0.5) / u2;
        var zz = z * z / 4.0;
        if (zz <= -Math.log(u2)) {
            return mu + z * sigma;
        }
    }
}

function GetObjectRequest(server, sendResponse) {
    this.server = server;
    this.sendResponse = sendResponse;

    this.rand = Math.random();
    this.key = KEYS[Math.floor(this.rand * CACHE_SIZE)];
    this.delay = sampleNormalRandom(TIME_DELAY, TIME_DRIFT);

    this.boundReallyProcess = fbind(this, this.reallyProcess);
    this.boundOnDiskRead = fbind(this, this.onDiskRead);
}

GetObjectRequest.prototype.processRequest = function processRequest() {
    if (this.delay <= 0) {
        this.reallyProcess();
    } else {
        setTimeout(this.boundReallyProcess, this.delay);
    }
};

GetObjectRequest.prototype.reallyProcess = function reallyProcess() {
    if (this.rand < 0.1) {
        this.readFromCache();
    } else {
        this.readFromDisk();
    }
};

GetObjectRequest.prototype.readFromCache = function readFromCache() {
    var obj = this.server.cache[this.key];

    this.flushResponse({
        ok: true,
        body: obj
    });
};

GetObjectRequest.prototype.readFromDisk = function readFromDisk() {
    fs.readFile(FIXTURE_FILE_NAME, 'utf8', this.boundOnDiskRead);
};

GetObjectRequest.prototype.onDiskRead = function onDiskRead(err, json) {
    if (err) {
        this.flushResponse({
            ok: false,
            body: {
                message: err.message
            }
        });
        return;
    }

    this.flushResponse({
        ok: true,
        body: JSON.parse(json)
    });
};

GetObjectRequest.prototype.flushResponse = function flushResponse(resp) {
    this.sendResponse(null, resp);

    this.server.pendingHistogram.update(
        this.server.channel.inboundPending.getPending()
    );
};

function fbind(ctx, fn) {
    return function _bound() {
        return fn.apply(ctx, arguments);
    };
}

function main() {
    var serv = new Server();
    serv.start();

    /*eslint-disable no-console*/
    console.log('server (' + process.pid + ') listening on 127.0.0.1:' + PORT);
    /*eslint-enable no-console*/
}

if (require.main === module) {
    main();
}
