'use strict';

var ID_OFFSET = 4;
var TYPE_OFFSET = 2;
var CREQ_FLAGS_OFFSET = 16;
var CREQ_TTL_OFFSET = 17;
var CREQ_TRACING_OFFSET = 21;
var CREQ_SERVICE_OFFSET = 46;

LazyFrame.freeList = [];
for (var iii = 0; iii < 1000; iii++) {
    LazyFrame.freeList.push(new LazyFrame());
}

LazyFrame.alloc = allocLazyFrame;
LazyFrame.free = freeLazyFrame;

module.exports = LazyFrame;

function allocLazyFrame(sourceConnection, frameBuffer) {
    var frame;

    if (LazyFrame.freeList.length === 0) {
        frame = new LazyFrame();
    } else {
        frame = LazyFrame.freeList.pop();
    }

    frame.sourceConnection = sourceConnection;
    frame.frameBuffer = frameBuffer;

    return frame;
}

function freeLazyFrame(frame) {
    frame.sourceConnection = null;
    frame.frameBuffer = null;
    frame.oldId = null;
    frame.newId = null;
    frame.frameType = null;

    LazyFrame.freeList.push(frame);
}

function LazyFrame() {
    var self = this;

    self.sourceConnection = null;
    self.frameBuffer = null;

    self.oldId = null;
    self.newId = null;
    self.frameType = null;

    self.reqServiceName = null;
    self.reqHeadersCount = null;
    self.reqChecksumType = null;
    self.reqArg1Length = null;
    self.reqArg1 = null;

    self.reqHeadersStart = null;
    self.reqChecksumStart = null;
    self.reqArg1Start = null;
    self.reqArg2Start = null;
}

LazyFrame.prototype.readId =
function readId() {
    var self = this;

    if (self.oldId !== null) {
        return self.oldId;
    }

    self.oldId = self.frameBuffer.readUInt32BE(ID_OFFSET, true);
    return self.oldId;
};

LazyFrame.prototype.readFrameType =
function readFrameType() {
    var self = this;

    if (self.frameType !== null) {
        return self.frameType;
    }

    self.frameType = self.frameBuffer.readUInt8(TYPE_OFFSET, true);
    return self.frameType;
};

LazyFrame.prototype.writeId =
function writeId(newId) {
    var self = this;

    self.frameBuffer.writeUInt32BE(newId, ID_OFFSET, true);

    self.newId = newId;
    return self.newId;
};

LazyFrame.prototype.readReqServiceName =
function readReqServiceName() {
    var self = this;

    if (self.reqServiceName !== null) {
        return self.reqServiceName;
    }

    var strLength = self.frameBuffer.readUInt8(CREQ_SERVICE_OFFSET, true);
    self.reqHeadersStart = CREQ_SERVICE_OFFSET + 1 + strLength;

    self.reqServiceName = self.frameBuffer
        .toString('utf8', CREQ_SERVICE_OFFSET + 1, self.reqHeadersStart);
    return self.reqServiceName;
};

LazyFrame.prototype.readReqArg1 =
function readReqArg1() {
    var self = this;

    if (self.reqArg1 !== null) {
        return self.reqArg1;
    }

    if (self.reqArg1Start === null) {
        self.skipReqChecksum();
    }

    var offset = self.reqArg1Start;
    self.reqArg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.reqArg2Start = offset + self.reqArg1Length;
    self.reqArg1 = self.frameBuffer
        .toString('utf8', offset, self.reqArg2Start);

    return self.reqArg1;
};

LazyFrame.prototype.skipReqHeaders =
function skipReqHeaders() {
    var self = this;

    if (self.reqHeadersStart === null) {
        self.readReqServiceName();
    }

    self.reqHeadersCount = self.frameBuffer
        .readUInt8(self.reqHeadersStart, true);

    var offset = self.reqHeadersStart + 1;
    for (var i = 0; i < self.reqHeadersCount; i++) {
        var keyLen = self.frameBuffer.readUInt8(offset, true);
        offset += 1 + keyLen;
        var valueLen = self.frameBuffer.readUInt8(offset, true);
        offset += 1 + valueLen;
    }

    self.reqChecksumStart = offset;
};

LazyFrame.prototype.skipReqChecksum =
function skipReqChecksum() {
    var self = this;

    if (self.reqChecksumStart === null) {
        self.skipReqHeaders();
    }

    self.reqChecksumType = self.frameBuffer
        .readUInt8(self.reqChecksumStart, true);

    var offset = self.reqChecksumStart + 1;
    if (self.reqChecksumStart !== 0x00) {
        offset += 4;
    }

    self.reqArg1Start = offset;
};
