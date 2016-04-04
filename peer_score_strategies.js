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

var Range = require('./range');

module.exports.PreferOutgoing = PreferOutgoing;
module.exports.NoPreference = NoPreference;
module.exports.PreferIncoming = PreferIncoming;

function PreferOutgoing(peer) {
    this.peer = peer;
    this.lastTier = this.getTier();
}

PreferOutgoing.UNCONNECTED = 0;
PreferOutgoing.ONLY_INCOMING = 1;
PreferOutgoing.FRESH_OUTGOING = 2;
PreferOutgoing.READY_OUTGOING = 3;

PreferOutgoing.prototype.getTier = function getTier() {
    var inconn = this.peer.getInConnection();
    var outconn = this.peer.getIdentifiedOutConnection();

    if (!inconn && !outconn) {
        return PreferOutgoing.UNCONNECTED;
    } else if (!outconn || outconn.direction !== 'out') {
        return PreferOutgoing.ONLY_INCOMING;
    } else if (outconn.remoteName === null) {
        return PreferOutgoing.FRESH_OUTGOING;
    } else {
        return PreferOutgoing.READY_OUTGOING;
    }
};

PreferOutgoing.prototype.getScoreRange = function getScoreRange() {
    // space:
    //   [0.1, 0.4)  peers with no identified outgoing connection
    //   [0.4, 1.0)  identified outgoing connections
    var tier = this.getTier();
    this.lastTier = tier;
    switch (tier) {
        default:
            /* falls through */
        case PreferOutgoing.ONLY_INCOMING:
            /* falls through */
        case PreferOutgoing.UNCONNECTED:
            /* falls through */
        case PreferOutgoing.FRESH_OUTGOING:
            return new Range(0.1, 0.4);
        case PreferOutgoing.READY_OUTGOING:
            return new Range(0.4, 1.0);
    }
};

function NoPreference(peer) {
    this.peer = peer;
    this.lastTier = this.getTier();
}

NoPreference.UNCONNECTED = 0;
NoPreference.CONNECTED = 1;
NoPreference.IDENTIFIED = 2;

NoPreference.prototype.getTier = function getTier() {
    var conn = this.peer.getIdentifiedOutConnection();

    if (!conn) {
        return NoPreference.UNCONNECTED;
    } else if (conn.remoteName === null) {
        return NoPreference.CONNECTED;
    } else {
        return NoPreference.IDENTIFIED;
    }
};

NoPreference.prototype.getScoreRange = function getScoreRange() {
    // space:
    //   (0.1, 0.4]  peers with no identified connection
    //   (0.4, 1.0]  identified connections
    var tier = this.getTier();
    this.lastTier = tier;
    switch (tier) {
        default:
            /* falls through */
        case NoPreference.UNCONNECTED:
            /* falls through */
        case NoPreference.CONNECTED:
            return new Range(0.1, 0.4);
        case NoPreference.IDENTIFIED:
            return new Range(0.4, 1.0);
    }
};

function PreferIncoming(peer) {
    this.peer = peer;
    this.lastTier = this.getTier();
}

PreferIncoming.UNCONNECTED = 0;
PreferIncoming.ONLY_OUTGOING = 1;
PreferIncoming.FRESH_INCOMING = 2;
PreferIncoming.READY_INCOMING = 3;

PreferIncoming.prototype.getTier = function getTier() {
    var outconn = this.peer.getOutConnection();
    var inconn = this.peer.getIdentifiedInConnection();

    if (!inconn && !outconn) {
        return PreferIncoming.UNCONNECTED;
    } else if (!inconn || inconn.direction !== 'in') {
        return PreferIncoming.ONLY_OUTGOING;
    } else if (inconn.remoteName === null) {
        return PreferIncoming.FRESH_INCOMING;
    } else {
        return PreferIncoming.READY_INCOMING;
    }
};

PreferIncoming.prototype.getScoreRange = function getScoreRange() {
    // space:
    //   [0.1, 0.4)  peers with no identified outgoing connection
    //   [0.4, 1.0)  identified outgoing connections
    var tier = this.getTier();
    this.lastTier = tier;
    switch (tier) {
        default:
            /* falls through */
        case PreferIncoming.ONLY_OUTGOING:
            /* falls through */
        case PreferIncoming.UNCONNECTED:
            /* falls through */
        case PreferIncoming.FRESH_INCOMING:
            return new Range(0.1, 0.4);
        case PreferIncoming.READY_INCOMING:
            return new Range(0.4, 1.0);
    }
};
