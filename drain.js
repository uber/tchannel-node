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

var assert = require('assert');
var process = require('process');
var CountedReadySignal = require('ready-signal/counted');
var errors = require('./errors');

var GOAL_NOOP = 'noop';
var GOAL_CLOSE_DRAINED = 'close drained connections';
var GOAL_CLOSE_PEER = 'close peer';

PeerDrain.GOAL_NOOP = GOAL_NOOP;
PeerDrain.GOAL_CLOSE_DRAINED = GOAL_CLOSE_DRAINED;
PeerDrain.GOAL_CLOSE_PEER = GOAL_CLOSE_PEER;

// TODO: subsume and unify with channel draining

function PeerDrain(peer, options, callback) {
    var chan = peer.channel.topChannel || peer.channel;

    assert(options, 'options is required');
    assert(options.reason, 'a reason is required');
    assert(!chan.draining, 'cannot drain a peer while channel is draining');
    assert(!options.goal ||
           options.goal === GOAL_NOOP ||
           options.goal === GOAL_CLOSE_DRAINED ||
           options.goal === GOAL_CLOSE_PEER,
           'expected a valid goal (if any)');

    this.goal = options.goal || PeerDrain.GOAL_NOOP;
    this.channel = chan;
    this.peer = peer;
    this.timeout = options.timeout || 0;
    this.reason = options.reason;
    this.direction = options.direction || 'both';
    this.callback = callback || null;
    this.timer = null;
    this.drained = null;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.finishedAt = 0;
    this.thenFinish = thenFinish;

    var self = this;

    function thenFinish(err) {
        var now = self.channel.timers.now();
        self.finish(err, now);
    }
}

PeerDrain.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info.drainGoal = self.goal;
    info.drainReason = self.reason;
    info.drainTimeout = self.timeout;
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

        switch (self.goal) {
            case GOAL_NOOP:
                self.finish(err, now);
                break;

            case GOAL_CLOSE_DRAINED:
                self.thenCloseDrained(err);
                break;

            case GOAL_CLOSE_PEER:
                self.thenClosePeer(err);
                break;

            default:
                self.finish(err || new Error('invalid drain goal'), now);
        }
    }
};

PeerDrain.prototype.stop =
function stop(reason) {
    var self = this;

    self.peer.logger.info('stopping peer drain', self.peer.extendLogInfo(
        self.extendLogInfo({
            stopReason: reason
        })
    ));

    self.stoppedAt = self.channel.timers.now();

    if (self.timer) {
        self.channel.timers.clearTimeout(self.timer);
        self.timer = null;
    }

    self.callback = null;
};

PeerDrain.prototype.thenCloseDrained =
function thenCloseDrained(err) {
    var self = this;

    if (err) {
        var info = self.peer.extendLogInfo(self.extendLogInfo({
            error: err
        }));

        if (err.type === 'tchannel.drain.peer.timed-out') {
            self.peer.logger.warn(
                'drain timed out, force closing connections',
                info);
        } else {
            self.peer.logger.warn(
                'unexpected error draining connections, closing anyhow',
                info);
        }
    }

    self.peer.closeDrainedConnections(self.thenFinish);
};

PeerDrain.prototype.thenClosePeer =
function thenClosePeer(err) {
    var self = this;

    if (err) {
        var info = self.peer.extendLogInfo(self.extendLogInfo({
            error: err
        }));

        if (err.type === 'tchannel.drain.peer.timed-out') {
            self.peer.logger.warn(
                'drain timed out, force closing peer',
                info);
        } else {
            self.peer.logger.warn(
                'unexpected error draining connections, closing peer anyhow',
                info);
        }
    }

    self.peer.close(self.thenFinish);
};

PeerDrain.prototype.finish =
function finish(err, now) {
    var self = this;

    if (!self.finishedAt) {
        self.finishedAt = now;

        if (self.callback) {
            self.callback(err);
            self.callback = null;
        }
    }
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
