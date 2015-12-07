'use strict';

var process = require('process');
var TCP_WRAP = process.binding('tcp_wrap').TCP;
var console = require('console');

var FrameHandler = require('./frame-handler.js');
var PeersCollection = require('./peers-collection.js');

/*
    var channel = Channel();

    channel.listen(port, host, onListening);

    -- make request: fast-mode

    var client = channel.createClient(serviceName, {
        ping: {
            ttl: <TTL>,
            headers: Object<...>
        },
        set: {
            ttl: <TTL>,
            headers: Object<...>
        },
        get: {
            ttl: <TTL>,
            headers: Object<...>
        }
    });
    client.sendPing({
        host: <HostPort>,
        arg2: String,
        arg3: String
    }, cb);
    client.sendGet({
        host: <HostPort>,
        arg2: String,
        arg3: String
    }, cb);

     -- make request: slow-mode

    channel.send({
        host: <HostPort>,
        ttl: <TTL>,
        headers: Object<...>,
        serviceName: String,
        arg1: String,
        arg2: String,
        arg3: String
    }, cb);

    channel.close();
*/

module.exports = Channel;

function Channel() {
    if (!(this instanceof Channel)) {
        return new Channel();
    }

    this.server = new TCP_WRAP();
    this.handler = new FrameHandler();
    this.peers = new PeersCollection(this);

    this.hostPort = null;
}

Channel.prototype.listen =
function listen(port, host, onListen) {
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

    if (onListen) {
        process.nextTick(emitListen);
    }

    function emitListen() {
        onListen();
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

    return self.peers.onSocket(socket, direction, hostPort);
};

Channel.prototype.addConnection =
function addConnection(conn) {
    var self = this;

    self.peers.addConnection(conn);
};

Channel.prototype.handleFrame =
function handleFrame(frame) {
    var self = this;

    self.handler.handleFrame(frame);
};

Channel.prototype.send =
function send(options, onResponse) {
    var self = this;

    self.peers.send(options, onResponse);
};

Channel.prototype.close =
function close(cb) {
    var self = this;

    self.server.close();
    self.server = null;

    self.peers.close();

    cb(null);
};
