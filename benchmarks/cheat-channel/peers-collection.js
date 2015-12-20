'use strict';

/* @flow */

/*::
import * as type from './peers-collection.h.js';
declare var PeersCollection : Class<type.PeersCollection>
*/
module.exports = PeersCollection;

function PeersCollection(channel) {
    var self/*:PeersCollection*/ = this;

    self.channel = channel;

    self.connections = Object.create(null);
    self.flatConnections = [];
    self.remoteNames = [];
    self.roundRobinIndex = 0;
}

PeersCollection.prototype.ensureConnection =
function ensureConnection(remoteName) {
    var self/*:PeersCollection*/ = this;

    if (self.connections[remoteName] &&
        self.connections[remoteName][0]
    ) {
        return self.connections[remoteName][0];
    }

    return self.createConnection(remoteName);
};

PeersCollection.prototype.roundRobinConn =
function roundRobinConn() {
    var self/*:PeersCollection*/ = this;

    var conn = self.flatConnections[self.roundRobinIndex];
    self.roundRobinIndex++;
    if (self.roundRobinIndex === self.flatConnections.length) {
        self.roundRobinIndex = 0;
    }

    return conn;
};

PeersCollection.prototype.createConnection =
function createConnection(remoteName) {
    var self/*:PeersCollection*/ = this;

    var conn = self.channel.allocateConnection(remoteName);
    self.addConnection(conn);

    return conn;
};

PeersCollection.prototype.ensureRemoteName =
function ensureRemoteName(remoteName) {
    var self/*:PeersCollection*/ = this;

    if (!self.connections[remoteName]) {
        self.connections[remoteName] = [];
        self.remoteNames.push(remoteName);
    }
};

PeersCollection.prototype.addConnection =
function addConnection(conn) {
    var self/*:PeersCollection*/ = this;

    var remoteName = 'unknown-remote-name';
    if (conn.remoteName) {
        remoteName = conn.remoteName;
    }

    self.ensureRemoteName(remoteName);
    self.connections[remoteName].push(conn);
    self.flatConnections.push(conn);
};

PeersCollection.prototype.close =
function close() {
    var self/*:PeersCollection*/ = this;

    for (var i = 0; i < self.flatConnections.length; i++) {
        var conn = self.flatConnections[i];
        conn.destroy();
    }
};
