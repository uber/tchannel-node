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

var parallel = require('run-parallel');
var Buffer = require('buffer').Buffer;
var allocCluster = require('./lib/alloc-cluster.js');
var EndpointHandler = require('../endpoint-handler');
var TChannel = require('../channel.js');

// Node.js deprecated Buffer in favor of Buffer.alloc and Buffer.from.
// istanbul ignore next
var bufferFrom = Buffer.from || Buffer;

allocCluster.test('request().send() to a server', 2, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];

    two.makeSubChannel({
        serviceName: 'server',
        peers: [one.hostPort]
    });

    one.makeSubChannel({
        serviceName: 'server'
    }).register('foo', function foo(req, res, arg2, arg3) {
        assert.ok(Buffer.isBuffer(arg2), 'handler got an arg2 buffer');
        assert.ok(Buffer.isBuffer(arg3), 'handler got an arg3 buffer');
        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    });

    parallelSendTest(two.subChannels.server, [
        {
            name: 'bufferOp',
            op: bufferFrom('foo'),
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: null,
            resHead: '',
            resBody: ''
        },

        {
            name: 'stringOp',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: null,
            resHead: '',
            resBody: ''
        },

        {
            name: 'bufferHead',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: bufferFrom('abc'),
            reqBody: null,
            resHead: 'abc',
            resBody: ''
        },

        {
            name: 'stringHead',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: 'abc',
            reqBody: null,
            resHead: 'abc',
            resBody: ''
        },

        {
            name: 'objectHead',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: JSON.stringify({value: 'abc'}),
            reqBody: null,
            resHead: '{"value":"abc"}',
            resBody: ''
        },

        {
            name: 'nullHead',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: null,
            resHead: '',
            resBody: ''
        },

        {
            name: 'undefinedHead',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: undefined,
            reqBody: null,
            resHead: '',
            resBody: ''
        },

        {
            name: 'bufferBody',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: bufferFrom('abc'),
            resHead: '',
            resBody: 'abc'
        },

        {
            name: 'stringBody',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: 'abc',
            resHead: '',
            resBody: 'abc'
        },

        {
            name: 'objectBody',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: JSON.stringify({value: 'abc'}),
            resHead: '',
            resBody: '{"value":"abc"}'
        },

        {
            name: 'nullBody',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: null,
            resHead: '',
            resBody: ''
        },

        {
            name: 'undefinedBody',
            op: 'foo',
            opts: {
                serviceName: 'server'
            },
            reqHead: null,
            reqBody: undefined,
            resHead: '',
            resBody: ''
        },

    ], assert, onResults);

    function onResults(err) {
        if (err) return assert.end(err);
        cluster.assertEmptyState(assert);
        assert.end();
    }
});

allocCluster.test('request().send() balances', 4, function t(cluster, assert) {
    var client = TChannel({
        timeoutFuzz: 0,
        random: function indifferent() {
            return 0.5;
        }
    });

    var clientChan = client.makeSubChannel({
        serviceName: 'lol'
    });

    cluster.channels.forEach(function each(chan, i) {
        var chanNum = i + 1;
        chan.handler = EndpointHandler();
        chan.handler.register('foo', function foo(req, res, arg2, arg3) {
            res.headers.as = 'raw';
            res.sendOk(arg2, arg3 + ' served by ' + chanNum);
        });

        clientChan.peers.add(chan.hostPort);
    });

    var round = 0;
    runBalanceTest(round, cluster, clientChan, assert, onRoundDone);

    function onRoundDone(err) {
        if (err) {
            onResults(err);
            return;
        }

        if (++round > 3) {
            onResults();
            return;
        }

        runBalanceTest(round, cluster, clientChan, assert, onRoundDone);
    }

    function onResults(err) {
        assert.ifError(err, 'no errors from sending');
        cluster.assertEmptyState(assert);
        client.close();
        assert.end();
    }
});

function balancedChecker(assert) {
    var seen = {};

    return checkBalancedServe;

    function checkBalancedServe(testCase, err, res, arg2, arg3) {
        assert.ifError(err, testCase.name + ': no result error');
        if (!err) {
            return;
        }

        var head = arg2 ? String(arg2) : arg2;
        var body = arg3 ? String(arg3) : arg3;
        assert.equal(head, '', testCase.name + ': expected head content');

        var match = /served by (\d+)$/.exec(body);
        if (!match) {
            assert.fail(testCase.name + ': expected a matching body');
            return;
        }

        var maxPrior = getMaxSeenCount();

        var servedBy = match[1];
        if (!seen[servedBy]) {
            seen[servedBy] = 0;
        }
        var count = ++seen[servedBy];
        var delta = count - maxPrior;
        assert.equal(delta, 1, testCase.resBody, testCase.name + ': expected served balance');
    }

    function getMaxSeenCount() {
        return Object.keys(seen).reduce(function max(count, key) {
            return seen[key] > count ? seen[key] : count;
        }, 0);
    }
}

