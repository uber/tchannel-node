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

var errors = require('./errors.js');
var inherits = require('util').inherits;
var process = require('process');
var Buffer = require('buffer').Buffer;
var setImmediate = require('timers').setImmediate;
var EventEmitter = require('./lib/event_emitter');

var TOMBSTONE_TTL_OFFSET = 500;

module.exports = Operations;

function Operations(opts) {
    EventEmitter.call(this);
    this.draining = false;
    this.drainEvent = this.defineEvent('drain');
    this.pendingChangeEvent = this.defineEvent('pendingChange');
    this.pendingChangeDelta = null;

    this.timers = opts.timers;
    this.logger = opts.logger;
    this.random = opts.random;
    this.connectionStalePeriod = opts.connectionStalePeriod;
    this.maxTombstoneTTL = opts.maxTombstoneTTL;
    this.connection = opts.connection;
    // TODO need this?
    this.destroyed = false;

    this.requests = {
        in: Object.create(null),
        out: Object.create(null)
    };
    this.pending = {
        in: 0,
        out: 0,
        errors: 0
    };
    this.lastTimeoutTime = 0;
}
inherits(Operations, EventEmitter);

Operations.prototype.emitPendingChange =
function emitPendingChange(numIn, numOut, numErrors) {
    var self = this;

    if (self.pendingChangeDelta !== null) {
        self.pendingChangeDelta.in += numIn;
        self.pendingChangeDelta.out += numOut;
        self.pendingChangeDelta.errors += numErrors;
    } else {
        self.pendingChangeEvent.emit(self, {
            in: numIn,
            out: numOut,
            errors: numErrors
        });
    }
};

Operations.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    if (self.connection) {
        info = self.connection.extendLogInfo(info);
    }

    return info;
};

Operations.prototype.setMaxTombstoneTTL =
function setMaxTombstoneTTL(ttl) {
    var self = this;

    self.maxTombstoneTTL = ttl;
};

function OperationTombstone(operations, id, time, req, context) {
    var self = this;

    var timeout = Math.min(
        TOMBSTONE_TTL_OFFSET + req.timeout,
        operations.maxTombstoneTTL
    );

    self.type = 'tchannel.operation.tombstone';
    self.isTombstone = true;
    self.logger = operations.logger;
    self.operations = operations;
    self.id = id;
    self.time = time;
    self.timeout = timeout;
    self.timeHeapHandle = null;
    self.destroyed = false;
    self.serviceName = req.serviceName;
    self.callerName = req.callerName;
    self.endpoint = req.endpoint;

    self.isPendingError = false;
    if (context && context.isErrorFrame) {
        self.isPendingError = errors.isPendingError(context.codeName);
    }
}

OperationTombstone.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    info.id = self.id;
    info.serviceName = self.serviceName;
    info.callerName = self.callerName;
    info.endpoint = self.endpoint;
    info.tombstoneTime = self.time;
    info.tombstoneTTL = self.timeout;
    info.heapCanceled = self.timeHeapHandle && !self.timeHeapHandle.item;
    info.heapExpireTime = self.timeHeapHandle && self.timeHeapHandle.expireTime;
    info.heapAmItem = self.timeHeapHandle && self.timeHeapHandle.item === self;

    if (self.operations) {
        info = self.operations.extendLogInfo(info);
        var other = self.operations.requests.out[self.id];
        if (self !== other) {
            info.otherType = typeof other;
            info.otherConstructorName = other && other.constructor && other.constructor.name;
        }
    }

    return info;
};

OperationTombstone.prototype.destroy = function destroy(now) {
    var self = this;

    self.destroyed = true;

    self.onTimeout(now);
};

OperationTombstone.prototype.onTimeout = function onTimeout(now) {
    var self = this;

    if (!self.destroyed && now < self.timeout + self.time) {
        self.logger.error('tombstone timed out too early', self.extendLogInfo({
            now: now,
            expireTime: self.timeout + self.time,
            delta: (self.timeout + self.time) - now
        }));
    }

    if (self.operations &&
        self.operations.requests.out[self.id] === self) {
        delete self.operations.requests.out[self.id];
        if (self.isPendingError) {
            self.operations.pending.errors--;
            self.operations.emitPendingChange(0, 0, -1);
        }
        self.operations = null;
    } else {
        self.logger.warn('mismatched expired operation tombstone', self.extendLogInfo({}));
        self.operations = null;
    }

    self.timeHeapHandle = null;
};

Operations.prototype.resetLastTimeoutTime = function resetLastTimeoutTime() {
    var self = this;

    self.lastTimeoutTime = 0;
};

