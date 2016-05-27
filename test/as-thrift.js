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

/*eslint max-params: [2, 5]*/

'use strict';

var path = require('path');
var TypedError = require('error/typed');
var fs = require('fs');

var allocCluster = require('./lib/alloc-cluster.js');

allocCluster.test('send and receiving an ok', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.equal(res.headers.as, 'thrift');
        assert.equal(res.body, 10);
        assert.end();
    });
});

allocCluster.test('send and receiving an big request', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    var largeList = [];
    for (var i = 0; i < 10 * 1000; i++) {
        largeList.push('abcdefgh');
    }

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo_big', null, {
        value: largeList
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.equal(res.headers.as, 'thrift');
        assert.equal(res.body, 10 * 1000);
        assert.end();
    });
});

allocCluster.test('sending using request()', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    tchannelAsThrift.request({
        serviceName: 'server',
        hasNoParent: true
    }).send('Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.equal(res.headers.as, 'thrift');
        assert.equal(res.body, 10);
        assert.end();
    });
});

allocCluster.test('send and receive a notOk', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        notOkResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(!res.ok);

        assert.equal(res.body.value, 10);
        assert.equal(res.body.message, 'No echo');
        assert.equal(res.body.type, undefined);

        assert.end();
    });
});

allocCluster.test('as=thrift send supports shouldApplicationRetry', {
    numPeers: 3
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        notOkResponse: true,
        succeedSecondTime: true,
        servers: 2
    });

    var client = cluster.channels[2].subChannels.server;

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true,
        shouldApplicationRetry: shouldRetry
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.equal(res.body, 10);
        assert.equal(res.headers.as, 'thrift');

        assert.end();
    });

    function shouldRetry(req, res, retry, done) {
        tchannelAsThrift.parseException(req, res, onException);

        function onException(err, info) {
            // Failed to parse thrift response
            if (err) {
                return done(err);
            }

            assert.equal(info.body.value, 10);
            assert.equal(info.body.message, 'No echo');
            assert.equal(info.typeName, 'noEcho');

            if (info.typeName === 'noEcho') {
                return retry();
            }

            done();
        }
    }
});

allocCluster.test('as=thrift request supports shouldApplicationRetry', {
    numPeers: 3
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        notOkResponse: true,
        succeedSecondTime: true,
        servers: 2
    });

    tchannelAsThrift.request({
        serviceName: 'server',
        hasNoParent: true,
        shouldThriftRetry: shouldRetry
    }).send('Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.equal(res.body, 10);
        assert.equal(res.headers.as, 'thrift');

        assert.end();
    });

    function shouldRetry(res/*, rawReq, rawRes*/) {
        assert.equal(res.body.value, 10);
        assert.equal(res.body.message, 'No echo');
        assert.equal(res.typeName, 'noEcho');

        if (res.typeName === 'noEcho') {
            return true;
        }

        return false;
    }
});

allocCluster.test('send and receive a typed notOk', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        notOkTypedResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(!res.ok);

        assert.equal(res.body.value, 10);
        assert.equal(res.body.message, 'No echo typed error');
        assert.equal(res.body.type, 'server.no-echo');

        assert.end();
    });
});

allocCluster.test('sending and receiving headers', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo', {
        headerA: 'headerA',
        headerB: 'headerB'
    }, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);

        assert.ok(res.ok);
        assert.deepEqual(res.head, {
            headerA: 'headerA',
            headerB: 'headerB'
        });
        assert.equal(res.body, 10);
        assert.end();
    });
});

allocCluster.test('getting an UnexpectedError frame', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        networkFailureResponse: true
    });
    var client = cluster.channels[1].subChannels.server;

    client.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, resp) {
        assert.ok(err);
        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'UnexpectedError');
        assert.equal(err.message, 'Unexpected Error');

        assert.equal(resp, undefined);
        assert.equal(client.logger.items().length, 1);

        assert.end();
    });
});

allocCluster.test('getting a BadRequest frame', {
    numPeers: 2
}, function t(cluster, assert) {
    makeTChannelThriftServer(cluster, {
        networkFailureResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    client.request({
        serviceName: 'server',
        hasNoParent: true,
        timeout: 1500,
        headers: {
            as: 'thrift'
        }
    }).send('Chamber::echo', 'junk header', null, onResponse);

    function onResponse(err, resp) {
        assert.ok(err);

        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'BadRequest');
        assert.equal(err.message,
            'tchannel-thrift-handler.parse-error.head-failed: Could not ' +
                'parse head (arg2) argument.\n' +
                'Expected Thrift encoded arg2 for endpoint Chamber::echo.\n' +
                'Got junk heade instead of Thrift.\n' +
                'Parsing error was: ' +
                'expected at least 28267 bytes, only have 7 @[2:4].\n'
        );

        assert.equal(resp, null);

        assert.end();
    }
});

allocCluster.test('sending without as header', {
    numPeers: 2
}, function t(cluster, assert) {
    makeTChannelThriftServer(cluster, {
        networkFailureResponse: true
    });

    var client = cluster.channels[1].subChannels.server;

    client.request({
        serviceName: 'server',
        hasNoParent: true,
        headers: {
            as: 'lol'
        },
        timeout: 1500
    }).send('Chamber::echo', null, null, onResponse);

    function onResponse(err, resp) {
        assert.ok(err);

        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'BadRequest');
        assert.equal(err.message,
            'Expected call request as header to be thrift');

        assert.equal(resp, null);

        assert.end();
    }
});

