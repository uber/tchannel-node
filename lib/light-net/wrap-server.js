// Copyright (c) 2015 Uber Technologies, Inc.
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

/* Failures:

 - running send_test.js
 - sending a 1000 requests through eager relay
 - sending a 1000 requests through lazy relay
 - sending N requests to black hole with lazy relay
*/

'use strict';

var process = require('process');
var TCP_WRAP = process.binding('tcp_wrap').TCP;
var assert = require('assert');

var WrapSocket = require('./wrap-socket.js');

module.exports = WrapServer;

function WrapServer(owner) {
    assert(typeof owner.onSocketError === 'function',
        'Channel must implement onSocketError()');
    assert(typeof owner.onIncomingSocket === 'function',
        'Channel must implement onIncomingSocket()');

    this._owner = owner;

    this.serverHandle = new TCP_WRAP();
}

WrapServer.prototype.listen = function listen(port, host, onListen) {
    var self = this;

    assert(typeof port === 'number', 'must have a port');
    assert(typeof host === 'string', 'must have a IPv4 host');
    assert(typeof onListen === 'function', 'must have a callback');

    self.serverHandle.owner = self;
    self.serverHandle.onconnection = onConnection;

    var err = self.serverHandle.bind(host, port);
    if (err) {
        return self._bailError('listen', onListen);
    }

    err = self.serverHandle.listen(511);
    if (err) {
        return self._bailError('listen', onListen);
    }

    process.nextTick(onListen);
};

function onConnection(handle) {
    this.owner._onConnection(handle);
}

WrapServer.prototype._onConnection = function _onConnection(handle) {
    var self = this;

    if (!handle) {
        return self._bailError('accept', null);
    }

    var socket = new WrapSocket(handle);
    self._owner.onIncomingSocket(socket);
};

WrapServer.prototype.address = function address() {
    var self = this;

    if (!self.serverHandle) {
        return null;
    }

    return self.serverHandle.getsockname();
};

WrapServer.prototype._bailError = function _bailError(reason, cb) {
    var self = this;

    self.serverHandle.close();
    self.serverHandle = null;

    var ex = errnoException(process._errno, reason);
    if (cb) {
        cb(ex);
    } else {
        self._owner.onSocketError(ex);
    }
};

WrapServer.prototype.close = function close() {
    var self = this;

    self.serverHandle.close();
};

function errnoException(errorno, syscall) {
    // TODO make this more compatible with ErrnoException from src/node.cc
    // Once all of Node is using this function the ErrnoException from
    // src/node.cc should be removed.
    var e = new Error(syscall + ' ' + errorno);
    e.errno = e.code = errorno;
    e.syscall = syscall;
    return e;
}
