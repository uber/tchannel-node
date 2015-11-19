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
var path = require('path');
var bufrw = require('bufrw');
var Result = require('bufrw/result');
var thriftrw = require('thriftrw');

var errors = require('../errors.js');
var HeaderRW = require('../v2/header.js').header2;

var metaThriftFile = path.join(__dirname, 'meta.thrift');

module.exports = TChannelAsThrift;

function TChannelAsThrift(opts) {
    if (!(this instanceof TChannelAsThrift)) {
        return new TChannelAsThrift(opts);
    }

    var self = this;

    opts = opts || {};

    self.thriftSource = opts.source;
    self.thriftFileName = opts.thriftFileName || 'service.thrift';
    self.spec = new thriftrw.Thrift({
        source: self.thriftSource, // deprecated
        entryPoint: opts.entryPoint,
        strict: opts.strict,
        allowIncludeAlias: opts.allowIncludeAlias,
        allowFilesystemAccess: true
    });

    self.logger = opts.logger;

    var bossMode = opts && opts.bossMode;
    self.bossMode = typeof bossMode === 'boolean' ? bossMode : false;

    var logParseFailures = opts && opts.logParseFailures;
    self.logParseFailures = typeof logParseFailures === 'boolean' ?
        logParseFailures : true;

    self.channel = opts.channel;

    self.isHealthy = opts.isHealthy;
    assert(!self.isHealthy || typeof self.isHealthy === 'function',
        'isHealthy must be a function');
    assert(!self.isHealthy || self.channel,
        'channel must be provided with isHealthy');

    var loadMetaAsync = opts.loadMetaAsync !== undefined ?
        opts.loadMetaAsync : true;
    if (self.isHealthy && loadMetaAsync) {
        self.registerHealthAsync();
    }
}

TChannelAsThrift.prototype.registerHealthAsync =
function registerHealthAsync() {
    var self = this;

    fs.readFile(metaThriftFile, 'utf8', onFile);

    function onFile(err, thriftSource) {
        if (err) {
            self.channel.logger.fatal('failed to read meta.thrift file', {
                error: err
            });
            return;
        }

        self.registerMeta(thriftSource);
    }
};

TChannelAsThrift.prototype.registerHealthSync =
function registerHealthSync() {
    var self = this;

    var thriftSource = fs.readFileSync(metaThriftFile, 'utf8');
    self.registerMeta(thriftSource);
};

TChannelAsThrift.prototype.registerMeta =
function registerMeta(metaSource) {
    var self = this;

    var metaSpec = new thriftrw.Thrift({
        source: metaSource
    });

    self.register(self.channel, 'Meta::health', self, health, metaSpec);
    self.register(self.channel, 'Meta::thriftIDL', self, thriftIDL, metaSpec);
};

TChannelAsThrift.prototype.request = function request(reqOptions) {
    var self = this;

    assert(self.channel, 'channel is required for thrift.request()');
    assert(reqOptions &&
        reqOptions.type !== 'tchannel.request' &&
        reqOptions.type !== 'tchannel.outgoing-request',
        'invalid reqOptions to TChannelAsThrift.request');

    var req = new TChannelThriftRequest({
        channel: self.channel,
        reqOptions: reqOptions,
        tchannelThrift: self
    });

    return req;
};

TChannelAsThrift.prototype.waitForIdentified =
function waitForIdentified(options, cb) {
    var self = this;

    assert(self.channel, 'channel is required for waitForIdentified()');

    return self.channel.waitForIdentified(options, cb);
};

