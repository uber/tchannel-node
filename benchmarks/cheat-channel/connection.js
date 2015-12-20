'use strict';

/* @flow */

var Buffer = require('buffer').Buffer;
var SlowBuffer = require('buffer').SlowBuffer;
var process = require('process');
var console = require('console');

var FrameParser = require('./parser.js');
var LazyFrame = require('./lazy-frame.js');
var v2Frames = require('./v2-frames.js');

var GUID = 1;
var GLOBAL_WRITE_BUFFER = new Buffer(65536);
var SLOW_BUFFER_POOL_SIZE = 512 * 1024;
var _pool;

function allocPool() {
    _pool = new SlowBuffer(SLOW_BUFFER_POOL_SIZE);
    _pool.used = 0;
}

/*::
import * as type from './connection.h.js';
declare var TChannelConnection : Class<type.TChannelConnection>
declare var OutPending : Class<type.OutPending>
declare var OutPendingBucket : Class<type.OutPendingBucket>
declare var PendingOutOperation : Class<type.PendingOutOperation>
*/

/*eslint no-console: 0*/
module.exports = TChannelConnection;

function TChannelConnection(socket, channel, direction) {
    var self/*:TChannelConnection*/ = this;

    self.socket = socket;
    self.channel = channel;
    self.socket.owner = self;

    self.parser = new FrameParser(self, onParserFrameBuffer);
    self.idCounter = 1;
    self.guid = String(GUID++) + '~';
    self.outRequestMapping = new OutPending();

    self.remoteName = null;
    self.initialized = false;
    self.frameQueue = [];
    // self.writeQueue = [];
    self.direction = direction;

    self.pendingWrite = false;
    self.connected = false;
    self.globalWriteBuffer = GLOBAL_WRITE_BUFFER;
    self.afterWriteCallback = null;
}

function OutPending() {
    var self/*:OutPending*/ = this;

    self.buckets = Object.create(null);
    self.bucketSize = 1024;

    self.emptyBucket = [];
    for (var i = 0; i < self.bucketSize; i++) {
        self.emptyBucket.push(null);
    }
}

OutPending.prototype.push =
function push(id, op) {
    var self/*:OutPending*/ = this;

    var remainder = id % 1024;
    var bucketStart = id - remainder;
    var bucket = self.getOrCreateBucket(bucketStart);

    bucket.elements[remainder] = op;
    bucket.count++;
};

OutPending.prototype.getOrCreateBucket =
function getOrCreateBucket(bucketStart) {
    var self/*:OutPending*/ = this;

    var bucket = self.buckets[bucketStart];
    if (!bucket) {
        var elems = self.emptyBucket.slice();
        bucket = self.buckets[bucketStart] = new OutPendingBucket(elems);
    }

    return bucket;
};

function OutPendingBucket(elems) {
    var self/*:OutPendingBucket*/ = this;

    self.elements = elems;
    self.count = 0;
}

OutPending.prototype.pop =
function pop(id) {
    var self/*:OutPending*/ = this;

    var op = null;
    var remainder = id % 1024;
    var bucketStart = id - remainder;

    var bucket = self.buckets[bucketStart];
    if (bucket) {
        op = bucket.elements[remainder];
        bucket.count--;
        if (bucket.count === 0) {
            delete self.buckets[bucketStart];
        }
    }

    return op;
};

function PendingOutOperation(data, ttl) {
    var self/*:PendingOutOperation*/ = this;

    self.timedOut = false;
    self.data = data;
    self.timeout = ttl;
}

TChannelConnection.prototype.addPendingOutReq =
function addPendingOutReq(frameId, data, ttl) {
    var self/*:TChannelConnection*/ = this;

    var op = new PendingOutOperation(data, ttl);
    self.outRequestMapping.push(frameId, op);
};

TChannelConnection.prototype.popPendingOutReq =
function popPendingOutReq(frameId) {
    var self/*:TChannelConnection*/ = this;

    return self.outRequestMapping.pop(frameId);
};

TChannelConnection.prototype.accept =
function accept() {
    var self/*:TChannelConnection*/ = this;

    self.connected = true;
    self.readStart();
};

TChannelConnection.prototype.readStart =
function readStart() {
    var self/*:TChannelConnection*/ = this;

    self.socket.setNoDelay(true);
    self.socket.onread = onRead;
    var err = self.socket.readStart();
    if (err) {
        console.error('could not readStart lul', err);
        return;
    }
};

