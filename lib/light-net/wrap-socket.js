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

'use strict';

var process = require('process');
var assert = require('assert');

/*
on(data) DONE
on(close) DONE
on(error) DONE
write() DONE
getPendingWrites() DONE
isClosed() DONE
getRemotePeerInfo() DONE
destroy() DONE
connect(host, port) DONE
accept() DONE
*/

var GUID = 0;

module.exports = WrapSocket;

function WrapSocket(handle) {
    this.handle = handle;
    this.handle.owner = this;
    this.connected = false;
    this.readable = false;
    this.writable = false;

    this.pendingWrites = 0;
    this.shouldClose = false;
    this.closed = false;

    this._owner = null;
    this.guid = ++GUID;
}

WrapSocket.prototype.setOwner = function setOwner(owner) {
    var self = this;

    self._owner = owner;
};

WrapSocket.prototype.accept = function accept() {
    var self = this;

    assert(self._owner !== null, 'owner must be set');

    self.connected = true;
    self.readable = true;
    self.writable = true;

    self._readStart();
};

WrapSocket.prototype.destroy = function destroy() {
    var self = this;

    if (self.handle) {
        self._close(false);
    }
};

WrapSocket.prototype.connect = function connect(host, port) {
    var self = this;

    assert(self._owner !== null, 'owner must be set');

    var connectReq = self.handle.connect(host, port);
    if (connectReq === null) {
        return self._bailError('connect', null);
    }

    connectReq.oncomplete = afterConnect;
};

WrapSocket.prototype.getRemotePeerName = function getRemotePeerName() {
    var self = this;

    return self.handle.getpeername();
};

WrapSocket.prototype.isClosed = function isClosed() {
    var self = this;

    return self.closed;
};

WrapSocket.prototype.getPendingWrites = function getPendingWrites() {
    var self = this;

    return self.pendingWrites;
};

WrapSocket.prototype.writeBuffer = function writeBuffer(buffer) {
    var self = this;

    assert(self.connected, 'cannot write without being connected');

    if (self.closed) {
        return self.writeAfterFIN();
    }

    var writeReq = self.handle.writeBuffer(buffer);
    if (!writeReq) {
        return self._bailError('write', null);
    }

    writeReq.oncomplete = afterWrite;
    if (this.handle.writeQueueSize === 0) {
        writeReq.flushed = true;
    } else {
        self.pendingWrites++;
    }
};

function afterWrite(status, handle, writeReq) {
    handle.owner._afterWrite(status, handle, writeReq);
}

WrapSocket.prototype.writeAfterFIN = function writeAfterFIN() {
    var self = this;

    var err = new Error('This socket has been ended by the other party');
    err.code = 'EPIPE';

    self._owner.onSocketError(err);
};

WrapSocket.prototype._afterWrite =
function _afterWrite(status, handle, writeReq) {
    var self = this;

    if (status) {
        return self._bailError('write', null);
    }

    if (!writeReq.flushed) {
        self.pendingWrites--;
    }

    if (self.pendingWrites === 0 && self.shouldClose) {
        self._close(false);
    }
};

function afterConnect(err, handle, req, readable, writable) {
    handle.owner._afterConnect(err, handle, req, readable, writable);
}

WrapSocket.prototype._afterConnect =
function _afterConnect(err, handle, req, readable, writable) {
    var self = this;

    if (err) {
        return self._bailError('connect', null);
    }

    self.readable = readable;
    self.writable = writable;
    self.connected = true;

    self._readStart();

    self._owner.onSocketWritable();
};

WrapSocket.prototype._readStart = function readStart() {
    var self = this;

    self.handle.setNoDelay(true);
    self.handle.onread = onRead;

    var err = self.handle.readStart();
    if (err) {
        self._bailError('read', null);
    }
};

function onRead(buffer, offset, length) {
    this.owner._onRead(buffer, offset, length);
}

WrapSocket.prototype._onRead = function _onRead(buffer, offset, length) {
    var self = this;

    if (buffer) {
        self._owner.onSocketBuffer(buffer, offset, offset + length);
    } else if (process._errno === 'EOF') {
        self._owner.onSocketEnd();

        // Not half-open; wait for write to be flushed before
        // we close the actual socket.
        self._closeSoon();
    } else {
        self._bailError('read', null);
    }
};

WrapSocket.prototype._closeSoon = function _closeSoon() {
    var self = this;

    self.shouldClose = true;
    if (self.pendingWrites === 0) {
        self._close(false);
    }
};

WrapSocket.prototype._close = function _close(isError) {
    var self = this;

    if (self.closed) {
        return;
    }

    self.handle.close();
    self.handle = null;
    self.closed = true;

    self._owner.onSocketClose(isError);
};

WrapSocket.prototype._bailError = function _bailError(reason, cb) {
    var self = this;

    self._close(true);

    var ex = errnoException(process._errno, reason);
    if (cb) {
        cb(ex);
    } else {
        self._owner.onSocketError(ex);
    }
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
