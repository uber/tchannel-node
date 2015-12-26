'use strict';

var Buffer = require('buffer').Buffer;

var V2Frames = require('./v2-frames.js');

var EMPTY_BUFFER = new Buffer(0);

module.exports = OutResponse;

function OutResponse(reqFrameId, conn, cacheBuf, csumstart) {
    this.id = reqFrameId;
    this.conn = conn;

    this.respHeaders = null;
    this.cacheBuf = cacheBuf;
    this.csumstart = csumstart;
}

// TODO: safety with an indexOf scan for duplicate headers
OutResponse.prototype.setHeader =
function setHeader(keyName, keyValue) {
    var self = this;

    if (!self.respHeaders) {
        self.respHeaders = [];
    }

    self.respHeaders.push(keyName);
    self.respHeaders.push(keyValue);
};

OutResponse.prototype.sendOk =
function sendOk(arg2, arg3) {
    var self = this;

    self._sendArgs(0x00, arg2, arg3);
};

OutResponse.prototype.sendNotOk =
function sendNotOk(arg2, arg3) {
    var self = this;

    self._sendArgs(0x01, arg2, arg3);
};

/*eslint complexity: 0*/
OutResponse.prototype._sendArgs =
function _sendArgs(code, arg2, arg3) {
    var self = this;

    arg2 = arg2 || EMPTY_BUFFER;
    arg3 = arg3 || EMPTY_BUFFER;

    if (self.cacheBuf) {
        self._sendCache(
            code,
            typeof arg2 === 'string' ? arg2 : null,
            Buffer.isBuffer(arg2) ? arg2 : null,
            typeof arg3 === 'string' ? arg3 : null,
            Buffer.isBuffer(arg3) ? arg3 : null
        );
    } else {
        self._sendFrame(
            code,
            typeof arg2 === 'string' ? arg2 : null,
            Buffer.isBuffer(arg2) ? arg2 : null,
            typeof arg3 === 'string' ? arg3 : null,
            Buffer.isBuffer(arg3) ? arg3 : null
        );
    }
};

OutResponse.prototype._sendFrame =
function _sendFrame(code, arg2str, arg2buf, arg3str, arg3buf) {
    var self = this;

    var buffer = self.conn.globalWriteBuffer;
    var offset = 0;

    offset = V2Frames.writeFrameHeader(buffer, offset, 0, 0x04, self.id);
    offset = V2Frames.writeCallResponseBody(
        buffer, offset, code, self.respHeaders,
        arg2str, arg2buf, arg3str, arg3buf
    );

    // Write the correct size of the buffer.
    buffer.writeUInt16BE(offset, 0, true);

    self.conn.writeFrameCopy(buffer, offset);
};

OutResponse.prototype._sendCache =
function _sendCache(code, arg2str, arg2buf, arg3str, arg3buf) {
    var self = this;

    var buffer = self.conn.globalWriteBuffer;
    var offset = 0;

    offset = V2Frames.partialCallResponseWriteTail(
        buffer, offset, self.csumstart, self.id, self.cacheBuf,
        arg2str, arg2buf, arg3str, arg3buf
    );

    // Write the correct size of the buffer.
    buffer.writeUInt16BE(offset, 0, true);

    self.conn.writeFrameCopy(buffer, offset);
};