Operations.prototype.checkLastTimeoutTime = function checkLastTimeoutTime(now) {
    var self = this;

    if (self.lastTimeoutTime &&
        now > self.lastTimeoutTime + self.connectionStalePeriod
    ) {
        self._deferResetDueToTimeouts(now);
    } else if (!self.lastTimeoutTime) {
        self.lastTimeoutTime = now;
    }
};

Operations.prototype._deferResetDueToTimeouts = function _deferResetDueToTimeouts(now) {
    var self = this;

    var elapsed = now - self.lastTimeoutTime;
    var err = errors.ConnectionStaleTimeoutError({
        period: self.connectionStalePeriod,
        elapsed: elapsed,
        lastTimeoutTime: self.lastTimeoutTime
    });
    process.nextTick(opCheckLastTimedout);

    function opCheckLastTimedout() {
        self.logger.warn('destroying socket from timeouts', self.connection.extendLogInfo({
            error: err
        }));
        self.connection.resetAll(err);
    }
};

Operations.prototype.getRequests = function getRequests() {
    var self = this;

    return self.requests;
};

Operations.prototype.getPending = function getPending() {
    var self = this;

    return self.pending;
};

// TODO: Merge getOutTombstone() with getOutReq()
Operations.prototype.getOutTombstone = function getOutTombstone(id) {
    var self = this;

    var op = self.requests.out[id] || null;
    if (op && !op.isTombstone) {
        return null;
    }

    return op;
};

Operations.prototype.getOutReq = function getOutReq(id) {
    var self = this;

    var req = self.requests.out[id] || null;
    if (req && req.isTombstone) {
        return null;
    }

    return req;
};

Operations.prototype.getInReq = function getInReq(id) {
    var self = this;

    return self.requests.in[id];
};

Operations.prototype.addOutReq = function addOutReq(req) {
    var self = this;

    req.operations = self;
    self.requests.out[req.id] = req;
    self.pending.out++;

    req.timeHeapHandle = self.connection.channel.timeHeap.update(req);

    self.emitPendingChange(0, 1, 0);

    return req;
};

Operations.prototype.addInReq = function addInReq(req) {
    var self = this;

    req.operations = self;
    self.requests.in[req.id] = req;
    self.pending.in++;

    req.timeHeapHandle = self.connection.channel.timeHeap.update(req);

    self.emitPendingChange(1, 0, 0);

    return req;
};

Operations.prototype.hasDrained = function hasDrained() {
    var self = this;

    if (self.pending.in === 0 &&
        self.pending.out === 0) {
        return true;
    } else if (self._isCollDrained(self.requests.in) &&
               self._isCollDrained(self.requests.out)) {
        return true;
    }

    return false;
};

Operations.prototype.checkDrained = function checkDrained() {
    var self = this;

    if (self.hasDrained()) {
        self.drainEvent.emit(self);
        self.drainEvent.removeAllListeners();
    }
};

Operations.prototype._isCollDrained = function _isCollDrained(coll) {
    var self = this;

    /*eslint-disable guard-for-in*/
    for (var id in coll) {
        var op = coll[id];
        if (!(op instanceof OperationTombstone) &&
            !op.drained && !(
                self.connection.channel.drainExempt &&
                self.connection.channel.drainExempt(op))
        ) {
            return false;
        }
    }
    /*eslint-enable guard-for-in*/

    return true;
};

Operations.prototype.popOutReq = function popOutReq(id, context) {
    var self = this;

    var req = self.requests.out[id];
    if (!req) {
        self.logMissingOutRequest(id, context);
        return null;
    } else if (req.isTombstone) {
        return null;
    }

    if (req.timeHeapHandle) {
        req.timeHeapHandle.cancel();
        req.timeHeapHandle = null;
    } else {
        self.logger.warn('Found OutRequest without timeHeapHandle', {
            serviceName: req.serviceName,
            endpoint: req.endpoint,
            socketRemoteAddr: req.remoteAddr,
            callerName: req.callerName
        });
    }

    var tombstone = new OperationTombstone(
        self, id, self.timers.now(), req, context
    );
    self.requests.out[id] = tombstone;
    tombstone.timeHeapHandle = self.connection.channel.timeHeap.update(tombstone, tombstone.time);

    var pendingErrors = 0;

    if (tombstone.isPendingError) {
        self.pending.errors++;
        pendingErrors++;
    }

    req.operations = null;
    self.pending.out--;
    if (self.draining) {
        self.checkDrained();
    }

    self.emitPendingChange(0, -1, pendingErrors);

    return req;
};