allocCluster.test('logger set correctly in send and register functions', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });
    var client = cluster.channels[1].subChannels.server;
    tchannelAsThrift.logger = undefined;

    function okHandler(opts, req, head, body, cb) {
        return cb(null, {
            ok: true,
            head: head,
            body: body.value
        });
    }

    tchannelAsThrift.register(client, 'Chamber::echo', {
        value: 10
    }, okHandler);
    assert.equal(tchannelAsThrift.logger, client.logger);

    var request = client.request({
        serviceName: 'server',
        hasNoParent: true
    });

    tchannelAsThrift.logger = undefined;
    tchannelAsThrift.send(request, 'Chamber::echo', null, {
        value: 10
    }, function onResponse(err, res) {
        assert.ifError(err);
        assert.equal(tchannelAsThrift.logger, request.channel.logger);
        assert.end();
    });
});

allocCluster.test('request() supports baggage', {
    numPeers: 2
}, function t(cluster, assert) {
    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'server'
    });

    var serverThrift = server.TChannelAsThrift({
        channel: server,
        entryPoint: path.join(__dirname, 'anechoic-chamber.thrift')
    });
    serverThrift.register('Chamber::echo', {}, okHandler);

    var client = cluster.channels[1].makeSubChannel({
        serviceName: 'server',
        peers: [
            cluster.channels[0].hostPort
        ],
        requestDefaults: {
            headers: {
                cn: 'wat'
            }
        }
    });

    var clientThrift = client.TChannelAsThrift({
        channel: client,
        entryPoint: path.join(__dirname, 'anechoic-chamber.thrift')
    });

    clientThrift.request({
        serviceName: 'server',
        hasNoParent: true,
        defaultRequestHeaders: {key: 'value'}
    }).send('Chamber::echo', {foo: 'bar'}, {
        value: 10
    }, function onResponse(err2, resp) {
        assert.ifError(err2, 'should have no req error');

        assert.ok(resp, 'expect response');
        assert.equal(resp.body, 10, 'expect resp body');

        assert.end();
    });

    function okHandler(opts, req, head, body, cb) {
        assert.equal(head.foo, 'bar');
        assert.equal(head.key, 'value');
        return cb(null, {
            ok: true,
            head: head,
            body: body.value
        });
    }
});

allocCluster.test('send with invalid types', {
    numPeers: 2
}, function t(cluster, assert) {
    makeTChannelThriftServer(cluster, {
        okResponse: true
    });

    var client = cluster.channels[1].subChannels.server;
    var tchannelAsThrift = client.TChannelAsThrift({
        entryPoint: path.join(__dirname, 'bad-anechoic-chamber.thrift')
    });

    tchannelAsThrift.send(client.request({
        serviceName: 'server',
        hasNoParent: true
    }), 'Chamber::echo', null, {
        value: 'lol'
    }, function onResponse(err, res) {
        assert.ok(err);

        assert.equal(err.type, 'tchannel.bad-request');
        assert.equal(err.isErrorFrame, true);
        assert.equal(err.codeName, 'BadRequest');
        assert.equal(err.message,
            'tchannel-thrift-handler.parse-error.body-failed: ' +
                'Could not parse body (arg3) argument.\n' +
                'Expected Thrift encoded arg3 for endpoint Chamber::echo.\n' +
                'Got \u000b\u0000\u0001\u0000\u0000\u0000\u0003lol ' +
                'instead of Thrift.\n' +
                'Parsing error was: ' +
                'unexpected typeid 11 (STRING) for field "value" ' +
                'with id 1 on echo_args; expected 8 (I32).\n'
        );

        assert.equal(res, undefined);

        assert.end();
    });
});

allocCluster.test('sending peer to peer', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });
    var hostPort = cluster.channels[0].hostPort;

    tchannelAsThrift.waitForIdentified({
        host: hostPort
    }, function onIdentified(err1) {
        assert.ifError(err1, 'should have no conn error');

        tchannelAsThrift.request({
            serviceName: 'server',
            host: hostPort,
            hasNoParent: true
        }).send('Chamber::echo', null, {
            value: 10
        }, function onResponse(err2, resp) {
            assert.ifError(err2, 'should have no req error');

            assert.ok(resp, 'expect response');
            assert.equal(resp.body, 10, 'expect resp body');

            assert.end();
        });
    });
});

