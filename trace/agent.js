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

var Span = require('./span');
var errors = require('../errors.js');

module.exports = Agent;

function Agent(options) {
    options = options || {};

    this.logger = options.logger;

    // If this is set to true in a call to Agent#configure, all incoming
    // requests will have their traceflags forced to 1. It's intended to be
    // set on the 'top level service'.
    this.forceTrace = options.forceTrace || false;

    // 'our' service name that is used as the service name on spans for
    // incoming reuqests
    this.serviceName = options.serviceName || null;

    if (options.reporter) {
        this.reporter = options.reporter;
    }
}

function compareTracingIds(id1, id2) {
    if (!id1 || !id2) {
        return false;
    }
    return id1[0] === id2[0] && id1[1] === id2[1];
}

// ## setupNewSpan
// Sets up a new span for an outgoing rpc
Agent.prototype.setupNewSpan = function setupNewSpan(options) {
    var hostPortParts = options.remoteName.split(':');
    var host = hostPortParts[0];
    var port = parseInt(hostPortParts[1], 10);

    var empty = [0, 0];
    if (compareTracingIds(empty, options.parentid)) {
        options.parentid = null;
    }

    if (compareTracingIds(empty, options.traceid)) {
        options.traceid = null;
    }

    if (compareTracingIds(empty, options.spanid)) {
        options.spanid = null;
    }

    var span = new Span({
        endpoint: new Span.Endpoint(
            host,
            port,
            // If a service hasn't been specified on the tracer, use the
            // service on the incoming request. This is to handle the
            // case of the service router, which has a different service name
            // than the one specified in the incoming request.
            this.serviceName || options.serviceName
        ),
        name: options.name,
        id: options.spanid,
        parentid: options.parentid,
        traceid: options.traceid,
        flags: this.forceTrace ? 1 : options.flags
    });

    var parentSpan = options.parentSpan;
    if (options.outgoing && !parentSpan && !options.hasNoParent) {
        throw errors.ParentRequired({
            parentSpan: parentSpan,
            hasNoParent: options.hasNoParent,
            serviceName: options.serviceName
        });
    }

    if (parentSpan && (!options.parentid && !options.traceid)) {
        // If there's a parentSpan and the parentid and traceid weren't
        // specified, we need to propagate the ids from the parent span.
        span.propagateIdsFrom(parentSpan);
        span.generateSpanid();
    } else if (!parentSpan && (!options.traceid && !options.spanid)) {
        // No ids were specified and there's no parent span. Generate a new
        // id and use it as the spanid and traceid.
        span.generateIds();
    }

    return span;
};

Agent.prototype.report = function report(span) {
    if (span.flags & 0x01) {
        this.reporter(span);
    }
};

Agent.prototype.reporter = function nullReporter() {};