Operations.prototype.logMissingOutRequest =
function logMissingOutRequest(id, context) {
    var self = this;

    // context is err or res
    if (context && context.originalId) {
        context = {
            error: context,
            id: context.originalId,
            info: 'got error frame for unknown id'
        };
    } else if (context && context.id) {
        context = {
            responseId: context.id,
            code: context.code,
            arg1: Buffer.isBuffer(context.arg1) ?
                String(context.arg1) : 'streamed-arg1',
            info: 'got call response for unknown id'
        };
    }

    // This could be because of a confused / corrupted server.
    self.logger.info('popOutReq received for unknown or lost id',
        self.connection.extendLogInfo({
            context: context,
            socketRemoteAddr: self.connection.socketRemoteAddr,
            direction: self.connection.direction
        })
    );
};

Operations.prototype.popInReq = function popInReq(id) {
    var self = this;

    var req = self.requests.in[id];
    if (!req) {
        // TODO warn ?
        return null;
    }

    if (req.timeHeapHandle) {
        req.timeHeapHandle.cancel();
        req.timeHeapHandle = null;
    }

    delete self.requests.in[id];
    self.pending.in--;

    self.emitPendingChange(-1, 0, 0);

    if (self.draining) {
        self.checkDrained();
    }

    return req;
};

Operations.prototype.clear = function clear() {
    var self = this;

    var now = self.timers.now();
    var inReqKeys = Object.keys(self.requests.in);
    var outReqKeys = Object.keys(self.requests.out);

    for (var i = 0; i < inReqKeys.length; i++) {
        self.popInReq(inReqKeys[i]);
    }
    for (var j = 0; j < outReqKeys.length; j++) {
        self.popOutReq(outReqKeys[j]);

        var tombstone = self.requests.out[outReqKeys[j]];
        if (tombstone.timeHeapHandle) {
            tombstone.timeHeapHandle.cancel();
        }
        tombstone.destroy(now);
    }
};

Operations.prototype.destroy = function destroy() {
    var self = this;

    self.destroyed = true;
};

Operations.prototype.sanitySweep = function sanitySweep(callback) {
    var self = this;

    self._sweepOps(self.requests.in, 'in', doneSweep);
    self._sweepOps(self.requests.out, 'out', doneSweep);

    var i = 0;
    function doneSweep() {
        i++;
        if (i === 2) {
            callback();
        }
    }
};

Operations.prototype._sweepOps = function _sweepOps(ops, direction, callback) {
    /*eslint max-statements: [2, 40]*/
    var self = this;

    // keep track of all pending change made during the sweep so we can
    // (maybe) emit one event at the end of the sweep

    self.pendingChangeDelta = {
        in: 0,
        out: 0,
        errors: 0
    };
    var pendingDirty = false;

    var now = self.timers.now();

    nextOp(Object.keys(ops), 0, callback);

    /*eslint complexity: 0*/
    function nextOp(opKeys, i, done) {
        if (i >= opKeys.length) {
            done(null);
            return;
        }

        var id = opKeys[i];
        var op = ops[id];

        if (!Object.prototype.hasOwnProperty.call(ops, id)) {
            setImmediate(deferNextOp);
            return;
        }

        if (op === undefined && (id in ops)) {
            self.logger.warn('unexpected undefined operation', {
                direction: direction,
                id: id
            });
        } else if (op.timedOut) {
            self.logger.warn('lingering timed-out operation', {
                direction: direction,
                id: id
            });

            if (direction === 'in') {
                self.popInReq(id);
                pendingDirty = true;
            } else if (direction === 'out') {
                self.popOutReq(id);
                pendingDirty = true;
            }
        } else if (op.isTombstone) {
            var heap = self.connection.channel.timeHeap;
            var expireTime = op.time + op.timeout;

            if (!op.operations) {
                self.logger.warn('zombie tombstone', op.extendLogInfo({
                    direction: direction,
                    opKey: id
                }));
                delete ops[id];
                if (op.isPendingError) {
                    self.pending.errors--;
                    self.pendingChangeDelta.errors--;
                    pendingDirty = true;
                }
                op.operations = null;
                op.timeHeapHandle.cancel();
                op.timeHeapHandle = null;
            } else if (expireTime < now && heap.lastRun > expireTime) {
                self.logger.warn('stale tombstone', op.extendLogInfo({
                    direction: direction,
                    opKey: id,
                    now: now,
                    staleDelta: op.time + op.timeout - now,
                    expireTime: expireTime,
                    heapLastRun: heap.lastRun
                }));
                delete ops[id];
                if (op.isPendingError) {
                    self.pending.errors--;
                    self.pendingChangeDelta.errors--;
                    pendingDirty = true;
                }
                op.operations = null;
                op.timeHeapHandle.cancel();
                op.timeHeapHandle = null;
            }
        }

        setImmediate(deferNextOp);

        function deferNextOp() {
            nextOp(opKeys, i + 1, done);
        }
    }

    if (pendingDirty) {
        self.pendingChangeEvent.emit(self, self.pendingChangeDelta);
    }
    self.pendingChangeDelta = null;
};
