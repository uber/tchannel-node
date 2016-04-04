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

var format = require('util').format;

module.exports = hookupPeerScoreObs;

function hookupPeerScoreObs(log, client, servers) {
    client.peerScoredEvent.on(onPeerScored);
    client.peerChosenEvent.on(onPeerChosen);

    function onPeerScored(info) {
        var peerDesc = describeServerPeer(servers, info.peer);
        var mess = format('%s scored peer %s', info.reason, peerDesc);
        if (info.scores) {
            var changes = info.scores.map(function each(score, i) {
                var change = score.hi / info.oldScores[i].hi - 1;
                var sign = change > 0 ? '+' : '';
                var str = sign + (100 * change).toFixed(1);
                return pad(5, ' ', str) + '%';
            });
            mess += ' by ' + changes.join(', ');
        } else {
            mess += ' score=' + info.score;
        }
        log(mess);
    }

    function onPeerChosen(info) {
        var peerDesc = describeServerPeer(servers, info.peer);
        var mess = format('%s chose server %s', info.mode, peerDesc);
        log(mess);
    }
}

function describeServerPeer(servers, peer) {
    for (var i = 0; i < servers.length; i++) {
        if (peer.hostPort === servers[i].hostPort) {
            return '' + (i + 1);
        }
    }
    return 'unknown(' + peer.hostPort + ')';
}

function pad(n, c, s) {
    while (s.length < n) {
        s = c + s;
    }
    return s;
}
