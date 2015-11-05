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

var assert = require('assert');
var CountedReadySignal = require('ready-signal/counted');
var errors = require('./errors');

// TODO: subsume and unify with channel draining

function PeerDrain(peer, options, callback) {
    var chan = peer.channel.topChannel || peer.channel;
    var self = this;

    assert(options, 'options is required');
    assert(options.reason, 'a reason is required');
    assert(!chan.draining, 'cannot drain a peer while channel is draining');

    self.channel = chan;
    self.peer = peer;
    self.timeout = options.timeout || 0;
    self.reason = options.reason;
    self.direction = options.direction || 'both';
    self.callback = callback || null;
    self.timer = null;
    self.drained = null;
    self.startedAt = 0;
    self.stoppedAt = 0;
    self.finishedAt = 0;

}

PeerDrain.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info.drainTimeout = self.timeout;
    info.drainReason = self.reason;
    info.drainDirection = self.direction;
    info.drainStartedAt = self.startedAt;
    info.drainStoppedAt = self.stoppedAt;
    info.drainFinishedAt = self.finishedAt;
    info.drainCounter = self.drained && self.drained.counter;

    return info;
};

PeerDrain.prototype.start =
function start() {
    var self = this;

    self.startedAt = self.channel.timers.now();
    self.drained = CountedReadySignal(1);

    var timer = null;
    if (self.timeout) {
        if (self.timer) {
            self.channel.timers.clearTimeout(self.timer);
        }
        timer = self.channel.timers.setTimeout(drainTimedOut, self.timeout);
        self.timer = timer;
    }

    process.nextTick(self.drained.signal);
    self.drained(drainDone);

    for (var i = 0; i < self.peer.connections.length; i++) {
        self.drainConnection(self.peer.connections[i]);
    }

    self.peer.logger.info('draining peer', self.peer.extendLogInfo(
        self.extendLogInfo({})
    ));

    function drainDone() {
        var now = self.channel.timers.now();
        finish(null, now);
    }

    function drainTimedOut() {
        if (self.finishedAt) {
            return;
        }
        var now = self.channel.timers.now();
        finish(errors.PeerDrainTimedOutError({
            direction: self.direction,
            elapsed: now - self.startedAt,
            timeout: self.timeout
        }), now);
    }

    function finish(err, now) {
        if (timer) {
            self.channel.timers.clearTimeout(timer);
            if (self.timer === timer) {
                self.timer = null;
            }
        }
        if (!self.finishedAt) {
            self.finishedAt = now;
            if (self.callback) {
                self.callback(err);
                self.callback = null;
            }
        }
    }
};

PeerDrain.prototype.stop =
function stop() {
    var self = this;

    // self.reason = '';
    // self.direction = '';

    self.stoppedAt = self.channel.timers.now();

    if (self.timer) {
        self.channel.timers.clearTimeout(self.timer);
        self.timer = null;
    }

    self.callback = null;
};

PeerDrain.prototype.drainConnection =
function drainConnection(conn) {
    var self = this;

    if (self.direction === 'both' ||
        self.direction === conn.direction) {
        self.drained.counter++;
        conn.drain(self.reason, self.drained.signal);
    }
};

module.exports.PeerDrain = PeerDrain;
