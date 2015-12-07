'use strict';

/*eslint max-params: 0, max-statements: 0 */
var process = require('process');
var Buffer = require('buffer').Buffer;

module.exports = {
    initFrameSize: initFrameSize,
    writeInitBody: writeInitBody,
    writeCallResponseBody: writeCallResponseBody,
    writeCallRequestBody: writeCallRequestBody,
    writeFrameHeader: writeFrameHeader,
    writeHeaders: writeHeaders,
    headersSize: headersSize,
    partialCallRequestSize: partialCallRequestSize,
    partialCallRequestWriteHead: partialCallRequestWriteHead,
    partialCallRequestWriteTail: partialCallRequestWriteTail
};

function initFrameSize(hostPort) {
    // frameHeader:16 version:2 nh:2 hkl:2 hk:hkl hvl:2 hb:hvl
    var bufferLength =
        16 + // frameHeader:166
        2 + // version:2
        2 + // nh:2
        2 + 'host_port'.length + // hostPortKey
        2 + hostPort.length + // hostPortValue
        2 + 'process_name'.length + // processNameKey
        2 + process.title.length; // processNameValue

    return bufferLength;
}

function partialCallRequestSize(serviceName, headers, endpoint) {
    var byteLength = 0;

    byteLength += 16;
    byteLength += 1;
    byteLength += 4;
    byteLength += 25;
    byteLength += 1 + Buffer.byteLength(serviceName);
    byteLength += headersSize(headers);
    byteLength += 1;
    byteLength += 2 + Buffer.byteLength(endpoint);

    return byteLength;
}

/*
    flags:1 ttl:4 tracing:25
    service~1 nh:1 (hk~1 hv~1){nh}
    csumtype:1 (csum:4){0,1} arg1~2
*/
function partialCallRequestWriteHead(
    buffer, offset, ttl, serviceName, headers, endpoint
) {
    // size:2
    offset += 2;

    // type:1
    buffer.writeInt8(0x03, offset, true);
    offset += 1;

    // reserved:1
    offset += 1;

    // id:1
    offset += 4;

    // reserved:8
    offset += 8;

    // flags:1
    offset += 1;

    // ttl:4
    buffer.writeUInt32BE(ttl, offset, true);
    offset += 4;

    // tracing:25
    // TODO: tracing
    offset += 25;

    // service~1
    buffer.writeInt8(serviceName.length, offset, true);
    offset += 1;
    buffer.write(serviceName, offset, serviceName.length, 'utf8');
    offset += serviceName.length;

    offset = writeHeaders(buffer, offset, headers);
    var csumstart = offset;

    // csumtype:1
    offset += 1;

    // csum:4{0, 1}
    // TODO: csum
    offset += 0;

    offset = writeInt16String(buffer, offset, endpoint);

    return csumstart;
}

function partialCallRequestWriteTail(
    buffer, offset, csumstart, id, headBuf,
    arg2str, arg2buf, arg3str, arg3buf
) {
    headBuf.copy(buffer, 0, 0, headBuf.length);

    // id:4
    buffer.writeUInt32BE(id, offset + 4, true);

    // flags
    buffer.writeUInt32BE(0x00, offset + 16, true);

    // csumtype:1
    buffer.writeInt8(0x00, offset + csumstart, true);

    offset = headBuf.length;

    // arg2~2
    if (arg2buf) {
        offset = writeInt16Buffer(buffer, offset, arg2buf);
    } else {
        offset = writeInt16String(buffer, offset, arg2str);
    }

    // arg3~2
    if (arg3buf) {
        offset = writeInt16Buffer(buffer, offset, arg3buf);
    } else {
        offset = writeInt16String(buffer, offset, arg3str);
    }

    return offset;
}

function headersSize(headers) {
    var byteLength = 0;

    byteLength += 1;
    for (var i = 0; i < headers.length; i++) {
        byteLength += 1 + Buffer.byteLength(headers[i], 'utf8');
    }

    return byteLength;
}

function writeHeaders(buffer, offset, headers) {
    var numHeaders = headers.length / 2;
    // nh:1
    buffer.writeInt8(numHeaders, offset, true);
    offset += 1;

    for (var i = 0; i < numHeaders; i++) {
        var headerKey = headers[2 * i];
        var headerValue = headers[(2 * i) + 1];

        // hk~1
        buffer.writeInt8(headerKey.length, offset, true);
        offset += 1;

        buffer.write(headerKey, offset, headerKey.length, 'utf8');
        offset += headerKey.length;

        // hv~1
        buffer.writeInt8(headerValue.length, offset, true);
        offset += 1;

        buffer.write(headerValue, offset, headerValue.length, 'utf8');
        offset += headerValue.length;
    }

    return offset;
}

function writeInt16Buffer(buffer, offset, arg) {
    buffer.writeUInt16BE(arg.length, offset, true);
    arg.copy(buffer, offset + 2, 0, arg.length);

    return offset + 2 + arg.length;
}

