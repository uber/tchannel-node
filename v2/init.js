// Copyright (c) 2016 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

/* eslint-disable curly */

var bufrw = require('bufrw');
var header = require('./header');
var errors = require('../errors');

module.exports.Request = InitRequest;
module.exports.Response = InitResponse;

var RequiredHeaderFields = ['host_port', 'process_name'];

function InitRequest(version, headers) {
    this.type = InitRequest.TypeCode;
    this.version = version || 0;
    this.headers = headers || {};
}

InitRequest.TypeCode = 0x01;

InitRequest.RW = bufrw.Struct(InitRequest, [
    {call: {poolWriteInto: writeFieldGuard}},
    {name: 'version', rw: bufrw.UInt16BE}, // version:2
    {name: 'headers', rw: header.header2}, // nh:2 (hk~2 hv~2){nh}
    {call: {poolReadFrom: readFieldGuard}}
]);

// TODO: MissingInitHeaderError check / guard

function InitResponse(version, headers) {
    this.type = InitResponse.TypeCode;
    this.version = version || 0;
    this.headers = headers || {};
}

InitResponse.TypeCode = 0x02;

InitResponse.RW = bufrw.Struct(InitResponse, [
    {call: {poolWriteInto: writeFieldGuard}},
    {name: 'version', rw: bufrw.UInt16BE}, // version:2
    {name: 'headers', rw: header.header2}, // nh:2 (hk~2 hv~2){nh}
    {call: {poolReadFrom: readFieldGuard}}
]);

function writeFieldGuard(destResult, initBody, buffer, offset) {
    var err = requiredFieldGuard(initBody.headers);
    if (err) return destResult.reset(err, offset);
    else return destResult.reset(null, offset);
}

function readFieldGuard(destResult, initBody, buffer, offset) {
    var err = requiredFieldGuard(initBody.headers);
    if (err) return destResult.reset(err, offset);
    else return destResult.reset(null, offset);
}

function requiredFieldGuard(headers) {
    for (var i = 0; i < RequiredHeaderFields.length; i++) {
        var field = RequiredHeaderFields[i];
        if (headers[field] === undefined) {
            return errors.MissingInitHeaderError({field: field});
        }
    }
    return null;
}
