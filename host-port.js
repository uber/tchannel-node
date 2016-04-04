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

var validIPv4 = /^\d+\.\d+\.\d+\.\d+$/;

module.exports.validateHostPort = validateHostPort;
module.exports.validateHost = validateHost;
module.exports.validatePort = validatePort;

function validateHost(host, allowEmphemeral) {
    if (typeof host !== 'string') {
        return 'Expected host to be a string';
    }

    if (!validIPv4.test(host)) {
        return 'Expected host to contain IPv4';
    }

    if (!allowEmphemeral && host === '0.0.0.0') {
        return 'Expected host to not be 0.0.0.0';
    }

    return null;
}

function validatePort(portNum, allowEmphemeral) {
    if (typeof portNum !== 'number') {
        return 'Expected port to be a number';
    }

    if (!(portNum >= 0 && portNum < 65536)) {
        return 'Expected port to be between >=0 & <65536';
    }

    if (!allowEmphemeral && portNum === 0) {
        return 'Expected port to not be 0';
    }

    return null;
}

function validateHostPort(hostPort, allowEmphemeral) {
    var reason;
    if (typeof hostPort !== 'string') {
        return 'Expected hostPort to be a string, got ' + JSON.stringify(hostPort) + ' instead';
    }

    var parts = hostPort.split(':');
    if (parts.length !== 2) {
        return 'Expected hostPort to be {ipv4}:{port}, got ' + JSON.stringify(hostPort) + 'instead';
    }

    var host = parts[0];
    reason = validateHost(host, allowEmphemeral);
    if (reason) {
        return reason + ' in ' + JSON.stringify(hostPort);
    }

    var portStr = parts[1];
    if (!stringIsValidNumber(portStr)) {
        return 'Expected port to be a valid number in ' + JSON.stringify(hostPort);
    }

    var portNum = parseInt(portStr, 10);
    reason = validatePort(portNum, allowEmphemeral);
    if (reason) {
        return reason + ' in ' + JSON.stringify(hostPort);
    }

    return null;
}

function stringIsValidNumber(numAsStr) {
    var num = parseInt(numAsStr, 10);
    return num.toString() === numAsStr;
}
