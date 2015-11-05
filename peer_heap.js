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

// This is used for every DFS. It will end up being the size of the largest
// peer list.
var dfsStack = [0, 1, 2];

function PeerHeap(random) {
    var self = this;

    self.array = [];

    self.random = random || Math.random;
    assert(typeof self.random === 'function', 'PeerHeap expected random fn');

    // We cache the range los and his so they can be stored as a contiguous
    // array of boxed doubles. This has a noticable speed increase.
    self.rangehis = [];
    self.rangelos = [];
}

PeerHeap.prototype.choose1 = function choose1(threshold, filter) {
    var self = this;
    if (self.array[0].range.lo >= threshold && (!filter || filter(self.array[0].peer))) {
        return self.array[0].peer;
    }
};

PeerHeap.prototype.choose2 = function choose2(threshold, filter) {
    var self = this;
    var prob1 = self.array[0].peer.getScore();
    var prob2 = self.array[1].peer.getScore();

    if (prob1 > threshold && prob1 >= prob2 && (!filter || filter(self.array[0].peer))) {
        return self.array[0].peer;
    } else if (prob2 > threshold && (!filter || filter(self.array[1].peer))) {
        return self.array[1].peer;
    }
};

/*eslint-disable complexity */
/*eslint-disable max-statements */
PeerHeap.prototype.choose = function choose(threshold, filter) {
    var self = this;

    if (!self.array.length) {
        return null;
    }

    if (self.array.length === 1) {
        return self.choose1(threshold, filter);
    }

    if (self.array.length === 2) {
        return self.choose2(threshold, filter);
    }

    var chosenPeer = null;
    var maxRangeStart = self.array[0].range.lo;
    var highestProbability = 0;
    var firstScore = self.array[0].peer.getScore();

    // Pointers into dfsStack
    var stackBegin = 0;
    var stackEnd = 0;

    if (firstScore > threshold && (!filter || filter(self.array[0].peer))) {
        // Don't check first peer if it looks good, check its children though
        chosenPeer = self.array[0].peer;
        highestProbability = firstScore;
        // The array is seeded with 0, 1, 2 so we just have to advance the
        // stack pointers
        stackBegin = 1;
        stackEnd = 2;
    }

    while (stackBegin <= stackEnd) {
        var i = dfsStack[stackBegin];
        stackBegin++;

        var el = self.array[i];

        if (self.rangehis[i] <= maxRangeStart) {
            // This range ends before the range with the largest start begins,
            // so it can't possibly be chosen over any of the ranges we've
            // seen. All ranges below this one have a smaller end, so this
            // range and any below it can't be chosen.
            continue;
        } else if (!filter || filter(el.peer)) {
            maxRangeStart = Math.max(maxRangeStart, self.rangelos[i]);

            // INLINE of TChannelPeer#getScore
            var lo = self.rangelos[i];
            var hi = self.rangehis[i];
            var rand = self.random();
            if (rand === 0) {
                rand = 1;
            }
            var probability = lo + ((hi - lo) * rand);

            if ((probability > highestProbability) && (probability > threshold)) {
                highestProbability = probability;
                chosenPeer = el.peer;
            }
        }

        // Continue DFS by 'pushing' left and right indexes onto end of
        // dfsStack, if the source array is long enough for that
        var left = 2 * i + 1;
        var right = left + 1;
        if (left < self.array.length) {
            dfsStack[++stackEnd] = left;
            if (right < self.array.length) {
                dfsStack[++stackEnd] = right;
            }
        }
    }

    return chosenPeer;
};
/*eslint-enable complexity */
/*eslint-enable max-statements */

PeerHeap.prototype.clear = function clear() {
    var self = this;

    for (var i = 0; i < self.array.length; i++) {
        var el = self.array[i];
        el.heap = null;
        el.peer = null;
        el.index = 0;
        el.range = null;
    }
    self.array.length = 0;
    self.rangehis.length = 0;
    self.rangelos.length = 0;
};

PeerHeap.prototype.add = function add(peer) {
    var self = this;

    var range = peer.scoreRange;
    var i = self.push(peer, range);
    var el = self.array[i];
    return el;
};

PeerHeap.prototype.rescore = function rescore() {
    var self = this;

    for (var i = 0; i < self.array.length; i++) {
        var el = self.array[i];
        el.range = el.peer.getScoreRange();
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

PeerHeap.prototype.push = function push(peer, range) {
    var self = this;

    var el = new PeerHeapElement(self);
    el.peer = peer;
    el.range = peer.scoreRange;
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

    for (;;) {
        var left = (2 * i) + 1;
        if (left >= self.array.length) {
            self.rangehis[i] = self.array[i].range.hi;
            self.rangelos[i] = self.array[i].range.lo;
            return i;
        }

        var right = left + 1;
        var child = left;
        if (right < self.array.length &&
            self.array[right].range.hi > self.array[left].range.hi) {
            child = right;
        }

        if (self.array[child].range.hi > self.array[i].range.hi) {
            self.swap(i, child);
            i = child;
        } else {
            self.rangehis[i] = self.array[i].range.hi;
            self.rangelos[i] = self.array[i].range.lo;
            return i;
        }
    }
};

PeerHeap.prototype.siftup = function siftup(i) {
    var self = this;

    while (i > 0) {
        var par = Math.floor((i - 1) / 2);
        if (self.array[i].range.hi > self.array[par].range.hi) {
            self.swap(i, par);
            i = par;
        } else {
            self.rangehis[i] = self.array[i].range.hi;
            self.rangelos[i] = self.array[i].range.lo;
            return i;
        }
    }

    self.rangehis[0] = self.array[0].range.hi;
    self.rangelos[0] = self.array[0].range.lo;

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

    self.rangehis[j] = a.range.hi;
    self.rangelos[j] = a.range.lo;

    self.rangehis[i] = b.range.hi;
    self.rangelos[i] = b.range.lo;
};

function PeerHeapElement(heap) {
    var self = this;

    self.heap = heap;
    self.peer = null;
    self.index = 0;
    self.range = null;
}

PeerHeapElement.prototype.rescore = function rescore(range) {
    var self = this;

    if (!self.heap) {
        return;
    }

    self.range = self.peer.scoreRange;
    self.index = self.heap.siftup(self.index);
    self.index = self.heap.siftdown(self.index);
};