allocCluster.test('using register() without channel', {
    numPeers: 2
}, function t(cluster, assert) {
    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'server'
    });

    var serverThrift = server.TChannelAsThrift({
        channel: server,
        entryPoint: path.join(__dirname, 'anechoic-chamber.thrift')
    });
    serverThrift.register('Chamber::echo', {}, okHandler);

    var client = cluster.channels[1].makeSubChannel({
        serviceName: 'server',
        peers: [
            cluster.channels[0].hostPort
        ],
        requestDefaults: {
            headers: {
                cn: 'wat'
            }
        }
    });

    var clientThrift = client.TChannelAsThrift({
        channel: client,
        entryPoint: path.join(__dirname, 'anechoic-chamber.thrift')
    });

    clientThrift.request({
        serviceName: 'server',
        hasNoParent: true
    }).send('Chamber::echo', null, {
        value: 10
    }, function onResponse(err2, resp) {
        assert.ifError(err2, 'should have no req error');

        assert.ok(resp, 'expect response');
        assert.equal(resp.body, 10, 'expect resp body');

        assert.end();
    });

    function okHandler(opts, req, head, body, cb) {
        return cb(null, {
            ok: true,
            head: head,
            body: body.value
        });
    }
});

allocCluster.test('expose service endpoints', {
    numPeers: 2
}, function t(cluster, assert) {
    var tchannelAsThrift = makeTChannelThriftServer(cluster, {
        okResponse: true
    });
    var hostPort = cluster.channels[0].hostPort;

    var expected = ['Chamber::echo', 'Chamber::echo_big'];

    var endpoints = tchannelAsThrift.getServiceEndpoints();
    assert.deepEqual(endpoints, expected);
    assert.end();
});

function makeActualServer(channel, opts) {
    var server = channel.makeSubChannel({
        serviceName: 'server'
    });
    var NoEchoTypedError = TypedError({
        type: 'server.no-echo',
        message: 'No echo typed error',
        value: null
    });

    var options = {
        isOptions: true
    };

    var succeedSecondTime = opts.succeedSecondTime;

    var fn = opts.okResponse ? okHandler :
        opts.notOkResponse ? notOkHandler :
        opts.notOkTypedResponse ? notOkTypedHandler :
        opts.networkFailureResponse ? networkFailureHandler :
            networkFailureHandler;

    var tchannelAsThrift = channel.TChannelAsThrift({
        entryPoint: path.join(__dirname, 'anechoic-chamber.thrift'),
        logParseFailures: false
    });
    tchannelAsThrift.register(server, 'Chamber::echo', options, fn);
    tchannelAsThrift.register(server, 'Chamber::echo_big', options, echoBig);

    function echoBig(ctx, req, head, body, cb) {
        return cb(null, {
            ok: true,
            head: null,
            body: body.value.length
        });
    }

    function okHandler(ctx, req, head, body, cb) {
        return cb(null, {
            ok: true,
            head: head,
            body: body.value
        });
    }

    function notOkHandler(ctx, req, head, body, cb) {
        opts.count++;
        if (opts.count === 2 && succeedSecondTime) {
            return cb(null, {
                ok: true,
                head: null,
                body: body.value
            });
        }

        return cb(null, {
            ok: false,
            body: NoEchoError(body.value),
            typeName: 'noEcho'
        });
    }

    function notOkTypedHandler(ctx, req, head, body, cb) {
        cb(null, {
            ok: false,
            body: NoEchoTypedError({
                value: body.value
            }),
            typeName: 'noEchoTyped'
        });
    }

    function networkFailureHandler(ctx, req, head, body, cb) {
        var networkError = new Error('network failure');

        cb(networkError);
    }

    function NoEchoError(value) {
        var err = new Error('No echo');
        err.value = value;
        return err;
    }
}

function makeTChannelThriftServer(cluster, opts) {
    var servers = opts.servers || 1;
    opts.count = opts.count || 0;

    var clientIndex = servers;
    var peers = [];

    for (var i = 0; i < servers; i++) {
        makeActualServer(cluster.channels[i], opts);
        peers.push(cluster.channels[i].hostPort);
    }

    cluster.channels[clientIndex].makeSubChannel({
        serviceName: 'server',
        peers: peers,
        requestDefaults: {
            headers: {
                cn: 'wat'
            }
        }
    });

    var tchannelAsThrift = cluster.channels[clientIndex].TChannelAsThrift({
        entryPoint: path.join(__dirname, 'anechoic-chamber.thrift'),
        logParseFailures: false,
        channel: cluster.channels[clientIndex].subChannels.server
    });

    return tchannelAsThrift;
}
