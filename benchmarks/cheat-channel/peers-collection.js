'use strict';

module.exports = PeersCollection;

function PeersCollection(channel) {
    if (!(this instanceof PeersCollection)) {
        return new PeersCollection(channel);
    }

    this.channel = channel;

    this.connections = Object.create(null);
    this.flatConnections = [];
    this.remoteNames = [];
}

PeersCollection.prototype.ensureConnection =
function ensureConnection(remoteName) {
    var self = this;

    if (self.connections[remoteName] &&
        self.connections[remoteName][0]
    ) {
        return self.connections[remoteName][0];
    }

    return self.createConnection(remoteName);
};

PeersCollection.prototype.roundRobinConn =
function roundRobinConn() {

};

PeersCollection.prototype.createConnection =
function createConnection(remoteName) {
    var self = this;

    var conn = self.channel.allocateConnection(remoteName);
    self.addConnection(conn);

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
    self.flatConnections.push(conn);
};

PeersCollection.prototype.close =
function close() {
    var self = this;

    for (var i = 0; i < self.flatConnections.length; i++) {
        var conn = self.flatConnections[i];
        conn.destroy();
    }
};
