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

var path = require('path');
var assert = require('assert');
var Buffer = require('buffer').Buffer;

module.exports = TCollectorTraceReporter;

function TCollectorTraceReporter(options) {
    if (!(this instanceof TCollectorTraceReporter)) {
        return new TCollectorTraceReporter(options);
    }
    var self = this;

    assert(typeof options === 'object', 'options required');
    assert(typeof options.logger === 'object', 'logger required');
    assert(typeof options.channel === 'object', 'channel required');
    assert(typeof options.callerName === 'string', 'callerName required');

    self.logger = options.logger;
    self.channel = options.channel;
    self.callerName = options.callerName;
    self.logWarnings = 'logWarnings' in options ?
        options.logWarnings : true;

    /*istanbul ignore if*/
    if (!self.channel) {
        // TODO: typederror or vld
        throw new Error('TCollectorTraceReporter must be passed a tchannel');
    }

    self.tchannelThrift = new self.channel.TChannelAsThrift({
        entryPoint: path.join(__dirname, 'tcollector.thrift'),
        strict: false
    });
}

TCollectorTraceReporter.ipToInt = function ipToInt(ip) {
    var ipl = 0;
    var parts = ip.split('.');
    for (var i = 0; i < parts.length; i++) {
        ipl <<= 8;
        ipl += parseInt(parts[i], 10);
    }
    return (ipl >>> 0);
};

TCollectorTraceReporter.intIdToBuffer = function intIdToBuffer(id) {
    var buf = new Buffer(8);
    buf.writeUInt32BE(id[0], 0);
    buf.writeUInt32BE(id[1], 4);
    return buf;
};

TCollectorTraceReporter.convertHost = function convertHost(endpoint) {
    return {
        // the >> 0 here effectively casts the ip as a signed int since
        // thrift doesn't have unsigned types
        ipv4: TCollectorTraceReporter.ipToInt(endpoint.ipv4) >> 0,
        port: endpoint.port,
        serviceName: endpoint.serviceName
    };
};

TCollectorTraceReporter.jsonSpanToThriftSpan =
function jsonSpanToThriftSpan(span) {
    var annotations = span.annotations.map(function fixAnnotation(item) {
        return {
            timestamp: item.timestamp,
            value: item.value
        };
    });

    var binaryAnnotations =
        span.binaryAnnotations.map(function fixBinAnnotation(item) {
            var ret = {
                key: item.key,
                annotationType: null,
                boolValue: null,
                intValue: null,
                doubleValue: null,
                stringValue: null,
                bytesValue: null
            };

            if (item.type === 'boolean') {
                ret.annotationType = 'BOOL';
                ret.boolValue = item.value;
            } else if (item.type === 'number') {
                ret.annotationType = 'DOUBLE';
                ret.doubleValue = item.value;
            } else {
                ret.annotationType = 'STRING';
                ret.stringValue = String(item.value);
            }

            return ret;
        });

    var endpoint = span.endpoint || span.annotations[0].host;
    var host = TCollectorTraceReporter.convertHost(endpoint);

    var mapped = {
        name: span.name,
        traceId: TCollectorTraceReporter.intIdToBuffer(span.traceid),
        parentId: TCollectorTraceReporter.intIdToBuffer(span.parentid),
        id: TCollectorTraceReporter.intIdToBuffer(span.id),
        annotations: annotations,
        binaryAnnotations: binaryAnnotations,
        host: host
    };

    return mapped;
};

TCollectorTraceReporter.prototype.report =
function report(span, opts, callback) {
    var self = this;

    if (typeof opts === 'function') {
        callback = opts;
        opts = null;
    }

    var req = self.channel.request({
        timeout: (opts && opts.timeout) || 100,
        trace: false,
        hasNoParent: true,
        headers: {
            cn: self.callerName,
            shardKey: span.traceid.toString('base64')
        },
        serviceName: 'tcollector',
        retryFlags: {never: true}
    });

    self.tchannelThrift.send(
        req,
        'TCollector::submit',
        null,
        {span: TCollectorTraceReporter.jsonSpanToThriftSpan(span)},
        onResponse
    );

    function onResponse(err, response) {
        if (err) {
            if (self.logWarnings) {
                self.logger.warn('Zipkin span submit failed', {
                    error: err,
                    serviceName: 'tcollector'
                });
            }

            if (callback) {
                callback(err);
            }

        } else if (!response.ok) {
            if (self.logWarnings) {
                self.logger.warn('Zipkin span submit failed: not ok', {
                    error: response.body,
                    serviceName: 'tcollector'
                });
            }

            if (callback) {
                callback(response.body);
            }

        } else if (callback) {
            callback();
        }
    }
};