TChannelAsThrift.prototype.register =
function register(channel, name, opts, handle, spec) {
    var self = this;

    // support register(endpoint, opts, handle)
    if (typeof channel === 'string') {
        assert(self.channel, 'channel is required for thrift.register()');
        assert(spec === undefined, 'must have only 4 arguments');

        spec = handle;
        handle = opts;
        opts = name;
        name = channel;
        channel = self.channel;
    }

    if (!self.logger) {
        self.logger = channel.logger;
    }

    assert(typeof name === 'string', 'endpoint has to be a string');

    channel.register(name, handleThriftRequest);

    function handleThriftRequest(req, res, inHeadBuffer, inBodyBuffer) {
        if (req.headers.as !== 'thrift') {
            return res.sendError('BadRequest',
                'Expected call request as header to be thrift');
        }

        // Process incoming thrift body
        var parseResult = self._parse({
            head: inHeadBuffer,
            body: inBodyBuffer,
            endpoint: name,
            direction: 'in.request',
            spec: spec
        });

        if (parseResult.err) {
            return res.sendError('BadRequest',
                parseResult.err.type + ': ' + parseResult.err.message);
        }

        var v = parseResult.value;
        handle(opts, req, v.head, v.body, handleThriftResponse);

        function handleThriftResponse(err, thriftRes) {
            if (err) {
                assert(isError(err), 'Error argument must be an error');

                self.logger.error('Got unexpected error in handler', {
                    endpoint: name,
                    error: err
                });

                return res.sendError('UnexpectedError', 'Unexpected Error');
            }

            if (!self.bossMode) {
                assert(typeof thriftRes.ok === 'boolean',
                    'expected response.ok to be a boolean');
                assert(thriftRes.body !== undefined,
                    'expected response.body to exist');

                if (!thriftRes.ok) {
                    assert(typeof thriftRes.typeName === 'string',
                        'expected not-ok response to have typeName');
                }
            }

            var stringifyResult = self._stringify({
                head: thriftRes.head,
                body: thriftRes.body,
                ok: thriftRes.ok,
                typeName: thriftRes.typeName,
                endpoint: name,
                direction: 'out.response',
                spec: spec
            });

            if (stringifyResult.err) {
                return res.sendError('UnexpectedError',
                    'Could not serialize thrift');
            }

            if (res.setOk(thriftRes.ok)) {
                res.headers.as = 'thrift';
                res.send(
                    stringifyResult.value.head,
                    stringifyResult.value.body
                );
            }
        }
    }
};

TChannelAsThrift.prototype.send =
function send(request, endpoint, outHead, outBody, callback) {
    var self = this;

    self.logger = self.logger || request.channel.logger;

    assert(typeof endpoint === 'string', 'send requires endpoint');
    assert(typeof request.serviceName === 'string' &&
        request.serviceName !== '',
        'req.serviceName must be a string');

    var stringifyResult = self._stringify({
        head: outHead,
        body: outBody,
        endpoint: endpoint,
        direction: 'out.request'
    });
    if (stringifyResult.err) {
        return callback(stringifyResult.err);
    }

    // Punch as=thrift into the transport headers
    request.headers.as = 'thrift';

    request.send(
        endpoint,
        stringifyResult.value.head,
        stringifyResult.value.body,
        handleResponse
    );

    function handleResponse(err, res, arg2, arg3) {
        if (err) {
            return callback(err);
        }

        var parseResult = self._parse({
            head: arg2,
            body: arg3,
            ok: res.ok,
            endpoint: endpoint,
            direction: 'in.response'
        });

        if (parseResult.err) {
            return callback(parseResult.err);
        }

        var v = parseResult.value;
        var resp = new TChannelThriftResponse(res, v);

        callback(null, resp);
    }
};

/*eslint-disable max-statements */
TChannelAsThrift.prototype._parse = function parse(opts) {
    var self = this;
    var spec = opts.spec || self.spec;

    var argsName = opts.endpoint + '_args';
    var argsType = spec.getType(argsName);

    var returnName = opts.endpoint + '_result';
    var resultType = spec.getType(returnName);

    var headRes = bufrw.fromBufferResult(HeaderRW, opts.head);
    if (headRes.err) {
        var headParseErr = errors.ThriftHeadParserError(headRes.err, {
            endpoint: opts.endpoint,
            direction: opts.direction,
            ok: opts.ok,
            headBuf: opts.head.slice(0, 10)
        });

        if (self.logParseFailures) {
            self.logger.warn('Got unexpected invalid thrift arg2', {
                endpoint: opts.endpoint,
                direction: opts.direction,
                ok: opts.ok,
                headErr: headParseErr
            });
        }

        return new Result(headParseErr);
    }

    var bodyRes;
    var typeName;
    if (opts.direction === 'in.request') {
        bodyRes = argsType.fromBufferResult(opts.body);
    } else if (opts.direction === 'in.response') {
        bodyRes = resultType.fromBufferResult(opts.body);

        if (bodyRes.value && opts.ok) {
            bodyRes.value = bodyRes.value.success;
        } else if (bodyRes.value && !opts.ok) {
            typeName = onlyKey(bodyRes.value);
            bodyRes.value = bodyRes.value[typeName];
        }
    }

    if (bodyRes.err) {
        var bodyParseErr = errors.ThriftBodyParserError(bodyRes.err, {
            endpoint: opts.endpoint,
            direction: opts.direction,
            ok: opts.ok,
            bodyBuf: opts.body.slice(0, 10)
        });

        if (self.logParseFailures) {
            self.logger.warn('Got unexpected invalid thrift for arg3', {
                endpoint: opts.endpoint,
                ok: opts.ok,
                direction: opts.direction,
                bodyErr: bodyParseErr
            });
        }

        return new Result(bodyParseErr);
    }

    return new Result(null, {
        head: headRes.value,
        body: bodyRes.value,
        typeName: typeName
    });
};
/*eslint-enable max-statements */

