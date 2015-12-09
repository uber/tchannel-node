'use strict';

/*eslint no-console: 0*/
var Buffer = require('buffer').Buffer;

var V2Frames = require('./v2-frames.js');

var EMPTY_BUFFER = new Buffer(0);

TChannelSender.RequestOptions = RequestOptions;

module.exports = TChannelSender;

function TChannelSender(channel) {
    if (!(this instanceof TChannelSender)) {
        return new TChannelSender(channel);
    }

    this.channel = channel;
}

TChannelSender.prototype.send =
function send(options, onResponse) {
    var self = this;

    var arg1 = options.arg1;
    var arg2 = options.arg2 || EMPTY_BUFFER;
    var arg3 = options.arg3 || EMPTY_BUFFER;

    var headers = options.headers;
    if (!headers) {
        headers = [];
    } else if (!Array.isArray(headers)) {
        headers = toFlatArray(headers);
    }

    var reqOpts = new RequestOptions(
        options.serviceName,
        options.host,
        options.ttl || 100,
        headers,
        null,
        typeof arg1 === 'string' ? arg1 : null,
        Buffer.isBuffer(arg1) ? arg1 : null,
        typeof arg2 === 'string' ? arg2 : null,
        Buffer.isBuffer(arg2) ? arg2 : null,
        typeof arg3 === 'string' ? arg3 : null,
        Buffer.isBuffer(arg3) ? arg3 : null
    );
    self._send(reqOpts, onResponse);
};

TChannelSender.prototype._send =
function _send(reqOpts, onResponse) {
    var self = this;

    var conn = self.channel.peers.ensureConnection(reqOpts.host);
    var reqId = conn.allocateId();
    self.sendCallRequest(conn, reqOpts, reqId);

    conn.addPendingOutReq(reqId, onResponse, reqOpts.ttl);
};

TChannelSender.prototype._sendCache =
function _sendCache(
    cacheBuf, csumstart, host, ttl,
    arg2str, arg2buf, arg3str, arg3buf, onResponse
) {
    var self = this;

    var conn = self.channel.peers.ensureConnection(host);
    var reqId = conn.allocateId();
    self.sendCallRequestTail(
        conn, cacheBuf, csumstart, reqId,
        arg2str, arg2buf, arg3str, arg3buf
    );

    conn.addPendingOutReq(reqId, onResponse, ttl);
};

TChannelSender.prototype.sendCallRequestTail =
function sendCallRequestTail(
    conn, cacheBuf, csumstart, reqId, arg2str, arg2buf, arg3str, arg3buf
) {
    var buffer = conn.globalWriteBuffer;
    var offset = 0;

    offset = V2Frames.partialCallRequestWriteTail(
        buffer, offset, csumstart, reqId, cacheBuf,
        arg2str, arg2buf, arg3str, arg3buf
    );

    buffer.writeUInt16BE(offset, 0, true);

    conn.writeFrameCopy(buffer, offset);
};

TChannelSender.prototype.sendCallRequest =
function sendCallRequest(conn, reqOpts, reqId) {
    var buffer = conn.globalWriteBuffer;
    var offset = 0;

    offset = V2Frames.writeFrameHeader(buffer, offset, 0, 0x03, reqId);
    offset = V2Frames.writeCallRequestBody(
        buffer, offset, reqOpts.ttl, reqOpts.serviceName,
        reqOpts.headers, reqOpts.headersbuf,
        reqOpts.arg1str, reqOpts.arg1buf,
        reqOpts.arg2str, reqOpts.arg2buf,
        reqOpts.arg3str, reqOpts.arg3buf
    );

    buffer.writeUInt16BE(offset, 0, true);

    conn.writeFrameCopy(buffer, offset);
};

function toFlatArray(object) {
    var flatList = [];

    /*eslint guard-for-in: 0*/
    for (var key in object) {
        flatList.push(key);
        flatList.push(object[key]);
    }

    return flatList;
}

/*eslint complexity: 0, max-params: 0*/
function RequestOptions(
    serviceName, host, ttl, headers, headersbuf,
    arg1str, arg1buf, arg2str, arg2buf, arg3str, arg3buf
) {
    this.serviceName = serviceName;
    this.host = host;
    this.ttl = ttl;
    this.headers = headers;
    this.headersbuf = headersbuf;
    this.arg1str = arg1str;
    this.arg1buf = arg1buf;
    this.arg2str = arg2str;
    this.arg2buf = arg2buf;
    this.arg3str = arg3str;
    this.arg3buf = arg3buf;
}
