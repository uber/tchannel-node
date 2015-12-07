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
        optimize away headers with RawRegister()

        OutResponse support arg2str & arg2buf pattern for faster
        shit.
*/
LazyFrame.alloc = allocLazyFrame;

module.exports = LazyFrame;

function allocLazyFrame(sourceConnection, frameBuffer, offset, length) {
    var frame;

    frame = new LazyFrame(
        sourceConnection, frameBuffer, offset, length
    );

    return frame;
}

function LazyFrame(sourceConnection, frameBuffer, offset, length) {
    this.sourceConnection = sourceConnection;
    this.frameBuffer = frameBuffer;
    this.offset = offset;
    this.length = length;

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

    self.oldId = self.frameBuffer.readUInt32BE(
        self.offset + ID_OFFSET, true
    );
    return self.oldId;
};

LazyFrame.prototype.readFrameType =
function readFrameType() {
    var self = this;

    if (self.frameType !== null) {
        return self.frameType;
    }

    self.frameType = self.frameBuffer.readUInt8(
        self.offset + TYPE_OFFSET, true
    );
    return self.frameType;
};

LazyFrame.prototype.writeId =
function writeId(newId) {
    var self = this;

    self.frameBuffer.writeUInt32BE(newId, self.offset + ID_OFFSET, true);

    self.newId = newId;
    return self.newId;
};

LazyFrame.prototype.markAsCallResponse =
function markAsCallResponse() {
    var self = this;

    self.tHeadersStart = self.offset + CRES_HEADER_OFFSET;
};

function readString(buffer, offset, end) {
    return buffer.utf8Slice(offset, end);
}

LazyFrame.prototype.readReqServiceName =
function readReqServiceName() {
    var self = this;

    if (self.reqServiceName !== null) {
        return self.reqServiceName;
    }

    var strLength = self.frameBuffer.readUInt8(
        self.offset + CREQ_SERVICE_OFFSET, true
    );
    self.tHeadersStart = self.offset + CREQ_SERVICE_OFFSET + 1 + strLength;

    self.reqServiceName = readString(
        self.frameBuffer,
        self.offset + CREQ_SERVICE_OFFSET + 1,
        self.tHeadersStart
    );
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
    self.arg1str = readString(
        self.frameBuffer, offset, self.arg2Start
    );

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
    self.arg2str = readString(
        self.frameBuffer, offset, self.arg3Start
    );

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
    self.arg3str = readString(self.frameBuffer, offset, end);

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
    self.arg3str = readString(self.frameBuffer, offset, end);

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
    var offset = self.offset + IREQ_HEADERS_OFFSET;
    var nh = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    for (var i = 0; i < nh; i++) {
        var keyLen = self.frameBuffer.readUInt16BE(offset, true);
        offset += 2;

        var headerKey = readString(
            self.frameBuffer, offset, offset + keyLen
        );
        offset += keyLen;

        var valueLen = self.frameBuffer.readUInt16BE(offset, true);
        offset += 2;

        var headerValue = readString(
            self.frameBuffer, offset, offset + valueLen
        );
        offset += valueLen;

        self.initReqHeaders.push(headerKey);
        self.initReqHeaders.push(headerValue);
    }

    return self.initReqHeaders;
};
