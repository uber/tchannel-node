// Copyright (c) 2020 Uber Technologies, Inc.
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

function PeerFileWatcher(channel, opts) {
    var self = this;

    assert(channel.topChannel, 'must be a subChannel');
    this.channel = channel;
    this.peerFile = opts.peerFile;
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

PeerFileWatcher.prototype._validateFilePath = function _validateFilePath() {
    if (!fs.existsSync(this.peerFile)) {
        assert(false, 'Peer hosts file does not exist: ' + this.peerFile);
    }
};

PeerFileWatcher.prototype._readPeerListFromFileSync =
function _readPeerListFromFileSync() {
    var tuple = safeJSONParse(fs.readFileSync(this.peerFile, 'utf8'));
    if (tuple[0]) {
        assert(false, 'Invalid JSON for TChannel peer host file at ' + this.peerFile);
    }
    return tuple[1];
};

PeerFileWatcher.prototype._establishFileWatcher =
function _establishFileWatcher() {
    // Use watchFile instead of watch here. watch uses inotify events,
    // but since we're getting renames every 30 seconds and the inode is
    // changing we'd need to keep creating new watches for every file and
    // eventually exhaust the kernel's inotify watch limit.
    //
    // watchFile instead polls with stat. Not as performant as inotify, but
    // better than watches eventually failing.
    fs.watchFile(this.peerFile, {
        interval: this.refreshInterval,
        persistent: true
    }, this._boundReload);
};

PeerFileWatcher.prototype.destroy = function destroy() {
    fs.unwatchFile(this.peerFile, this._boundReload);
};

/**
 * Load hosts from a JSON file and update peers in TChannel.
 */
PeerFileWatcher.prototype.reloadSync =
function reloadSync() {
    this.logger.info('PeerFileWatcher: Loading peer list from file sync', {
        peerFile: this.peerFile
    });

    var newPeers = this._readPeerListFromFileSync();
    this.channel.updatePeers(newPeers);
};

PeerFileWatcher.prototype.reload =
function reload() {
    var self = this;
    this.logger.info('PeerFileWatcher: Loading peer list from file async', {
        peerFile: this.peerFile
    });

    this._readPeerList(onPeers);

    function onPeers(err, newPeers) {
        if (err) {
            self.logger.error('PeerFileWatcher: Could not load peers file', {
                peerFile: self.peerFile,
                error: err
            });
            return;
        }

        self.channel.updatePeers(newPeers);
    }
};

PeerFileWatcher.prototype._readPeerList =
function _readPeerList(cb) {
    fs.readFile(this.peerFile, 'utf8', onFile);

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

module.exports = PeerFileWatcher;
