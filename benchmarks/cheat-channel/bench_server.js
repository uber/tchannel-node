'use strict';

var process = require('process');
process.title = 'nodejs-benchmarks-cheat_bench_server';

var parseArgs = require('minimist');
var assert = require('assert');

var Channel = require('./channel.js');

var SERVER_HOST = '127.0.0.1';

function BenchServer(port) {
    if (!(this instanceof BenchServer)) {
        return new BenchServer(port);
    }

    this.port = port;

    // TODO: stats
    // TODO: trace propagation
    // TODO: timeouts
    this.channel = new Channel();

    // TODO: optional trace reporter

    this.keys = {};
    this.registerEndpoints();
}

BenchServer.prototype.registerEndpoints =
function registerEndpoints() {
    var self = this;

    self.channel.handler.registerRaw('benchmark', 'ping', onPing);
    self.channel.handler.registerRaw('benchmark', 'set', onSet);
    self.channel.handler.registerRaw('benchmark', 'get', onGet);

    function onGet(frame, res) {
        var key = frame.readArg2str();

        if (self.keys[key] !== undefined) {
            var val = self.keys[key];
            res.sendOk(val.length.toString(10), val);
        } else {
            res.sendNotOk('key not found', key);
        }
    }

    function onSet(frame, res) {
        var key = frame.readArg2str();
        var val = frame.readArg3();

        self.keys[key] = val;

        res.sendOk('ok', 'really ok');
    }

    function onPing(frame, res) {
        res.sendOk('pong', null);
    }
};

BenchServer.prototype.listen =
function listen() {
    var self = this;

    self.channel.listen(self.port, SERVER_HOST);
};

function main(opts) {
    assert(opts.port, 'port needed');
    assert(opts.instances, 'instances needed');

    var INSTANCES = parseInt(opts.instances, 10);
    var basePort = parseInt(opts.port, 10);
    for (var i = 0; i < INSTANCES; i++) {
        var port = basePort + i;

        var benchServer = BenchServer(port);
        benchServer.listen();
    }
}

if (require.main === module) {
    main(parseArgs(process.argv.slice(2)));
}
