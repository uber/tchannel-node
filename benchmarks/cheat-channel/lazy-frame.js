'use strict';

/* @flow */

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

/*::
import * as type from './lazy-frame.h.js';
declare var LazyFrame : Class<type.LazyFrame>
*/

/*eslint max-statements: [2, 30]*/
module.exports = LazyFrame;

function LazyFrame(sourceConnection, frameBuffer, offset, length) {
    var self/*:LazyFrame*/ = this;

    self.sourceConnection = sourceConnection;
    self.frameBuffer = frameBuffer;
    self.offset = offset;
    self.length = length;

    self.oldId = null;
    self.newId = null;
    self.frameType = null;

    self.initReqHeaders = null;

    self.reqServiceName = null;
    self.tHeadersCount = null;
    self.checksumType = null;
    self.arg1Length = null;
    self.arg2Length = null;
    self.arg3Length = null;
    self.arg1 = null;
    self.arg1str = null;
    self.arg2 = null;
    self.arg2str = null;
    self.arg3 = null;
    self.arg3str = null;

    self.tHeadersStart = null;
    self.checksumStart = null;
    self.arg1Start = null;
    self.arg2Start = null;
    self.arg3Start = null;
}

LazyFrame.prototype.readId =
function readId() {
    var self/*:LazyFrame*/ = this;

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
    var self/*:LazyFrame*/ = this;

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
    var self/*:LazyFrame*/ = this;

    self.frameBuffer.writeUInt32BE(newId, self.offset + ID_OFFSET, true);

    self.newId = newId;
    return self.newId;
};

LazyFrame.prototype.markAsCallResponse =
function markAsCallResponse() {
    var self/*:LazyFrame*/ = this;

    self.tHeadersStart = self.offset + CRES_HEADER_OFFSET;
};

function readString(buffer, offset, end) {
    return buffer.utf8Slice(offset, end);
}

LazyFrame.prototype.readReqServiceName =
function readReqServiceName() {
    var self/*:LazyFrame*/ = this;

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
    var self/*:LazyFrame*/ = this;

    if (self.arg1str !== null) {
        return self.arg1str;
    }

    var offset;
    if (self.arg1Start === null) {
        offset = self.skipChecksum();
    } else {
        offset = self.arg1Start;
    }

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
    var self/*:LazyFrame*/ = this;

    if (self.arg1 !== null) {
        return self.arg1;
    }

    var offset;
    if (self.arg1Start === null) {
        offset = self.skipChecksum();
    } else {
        offset = self.arg1Start;
    }

    self.arg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg2Start = offset + self.arg1Length;
    self.arg1 = self.frameBuffer.slice(offset, self.arg2Start);

    return self.arg1;
};

LazyFrame.prototype.skipArg1 =
function skipArg1() {
    var self/*:LazyFrame*/ = this;

    if (self.arg2Start !== null) {
        return self.arg2Start;
    }

    var offset;
    if (self.arg1Start === null) {
        offset = self.skipChecksum();
    } else {
        offset = self.arg1Start;
    }

    self.arg1Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    return offset;
};

LazyFrame.prototype.readArg2 =
function readArg2() {
    var self/*:LazyFrame*/ = this;

    if (self.arg2 !== null) {
        return self.arg2;
    }

    var offset;
    if (self.arg2Start === null) {
        offset = self.skipArg1();
    } else {
        offset = self.arg2Start;
    }

    self.arg2Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg3Start = offset + self.arg2Length;
    self.arg2 = self.frameBuffer.slice(offset, self.arg3Start);

    return self.arg2;
};

LazyFrame.prototype.skipArg2 =
function skipArg2() {
    var self/*:LazyFrame*/ = this;

    if (self.arg3Start !== null) {
        return self.arg3Start;
    }

    var offset;
    if (self.arg2Start === null) {
        offset = self.skipArg1();
    } else {
        offset = self.arg2Start;
    }

    self.arg2Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    self.arg3Start = offset + self.arg2Length;

    return self.arg3Start;
};

LazyFrame.prototype.readArg2str =
function readArg2str() {
    var self/*:LazyFrame*/ = this;

    if (self.arg2str !== null) {
        return self.arg2str;
    }

    var offset;
    if (self.arg2Start === null) {
        offset = self.skipArg1();
    } else {
        offset = self.arg2Start;
    }

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
    var self/*:LazyFrame*/ = this;

    if (self.arg3 !== null) {
        return self.arg3;
    }

    var offset;
    if (self.arg3Start === null) {
        offset = self.skipArg2();
    } else {
        offset = self.arg3Start;
    }

    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3 = self.frameBuffer.slice(offset, end);

    return self.arg3;
};

LazyFrame.prototype.readArg3str =
function readArg3str() {
    var self/*:LazyFrame*/ = this;

    if (self.arg3str !== null) {
        return self.arg3str;
    }

    var offset;
    if (self.arg3Start === null) {
        offset = self.skipArg2();
    } else {
        offset = self.arg3Start;
    }

    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3str = readString(self.frameBuffer, offset, end);

    return self.arg3str;
};

LazyFrame.prototype.readOnlyArg3str =
function readOnlyArg3str() {
    var self/*:LazyFrame*/ = this;

    if (self.arg3str !== null) {
        return self.arg3str;
    }

    var offset;
    if (self.arg3Start === null) {
        offset = self.skipArg2();
    } else {
        offset = self.arg3Start;
    }

    self.arg3Length = self.frameBuffer.readUInt16BE(offset, true);
    offset += 2;

    var end = offset + self.arg3Length;
    self.arg3str = readString(self.frameBuffer, offset, end);

    return self.arg3str;
};

LazyFrame.prototype.skipTransportHeaders =
function skipTransportHeaders() {
    var self/*:LazyFrame*/ = this;

    if (self.tHeadersStart === null) {
        console.error('could not skipTransportHeaders()');
        return -1;
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
    return self.checksumStart;
};

LazyFrame.prototype.skipChecksum =
function skipChecksum() {
    var self/*:LazyFrame*/ = this;

    var offset;
    if (self.checksumStart === null) {
        offset = self.skipTransportHeaders();
    } else {
        offset = self.checksumStart;
    }

    self.checksumType = self.frameBuffer.readUInt8(offset, true);

    offset += 1;
    if (self.checksumType !== 0x00) {
        offset += 4;
    }

    self.arg1Start = offset;
    return offset;
};

LazyFrame.prototype.readInitReqHeaders =
function readInitReqHeaders() {
    var self/*:LazyFrame*/ = this;

    var initReqHeaders;
    if (self.initReqHeaders !== null) {
        return self.initReqHeaders;
    }

    initReqHeaders = self.initReqHeaders = [];
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

        initReqHeaders.push(headerKey);
        initReqHeaders.push(headerValue);
    }

    return initReqHeaders;
};