TChannelConnection.prototype.connect =
function connect(hostPort) {
    var self/*:TChannelConnection*/ = this;

    self.remoteName = hostPort;

    var parts = hostPort.split(':');
    var connectReq = self.socket.connect(parts[0], parseInt(parts[1], 10));
    if (connectReq === null) {
        console.error('could not connect', process._errno);
        return;
    }

    connectReq.oncomplete = afterConnect;
};

function afterConnect(err, socket, req, readable, writable) {
    var conn/*:TChannelConnection*/ = socket.owner;

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
    var conn/*:TChannelConnection*/ = this.owner;

    if (buffer) {
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
        conn.destroy();
        return;
    }
}

TChannelConnection.prototype.onSocketRead =
function onSocketRead(buffer, offset, length) {
    var self/*:TChannelConnection*/ = this;

    if (length === 0) {
        // could have no bytes
        return;
    }

    self.onSocketBuffer(buffer, offset, length);
};

TChannelConnection.prototype.onSocketBuffer =
function onSocketBuffer(socketBuffer, start, length) {
    var self/*:TChannelConnection*/ = this;

    self.parser.write(socketBuffer, start, length);
};

TChannelConnection.prototype.onFrameBuffer =
function onFrameBuffer(frameBuffer, offset, length) {
    var self/*:TChannelConnection*/ = this;

    var frame = new LazyFrame(self, frameBuffer, offset, length);
    self.channel.handler.handleFrame(frame);
};

TChannelConnection.prototype.allocateId =
function allocateId() {
    var self/*:TChannelConnection*/ = this;

    return self.idCounter++;
};

TChannelConnection.prototype.writeFrameCopy =
function writeFrameCopy(frameBuffer, len) {
    var self/*:TChannelConnection*/ = this;

    if (!_pool || _pool.length - _pool.used < len) {
        allocPool();
    }

    var buf = new Buffer(_pool, len, _pool.used);
    // Align on 8 byte boundary to avoid alignment issues on ARM.
    _pool.used = (_pool.used + len + 7) & ~7;

    frameBuffer.copy(buf, 0, 0, len);
    self.writeFrame(buf);
};

TChannelConnection.prototype.writeFrame =
function writeFrame(frameBuffer) {
    var self/*:TChannelConnection*/ = this;

    if (self.initialized) {
        self.writeToSocket(frameBuffer);
    } else {
        self.frameQueue.push(frameBuffer);
    }
};

TChannelConnection.prototype.writeToSocket =
function writeToSocket(buffer) {
    var self/*:TChannelConnection*/ = this;

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
    var self/*:TChannelConnection*/ = this;

    // magicCounters.in++;
    // console.log('handleInitRequest', magicCounters.in);

    reqFrame.readId();

    var initHeaders = reqFrame.readInitReqHeaders();
    var index = initHeaders.indexOf('host_port');
    self.remoteName = initHeaders[index + 1];

    self.channel.peers.addConnection(self);
    self.sendInitResponse(reqFrame);
};

TChannelConnection.prototype.sendInitResponse =
function sendInitResponse(reqFrame) {
    var self/*:TChannelConnection*/ = this;

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
    var self/*:TChannelConnection*/ = this;

    self.afterWriteCallback = null;
    self.flushPending();
}

TChannelConnection.prototype.sendInitRequest =
function sendInitRequest() {
    var self/*:TChannelConnection*/ = this;

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
function handleInitResponse(resFrame) {
    var self/*:TChannelConnection*/ = this;

    // magicCounters.out--;
    // console.log('handleInitResponse', magicCounters.out);

    self.flushPending();
};

TChannelConnection.prototype.flushPending =
function flushPending() {
    var self/*:TChannelConnection*/ = this;

    self.initialized = true;
    // console.log('flushing frames', self.frameQueue.length);

    for (var i = 0; i < self.frameQueue.length; i++) {
        self.writeToSocket(self.frameQueue[i]);
    }

    self.frameQueue.length = 0;
};

function onParserFrameBuffer(connection, buffer, offset, length) {
    connection.onFrameBuffer(buffer, offset, length);
}

TChannelConnection.prototype.destroy =
function destroy() {
    var self/*:TChannelConnection*/ = this;

    self.socket.close(onClose);
    self.socket.onread = null;
};

function onClose() {
    // TODO: ???
}