function writeInt16String(buffer, offset, str) {
    var n = buffer.write(str, offset + 2, buffer.length - offset - 2, 'utf8');
    buffer.writeUInt16BE(n, offset, true);

    return offset + 2 + n;
}

/*
    flags:1 ttl:4 tracing:25
    service~1 nh:1 (hk~1 hv~1){nh}
    csumtype:1 (csum:4){0,1} arg1~2 arg2~2 arg3~2
*/
function writeCallRequestBody(
    buffer, offset, ttl, serviceName, headers, headersbuf,
    arg1str, arg1buf, arg2str, arg2buf, arg3str, arg3buf
) {
    // flags:1
    buffer.writeInt8(0x00, offset, true);
    offset += 1;

    // ttl:4
    buffer.writeUInt32BE(ttl, offset, true);
    offset += 4;

    // tracing:25
    // TODO: tracing
    offset += 25;

    // service~1
    buffer.writeInt8(serviceName.length, offset, true);
    offset += 1;
    buffer.write(serviceName, offset, serviceName.length, 'utf8');
    offset += serviceName.length;

    // headers
    if (headers) {
        offset = writeHeaders(buffer, offset, headers);
    } else if (headersbuf) {
        headersbuf.copy(buffer, offset, 0, headersbuf.length);
        offset += headersbuf.length;
    }

    // csumtype:1
    buffer.writeInt8(0x00, offset, true);
    offset += 1;

    // csum:4{0, 1}
    // TODO: csum
    offset += 0;

    if (arg1buf) {
        // arg1~2
        offset = writeInt16Buffer(buffer, offset, arg1buf);
    } else {
        offset = writeInt16String(buffer, offset, arg1str);
    }

    // arg2~2
    if (arg2buf) {
        offset = writeInt16Buffer(buffer, offset, arg2buf);
    } else {
        offset = writeInt16String(buffer, offset, arg2str);
    }

    // arg3~2
    if (arg3buf) {
        offset = writeInt16Buffer(buffer, offset, arg3buf);
    } else {
        offset = writeInt16String(buffer, offset, arg3str);
    }

    return offset;
}

/*
    flags:1 code:1 tracing:25
    nh:1 (hk~1 hv~1){nh}
    csumtype:1 (csum:4){0,1} arg1~2 arg2~2 arg3~2
*/
function writeCallResponseBody(
    buffer, offset, code, headers, arg2, arg3
) {
    // flags:1
    buffer.writeInt8(0x00, offset, true);
    offset += 1;

    // code:1
    buffer.writeInt8(code, offset, true);
    offset += 1;

    // tracing:25
    // TODO: tracing
    offset += 25;

    // headers
    offset = writeHeaders(buffer, offset, headers);

    // csumtype:1
    buffer.writeInt8(0x00, offset, true);
    offset += 1;

    // csum:4{0,1}
    // TODO: csum
    offset += 0;

    // arg1~2
    buffer.writeUInt16BE(0x00, offset, true);
    offset += 2;

    // arg2~2
    buffer.writeUInt16BE(arg2.length, offset, true);
    offset += 2;
    arg2.copy(buffer, offset, 0, arg2.length);
    offset += arg2.length;

    // arg3~2
    buffer.writeUInt16BE(arg3.length, offset, true);
    offset += 2;
    arg3.copy(buffer, offset, 0, arg3.length);
    offset += arg3.length;

    return offset;
}

function writeInitBody(buffer, offset, hostPort) {
    // Version
    buffer.writeUInt16BE(2, offset, true);
    offset += 2;
    // number of headers
    buffer.writeUInt16BE(2, offset, true);
    offset += 2;

    // key length
    buffer.writeUInt16BE('host_port'.length, offset, true);
    offset += 2;
    // key value
    buffer.write('host_port', offset, 'host_port'.length, 'utf8');
    offset += 'host_port'.length;

    // value length
    buffer.writeUInt16BE(hostPort.length, offset, true);
    offset += 2;
    // value value
    buffer.write(hostPort, offset, hostPort.length, 'utf8');
    offset += hostPort.length;

    // key length
    buffer.writeUInt16BE('process_name'.length, offset, true);
    offset += 2;
    // key value
    buffer.write('process_name', offset, 'process_name'.length, 'utf8');
    offset += 'process_name'.length;

    // value length
    buffer.writeUInt16BE(process.title.length, offset, true);
    offset += 2;
    // value value
    buffer.write(process.title, offset, process.title.length, 'utf8');
    offset += process.title.length;

    return offset;
}

function writeFrameHeader(buffer, offset, size, type, id) {
    // size
    buffer.writeUInt16BE(size, offset, true);
    offset += 2;

    // type
    buffer.writeInt8(type, offset, true);
    offset += 1;

    // reserved
    offset += 1;

    // id
    buffer.writeUInt32BE(id, offset, true);
    offset += 4;

    // reserved
    offset += 8;

    return offset;
}
