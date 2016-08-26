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
var setTimeout = require('timers').setTimeout;
var clearTimeout = require('timers').clearTimeout;

var TChannelPeersBase = require('./peers_base.js');
var PeerHeap = require('./peer_heap.js');

var REFRESH_TIMER = 60 * 1000;

function TChannelSubPeers(channel, options) {
    TChannelPeersBase.call(this, channel, options);

    var self = this;
    this.peerScoreThreshold = this.options.peerScoreThreshold || 0;
    this.choosePeerWithHeap = channel.choosePeerWithHeap;

    this.hasMinConnections = typeof options.minConnections === 'number';
    this.minConnections = options.minConnections;

    this.currentConnectedPeers = 0;
    this._heap = new PeerHeap(this, channel.random);

    this.boundOnOutConnectionDelta = boundOnOutConnectionDelta;
    this.boundOnRefreshConnectedPeers = boundOnRefreshConnectedPeers;

    this.refreshTimer = null;
    this.refreshConnectedPeersDelay = this.channel.refreshConnectedPeersDelay ||
        REFRESH_TIMER;

    if (this.hasMinConnections) {
        this.refreshTimer = setTimeout(
            this.boundOnRefreshConnectedPeers, this.refreshConnectedPeersDelay
        );
    }

    function boundOnOutConnectionDelta(delta, peer) {
        self.onOutConnectionDelta(peer, delta);
    }

    function boundOnRefreshConnectedPeers() {
        self.refreshConnectedPeers();
    }
}

inherits(TChannelSubPeers, TChannelPeersBase);

TChannelSubPeers.prototype.refreshConnectedPeers =
function refreshConnectedPeers() {
    var peers = this.values();

    var currentConnectedPeers = 0;
    for (var i = 0; i < peers.length; i++) {
        if (peers[i].countConnections('out') > 0) {
            currentConnectedPeers++;
        }
    }

    this.currentConnectedPeers = currentConnectedPeers;
    this.refreshTimer = setTimeout(
        this.boundOnRefreshConnectedPeers, this.refreshConnectedPeersDelay
    );
};

TChannelSubPeers.prototype.onOutConnectionDelta =
function onOutConnectionDelta(peer, delta) {
    var connCount = peer.countConnections('out');

    if (delta === 1 && connCount === 1) {
        this.currentConnectedPeers++;
    } else if (delta === -1 && connCount === 0) {
        this.currentConnectedPeers--;
    }
};

TChannelSubPeers.prototype.close = function close(callback) {
    var self = this;

    if (self.refreshTimer) {
        clearTimeout(self.refreshTimer);
    }

    var peers = self.values();
    TChannelPeersBase.prototype.close.call(self, peers, callback);
};

TChannelSubPeers.prototype.add = function add(hostPort, options) {
    /* eslint max-statements: [2, 25]*/
    var self = this;

    var peer = self._map[hostPort];
    if (peer) {
        return peer;
    }

    var topChannel = self.channel.topChannel;

    peer = topChannel.peers.add(hostPort, options);
    peer.setPreferConnectionDirection(self.preferConnectionDirection);

    if (peer.countConnections('out') > 0) {
        this.currentConnectedPeers++;
    }

    peer.deltaOutConnectionEvent.on(self.boundOnOutConnectionDelta);

    self._map[hostPort] = peer;
    self._keys.push(hostPort);

    var el = self._heap.add(peer);
    peer.heapElements.push(el);

    return peer;
};

TChannelSubPeers.prototype.clear = function clear() {
    var self = this;

    self._map = Object.create(null);
    self._keys = [];
    self._heap.clear();
};

