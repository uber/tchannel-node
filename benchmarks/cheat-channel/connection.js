'use strict';

var Buffer = require('buffer').Buffer;
var process = require('process');
var console = require('console');

var FrameParser = require('./parser.js');
var LazyFrame = require('./lazy-frame.js');
var v2Frames = require('./v2-frames.js');

var GUID = 1;
var GLOBAL_WRITE_BUFFER = new Buffer(65536);

/*eslint no-console: 0*/
module.exports = TChannelConnection;

function TChannelConnection(socket, channel, direction) {
    if (!(this instanceof TChannelConnection)) {
        return new TChannelConnection(socket, channel, direction);
    }

    var self = this;

    self.socket = socket;
    self.channel = channel;
    self.socket.owner = self;

    self.parser = new FrameParser(self, onParserFrameBuffer);
    self.idCounter = 1;
    self.guid = String(GUID++) + '~';
    self.outRequestMapping = Object.create(null);

    self.initialized = false;
    self.frameQueue = [];
    self.writeQueue = [];
    self.direction = direction;

    self.pendingWrite = false;
    self.connected = false;
    self.globalWriteBuffer = GLOBAL_WRITE_BUFFER;
}

TChannelConnection.prototype.accept =
function accept() {
    var self = this;

    self.connected = true;
    self.readStart();
};

TChannelConnection.prototype.readStart =
function readStart() {
    var self = this;

    self.socket.onread = onRead;
    var err = self.socket.readStart();
    if (err) {
        console.error('could not readStart lul', err);
        return;
    }
};

TChannelConnection.prototype.connect =
function connect(hostPort) {
    var self = this;

    var parts = hostPort.split(':');
    var connectReq = self.socket.connect(parts[0], parts[1]);
    if (connectReq === null) {
        console.error('could not connect', process._errno);
        return;
    }

    connectReq.oncomplete = afterConnect;
};

function afterConnect(err, socket, req, readable, writable) {
    var conn = socket.owner;

    if (err) {
        console.error('lol connect', err);
        return;
    }

    if (!readable || !writable) {
        console.error('bad socket :(');
        return;
    }

    conn.connected = true;
    conn.readStart();

    if (conn.direction === 'out') {
        // console.log('sendInitRequest');
        conn.sendInitRequest();
    }
}

function onRead(buffer, offset, length) {
    if (buffer) {
        var conn = this.owner;
        // console.log('gotn socket buffer', {
        //     guid: conn.guid,
        //     bufStr: buffer.slice(offset, offset + length).toString('utf8')
        // });
        conn.onSocketRead(buffer, offset, offset + length);
    } else if (process._errno === 'EOF') {
        // console.log('got EOF LOLOLOLOLOLOL');
        // socket close (TODO lololol)
        return;
    } else {
        console.error('read failed', process._errno);
        return;
    }
}

TChannelConnection.prototype.onSocketRead =
function onSocketRead(buffer, offset, length) {
    var self = this;

    if (length === 0) {
        // could have no bytes
        return;
    }

    self.onSocketBuffer(buffer, offset, length);
};

TChannelConnection.prototype.onSocketBuffer =
function onSocketBuffer(socketBuffer, start, length) {
    var self = this;

    self.parser.write(socketBuffer, start, length);
};

TChannelConnection.prototype.onFrameBuffer =
function onFrameBuffer(frameBuffer) {
    var self = this;

    var frame = LazyFrame.alloc(self, frameBuffer);
    self.channel.handleFrame(frame);
};

TChannelConnection.prototype.allocateId =
function allocateId() {
    var self = this;

    return self.idCounter++;
};

TChannelConnection.prototype.writeFrame =
function writeFrame(frame) {
    var self = this;

    if (self.initialized) {
        self.writeToSocket(frame.frameBuffer);
    } else {
        self.frameQueue.push(frame.frameBuffer);
    }
};

TChannelConnection.prototype.writeToSocket =
function writeToSocket(buffer) {
    var self = this;

    // if (self.pendingWrite) {
    //     self.writeQueue.push(buffer);
    //     return;
    // }

    if (!self.connected) {
        throw new Error('lol noob');
    }

    self.pendingWrite = true;

    // console.log('writing to socket', self.guid);
    var writeReq = self.socket.writeBuffer(buffer);
    if (!writeReq) {
        console.error('did not get writeReq');
        return;
    }

    writeReq.oncomplete = afterWrite;
};

function afterWrite(status, socket, writeReq) {
    var conn = socket.owner;

    if (status) {
        console.error('write failed', status);
        return;
    }

    if (conn.afterWriteCallback) {
        conn.afterWriteCallback();
    }

    conn.pendingWrite = false;
    // if (conn.writeQueue.length) {
    //     conn.writeToSocket(conn.writeQueue.shift());
    // }
}

TChannelConnection.prototype.handleInitRequest =
function handleInitRequest(reqFrame) {
    var self = this;

    // magicCounters.in++;
    // console.log('handleInitRequest', magicCounters.in);

    reqFrame.readId();
    self.sendInitResponse(reqFrame);
};

TChannelConnection.prototype.sendInitResponse =
function sendInitResponse(reqFrame) {
    var self = this;

    // magicCounters.in--;
    // console.log('handleInitResponse', magicCounters.in);

    var bufferLength = v2Frames.initFrameSize(self.channel.hostPort);
    var buffer = new Buffer(bufferLength);
    var offset = 0;

    offset = v2Frames.writeFrameHeader(
        buffer, offset, bufferLength, 0x02, reqFrame.oldId
    );
    offset = v2Frames.writeInitBody(
        buffer, offset, self.channel.hostPort
    );

    self.afterWriteCallback = onInitResponseWrite;
    self.writeToSocket(buffer);
};

function onInitResponseWrite() {
    var self = this;

    self.afterWriteCallback = null;
    self.flushPending();
}

TChannelConnection.prototype.sendInitRequest =
function sendInitRequest() {
    var self = this;

    // magicCounters.out++;
    // console.log('sendInitRequest', magicCounters.out);

    var bufferLength = v2Frames.initFrameSize(self.channel.hostPort);
    var buffer = new Buffer(bufferLength);
    var offset = 0;

    offset = v2Frames.writeFrameHeader(
        buffer, offset, bufferLength, 0x01, self.allocateId()
    );
    offset = v2Frames.writeInitBody(
        buffer, offset, self.channel.hostPort
    );

    self.writeToSocket(buffer);
};

TChannelConnection.prototype.handleInitResponse =
function handleInitResponse() {
    var self = this;

    // magicCounters.out--;
    // console.log('handleInitResponse', magicCounters.out);

    self.flushPending();
};

TChannelConnection.prototype.flushPending =
function flushPending() {
    var self = this;

    self.initialized = true;
    // console.log('flushing frames', self.frameQueue.length);

    for (var i = 0; i < self.frameQueue.length; i++) {
        self.writeToSocket(self.frameQueue[i]);
    }

    self.frameQueue.length = 0;
};

function onParserFrameBuffer(connection, buffer) {
    connection.onFrameBuffer(buffer);
}

