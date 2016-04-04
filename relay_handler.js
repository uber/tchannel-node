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

var errors = require('./errors');
var stat = require('./stat-tags.js');

var LazyRelayInReq = require('./lazy_relay.js').LazyRelayInReq;
var logError = require('./lazy_relay.js').logError;

RelayHandler.RelayRequest = RelayRequest;

module.exports = RelayHandler;

function RelayHandler(channel, circuits) {
    this.channel = channel;
    this.circuits = circuits || null;
    this.logger = this.channel.logger;
    this.lazyEnabled = this.channel.options.useLazyRelaying;
}

RelayHandler.prototype.type = 'tchannel.relay-handler';

RelayHandler.prototype.handleLazily = function handleLazily(conn, reqFrame) {
    var self = this;

    if (!self.lazyEnabled) {
        return false;
    }

    var rereq = LazyRelayInReq.alloc();
    rereq.reset(conn, reqFrame);

    var err = rereq.initRead();
    if (err) {
        rereq.onReadError(err);
        return true;
    }

    rereq.peer = self.channel.peers.choosePeer(null);
    if (!rereq.peer) {
        rereq.sendErrorFrame('Declined', 'no peer available for request');
        self.logger.info('no relay peer available', rereq.extendLogInfo({}));
        rereq.free();
        return true;
    }

    conn.ops.addInReq(rereq);
    rereq.createOutRequest();

    return true;
};

RelayHandler.prototype.handleRequest = function handleRequest(req, buildRes) {
    var self = this;

    req.forwardTrace = true;

    var peer = self.channel.peers.choosePeer(null);
    if (!peer) {
        // TODO: stat
        // TODO: allow for customization of this message so hyperbahn can
        // augment it with things like "at entry node", "at exit node", etc
        buildRes().sendError('Declined', 'no peer available for request');
        self.logger.info('no relay peer available', req.extendLogInfo({}));
        return;
    }

    var rereq = new RelayRequest(self.channel, peer, req, buildRes);
    rereq.createOutRequest();
};

function RelayRequest(channel, peer, inreq, buildRes) {
    this.channel = channel;
    this.logger = this.channel.logger;
    this.inreq = inreq;
    this.inres = null;
    this.outres = null;
    this.outreq = null;
    this.buildRes = buildRes;
    this.peer = peer;
    this.error = null;

    this.boundOnError = onError;
    this.boundExtendLogInfo = extendLogInfo;
    this.boundOnIdentified = onIdentified;

    var self = this;
    inreq.timeoutEvent.on(onTimeout);

    function onTimeout(err) {
        self.onInRequestTimeout(err);
    }

    function onError(err) {
        self.onError(err);
    }

    function extendLogInfo(info) {
        return self.extendLogInfo(info);
    }

    function onIdentified(err) {
        if (err) {
            self.onError(err);
        } else {
            self.onIdentified();
        }
    }
}

RelayRequest.prototype.createOutRequest = function createOutRequest() {
    var self = this;

    if (self.outreq) {
        self.logger.warn('relay request already started', self.extendLogInfo({}));
        return;
    }

    self.peer.waitForIdentified(self.boundOnIdentified);
};

