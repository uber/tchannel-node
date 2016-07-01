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

var EventEmitter = require('./lib/event_emitter');
var inherits = require('util').inherits;
var process = require('process');
var Buffer = require('buffer').Buffer;

var errors = require('./errors');
var States = require('./reqres_states');

var emptyBuffer = Buffer(0);

function TChannelInRequest(id, options) {
    /*eslint max-statements: [2, 40]*/

    EventEmitter.call(this);
    this.errorEvent = this.defineEvent('error');
    this.timeoutEvent = this.defineEvent('timeout');
    this.finishEvent = this.defineEvent('finish');
    this.channel = options.channel;

    this.timeout = options.timeout || 0;
    this.tracing = options.tracing || null;
    this.serviceName = options.serviceName || '';
    this.callerName = options.headers && options.headers.cn || '';
    this.headers = options.headers || {};
    this.checksum = options.checksum || null;
    this.retryFlags = options.retryFlags || null;
    this.connection = options.connection || null;

    this.state = States.Initial;
    this.operations = null;
    this.timeHeapHandle = null;
    this.id = id || 0;
    this.remoteAddr = null;
    this.streamed = false;
    this.arg1 = emptyBuffer;
    this.endpoint = null;
    this.arg2 = emptyBuffer;
    this.arg3 = emptyBuffer;
    this.forwardTrace = false;
    this.span = null;
    this.start = this.channel.timers.now();
    this.res = null;
    this.err = null;
    this.circuit = null;
    this.flags = options.flags;

    if (options.tracer) {
        this.setupTracing(options);
    }
}

inherits(TChannelInRequest, EventEmitter);

TChannelInRequest.prototype.type = 'tchannel.incoming-request';

TChannelInRequest.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    // TODO: add:
    // - request id?
    // - tracing id?
    // - other?

    info.inRequestId = self.id;
    info.inRequestType = self.type;
    info.inRequestState = States.describe(self.state);
    info.inRequestRemoteAddr = self.remoteAddr;
    info.serviceName = self.serviceName;
    info.callerName = self.callerName;
    info.inRequestErr = self.err;

    if (self.endpoint !== null) {
        info.inRequestArg1 = self.endpoint;
    } else {
        info.inRequestArg1 = String(self.arg1);
    }

    if (self.connection) {
        info = self.connection.extendLogInfo(info);
    }

    return info;
};

TChannelInRequest.prototype.setupTracing = function setupTracing(options) {
    var self = this;

    self.span = options.tracer.setupNewSpan({
        spanid: self.tracing.spanid,
        traceid: self.tracing.traceid,
        parentid: self.tracing.parentid,
        flags: self.tracing.flags,
        remoteName: options.hostPort,
        serviceName: self.serviceName,
        name: '' // fill this in later
    });

    self.span.annotateBinary('cn', self.callerName);
    self.span.annotateBinary('as', self.headers.as);
    if (self.connection) {
        self.span.annotateBinary('src', self.connection.remoteName);
    }

    self.span.annotate('sr');
};

TChannelInRequest.prototype.handleFrame = function handleFrame(parts, isLast) {
    var self = this;

    if (parts.length !== 3 || self.state !== States.Initial || !isLast) {
        return errors.ArgStreamUnimplementedError();
    }

    self.arg1 = parts[0] || emptyBuffer;
    self.endpoint = String(self.arg1);
    self.arg2 = parts[1] || emptyBuffer;
    self.arg3 = parts[2] || emptyBuffer;

    if (self.span) {
        self.span.name = self.endpoint;
    }

    self.emitFinish();

    return null;
};

TChannelInRequest.prototype.emitError = function emitError(err) {
    var self = this;

    if (self.circuit) {
        self.circuit.state.onRequestError(err);
    }

    self.err = err;
    self.errorEvent.emit(self, err);
};

TChannelInRequest.prototype.emitFinish = function emitFinish() {
    var self = this;

    self.state = States.Done;
    self.finishEvent.emit(self);
};

TChannelInRequest.prototype.onTimeout = function onTimeout(now) {
    var self = this;
    var timeoutError;

    if (!self.res ||
        self.res.state === States.Initial ||
        self.res.state === States.Streaming
    ) {
        // TODO: send an error frame response?
        // TODO: emit error on self.res instead / in addition to?
        // TODO: should cancel any pending handler
        timeoutError = errors.RequestTimeoutError({
            id: self.id,
            start: self.start,
            elapsed: now - self.start,
            timeout: self.timeout,
            remoteAddr: self.remoteAddr
        });
        process.nextTick(deferInReqTimeoutErrorEmit);
    }

    function deferInReqTimeoutErrorEmit() {
        if (!self.res || self.res.state === States.Initial) {
            self.timeoutEvent.emit(self, timeoutError);
            self.emitError(timeoutError);
        }

        if (self.operations) {
            self.operations.popInReq(self.id);
        }
    }
};

// TODO: deprecated, remove
TChannelInRequest.prototype.withArg1 = function withArg1(callback) {
    var self = this;
    callback(null, self.arg1);
};

TChannelInRequest.prototype.withArg2 = function withArg23(callback) {
    var self = this;
    callback(null, self.arg2);
};

TChannelInRequest.prototype.withArg23 = function withArg23(callback) {
    var self = this;
    callback(null, self.arg2, self.arg3);
};

module.exports = TChannelInRequest;
