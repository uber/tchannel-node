'use strict';

var Buffer = require('buffer').Buffer;

var V2Frames = require('./v2-frames.js');

var EMPTY_BUFFER = new Buffer(0);

module.exports = OutResponse;

function OutResponse(reqFrameId, conn) {
    var self = this;

    self.id = reqFrameId;
    self.conn = conn;

    self.respHeaders = [];
}

// TODO: safety with an indexOf scan for duplicate headers
OutResponse.prototype.setHeader =
function setHeader(keyName, keyValue) {
    var self = this;

    self.respHeaders.push(keyName);
    self.respHeaders.push(keyValue);
};

OutResponse.prototype.sendOk =
function sendOk(arg2, arg3) {
    var self = this;

    if (!arg2) {
        arg2 = EMPTY_BUFFER;
    }
    if (!arg3) {
        arg3 = EMPTY_BUFFER;
    }
    if (typeof arg2 === 'string') {
        arg2 = new Buffer(arg2);
    }
    if (typeof arg3 === 'string') {
        arg3 = new Buffer(arg3);
    }

    self._sendOk(arg2, arg3);
};

OutResponse.prototype._sendOk =
function _sendOk(arg2, arg3) {
    var self = this;

    var buffer = self.conn.globalWriteBuffer;
    var offset = 0;

    offset = V2Frames.writeFrameHeader(buffer, offset, 0, 0x04, self.id);
    offset = V2Frames.writeCallResponseBody(
        buffer, offset, 0x00, self.respHeaders, arg2, arg3
    );

    // Write the correct size of the buffer.
    buffer.writeUInt16BE(offset, 0, true);

    var writeBuffer = new Buffer(offset);
    buffer.copy(writeBuffer, 0, 0, offset);
    self.conn.writeToSocket(writeBuffer);
};