TChannelAsThrift.prototype._stringify = function stringify(opts) {
    var self = this;
    var spec = opts.spec || self.spec;

    var argsName = opts.endpoint + '_args';
    var argsType = spec.getType(argsName);

    var returnName = opts.endpoint + '_result';
    var resultType = spec.getType(returnName);

    opts.head = opts.head || {};

    var headRes = bufrw.toBufferResult(HeaderRW, opts.head);
    if (headRes.err) {
        var headStringifyErr = errors.ThriftHeadStringifyError(headRes.err, {
            endpoint: opts.endpoint,
            ok: opts.ok,
            direction: opts.direction,
            head: opts.head
        });

        self.logger.error('Got unexpected unserializable thrift for arg2', {
            endpoint: opts.endpoint,
            ok: opts.ok,
            direction: opts.direction,
            headErr: headStringifyErr
        });
        return new Result(headStringifyErr);
    }

    var bodyRes;
    if (opts.direction === 'out.request') {
        bodyRes = argsType.toBufferResult(opts.body);
    } else if (opts.direction === 'out.response') {
        var thriftResult = {};
        if (!opts.ok) {
            thriftResult[opts.typeName] = opts.body;
        } else {
            thriftResult.success = opts.body;
        }

        bodyRes = resultType.toBufferResult(thriftResult);
    }

    if (bodyRes.err) {
        var bodyStringifyErr = errors.ThriftBodyStringifyError(bodyRes.err, {
            endpoint: opts.endpoint,
            ok: opts.ok,
            direction: opts.direction,
            body: opts.body
        });

        self.logger.error('Got unexpected unserializable thrift for arg3', {
            endpoint: opts.endpoint,
            direction: opts.direction,
            ok: opts.ok,
            bodyErr: bodyStringifyErr
        });
        return new Result(bodyStringifyErr);
    }

    return new Result(null, {
        head: headRes.value,
        body: bodyRes.value
    });
};

function TChannelThriftResponse(response, parseResult) {
    var self = this;

    self.ok = response.ok;
    self.head = parseResult.head;
    self.body = null;
    self.headers = response.headers;
    self.body = parseResult.body;
    self.typeName = parseResult.typeName;
}

function TChannelThriftRequest(options) {
    var self = this;

    self.channel = options.channel;
    self.reqOptions = options.reqOptions;
    self.tchannelThrift = options.tchannelThrift;
}

TChannelThriftRequest.prototype.send =
function send(endpoint, head, body, callback) {
    var self = this;

    var outreq = self.channel.request(self.reqOptions);
    self.tchannelThrift.send(outreq, endpoint, head, body, callback);
};

function health(tchannelThrift, req, head, body, callback) {
    var status = tchannelThrift.isHealthy();
    assert(status && typeof status.ok === 'boolean', 'status must have ok field');
    assert(status && (status.ok || typeof status.message === 'string'),
        'status.message must be provided when status.ok === false');

    return callback(null, {
        ok: true,
        body: {
            ok: status.ok,
            message: status.message
        }
    });
}

function thriftIDL(tchannelThrift, req, head, body, callback) {
    return callback(null, {
        ok: true,
        body: tchannelThrift.spec.getSources()
    });
}

// TODO proper Thriftify result union that reifies as the selected field.
function onlyKey(object) {
    for (var name in object) {
        if (object[name] !== null) {
            return name;
        }
    }
}

function isError(err) {
    return Object.prototype.toString.call(err) === '[object Error]';
}
