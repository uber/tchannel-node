'use strict';

/* @flow */

/*eslint no-console: 0*/
var Buffer = require('buffer').Buffer;

var V2Frames = require('./v2-frames.js');

var EMPTY_BUFFER = new Buffer(0);

TChannelSender.RequestOptions = RequestOptions;

/*::
var Channel = require('./channel.js');
var Connection = require('./connection.js');
var LazyFrame = require('./lazy-frame.js');

type StrOrBuf = string | Buffer | null;
type IOnResponse = (err?: Error, resp: LazyFrame) => void

type SendOptions = {
    arg1: StrOrBuf;
    arg2: StrOrBuf;
    arg3: StrOrBuf;
    headers: null | Array<string> | { [key: string]: string };
    serviceName: string,
    host: string,
    ttl: number | null
};

declare class RequestOptions {
    serviceName: string;
    host: string;
    ttl: number;
    headers: Array<string>;
    headersbuf: Buffer | null;
    arg1str: string | null;
    arg2str: string | null;
    arg3str: string | null;
    arg1buf: Buffer | null;
    arg2buf: Buffer | null;
    arg3buf: Buffer | null;

    constructor(
        serviceName: string, host: string, ttl: number,
        headers: Array<string>, headersbuf: Buffer | null,
        arg1str: string | null, arg1buf: Buffer | null,
        arg2str: string | null, arg2buf:  Buffer | null,
        arg3str: string | null, arg3buf: Buffer | null
    ): void;
}

declare class TChannelSender {
    channel: Channel;

    send: (options: SendOptions, onResponse: IOnResponse) => void;
    _send: (reqOpts: RequestOptions, onResponse: IOnResponse) => void;
    _sendCache: (
        cacheBuf: Buffer, csumstart: number, host: string, ttl: number,
        arg2str: string | null, arg2buf: Buffer | null,
        arg3str: string | null, arg3buf: Buffer | null,
        onResponse: IOnResponse
    ) => void;
    sendCallRequestTail: (
        conn: Connection, cacheBuf: Buffer, csumstart: number,
        reqId: number, arg2str: string | null, arg2buf: Buffer | null,
        arg3str: string | null, arg3buf: Buffer | null
    ) => void;
    sendCallRequest: (
        conn: Connection, reqOpts: RequestOptions, reqId: number
    ) => void;

    static RequestOptions: typeof RequestOptions
}
*/
module.exports = TChannelSender;

function TChannelSender(channel) {
    var self/*:TChannelSender*/ = this;

    self.channel = channel;
}

TChannelSender.prototype.send =
function send(options, onResponse) {
    var self/*:TChannelSender*/ = this;

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
        (typeof arg1 !== 'string' && arg1) ? arg1 : null,
        typeof arg2 === 'string' ? arg2 : null,
        typeof arg2 !== 'string' ? arg2 : null,
        typeof arg3 === 'string' ? arg3 : null,
        typeof arg3 !== 'string' ? arg3 : null
    );
    self._send(reqOpts, onResponse);
};

TChannelSender.prototype._send =
function _send(reqOpts, onResponse) {
    var self/*:TChannelSender*/ = this;

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
    var self/*:TChannelSender*/ = this;

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
    var self/*:RequestOptions*/ = this;

    self.serviceName = serviceName;
    self.host = host;
    self.ttl = ttl;
    self.headers = headers;
    self.headersbuf = headersbuf;
    self.arg1str = arg1str;
    self.arg1buf = arg1buf;
    self.arg2str = arg2str;
    self.arg2buf = arg2buf;
    self.arg3str = arg3str;
    self.arg3buf = arg3buf;
}
