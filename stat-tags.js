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

var BatchStatsd = require('./lib/statsd.js');
var clean = BatchStatsd.clean;
var cleanHostPort = BatchStatsd.cleanHostPort;

module.exports = {
    InboundCallsRecvdTags: InboundCallsRecvdTags,
    OutboundCallsSuccessTags: OutboundCallsSuccessTags,
    OutboundCallsLatencyTags: OutboundCallsLatencyTags,
    OutboundCallsSentTags: OutboundCallsSentTags,
    OutboundCallsAppErrorsTags: OutboundCallsAppErrorsTags,
    OutboundCallsPerAttemptLatencyTags: OutboundCallsPerAttemptLatencyTags,
    OutboundCallsPerAttemptAppErrorsTags: OutboundCallsPerAttemptAppErrorsTags,
    OutboundCallsSystemErrorsTags: OutboundCallsSystemErrorsTags,
    OutboundCallsOperationalErrorsTags: OutboundCallsOperationalErrorsTags,
    OutboundCallsPerAttemptOperationalErrorsTags: OutboundCallsPerAttemptOperationalErrorsTags,
    OutboundCallsRetriesTags: OutboundCallsRetriesTags,
    InboundCallsLatencyTags: InboundCallsLatencyTags,
    InboundCallsSuccessTags: InboundCallsSuccessTags,
    InboundCallsAppErrorsTags: InboundCallsAppErrorsTags,
    InboundCallsSystemErrorsTags: InboundCallsSystemErrorsTags,
    InboundRequestSizeTags: InboundRequestSizeTags,
    ConnectionsBytesRcvdTags: ConnectionsBytesRcvdTags,
    InboundResponseSizeTags: InboundResponseSizeTags,
    OutboundRequestSizeTags: OutboundRequestSizeTags,
    ConnectionsBytesSentTags: ConnectionsBytesSentTags,
    OutboundResponseSizeTags: OutboundResponseSizeTags,
    RateLimiterServiceTags: RateLimiterServiceTags,
    RateLimiterEdgeTags: RateLimiterEdgeTags,
    RateLimiterEmptyTags: RateLimiterEmptyTags,
    InboundProtocolErrorsTags: InboundProtocolErrorsTags,
    ConnectionsActiveTags: ConnectionsActiveTags,
    ConnectionsInitiatedTags: ConnectionsInitiatedTags,
    ConnectionsConnectErrorsTags: ConnectionsConnectErrorsTags,
    ConnectionsAcceptedTags: ConnectionsAcceptedTags,
    ConnectionsAcceptErrorsTags: ConnectionsAcceptErrorsTags,
    ConnectionsErrorsTags: ConnectionsErrorsTags,
    ConnectionsClosedTags: ConnectionsClosedTags,
    RelayLatencyTags: RelayLatencyTags,
    HTTPHanlderBuildLatencyTags: HTTPHanlderBuildLatencyTags,
    ObjectPoolTags: ObjectPoolTags
};

function InboundCallsRecvdTags(cn, serviceName, endpoint) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.callingService = cn || '';
    this.service = serviceName;
    this.endpoint = endpoint;
}

InboundCallsRecvdTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint');
};

function OutboundCallsAppErrorsTags(serviceName, cn, endpoint, type) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.type = type;
}

OutboundCallsAppErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type');
};

function OutboundCallsSuccessTags(serviceName, cn, endpoint) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
}

OutboundCallsSuccessTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint');
};

function OutboundCallsPerAttemptAppErrorsTags(
    serviceName, cn, endpoint, type, retryCount
) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.type = type;
    this.retryCount = retryCount;
}

OutboundCallsPerAttemptAppErrorsTags.prototype.toStatKey =
function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type') + '.' +
        this.retryCount;
};

function OutboundCallsSystemErrorsTags(
    serviceName, cn, endpoint, type, retryCount
) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.type = type;
    this.retryCount = retryCount;
}

OutboundCallsSystemErrorsTags.prototype.toStatKey =
function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type');
};

function OutboundCallsOperationalErrorsTags(
    serviceName, cn, endpoint, type
) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.type = type;
}

OutboundCallsOperationalErrorsTags.prototype.toStatKey =
function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type');
};

function OutboundCallsPerAttemptOperationalErrorsTags(
    serviceName, cn, endpoint, type, retryCount
) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.type = type;
    this.retryCount = retryCount;
}

OutboundCallsPerAttemptOperationalErrorsTags.prototype.toStatKey =
function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type') + '.' +
        this.retryCount;
};

function OutboundCallsRetriesTags(
    serviceName, cn, endpoint, retryCount
) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.retryCount = retryCount;
}

OutboundCallsRetriesTags.prototype.toStatKey =
function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        this.retryCount;
};

function OutboundCallsPerAttemptLatencyTags(
    serviceName, cn, endpoint, remoteAddr, retryCount
) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
    this.peer = remoteAddr;
    this.retryCount = retryCount;
}

OutboundCallsPerAttemptLatencyTags.prototype.toStatKey =
function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint') + '.' +
        this.retryCount;
};

function OutboundCallsLatencyTags(serviceName, cn, endpoint) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
}

OutboundCallsLatencyTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint');
};

function OutboundCallsSentTags(serviceName, cn, endpoint) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
}

OutboundCallsSentTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint');
};

function InboundCallsLatencyTags(cn, serviceName, endpoint) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.callingService = cn;
    this.service = serviceName;
    this.endpoint = endpoint;
}

InboundCallsLatencyTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint');
};

function InboundCallsSuccessTags(cn, serviceName, endpoint) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.callingService = cn;
    this.service = serviceName;
    this.endpoint = endpoint;
}

InboundCallsSuccessTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint');
};

function InboundCallsAppErrorsTags(cn, serviceName, endpoint, type) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.callingService = cn;
    this.service = serviceName;
    this.endpoint = endpoint;
    this.type = type;
}

InboundCallsAppErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type');
};

function InboundCallsSystemErrorsTags(cn, serviceName, endpoint, type) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.callingService = cn;
    this.service = serviceName;
    this.endpoint = endpoint;
    this.type = type;
}

InboundCallsSystemErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint') + '.' +
        clean(this.type, 'no-type');
};

function InboundRequestSizeTags(cn, serviceName, endpoint) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.callingService = cn;
    this.service = serviceName;
    this.endpoint = endpoint;
}

InboundRequestSizeTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint');
};

function ConnectionsBytesRcvdTags(hostPort, peerHostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peerHostPort;
}

ConnectionsBytesRcvdTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function InboundResponseSizeTags(cn, serviceName, endpoint) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.callingService = cn;
    this.service = serviceName;
    this.endpoint = endpoint;
}

InboundResponseSizeTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callingService, 'no-calling-service') + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.endpoint, 'no-endpoint');
};

function OutboundRequestSizeTags(serviceName, cn, endpoint) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
}

OutboundRequestSizeTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint');
};

function ConnectionsBytesSentTags(hostPort, peer) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peer;
}

ConnectionsBytesSentTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function OutboundResponseSizeTags(serviceName, cn, endpoint) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.targetService = serviceName;
    this.service = cn;
    this.targetEndpoint = endpoint;
}

OutboundResponseSizeTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.service, 'no-service') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        clean(this.targetEndpoint, 'no-endpoint');
};

function RateLimiterServiceTags(serviceName) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.targetService = serviceName;
}

RateLimiterServiceTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.targetService, 'no-target-service');
};

function RateLimiterEdgeTags(edgeName) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.edgeName = edgeName;
}

RateLimiterEdgeTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.edgeName, 'no-edge-name');
};

function RateLimiterEmptyTags() {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;
}

RateLimiterEmptyTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix;
};

function InboundProtocolErrorsTags(peerHostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.peerHostPort = peerHostPort;
}

InboundProtocolErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function ConnectionsActiveTags(hostPort, peerHostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peerHostPort;
}

ConnectionsActiveTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function ConnectionsInitiatedTags(hostPort, peerHostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peerHostPort;
}

ConnectionsInitiatedTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function ConnectionsConnectErrorsTags(hostPort, peerHostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peerHostPort;
}

ConnectionsConnectErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function ConnectionsAcceptedTags(hostPort, peerHostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peerHostPort;
}

ConnectionsAcceptedTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port');
};

function ConnectionsAcceptErrorsTags(hostPort) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
}

ConnectionsAcceptErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.hostPort, 'no-host-port');
};

function ConnectionsErrorsTags(peerHostPort, type) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.peerHostPort = peerHostPort;
    this.type = type;
}

ConnectionsErrorsTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port') + '.' +
        clean(this.type, 'no-type');
};

function ConnectionsClosedTags(hostPort, peerHostPort, reason) {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;

    this.hostPort = hostPort;
    this.peerHostPort = peerHostPort;
    this.reason = reason;
}

ConnectionsClosedTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        cleanHostPort(this.peerHostPort, 'no-peer-host-port') + '.' +
        clean(this.reason, 'no-reason');
};

function RelayLatencyTags() {
    this.app = null;
    this.host = null;
    this.cluster = null;
    this.version = null;
}

RelayLatencyTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix;
};

function HTTPHanlderBuildLatencyTags(serviceName, callerName, streamed) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.targetService = serviceName;
    this.callerName = callerName;
    this.streamed = streamed;
}

HTTPHanlderBuildLatencyTags.prototype.toStatKey = function toStatKey(prefix) {
    return prefix + '.' +
        clean(this.callerName, 'no-caller-name') + '.' +
        clean(this.targetService, 'no-target-service') + '.' +
        (this.streamed ? 'streamed' : 'unstreamed');
};

function ObjectPoolTags(poolName, statType) {
    this.app = '';
    this.host = '';
    this.cluster = '';
    this.version = '';

    this.poolName = poolName;
    this.statType = statType;

    this._cachedPrefix = '';
    this._key = '';
}

ObjectPoolTags.prototype.toStatKey = function toStatKey(prefix) {
    // prefix should never change but we store it in _cachedPrefix just in case
    if (!this._key || prefix !== this._cachedPrefix) {
        this._key = prefix + '.' + this.poolName + '.' + this.statType;
        this._cachedPrefix = prefix;
    }
    return this._key;
};
