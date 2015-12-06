'use strict';

/*eslint no-console: 0*/
var console = require('console');

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

PeersCollection.prototype.addConnection =
function addConnection(conn) {
    var self = this;

    if (!self.connections[conn.remoteName]) {
        self.connections[conn.remoteName] = [];
        self.remoteNames.push(conn.remoteName);
    }

    self.connections[conn.remoteName].push(conn);
};
