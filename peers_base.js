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

var inherits = require('util').inherits;
var setImmediate = require('timers').setImmediate;
var EventEmitter = require('./lib/event_emitter');

function TChannelPeersBase(channel, options) {
    EventEmitter.call(this);
    this.channel = channel;
    this.logger = this.channel.logger;
    this.options = options || {};
    this._map = Object.create(null);
    this._keys = [];
    this.preferConnectionDirection = this.options.preferConnectionDirection || 'any';
}

inherits(TChannelPeersBase, EventEmitter);

TChannelPeersBase.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info = self.channel.extendLogInfo(info);

    return info;
};

TChannelPeersBase.prototype.close = function close(peers, callback) {
    var self = this;

    var counter = peers.length + 1;
    peers.forEach(function eachPeer(peer) {
        peer.close(onClose);
    });
    self.clear();
    onClose();

    function onClose() {
        if (--counter <= 0) {
            if (counter < 0) {
                self.logger.error('closed more peers than expected', {
                    counter: counter
                });
            }
            callback();
        }
    }
};

TChannelPeersBase.prototype.sanitySweep =
function sanitySweep(callback) {
    var self = this;

    nextPeer(self.values(), 0, callback);

    function nextPeer(peers, i, done) {
        if (i >= peers.length) {
            done(null);
            return;
        }

        var peer = peers[i];

        nextConn(peer.connections, 0, function connSweepDone(err) {
            if (err) {
                done(err);
                return;
            }
            setImmediate(deferNextPeer);
        });

        function deferNextPeer() {
            nextPeer(peers, i + 1, done);
        }
    }

    function nextConn(conns, i, done) {
        if (i >= conns.length) {
            done(null);
            return;
        }

        var conn = conns[i];
        conn.ops.sanitySweep(function opsSweepDone() {
            setImmediate(deferNextConn);
        });

        function deferNextConn() {
            nextConn(conns, i + 1, done);
        }
    }
};

TChannelPeersBase.prototype.get = function get(hostPort) {
    var self = this;

    return self._map[hostPort] || null;
};

TChannelPeersBase.prototype.keys = function keys() {
    var self = this;

    return self._keys.slice();
};

TChannelPeersBase.prototype.values = function values() {
    var self = this;

    var keys = self._keys;
    var ret = new Array(keys.length);
    for (var i = 0; i < keys.length; i++) {
        ret[i] = self._map[keys[i]];
    }

    return ret;
};

TChannelPeersBase.prototype.entries = function entries() {
    var self = this;

    var keys = self._keys;
    var ret = new Array(keys.length);
    for (var i = 0; i < keys.length; i++) {
        ret[i] = [keys[i], self._map[keys[i]]];
    }
    return ret;
};

TChannelPeersBase.prototype.delete = function del(hostPort) {
    var self = this;
    var peer = self._map[hostPort];

    if (!peer) {
        return null;
    }

    self._delete(peer);

    return peer;
};

module.exports = TChannelPeersBase;