function runBalanceTest(roundNo, cluster, channel, assert, callback) {
    var checkBalancedServe = balancedChecker(assert);
    var testCases = [];

    var n = 2 * cluster.channels.length;
    for (var m = 1; m <= n; m++) {
        var msgNum = n * roundNo + m;
        testCases.push({
            logger: cluster.logger,
            name: 'msg' + msgNum,
            op: 'foo',
            reqHead: '',
            reqBody: 'msg' + msgNum,
            check: checkBalancedServe
        });
    }

    parallelSendTest(channel, testCases, assert, callback);
}

allocCluster.test('request().send() to self', 1, function t(cluster, assert) {
    var one = cluster.channels[0];

    var subOne = one.makeSubChannel({
        serviceName: 'one'
    });

    subOne.handler.register('foo', function foo(req, res, arg2, arg3) {
        assert.ok(Buffer.isBuffer(arg2), 'handler got an arg2 string');
        assert.ok(Buffer.isBuffer(arg3), 'handler got an arg3 string');
        assert.equal(arg2.toString().indexOf('head'), 0, 'expected to get head');
        assert.equal(arg3.toString().indexOf('msg'), 0, 'expected to get msg');

        res.headers.as = 'raw';
        res.sendOk(arg2, arg3);
    });
    subOne.handler.register('bar', function bar(req, res, arg2, arg3) {
        assert.ok(Buffer.isBuffer(arg2), 'handler got an arg2 string');
        assert.ok(Buffer.isBuffer(arg3), 'handler got an arg3 string');
        assert.equal(arg2.toString().indexOf('head'), 0, 'expected to get head');
        assert.equal(arg3.toString().indexOf('msg'), 0, 'expected to get msg');

        res.headers.as = 'raw';
        res.sendNotOk(arg2, arg3);
    });

    subOne.waitForIdentified({
        host: one.hostPort
    }, onIdentified);

    function onIdentified(err) {
        assert.ifError(err, 'should not fail identification to self');

        parallelSendTest(subOne, [
            {
                name: 'msg1', op: 'foo',
                reqHead: 'head1', reqBody: 'msg1',
                resHead: 'head1', resBody: 'msg1',
                opts: {
                    host: one.hostPort,
                    serviceName: 'one'
                }
            },
            {
                name: 'msg2', op: 'bar',
                reqHead: 'head2', reqBody: 'msg2',
                resHead: 'head2', resBody: 'msg2',
                resOk: false,
                opts: {
                    host: one.hostPort,
                    serviceName: 'one'
                }
            }
        ], assert, onResults);
    }

    function onResults(err) {
        assert.ifError(err, 'no errors from sending');
        cluster.assertEmptyState(assert);
        assert.end();
    }
});

