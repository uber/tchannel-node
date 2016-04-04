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
/* eslint no-console:0 no-process-exit:0 */

var console = require('console');
var PeerHeap = require('../peer_heap');
var process = require('process');

function rand(lo, hi) {
    return Math.floor(Math.random() * (hi - lo + 1) + lo);
}

function Peer() {
    if (!(this instanceof Peer)) {
        return new Peer();
    }
    var self = this;

    self.scoreRange = {};
    self.pendingCount = 0;
    self.randPending();
    self.el = null;
}

Peer.prototype.getScoreRange = function getScoreRange() {
    var self = this;

    return self.scoreRange;
};

Peer.prototype.randPending = function randPending() {
    var self = this;

    self.pendingCount = rand(0, 10);
    var nums = [Math.random(), Math.random()];
    self.scoreRange = {
        lo: Math.min(nums[0], nums[1]),
        hi: Math.max(nums[0], nums[1])
    };
    if (self.el) {
        self.el.rescore();
    }
};

Peer.prototype.getScore = function getScore() {
    var self = this;
    var diff = self.scoreRange.hi - self.scoreRange.lo;
    var num = Math.random();
    var score = self.scoreRange.lo + num * diff;
    return score;
};

/* eslint max-statements: [2, 28] */
function benchmark(numPeers, numChoices) {
    var heap = new PeerHeap();
    var i;
    var peers = [];
    var heapEls = [];
    var newPeer;
    var el;

    for (i = 0; i < numPeers; i++) {
        newPeer = new Peer();
        el = heap.add(newPeer);
        heapEls.push(el);
        newPeer.el = el;
        peers.push(newPeer);
    }

    var start = Date.now();

    for (i = 0; i < numChoices; i++) {
        var choice = heap.choose(0);
        if (choice) {
            choice.randPending();

            peers[rand(0, peers.length - 1)].randPending();
            peers[rand(0, peers.length - 1)].randPending();
            peers[rand(0, peers.length - 1)].randPending();
            peers[rand(0, peers.length - 1)].randPending();
            peers[rand(0, peers.length - 1)].randPending();
            peers[rand(0, peers.length - 1)].randPending();

        } else {
            console.log('no choice!');
        }
    }

    var time = Date.now() - start;

    return time;
}

console.log('pid:', process.pid);

console.log('benchmark(1000, 50000):', benchmark(1000, 50000));

