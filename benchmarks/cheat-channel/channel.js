'use strict';

/* @flow */

var process = require('process');
var TCP_WRAP = process.binding('tcp_wrap').TCP;
var console = require('console');

var FrameHandler = require('./frame-handler.js');
var PeersCollection = require('./peers-collection.js');
var buildFastClient = require('./fast-client.js');
var TChannelConnection = require('./connection.js');
var TChannelSender = require('./sender.js');

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

/*::
type OnListenFn = () => void;
type OnCloseFn = (err: Error | null) => void;

declare class Channel {
    server: any;
    handler: any;
    peers: any;
    sender: any;

    hostPort: ?string;

    constructor(): void;
    listen: (port: number, host: string, onListen?: OnListenFn) => void;
    delayEmitListen: (onListen: OnListenFn) => void;
    allocateConnection: (remoteName: string) => any;
    onSocket: (socket: any, direction: string, hostPort: string) => any;
    createClient: (serviceName: string, opts: any) => any;
    send: (options: any, onResponse: () => void) => void;
    close: (cb: OnCloseFn) => void;
}
*/

module.exports = Channel;

function Channel() {
    this.server = new TCP_WRAP();
    this.handler = new FrameHandler();
    this.peers = new PeersCollection(this);
    this.sender = new TChannelSender(this);

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
        self.delayEmitListen(onListen);
    }
};

Channel.prototype.delayEmitListen =
function delayEmitListen(onListen) {
    process.nextTick(emitListen);

    function emitListen() {
        onListen();
    }
};

function onConnection(socket) {
    if (!socket) {
        console.error('could not accept / incoming connect');
        return;
    }

    var naiveRelay = this.owner;
    naiveRelay.onSocket(socket, 'in');
}

Channel.prototype.allocateConnection =
function allocateConnection(remoteName) {
    var self = this;

    var socket = new TCP_WRAP();
    return self.onSocket(socket, 'out', remoteName);
};

Channel.prototype.onSocket =
function onSocket(socket, direction, hostPort) {
    var self = this;

    var conn = new TChannelConnection(socket, self, direction);
    if (direction === 'in') {
        conn.accept();
    } else if (direction === 'out') {
        conn.connect(hostPort);
    } else {
        console.error('invalid direction', direction);
    }

    return conn;
};

Channel.prototype.createClient =
function createClient(serviceName, opts) {
    var self = this;

    return buildFastClient(self, serviceName, opts);
};

Channel.prototype.send =
function send(options, onResponse) {
    var self = this;

    self.sender.send(options, onResponse);
};

Channel.prototype.close =
function close(cb) {
    var self = this;

    self.server.close();
    self.server = null;

    self.peers.close();

    cb(null);
};
