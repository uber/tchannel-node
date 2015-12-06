'use strict';

var process = require('process');
var TCP_WRAP = process.binding('tcp_wrap').TCP;
var console = require('console');

var FrameHandler = require('./frame-handler.js');
var RelayConnection = require('./connection.js');

module.exports = Channel;

function Channel(opts) {
    if (!(this instanceof Channel)) {
        return new Channel(opts);
    }

    var self = this;

    self.server = new TCP_WRAP();
    self.handler = new FrameHandler();

    self.connections = null;
    self.hostPort = null;
}

Channel.prototype.listen =
function listen(port, host) {
    var self = this;

    self.server.owner = self;
    self.server.onconnection = onConnection;

    self.hostPort = host + ':' + port;
    var err = self.server.bind(host, port);
    if (err) {
        console.error('failed to bind() to address', err);
        return;
    }

    err = self.server.listen(511);
    if (err) {
        console.error('failed to listen()', err);
        return;
    }
};

Channel.prototype.register =
function register(serviceName, endpoint, fn) {
    var self = this;

    self.handler.register(serviceName, endpoint, fn);
};

function onConnection(socket) {
    if (!socket) {
        console.error('could not accept / incoming connect');
        return;
    }

    var naiveRelay = this.owner;
    naiveRelay.onSocket(socket, 'in');
}

Channel.prototype.onSocket =
function onSocket(socket, direction, hostPort) {
    var self = this;

    var conn = RelayConnection(socket, self, direction);
    if (direction === 'in') {
        conn.accept();
    } else if (direction === 'out') {
        conn.connect(hostPort);
    } else {
        console.error('invalid direction', direction);
    }

    return conn;
};

Channel.prototype.handleFrame =
function handleFrame(frame) {
    var self = this;

    self.handler.handleFrame(frame);
};
