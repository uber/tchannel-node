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
var extend = require('xtend');

var TChannelPeersBase = require('./peers_base.js');
var TChannelPeer = require('./peer');

function TChannelRootPeers(channel, options) {
    TChannelPeersBase.call(this, channel, options);
    this.allocPeerEvent = this.defineEvent('allocPeer');
    this.peerOptions = this.options.peerOptions || {};
}

inherits(TChannelRootPeers, TChannelPeersBase);

TChannelRootPeers.prototype.close = function close(callback) {
    var self = this;

    var peers = self.values();
    TChannelPeersBase.prototype.close.call(self, peers, callback);
};

TChannelRootPeers.prototype.add = function add(hostPort, options) {
    /*eslint max-statements: [2, 25]*/
    var self = this;

    var peer = self._map[hostPort];
    if (peer) {
        return peer;
    }

    options = options || extend({}, self.peerOptions);
    options.preferConnectionDirection = self.preferConnectionDirection;
    peer = new TChannelPeer(self.channel, hostPort, options);
    self.allocPeerEvent.emit(self, peer);

    self._map[hostPort] = peer;
    self._keys.push(hostPort);

    return peer;
};

TChannelRootPeers.prototype.clear = function clear() {
    var self = this;

    var names = Object.keys(self.channel.subChannels);
    for (var i = 0; i < names.length; i++) {
        var subChannel = self.channel.subChannels[names[i]];
        subChannel.peers.clear();
    }

    self._map = Object.create(null);
    self._keys = [];
};

TChannelRootPeers.prototype._delete = function _del(peer) {
    var self = this;

    var names = Object.keys(self.channel.subChannels);
    for (var i = 0; i < names.length; i++) {
        var subChannel = self.channel.subChannels[names[i]];
        subChannel.peers._delete(peer);
    }

    delete self._map[peer.hostPort];
    var index = self._keys.indexOf(peer.hostPort);
    popout(self._keys, index);
};

TChannelRootPeers.prototype.choosePeer = function choosePeer(req) {
    return null;
};

function popout(array, i) {
    if (!array.length) {
        return;
    }

    var j = array.length - 1;
    if (i !== j) {
        var tmp = array[i];
        array[i] = array[j];
        array[j] = tmp;
    }
    array.pop();
}

module.exports = TChannelRootPeers;
