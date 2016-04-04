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

function Range(lo, hi) {
    var self = this;

    self.lo = lo;
    self.hi = hi;
}

// Scale this range by another range
Range.prototype.multiply = function multiply(range) {
    var self = this;

    var diff = self.hi - self.lo;

    self.hi = self.lo + (range.hi * diff);
    self.lo += (range.lo * diff);
};

Range.prototype.inspect = 
Range.prototype.toString = function toString() {
    var self = this;

    return "Range(" + self.lo + ", " + self.hi + ")";
};

// A max-score (pre-computed) for peer selection

// This is used for every DFS. It will end up being the size of the largest
// peer list.
var dfsStack = [0, 1, 2];

function PeerHeap() {
    var self = this;

    self.array = [];
    self.rangehis = [];
    self.rangelos = [];
}

PeerHeap.prototype.chooseWeightedRandom = function chooseWeightedRandom(threshold, filter) {
    var self = this;

    var chosenPeer = null;
    var maxRangeStart = self.array[0].range.lo;
    var highestProbability = 0;
    var firstScore = self.array[0].peer.getScore();
    var stackBegin = 0;
    var stackEnd = 0;

    if (firstScore > threshold && (!filter || filter(self.array[0].peer))) {
        chosenPeer = self.array[0].peer;
        highestProbability = firstScore;
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

            var lo = self.rangelos[i];
            var hi = self.rangehis[i];
            var probability = lo + ((hi - lo) * Math.random());

            if ((probability > highestProbability) && (probability > threshold)) {
                highestProbability = probability;
                chosenPeer = el.peer;
            }
        }

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
        el.range = null;
    }
    self.array.length = 0;
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
        el.score = el.range.hi;
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
    el.range = range;
    el.score = range.hi;
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
            self.rangehis[i] = self.array[i].range.hi;
            self.rangelos[i] = self.array[i].range.lo;
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
        if (self.array[i].score > self.array[par].score) {
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
};

function PeerHeapElement(heap) {
    var self = this;

    self.heap = heap;
    self.peer = null;
    self.score = 0;
    self.index = 0;
    self.range = null;
}

PeerHeapElement.prototype.rescore = function rescore(range) {
    var self = this;

    if (!self.heap) {
        return;
    }

    if (!range) {
        self.range = self.peer.scoreRange;
    } else {
        self.range = range;
    }

    self.score = self.range.hi;
    self.index = self.heap.siftup(self.index);
    self.index = self.heap.siftdown(self.index);
};

function rand(lo, hi) {
    return Math.floor(Math.random() * (hi - lo + 1) + lo);
    //return (lcg.rand() % (hi - lo + 1)) + lo;
}

function Peer() {
    if (!(this instanceof Peer)) {
        return new Peer();
    }
    var self = this;

    self.scoreRange = null;
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
    //var nums = [rand(0, 100), rand(0, 100)];
    var nums = [Math.random(), Math.random()];
    self.scoreRange = new Range(
        Math.min(nums[0], nums[1]),
        Math.max(nums[0], nums[1])
    );
};

Peer.prototype.getScore = function getScore() {
    var self = this;
    var diff = self.scoreRange.hi - self.scoreRange.lo;
    //var num = rand(self.scoreRange.lo, self.scoreRange.hi);
    var score = self.scoreRange.lo + diff * Math.random();
    return score;
};

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
        var choice = heap.choose(0, noop);
        if (choice) {
            choice.randPending();
            choice.el.rescore();
        } else {
            print("no choice!");
        }
    }

    var time = Date.now() - start;

    return time;
}

function noop () { return true; }

//while (true) {
    print("benchmark(1000, 50000):", benchmark(1000, 1000000));
//}
//print("benchmark(1000, 10000000):", benchmark(1000, 1000000000));