TChannelSubPeers.prototype._delete = function _del(peer) {
    var self = this;

    var index = self._keys.indexOf(peer.hostPort);
    if (index === -1) {
        return;
    }

    if (peer.countConnections('out') > 0) {
        this.currentConnectedPeers--;
    }

    peer.deltaOutConnectionEvent
        .removeListener(self.boundOnOutConnectionDelta);

    delete self._map[peer.hostPort];
    popout(self._keys, index);

    for (var i = 0; i < peer.heapElements.length; i++) {
        var el = peer.heapElements[i];
        if (el.heap === self._heap) {
            el.heap.remove(el.index);
            popout(peer.heapElements, i);
            break;
        }
    }
};

TChannelSubPeers.prototype.setChoosePeerWithHeap = function setChoosePeerWithHeap(enabled) {
    var self = this;

    self.choosePeerWithHeap = enabled;
};

TChannelSubPeers.prototype.choosePeer = function choosePeer(req) {
    var self = this;

    if (self.choosePeerWithHeap) {
        return self.chooseHeapPeer(req);
    }

    return self.chooseLinearPeer(req);
};

/*eslint max-statements: [2, 40]*/
TChannelSubPeers.prototype.chooseLinearPeer = function chooseLinearPeer(req) {
    /* eslint complexity: [2, 15]*/
    var self = this;

    var hosts = self._keys;
    if (!hosts || !hosts.length) {
        return null;
    }

    var threshold = self.peerScoreThreshold;

    var selectedPeer = null;
    var secondaryPeer = null;
    var selectedScore = 0;
    var secondaryScore = 0;

    var notEnoughPeers = false;
    if (this.hasMinConnections) {
        notEnoughPeers = this.currentConnectedPeers < this.minConnections;
    }

    for (var i = 0; i < hosts.length; i++) {
        var hostPort = hosts[i];
        var peer = self._map[hostPort];

        var shouldSkip = req && req.triedRemoteAddrs && req.triedRemoteAddrs[hostPort];
        if (!shouldSkip) {
            var isSecondary = notEnoughPeers && peer.isConnected('out');
            var score = peer.getScore(req);

            if (self.channel.topChannel.peerScoredEvent) {
                self.channel.topChannel.peerScoredEvent.emit(peer, {
                    peer: peer,
                    reason: 'chooseLinearPeer',
                    score: score
                });
            }

            var want;
            if (isSecondary) {
                want = score > threshold && (
                    secondaryPeer === null || score > secondaryScore
                );
            } else {
                want = score > threshold &&
                    (selectedPeer === null || score > selectedScore);
            }

            if (want) {
                if (isSecondary) {
                    secondaryPeer = peer;
                    secondaryScore = score;
                } else {
                    selectedPeer = peer;
                    selectedScore = score;
                }
            }
        }
    }

    if (self.channel.topChannel.peerChosenEvent) {
        self.channel.topChannel.peerChosenEvent.emit(self, {
            mode: 'linear',
            peer: selectedPeer
        });
    }

    if (secondaryScore > selectedScore && selectedPeer) {
        selectedPeer.tryConnect(noop);
        return secondaryPeer;
    }

    return selectedPeer || secondaryPeer;
};

function noop() {}

TChannelSubPeers.prototype.chooseHeapPeer = function chooseHeapPeer(req) {
    var self = this;

    var peer;
    if ((req && req.triedRemoteAddrs)) {
        peer = self._choosePeerSkipTried(req);
    } else {
        peer = self._heap.choose(self.peerScoreThreshold);
    }

    if (self.channel.topChannel.peerChosenEvent) {
        self.channel.topChannel.peerChosenEvent.emit(self, {
            mode: 'heap',
            peer: peer
        });
    }

    return peer;
};

TChannelSubPeers.prototype._choosePeerSkipTried =
function _choosePeerSkipTried(req) {
    var self = this;

    return self._heap.choose(self.peerScoreThreshold, filterTriedPeers);

    function filterTriedPeers(peer) {
        var shouldSkip = req.triedRemoteAddrs[peer.hostPort];
        return !shouldSkip;
    }
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

module.exports = TChannelSubPeers;
