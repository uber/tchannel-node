'use strict';

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

/*eslint no-console: 0*/
module.exports = TChannelConnection;

function TChannelConnection(socket, channel, direction) {
    if (!(this instanceof TChannelConnection)) {
        return new TChannelConnection(socket, channel, direction);
    }

    this.socket = socket;
    this.channel = channel;
    this.socket.owner = this;

    this.parser = new FrameParser(this, onParserFrameBuffer);
    this.idCounter = 1;
    this.guid = String(GUID++) + '~';
    this.outRequestMapping = new OutPending();

    this.remoteName = null;
    this.initialized = false;
    this.frameQueue = [];
    // this.writeQueue = [];
    this.direction = direction;

    // this.pendingWrite = false;
    this.connected = false;
    this.globalWriteBuffer = GLOBAL_WRITE_BUFFER;
}

function OutPending() {
    this.buckets = Object.create(null);
    this.bucketSize = 1024;

    this.emptyBucket = [];
    for (var i = 0; i < this.bucketSize; i++) {
        this.emptyBucket.push(null);
    }
}

OutPending.prototype.push =
function push(id, op) {
    var self = this;

    var remainder = id % 1024;
    var bucketStart = id - remainder;
    var bucket = self.getOrCreateBucket(bucketStart);

    bucket.elements[remainder] = op;
    bucket.count++;
};

OutPending.prototype.getOrCreateBucket =
function getOrCreateBucket(bucketStart) {
    var self = this;

    var bucket = self.buckets[bucketStart];
    if (!bucket) {
        var elems = self.emptyBucket.slice();
        bucket = self.buckets[bucketStart] = new OutPendingBucket(elems);
    }

    return bucket;
};

function OutPendingBucket(elems) {
    this.elements = elems;
    this.count = 0;
}

OutPending.prototype.pop =
function pop(id) {
    var self = this;

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

function PendingOutOperation(onResponse, ttl) {
    this.timedOut = false;
    this.onResponse = onResponse;
    this.timeout = ttl;
}

TChannelConnection.prototype.addPendingOutReq =
function addPendingOutReq(frameId, onResponse, ttl) {
    var self = this;

    var op = new PendingOutOperation(onResponse, ttl);
    self.outRequestMapping.push(frameId, op);
};

TChannelConnection.prototype.popPendingOutReq =
function popPendingOutReq(frameId) {
    var self = this;

    return self.outRequestMapping.pop(frameId);
};

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
    var conn = this.owner;

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

TChannelConnection.prototype.writeFrameCopy =
function writeFrameCopy(frameBuffer, len) {
    var self = this;

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
    var self = this;

    if (self.initialized) {
        self.writeToSocket(frameBuffer);
    } else {
        self.frameQueue.push(frameBuffer);
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

    var initHeaders = reqFrame.readInitReqHeaders();
    var index = initHeaders.indexOf('host_port');
    self.remoteName = initHeaders[index + 1];

    self.channel.addConnection(self);

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
function handleInitResponse(resFrame) {
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

TChannelConnection.prototype.destroy =
function destroy() {
    var self = this;

    self.socket.close(onClose);
    self.socket.onread = null;
    self.socket = null;
};

function onClose() {
    // TODO: ???
}
