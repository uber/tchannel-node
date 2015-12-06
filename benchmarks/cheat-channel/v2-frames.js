'use strict';

/*eslint max-params: 0, max-statements: 0 */
var process = require('process');

module.exports = {
    initFrameSize: initFrameSize,
    writeInitBody: writeInitBody,
    writeCallResponseBody: writeCallResponseBody,
    writeFrameHeader: writeFrameHeader
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
