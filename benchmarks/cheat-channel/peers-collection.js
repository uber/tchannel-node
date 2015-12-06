'use strict';

/*eslint no-console: 0*/
var console = require('console');
var process = require('process');
var TCP_WRAP = process.binding('tcp_wrap').TCP;

var ChannelConnection = require('./connection.js');

module.exports = PeersCollection;

function PeersCollection(channel) {
    if (!(this instanceof PeersCollection)) {
        return new PeersCollection(channel);
    }

    var self = this;

    self.channel = channel;

    self.connections = {};
    self.remoteNames = [];
}

PeersCollection.prototype.onSocket =
function onSocket(socket, direction, hostPort) {
    var self = this;

    var conn = ChannelConnection(socket, self.channel, direction);
    if (direction === 'in') {
        conn.accept();
    } else if (direction === 'out') {
        conn.connect(hostPort);
    } else {
        console.error('invalid direction', direction);
    }

    return conn;
};

PeersCollection.prototype.send =
function send(options, onResponse) {
    var self = this;

    var conn = self.ensureConnection(options.host);
};

PeersCollection.prototype.ensureConnection =
function ensureConnection(remoteName) {
    var self = this;

    if (self.connections[remoteName] &&
        self.connections[remoteName][0]
    ) {
        return self.connnections[remoteName][0];
    }

    self.ensureRemoteName(remoteName);
    var socket = new TCP_WRAP();
    var conn = self.onSocket(socket, 'out', remoteName);
    self.connections[remoteName].push(conn);

    return conn;
};

PeersCollection.prototype.ensureRemoteName =
function ensureRemoteName(remoteName) {
    var self = this;

    if (!self.connections[remoteName]) {
        self.connections[remoteName] = [];
        self.remoteNames.push(remoteName);
    }
};

PeersCollection.prototype.addConnection =
function addConnection(conn) {
    var self = this;

    self.ensureRemoteName(conn.remoteName);
    self.connections[conn.remoteName].push(conn);
};
