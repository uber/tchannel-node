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

module.exports = PeerHeap;

// A max-score (pre-computed) for peer selection

function PeerHeap(random) {
    var self = this;

    self.random = random || Math.random;
    assert(typeof self.random === 'function', 'PeerHeap expected random fn');

    self.array = [];
    // TODO: worth it to keep a tail free list like TimeHeap?
    // self.end = 0;
    self._stack = [];
}

PeerHeap.prototype.chooseWeightedRandom = function chooseWeightedRandom(threshold, filter) {
    var self = this;

    // We select into this set as long as we have ranges that overlap. Then,
    // we introduce randomness into the set and choose
    var seedPeer = self.array[0].peer;
    var seedRange = seedPeer.pendingWeightedRange();
    var set = [seedPeer];
    var minRangeStart = seedRange[0];
    var i;

    self._stack.push(0);

    while (self._stack.length) {
        i = self._stack.shift();
        var el = self.array[i];

        var range = el.peer.pendingWeightedRange();

        if (range[1] <= minRangeStart) {
            // If this range ends before the range with the smallest start
            // begins, then it's no longer overlapping. Continue without
            // adding the left and right children to the search stack.
            continue;
        } else if (!filter || filter(el.peer)) {
            minRangeStart = Math.min(minRangeStart, range[0]);
            set.push(el.peer);
        }

        // Continue DFS down heap
        var left = 2 * i + 1;
        var right = 2 * i + 2;
        if (left < self.array.length) {
            self._stack.push(left);
            if (right < self.array.length) {
                self._stack.push(right);
            }
        }
    }

    self._stack.length = 0;

    var chosenPeer = null;
    var highestProbability = 0;
    var probability;
    for (i = 0; i < set.length; i++) {
        probability = set[i].scoreStrategy.getScore();
        if ((probability > highestProbability) && (probability > threshold)) {
            highestProbability = probability;
            chosenPeer = set[i];
        }
    }

    return chosenPeer;
};

PeerHeap.prototype.choose = function choose(threshold, filter) {
    var self = this;

    if (!self.array.length) {
        return null;
    }

    return self.chooseWeightedRandom(threshold, filter);
};

PeerHeap.prototype.clear = function clear() {
    var self = this;

    for (var i = 0; i < self.array.length; i++) {
        var el = self.array[i];
        el.heap = null;
        el.peer = null;
        el.score = 0;
        el.index = 0;
    }
    self.array.length = 0;
};

PeerHeap.prototype.add = function add(peer) {
    var self = this;

    var range = peer.pendingWeightedRange();

    var i = self.push(peer, range[1]);
    var el = self.array[i];
    return el;
};

PeerHeap.prototype.rescore = function rescore() {
    var self = this;

    for (var i = 0; i < self.array.length; i++) {
        var el = self.array[i];
        el.score = el.peer.pendingWeightedRange()[1];
    }
    self.heapify();
};

PeerHeap.prototype.heapify = function heapify() {
    var self = this;

    if (self.array.length <= 1) {
        return;
    }

    for (var i = Math.floor(self.array.length / 2 - 1); i >= 0; i--) {
        self.siftdown(i);
    }
};

PeerHeap.prototype.remove = function remove(i) {
    var self = this;

    if (i >= self.array.length) {
        return;
    }

    if (self.array.length === 1) {
        self.array.pop();
        return;
    }

    var j = self.array.length - 1;
    if (i === j) {
        self.array.pop();
        return;
    }

    self.swap(i, j);
    self.array.pop();
    self.siftup(i);
};

PeerHeap.prototype.push = function push(peer, score) {
    var self = this;

    var el = new PeerHeapElement(self);
    el.peer = peer;
    el.score = score;
    el.index = self.array.length;

    self.array.push(el);
    return self.siftup(el.index);
};

PeerHeap.prototype.pop = function pop() {
    var self = this;
    var peer = null;

    if (!self.array.length) {
        return peer;
    }

    if (self.array.length === 1) {
        peer = self.array.pop();
        return peer;
    }

    peer = self.array[0].peer;
    self.array[0] = self.array.pop();
    self.siftdown(0);

    return peer;
};

PeerHeap.prototype.siftdown = function siftdown(i) {
    var self = this;

    while (true) {
        var left = (2 * i) + 1;
        if (left >= self.array.length) {
            return i;
        }

        var right = left + 1;
        var child = left;
        if (right < self.array.length &&
            self.array[right].score > self.array[left].score) {
            child = right;
        }

        if (self.array[child].score > self.array[i].score) {
            self.swap(i, child);
            i = child;
        } else {
            return i;
        }
    }
};

PeerHeap.prototype.siftup = function siftup(i) {
    var self = this;

    while (i > 0) {
        var par = Math.floor((i - 1) / 2);
        if (self.array[i].score > self.array[par].score) {
            self.swap(i, par);
            i = par;
        } else {
            return i;
        }
    }

    return 0;
};

PeerHeap.prototype.swap = function swap(i, j) {
    var self = this;

    var a = self.array[i];
    var b = self.array[j];

    self.array[i] = b;
    self.array[j] = a;
    b.index = i;
    a.index = j;
};

function PeerHeapElement(heap) {
    var self = this;

    self.heap = heap;
    self.peer = null;
    self.score = 0;
    self.index = 0;
}

PeerHeapElement.prototype.rescore = function rescore(score) {
    var self = this;

    if (!self.heap) {
        return;
    }

    if (score === undefined) {
        score = self.peer.pendingWeightedRange()[1];
    }

    self.score = score;
    self.index = self.heap.siftup(self.index);
    self.index = self.heap.siftdown(self.index);
};
