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
var fs = require('fs');
var TypedError = require('error/typed');
var WrappedError = require('error/wrapped');

var HostsFileDoesNotExistError = TypedError({
    type: 'tchannel.p2p-client.hosts-file.does-not-exist',
    message: 'Hosts file: `{file}` does not exist.',
    file: null
});

var HostsFileCouldNotBeReadError = WrappedError({
    type: 'tchannel.p2p-client.hosts-file.could-not-be-read',
    message: 'Hosts file `{file}` could not be read: `{causeMessage}`.',
    file: null
});

var HostsFileInvalidJSONError = WrappedError({
    type: 'tchannel.p2p-client.hosts-file.invalid-json',
    message: 'Hosts file `{file}` has invalid JSON: {origMessage}.\n' +
        'Content starts with {sampleText}.',
    file: null,
    contents: null
});

var InvalidHostFileContents = TypedError({
    type: 'tchannel.p2p-client.invalid-host-file-content',
    message: 'Hosts file `{file}` has invalid content.\n' +
        '{reason} but found {sampleText}.',
    file: null,
    reason: null,
    sampleText: null
});

var syncFileReader = new SyncFileReader();
var safeJSONParser = new SafeJSONParser();

module.exports = PeerToPeerClient;

function PeerToPeerClient(options) {
    assert(options && options.tchannel, 'Must pass in a tchannel');
    assert(options && options.tchannel && !options.tchannel.topChannel,
        'Must pass in top level tchannel');
    assert(options.tchannel.tracer, 'Top channel must have trace enabled');
    assert(options.callerName, 'must pass in callerName');
    assert(options.hyperbahnClient, 'must pass in a hyperbahn client');
    assert(options.tchannel.tracer.reporter.name !== 'nullReporter',
        'tchannel must have a non-null trace reporter');

    this.callerName = options.callerName;
    this.tchannel = options.tchannel;

    this.logger = options.logger || this.tchannel.logger;
    this.statsd = options.statsd;
}

PeerToPeerClient.prototype.getThriftSync =
function getThriftSync(options) {
    assert(options && options.serviceName, 'must pass serviceName');
    assert(options && options.thriftFile, 'must pass thriftFile');

    var channel = this.getClientChannelSync(options);

    return channel.TChannelAsThrift({
        entryPoint: options.thriftFile,
        strict: options.strict,
        logger: options.logger,
        bossMode: options.bossMode,
        channel: channel,
        isHealthy: options.isHealthy
    });
};

// Gets the subchannel for hitting a particular service
PeerToPeerClient.prototype.getClientChannelSync =
function getClientChannelSync(options) {
    assert(options && options.serviceName, 'must pass serviceName');
    assert(
        (options && options.hostFilePath) ||
        (options && options.hostList),
        'must pass hostFilePath or hostList'
    );

    var channelName = options.channelName || options.serviceName;

    if (this.tchannel.subChannels[channelName]) {
        assert(false, 'PeerToPeerClient cannot get client channel. ' +
            'channel already exists: ' + channelName);
    }

    var initialPeers = this.readPeersSync(
        options.hostFilePath, options.hostList
    );
    if (!initialPeers) {
        return null;
    }

    var channelOptions = {
        peers: initialPeers,
        serviceName: channelName,
        preferConnectionDirection: 'out',
        requestDefaults: {
            serviceName: channelName,
            headers: {
                cn: this.callerName
            }
        }
    };

    if ('trace' in options) {
        channelOptions.trace = options.trace;
    }
    if ('timeout' in options) {
        channelOptions.requestDefaults.timeout = options.timeout;
    }
    if ('retryLimit' in options) {
        channelOptions.requestDefaults.retryLimit = options.retryLimit;
    }

    var subChan = this.tchannel.makeSubChannel(channelOptions);
    this.addFileWatcher(subChan, options.hostFilePath);

    return subChan;
};

PeerToPeerClient.prototype.addFileWatcher =
function addFileWatcher(subChan, hostFilePath) {
};

PeerToPeerClient.prototype.readPeersSync =
function readPeersSync(hostFilePath, hostList) {
    if (!hostFilePath) {
        return hostList;
    }

    if (!fs.existsSync(hostFilePath)) {
        this._failSync(HostsFileDoesNotExistError({
            file: hostFilePath
        }));
        return null;
    }

    var contents = syncFileReader.readFileSync(hostFilePath);
    if (!contents) {
        this._failSync(
            HostsFileCouldNotBeReadError(syncFileReader.lastError, {
                file: hostFilePath
            })
        );
        return null;
    }

    var hosts = safeJSONParser.parseJSON(contents);
    if (!hosts) {
        this._failSync(
            HostsFileInvalidJSONError(safeJSONParser.lastError, {
                file: hostFilePath,
                sampleText: contents.substr(0, 40)
            })
        );
        return null;
    }

    if (!Array.isArray(hosts) || hosts.length === 0 ||
        typeof hosts[0] !== 'string'
    ) {
        var reason;
        if (!Array.isArray(hosts)) {
            reason = 'Expected hosts to be array but is: ' + typeof hosts;
        } else if (hosts.length === 0) {
            reason = 'Expected hosts to not be empty array';
        } else if (typeof hosts[0] !== 'string') {
            reason = 'Expected hosts to be array of strings but is: ' +
                typeof hosts[0];
        }

        this._failSync(
            InvalidHostFileContents({
                file: hostFilePath,
                sampleText: contents.substr(0, 40),
                reason: reason
            })
        );
        return null;
    }

    return hosts;
};

PeerToPeerClient.prototype._failSync =
function _failSync(error) {
    throw error;
};

function SyncFileReader() {
    this.lastError = null;
}

SyncFileReader.prototype.readFileSync =
function readFileSync(filePath) {
    var contents = null;
    try {
        contents = fs.readFileSync(filePath);
    } catch (err) {
        this.lastError = err;
    }

    return contents;
};

function SafeJSONParser() {
    this.lastError = null;
}

SafeJSONParser.prototype.parseJSON =
function parseJSON(text) {
    var contents = null;
    try {
        contents = JSON.parse(text);
    } catch (err) {
        this.lastError = err;
    }

    return contents;
};
