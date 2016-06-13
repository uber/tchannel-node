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

var safeJSONParse = require('safe-json-parse/tuple');
var fs = require('fs');
var assert = require('assert');

function ChannelWatcher(channel, opts) {
    var self = this;

    assert(channel.topChannel, 'must be a subChannel');
    this.channel = channel;
    this.filePath = opts.filePath;
    this.refreshInterval = opts.refreshInterval || 5007;
    this.logger = channel.logger;

    this._boundReload = _boundReload;

    this._validateFilePath();
    this._establishFileWatcher();

    // Trigger an initial load
    this.reloadSync();

    function _boundReload() {
        self.reload();
    }
}

ChannelWatcher.prototype._validateFilePath = function _validateFilePath() {
    if (!fs.existsSync(this.filePath)) {
        assert(false, 'Peer hosts file does not exist: ' + this.filePath);
    }
};

ChannelWatcher.prototype._readPeerListFromFileSync =
function _readPeerListFromFileSync() {
    var tuple = safeJSONParse(fs.readFileSync(this.filePath, 'utf8'));
    if (tuple[0]) {
        assert(false, 'Invalid JSON for TChannel peer host file at ' + this.filePath);
    }
    return tuple[1];
};

ChannelWatcher.prototype._establishFileWatcher =
function _establishFileWatcher() {
    // Use watchFile instead of watch here. watch uses inotify events,
    // but since we're getting renames every 30 seconds and the inode is
    // changing we'd need to keep creating new watches for every file and
    // eventually exhaust the kernel's inotify watch limit.
    //
    // watchFile instead polls with stat. Not as performant as inotify, but
    // better than watches eventually failing.
    fs.watchFile(this.filePath, {
        interval: this.refreshInterval,
        persistent: true
    }, this._boundReload);
};

ChannelWatcher.prototype.destroy = function destroy() {
    fs.unwatchFile(this.filePath, this._boundReload);
};

/**
 * Load hosts from a JSON file and update peers in TChannel.
 */
ChannelWatcher.prototype.reloadSync =
function reloadSync() {
    this.logger.info('ChannelWatcher: Loading peer list from file sync', {
        filePath: this.filePath
    });

    var newPeers = this._readPeerListFromFileSync();
    this.updatePeers(newPeers);
};

ChannelWatcher.prototype.reload =
function reload() {
    var self = this;
    this.logger.info('ChannelWatcher: Loading peer list from file async', {
        filePath: this.filePath
    });

    this._readPeerList(onPeers);

    function onPeers(err, newPeers) {
        if (err) {
            self.logger.error('ChannelWatcher: Could not load peers file', {
                filePath: self.filePath,
                error: err
            });
            return;
        }

        self.updatePeers(newPeers);
    }
};

ChannelWatcher.prototype._readPeerList =
function _readPeerList(cb) {
    fs.readFile(this.filePath, 'utf8', onFile);

    function onFile(err, text) {
        if (err) {
            return cb(err);
        }

        var tuple = safeJSONParse(text);
        if (tuple[0]) {
            return cb(tuple[0]);
        }

        cb(null, tuple[1]);
    }
};

ChannelWatcher.prototype.updatePeers =
function updatePeers(newPeers) {
    // Take a snapshot of current, existing peers. This is used to delete old
    // peers later.
    var oldPeers = this.channel.peers.keys().slice();

    var i;

    // Load new peers; duplicates are ignored
    for (i = 0; i < newPeers.length; i++) {
        if (typeof newPeers[i] === 'string') {
            this.channel.peers.add(newPeers[i]);
        }
    }

    // Drain and delete existing peers that are not in the new peer list
    for (i = 0; i < oldPeers.length; i++) {
        if (newPeers.indexOf(oldPeers[i]) === -1) {
            this.logger.info('ChannelWatcher: Removing old peer', {
                peer: oldPeers[i]
            });

            var peer = this.channel.peers.get(oldPeers[i]);
            this.channel.peers.delete(oldPeers[i]);

            this.drainPeer(peer);
        }
    }

    this.logger.info('ChannelWatcher: Loaded peers', {
        newPeers: newPeers
    });
};

ChannelWatcher.prototype.drainPeer = function drainPeer(peer) {
    var self = this;
    if (peer.draining) {
        return;
    }

    peer.drain({
        goal: peer.DRAIN_GOAL_CLOSE_PEER,
        reason: 'peer has been removed from the peer list',
        direction: 'both',
        timeout: 5 * 1000
    }, thenDeleteIt);

    function thenDeleteIt(err) {
        if (err) {
            self.logger.warn(
                'ChannelWatcher: error closing peer, deleting anyhow',
                peer.extendLogInfo(peer.draining.extendLogInfo({
                    error: err
                }))
            );
        }

        self.channel.topChannel.peers.delete(peer.hostPort);
    }
};

module.exports = ChannelWatcher;
