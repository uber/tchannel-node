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

/* TODO:
        readUtf8 avoid toString()
        writeUtf8 avoid write()

        optimize away headers with RawRegister()

        OutResponse support arg2str & arg2buf pattern for faster
        shit.
*/
LazyFrame.alloc = allocLazyFrame;

module.exports = LazyFrame;

function allocLazyFrame(sourceConnection, frameBuffer) {
    var frame;

    // if (LazyFrame.freeList.length === 0) {
    frame = new LazyFrame(sourceConnection, frameBuffer);
    // } else {
    //     frame = LazyFrame.freeList.pop();
    // }

    return frame;
}

function LazyFrame(sourceConnection, frameBuffer) {
    this.sourceConnection = sourceConnection;
    this.frameBuffer = frameBuffer;

    this.oldId = null;
    this.newId = null;
    this.frameType = null;

    this.initReqHeaders = null;

    this.reqServiceName = null;
    this.tHeadersCount = null;
    this.checksumType = null;
    this.arg1Length = null;
    this.arg2Length = null;
    this.arg3Length = null;
    this.arg1 = null;
    this.arg1str = null;
    this.arg2 = null;
    this.arg2str = null;
    this.arg3 = null;
    this.arg3str = null;

    this.tHeadersStart = null;
    this.checksumStart = null;
    this.arg1Start = null;
    this.arg2Start = null;
    this.arg3Start = null;
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

LazyFrame.prototype.markAsCallResponse =
function markAsCallResponse() {
    var self = this;

    self.tHeadersStart = CRES_HEADER_OFFSET;
};

LazyFrame.prototype.readReqServiceName =
function readReqServiceName() {
    var self = this;

    if (self.reqServiceName !== null) {
        return self.reqServiceName;
    }

    var strLength = self.frameBuffer.readUInt8(CREQ_SERVICE_OFFSET, true);
    self.tHeadersStart = CREQ_SERVICE_OFFSET + 1 + strLength;

    self.reqServiceName = self.frameBuffer
        .toString('utf8', CREQ_SERVICE_OFFSET + 1, self.tHeadersStart);
    return self.reqServiceName;
};

LazyFrame.prototype.readArg1str =
function readArg1str() {
    var self = this;

    if (self.arg1str !== null) {
        return self.arg1str;
    }

    if (self.arg1Start === null) {
        self.skipChecksum();
    }

    var offset = self.arg1Start;
    self.arg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg2Start = offset + self.arg1Length;
    self.arg1str = self.frameBuffer.toString('utf8', offset, self.arg2Start);

    return self.arg1str;
};

LazyFrame.prototype.readArg1 =
function readArg1() {
    var self = this;

    if (self.arg1 !== null) {
        return self.arg1;
    }

    if (self.arg1Start === null) {
        self.skipChecksum();
    }

    var offset = self.arg1Start;
    self.arg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg2Start = offset + self.arg1Length;
    self.arg1 = self.frameBuffer.slice(offset, self.arg2Start);

    return self.arg1;
};

LazyFrame.prototype.skipArg1 =
function skipArg1() {
    var self = this;

    if (self.arg2Start !== null) {
        return;
    }

    if (self.arg1Start === null) {
        self.skipChecksum();
    }

    var offset = self.arg1Start;
    self.arg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    return;
};

LazyFrame.prototype.readArg2 =
function readArg2() {
    var self = this;

    if (self.arg2 !== null) {
        return self.arg2;
    }

    if (self.arg2Start === null) {
        self.readArg1();
    }

    var offset = self.arg2Start;
    self.arg2Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg3Start = offset + self.arg2Length;
    self.arg2 = self.frameBuffer.slice(offset, self.arg3Start);

    return self.arg2;
};

LazyFrame.prototype.skipArg2 =
function skipArg2() {
    var self = this;

    if (self.arg3Start !== null) {
        return;
    }

    if (self.arg2Start === null) {
        self.skipArg1();
    }

    var offset = self.arg2Start;
    self.arg2Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg3Start = offset + self.arg2Length;

    return;
};

LazyFrame.prototype.readArg2str =
function readArg2str() {
    var self = this;

    if (self.arg2str !== null) {
        return self.arg2str;
    }

    if (self.arg2Start === null) {
        self.readArg1str();
    }

    var offset = self.arg2Start;
    self.arg2Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg3Start = offset + self.arg2Length;
    self.arg2str = self.frameBuffer.toString('utf8', offset, self.arg3Start);

    return self.arg2str;
};

LazyFrame.prototype.readArg3 =
function readArg3() {
    var self = this;

    if (self.arg3 !== null) {
        return self.arg3;
    }

    if (self.arg3Start === null) {
        self.readArg2();
    }

    var offset = self.arg3Start;
    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3 = self.frameBuffer.slice(offset, end);

    return self.arg3;
};

LazyFrame.prototype.readArg3str =
function readArg3str() {
    var self = this;

    if (self.arg3str !== null) {
        return self.arg3str;
    }

    if (self.arg3Start === null) {
        self.readArg2str();
    }

    var offset = self.arg3Start;
    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3str = self.frameBuffer.toString('utf8', offset, end);

    return self.arg3str;
};

LazyFrame.prototype.readOnlyArg3str =
function readOnlyArg3str() {
    var self = this;

    if (self.arg3str !== null) {
        return self.arg3str;
    }

    if (self.arg3Start === null) {
        self.skipArg2();
    }

    var offset = self.arg3Start;
    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3str = self.frameBuffer.toString('utf8', offset, end);

    return self.arg3str;
};

LazyFrame.prototype.skipTransportHeaders =
function skipTransportHeaders() {
    var self = this;

    if (self.tHeadersStart === null) {
        console.error('could not skipTransportHeaders()');
        return;
    }

    self.tHeadersCount = self.frameBuffer
        .readUInt8(self.tHeadersStart, true);

    var offset = self.tHeadersStart + 1;
    for (var i = 0; i < self.tHeadersCount; i++) {
        var keyLen = self.frameBuffer.readUInt8(offset, true);
        offset += 1 + keyLen;
        var valueLen = self.frameBuffer.readUInt8(offset, true);
        offset += 1 + valueLen;
    }

    self.checksumStart = offset;
};

LazyFrame.prototype.skipChecksum =
function skipChecksum() {
    var self = this;

    if (self.checksumStart === null) {
        self.skipTransportHeaders();
    }

    self.checksumType = self.frameBuffer
        .readUInt8(self.checksumStart, true);

    var offset = self.checksumStart + 1;
    if (self.checksumType !== 0x00) {
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