RelayRequest.prototype.onIdentified = function onIdentified() {
    var self = this;

    var conn = self.peer.getInConnection(true);
    if (!conn.remoteName) {
        // we get the problem
        self.logger.error('onIdentified called on no connection identified', {
            hostPort: self.peer.hostPort
        });
    }
    if (conn.closing) {
        // most likely
        self.logger.error('onIdentified called on connection closing', {
            hostPort: self.peer.hostPort
        });
    }

    var elapsed = self.channel.timers.now() - self.inreq.start;
    var timeout = Math.max(self.inreq.timeout - elapsed, 1);

    if (self.channel.maximumRelayTTL !== 0 &&
        timeout > self.channel.maximumRelayTTL
    ) {
        self.logger.warn(
            'Clamping timeout to maximum ttl allowed',
            self.extendLogInfo({
                timeout: timeout,
                maximumTTL: self.channel.maximumRelayTTL
            })
        );

        timeout = self.channel.maximumRelayTTL;
    }

    // TODO use a type for this literal
    self.outreq = self.channel.request({
        peer: self.peer,
        streamed: self.inreq.streamed,
        timeout: timeout,
        parent: self.inreq,
        tracing: self.inreq.tracing,
        checksum: self.inreq.checksum,
        forwardTrace: true,
        serviceName: self.inreq.serviceName,
        headers: self.inreq.headers,
        retryFlags: self.inreq.retryFlags
    });
    self.outreq.responseEvent.on(onResponse);
    self.outreq.errorEvent.on(self.boundOnError);

    if (self.outreq.streamed) {
        self.outreq.sendStreams(self.inreq.arg1, self.inreq.arg2, self.inreq.arg3);
    } else {
        self.outreq.send(self.inreq.arg1, self.inreq.arg2, self.inreq.arg3);
    }

    self.channel.emitFastStat(
        'tchannel.relay.latency',
        'timing',
        elapsed,
        new stat.RelayLatencyTags()
    );

    function onResponse(res) {
        self.onResponse(res);
    }
};

RelayRequest.prototype.createOutResponse = function createOutResponse(options) {
    var self = this;
    if (self.outres) {
        self.logger.warn('relay request already responded', self.extendLogInfo({
            error: self.error,
            options: options // TODO: seems like a Bad Idea ™
        }));
        return null;
    }

    // It is possible that the inreq gets reaped with a timeout
    // It is also possible that the out request gets repead with a timeout
    // Both the in & out req try to create an outgoing response
    if (self.inreq.res && self.inreq.res.codeString === 'Timeout') {
        self.logger.debug('relay request already timed out', {
            codeString: self.inreq.res.codeString,
            responseMessage: self.inreq.res.message,
            serviceName: self.outreq && self.outreq.serviceName,
            arg1: self.outreq && String(self.outreq.arg1),
            outRemoteAddr: self.outreq && self.outreq.remoteAddr,
            inRemoteAddr: self.inreq.remoteAddr,
            inSocketRemoteAddr: self.inreq.connection.socketRemoteAddr,
            error: self.error
        });
        return null;
    }

    self.outres = self.buildRes(options);

    return self.outres;
};

RelayRequest.prototype.onResponse = function onResponse(res) {
    var self = this;

    if (self.inres) {
        self.logger.warn('relay request got more than one response callback', {
            // TODO: better context
            remoteAddr: res.remoteAddr,
            id: res.id
        });
        return;
    }
    self.inres = res;

    if (!self.createOutResponse({
        streamed: self.inres.streamed,
        headers: self.inres.headers,
        code: self.inres.code
    })) {
        return;
    }

    if (self.outres.streamed) {
        self.inres.arg2.pipe(self.outres.arg2);
        self.inres.arg3.pipe(self.outres.arg3);
    } else {
        self.outres.send(self.inres.arg2, self.inres.arg3);
    }
};

RelayRequest.prototype.onError = function onError(err) {
    var self = this;

    if (self.error) {
        self.logger.warn('Unexpected double onError', self.inreq.extendLogInfo({
            error: err,
            oldError: self.error
        }));
    }
    self.error = err;

    if (!self.createOutResponse()) {
        return;
    }
    var codeName = errors.classify(err) || 'UnexpectedError';

    self.outres.sendError(codeName, err.message);
    self.logError(err, codeName);
};

RelayRequest.prototype.onInRequestTimeout =
function onInRequestTimeout(err) {
    var self = this;

    var codeName = errors.classify(err) || 'UnexpectedError';
    self.logError(err, codeName);
};

RelayRequest.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    // XXX does inreq give:
    // info.remoteAddr = self.inreq.remoteAddr;
    // info.id = self.inreq.id;
    info.outRemoteAddr = self.outreq && self.outreq.remoteAddr;
    info = self.inreq.extendLogInfo(info);

    return info;
};

RelayRequest.prototype.logError = function relayRequestLogError(err, codeName) {
    var self = this;

    logError(self.logger, err, codeName, self.boundExtendLogInfo);
};
