'use strict';

var ID_OFFSET = 4;
var TYPE_OFFSET = 2;

var CRES_FLAGS_OFFSET = 16;
var CRES_CODE_OFFSET = 17;
var CRES_TRACING_OFFSET = 18;
var CRES_HEADER_OFFSET = 43;

var CREQ_FLAGS_OFFSET = 16;
var CREQ_TTL_OFFSET = 17;
var CREQ_TRACING_OFFSET = 21;
var CREQ_SERVICE_OFFSET = 46;

var IREQ_HEADERS_OFFSET = 18;

/*  REQUEST
    flags:1 ttl:4 tracing:25
    service~1 nh:1 (hk~1 hv~1){nh}
    csumtype:1 (csum:4){0,1} arg1~2 arg2~2 arg3~2
*/

/*  RESPONSE
    flags:1 code:1 tracing:25
    nh:1 (hk~1 hv~1){nh}
    csumtype:1 (csum:4){0,1} arg1~2 arg2~2 arg3~2
*/

LazyFrame.alloc = allocLazyFrame;

module.exports = LazyFrame;

function allocLazyFrame(sourceConnection, frameBuffer) {
    var frame;

    // if (LazyFrame.freeList.length === 0) {
    frame = new LazyFrame();
    // } else {
    //     frame = LazyFrame.freeList.pop();
    // }

    frame.sourceConnection = sourceConnection;
    frame.frameBuffer = frameBuffer;

    return frame;
}

function LazyFrame() {
    var self = this;

    self.sourceConnection = null;
    self.frameBuffer = null;

    self.oldId = null;
    self.newId = null;
    self.frameType = null;

    self.initReqHeaders = null;

    self.reqServiceName = null;
    self.reqHeadersCount = null;
    self.reqChecksumType = null;
    self.arg1Length = null;
    self.arg2Length = null;
    self.arg3Length = null;
    self.arg1 = null;
    self.arg2 = null;
    self.arg3 = null;

    self.reqHeadersStart = null;
    self.reqChecksumStart = null;
    self.arg1Start = null;
    self.arg2Start = null;
    self.arg3Start = null;
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

    if (self.arg1 !== null) {
        return self.arg1;
    }

    if (self.arg1Start === null) {
        self.skipReqChecksum();
    }

    var offset = self.arg1Start;
    self.arg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg2Start = offset + self.arg1Length;
    self.arg1 = self.frameBuffer.slice(offset, self.arg2Start);

    return self.arg1;
};

LazyFrame.prototype.readReqArg2 =
function readReqArg2() {
    var self = this;

    if (self.arg2 !== null) {
        return self.arg2;
    }

    if (self.arg2Start === null) {
        self.readReqArg1();
    }

    var offset = self.arg2Start;
    self.arg2Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg3Start = offset + self.arg2Length;
    self.arg2 = self.frameBuffer.slice(offset, self.arg3Start);

    return self.arg2;
};

LazyFrame.prototype.readArg3 =
function readArg3() {
    var self = this;

    if (self.arg3 !== null) {
        return self.arg3;
    }

    if (self.arg3Start === null) {
        self.readReqArg2();
    }

    var offset = self.arg3Start;
    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3 = self.frameBuffer.slice(offset, end);

    return self.arg3;
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
    if (self.reqChecksumType !== 0x00) {
        offset += 4;
    }

    self.arg1Start = offset;
};

LazyFrame.prototype.readInitReqHeaders =
function readInitReqHeaders() {
    var self = this;

    if (self.initReqHeaders !== null) {
        return self.initReqHeaders;
    }

    self.initReqHeaders = [];
    var offset = IREQ_HEADERS_OFFSET;
    var nh = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    for (var i = 0; i < nh; i++) {
        var keyLen = self.frameBuffer.readUInt16BE(offset, true);
        offset += 2;

        var headerKey = self.frameBuffer
            .toString('utf8', offset, offset + keyLen);
        offset += keyLen;

        var valueLen = self.frameBuffer.readUInt16BE(offset, true);
        offset += 2;

        var headerValue = self.frameBuffer
            .toString('utf8', offset, offset + valueLen);
        offset += valueLen;

        self.initReqHeaders.push(headerKey);
        self.initReqHeaders.push(headerValue);
    }

    return self.initReqHeaders;
};