allocCluster.test('send to self', {
    numPeers: 1
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var subOne = one.makeSubChannel({
        serviceName: 'one',
        peers: [one.hostPort],
        requestDefaults: {
            hasNoParent: true,
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    subOne.handler.register('foo', function foo(req, res) {
        res.headers.as = 'raw';
        res.sendOk('', 'bar');
    });

    subOne.waitForIdentified({
        host: one.hostPort
    }, onIdentified);

    function onIdentified(err) {
        assert.ifError(err);

        subOne.request({
            host: one.hostPort,
            serviceName: 'one'
        }).send('foo', '', '', onResponse);
    }

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);

        assert.ok(resp.ok);
        assert.equal(String(arg3), 'bar');

        assert.end();
    }
});

allocCluster.test('send junk transport headers', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster.logger.whitelist('info', 'resetting connection');

    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var subOne = one.makeSubChannel({
        serviceName: 'one',
        requestDefaults: {
            hasNoParent: true,
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    subOne.waitForIdentified({
        host: two.hostPort
    }, onIdentified);

    function onIdentified(err1) {
        assert.ifError(err1);

        subOne.request({
            serviceName: 'one',
            host: two.hostPort,
            headers: {
                foo: undefined
            }
        }).send('foo', '', '', onResponse);

        function onResponse(err2) {
            assert.ok(err2);
            assert.equal(err2.type, 'tchannel.connection.reset');

            assert.equal(err2.message,
                'tchannel: tchannel write failure: invalid ' +
                'header type for header foo; expected string, ' +
                'got undefined'
            );

            assert.end();
        }
    }
});

allocCluster.test('self send() with error frame', 1, function t(cluster, assert) {
    var one = cluster.channels[0];
    var subOne = one.makeSubChannel({
        serviceName: 'one'
    });

    subOne.handler.register('foo', function foo(req, res) {
        res.sendError('Cancelled', 'bye lol');
    });

    subOne.register('unhealthy', function unhealthy(req, res) {
        res.sendError('Unhealthy', 'smallest violin');
    });

    function cancelCase(callback) {
        subOne.request({
            host: one.hostPort,
            serviceName: 'one',
            hasNoParent: true,
            headers: {
                'as': 'raw',
                cn: 'wat'
            }
        }).send('foo', '', '', onResponse);

        function onResponse(err) {
            assert.equal(err.message, 'bye lol');
            assert.deepEqual(err, {
                type: 'tchannel.cancelled',
                fullType: 'tchannel.cancelled',
                isErrorFrame: true,
                codeName: 'Cancelled',
                errorCode: 2,
                originalId: 2,
                remoteAddr: one.hostPort,
                name: 'TchannelCancelledError',
                message: 'bye lol'
            });
            callback();
        }
    }

    function unhealthyCase(callback) {
        subOne.request({
            host: one.hostPort,
            serviceName: 'one',
            hasNoParent: true,
            headers: {
                'as': 'raw',
                cn: 'wat'
            }
        }).send('unhealthy', '', '', onResponse);

        function onResponse(err) {
            assert.equal(err.message, 'smallest violin');
            assert.deepEqual(err, {
                type: 'tchannel.unhealthy',
                fullType: 'tchannel.unhealthy',
                isErrorFrame: true,
                codeName: 'Unhealthy',
                errorCode: 8,
                originalId: 3,
                remoteAddr: one.hostPort,
                name: 'TchannelUnhealthyError',
                message: 'smallest violin'
            });
            callback();
        }
    }

    subOne.waitForIdentified({
        host: one.hostPort
    }, onIdentified);

    function onIdentified(err) {
        assert.ifError(err);

        parallel([cancelCase, unhealthyCase], assert.end);
    }
});

allocCluster.test('send() with requestDefaults', 2, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var subOne = one.makeSubChannel({
        serviceName: 'one'
    });

    var subTwo = two.makeSubChannel({
        serviceName: 'one',
        requestDefaults: {
            headers: {
                cn: 'foo'
            }
        },
        peers: [one.hostPort]
    });

    subOne.handler.register('foo', function foo(req, res) {
        res.headers.as = 'raw';
        res.sendOk('', req.callerName);
    });

    subTwo.request({
        serviceName: 'one',
        hasNoParent: true,
        headers: {
            'as': 'raw',
            cn: 'wat'
        }
    }).send('foo', '', '', onResponse);

    function onResponse(err, resp, arg2, arg3) {
        assert.ifError(err);
        assert.ok(resp.ok);

        assert.equal(String(arg3), 'wat');

        assert.end();
    }
});

function parallelSendTest(channel, testCases, assert, callback) {
    var n = testCases.length;
    for (var i = 0; i < testCases.length; i++) {
        var sendCont = sendTest(channel, testCases[i], assert);
        sendCont(onSendDone);
    }

    function onSendDone() {
        --n;
        if (n === 0) {
            callback();
        } else if (n < 0) {
            assert.fail('got ' + Math.abs(n) + ' extra send callbacks');
        }
    }
}

function sendTest(channel, testCase, assert) {
    return function runSendTest(callback) {
        testCase.opts = testCase.opts || {};
        testCase.opts.hasNoParent = true;
        testCase.opts.headers = {
            'as': 'raw',
            cn: 'wat'
        };

        channel
            .request(testCase.opts)
            .send(testCase.op, testCase.reqHead, testCase.reqBody, onResult);

        function onResult(err, res, arg2, arg3) {
            if (testCase.check) {
                testCase.check(testCase, err, res, arg2, arg3);
            } else {
                check(err, res, arg2, arg3);
            }
            callback();
        }
    };

    function check(err, res, arg2, arg3) {
        var head = arg2;
        var body = arg3;
        assert.ifError(err, testCase.name + ': no result error');
        if (!err) {
            assert.ok(typeof head === 'string' || Buffer.isBuffer(head), testCase.name + ': got head buffer or string');
            assert.ok(typeof body === 'string' || Buffer.isBuffer(body), testCase.name + ': got body buffer or string');
            assert.equal(head ? String(head) : head, testCase.resHead, testCase.name + ': expected head content');
            assert.equal(body ? String(body) : body, testCase.resBody, testCase.name + ': expected body content');
        }

        if ('resOk' in testCase) {
            assert.equal(res.ok, testCase.resOk,
                testCase.name + ': expected res ok');
        }
    }
}
