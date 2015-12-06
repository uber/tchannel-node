'use strict';

/*eslint no-console: 0*/
var console = require('console');
var process = require('process');
var TCP_WRAP = process.binding('tcp_wrap').TCP;
var Buffer = require('buffer').Buffer;

var ChannelConnection = require('./connection.js');
var V2Frames = require('./v2-frames.js');

var EMPTY_BUFFER = new Buffer(0);

module.exports = PeersCollection;

function PeersCollection(channel) {
    if (!(this instanceof PeersCollection)) {
        return new PeersCollection(channel);
    }

    var self = this;

    self.channel = channel;

    self.connections = Object.create(null);
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

function toFlatArray(object) {
    var flatList = [];

    /*eslint guard-for-in: 0*/
    for (var key in object) {
        flatList.push(key);
        flatList.push(object[key]);
    }

    return flatList;
}

function RequestOptions(options) {
    var self = this;

    self.serviceName = options.serviceName;

    var arg1 = options.arg1;
    if (typeof arg1 === 'string') {
        arg1 = new Buffer(arg1);
    }
    self.arg1 = arg1;

    self.ttl = options.ttl || 100;

    var headers = options.headers;
    if (!headers) {
        headers = [];
    } else if (!Array.isArray(headers)) {
        headers = toFlatArray(headers);
    }
    self.headers = headers;

    var arg2 = options.arg2;
    if (!arg2) {
        arg2 = EMPTY_BUFFER;
    } else if (typeof arg2 === 'string') {
        arg2 = new Buffer(arg2);
    }
    self.arg2 = arg2;

    var arg3 = options.arg3;
    if (!arg3) {
        arg3 = EMPTY_BUFFER;
    } else if (typeof arg3 === 'string') {
        arg3 = new Buffer(arg3);
    }
    self.arg3 = arg3;
}

PeersCollection.prototype.send =
function send(options, onResponse) {
    var self = this;

    var conn = self.ensureConnection(options.host);
    var reqOpts = new RequestOptions(options);
    var reqId = self.sendCallRequest(conn, reqOpts);

    conn.addPendingOutReq(reqId, onResponse, reqOpts.ttl);
};

PeersCollection.prototype.sendCallRequest =
function sendCallRequest(conn, reqOpts) {
    var buffer = conn.globalWriteBuffer;
    var offset = 0;

    var reqId = conn.allocateId();
    offset = V2Frames.writeFrameHeader(buffer, offset, 0, 0x03, reqId);
    offset = V2Frames.writeCallRequestBody(
        buffer, offset, reqOpts.ttl, reqOpts.serviceName,
        reqOpts.headers, reqOpts.arg1, reqOpts.arg2, reqOpts.arg3
    );

    buffer.writeUInt16BE(offset, 0, true);

    var writeBuffer = new Buffer(offset);
    buffer.copy(writeBuffer, 0, 0, offset);
    conn.writeFrame(writeBuffer);

    return reqId;
};

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

PeersCollection.prototype.createConnection =
function createConnection(remoteName) {
    var self = this;

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

PeersCollection.prototype.close =
function close() {
    var self = this;

    for (var i = 0; i < self.remoteNames.length; i++) {
        var conns = self.connections[self.remoteNames[i]];

        for (var j = 0; j < conns.length; j++) {
            conns[j].destroy();
        }
    }
};
