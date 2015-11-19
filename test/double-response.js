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

var TypedError = require('error/typed');

var allocCluster = require('./lib/alloc-cluster.js');
var TChannelAsThrift = require('../as/thrift.js');

var throft = [
    'struct DoubleResult {',
    '    1: required string value',
    '}',
    '',
    'exception DoubleError {',
    '    1: required string message',
    '}',
    '',
    'service DoubleResponse {',
    '    DoubleResult method(1: string value) throws (',
    '        1: DoubleError error',
    '    )',
    '}'
].join('\n');

/*

    BUG: OK OK
    BUG: OK NOT_OK
    BUG: OK ERROR_FRAME
    BUG: NOT_OK OK
    BUG: NOT_OK NOT_OK
    BUG: NOT_OK ERROR_FRAME
    BUG: ERROR_FRAME OK
    BUG: ERROR_FRAME NOT_OK
    BUG: ERROR_FRAME ERROR_FRAME
    OPERATIONAL: TIMEOUT OK
    OPERATIONAL: TIMEOUT NOT_OK
    OPERATIONAL: TIMEOUT ERROR_FRAME
    BUG: INTERNAL_ERRORFRAME OK
    BUG: INTERNAL_ERRORFRAME NOT_OK
    BUG: INTERNAL_ERRORFRAME ERROR_FRAME

*/

allocCluster.test('sending OK OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['ok', 'ok']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ifError(err);

        assert.deepEqual(resp.head, {});
        assert.ok(resp.body);

        assert.equal(resp.body.value, 'foobar');

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 1);
        var record1 = lines[0];

        var err1 = record1.meta.error;

        assert.equal(record1.msg, 'outgoing response has an error');
        assert.equal(record1.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record1.meta.responseState, 'Done');
        assert.equal(record1.meta.responseOk, true);
        assert.equal(err1.method, 'setOk');
        assert.equal(err1.type, 'tchannel.response-already-started');
        assert.equal(err1.ok, true);

        assert.end();
    }
});

allocCluster.test('sending OK NOT_OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['ok', 'not ok']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ifError(err);

        assert.deepEqual(resp.head, {});
        assert.ok(resp.body);

        assert.equal(resp.body.value, 'foobar');

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 1);
        var record1 = lines[0];

        var err1 = record1.meta.error;

        assert.equal(record1.msg, 'outgoing response has an error');
        assert.equal(record1.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record1.meta.responseState, 'Done');
        assert.equal(record1.meta.responseOk, true);
        assert.equal(err1.method, 'setOk');
        assert.equal(err1.type, 'tchannel.response-already-started');
        assert.equal(err1.ok, false);

        assert.end();
    }
});

allocCluster.test('sending OK ERROR_FRAME', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['ok', 'error']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );
    cluster.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ifError(err);

        assert.deepEqual(resp.head, {});
        assert.ok(resp.body);

        assert.equal(resp.body.value, 'foobar');

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 2);
        var record1 = lines[0];
        var record2 = lines[1];

        var err1 = record1.meta.error;
        var err2 = record2.meta.error;

        assert.equal(record1.msg,
            'Got unexpected error in handler');
        assert.equal(record1.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err1.message, 'Error: foobar');

        assert.equal(record2.msg, 'outgoing response has an error');
        assert.equal(record2.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record2.meta.responseState, 'Done');
        assert.ok(record2.meta.arg3.indexOf('foobar') >= 0);
        assert.equal(err2.method, 'sendError');
        assert.equal(err2.type, 'tchannel.response-already-done');
        assert.equal(err2.codeString, 'UnexpectedError');
        assert.equal(err2.errMessage, 'Unexpected Error');

        assert.end();
    }
});

allocCluster.test('sending NOT_OK OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['not ok', 'ok']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ifError(err);

        assert.deepEqual(resp.head, {});
        assert.ok(resp.body);

        assert.equal(resp.body.message, 'foobar');

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 1);
        var record1 = lines[0];

        var err1 = record1.meta.error;

        assert.equal(record1.msg, 'outgoing response has an error');
        assert.equal(record1.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record1.meta.responseState, 'Done');
        assert.equal(record1.meta.responseOk, false);
        assert.equal(err1.method, 'setOk');
        assert.equal(err1.type, 'tchannel.response-already-started');
        assert.equal(err1.ok, true);

        assert.end();
    }
});

allocCluster.test('sending NOT_OK NOT_OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['not ok', 'not ok']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ifError(err);

        assert.deepEqual(resp.head, {});
        assert.ok(resp.body);

        assert.equal(resp.body.message, 'foobar');

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 1);
        var record1 = lines[0];

        var err1 = record1.meta.error;

        assert.equal(record1.msg, 'outgoing response has an error');
        assert.equal(record1.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record1.meta.responseState, 'Done');
        assert.equal(record1.meta.responseOk, false);
        assert.equal(err1.method, 'setOk');
        assert.equal(err1.type, 'tchannel.response-already-started');
        assert.equal(err1.ok, false);

        assert.end();
    }
});

allocCluster.test('sending NOT_OK ERROR_FRAME', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['not ok', 'error']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );
    cluster.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ifError(err);

        assert.deepEqual(resp.head, {});
        assert.ok(resp.body);

        assert.equal(resp.body.message, 'foobar');

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 2);
        var record1 = lines[0];
        var record2 = lines[1];

        var err1 = record1.meta.error;
        var err2 = record2.meta.error;

        assert.equal(record1.msg,
            'Got unexpected error in handler');
        assert.equal(record1.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err1.message, 'Error: foobar');

        assert.equal(record2.msg, 'outgoing response has an error');
        assert.equal(record2.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record2.meta.responseState, 'Done');
        assert.ok(record2.meta.arg3.indexOf('foobar') >= 0);
        assert.equal(err2.method, 'sendError');
        assert.equal(err2.type, 'tchannel.response-already-done');
        assert.equal(err2.codeString, 'UnexpectedError');
        assert.equal(err2.errMessage, 'Unexpected Error');

        assert.end();
    }
});

allocCluster.test('sending ERROR_FRAME OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['error', 'ok']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );
    cluster.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ok(err && (
            err.type === 'tchannel.unexpected'
        ), 'expected "unexpected" error');

        assert.equal(resp, undefined);

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 2);
        var record1 = lines[0];
        var record2 = lines[1];

        var err1 = record1.meta.error;
        var err2 = record2.meta.error;

        assert.equal(record1.msg,
            'Got unexpected error in handler');
        assert.equal(record1.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err1.message, 'Error: foobar');

        assert.equal(record2.msg, 'outgoing response has an error');
        assert.equal(record2.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record2.meta.responseState, 'Error');
        assert.equal(record2.meta.responseCodeString, 'UnexpectedError');
        assert.equal(record2.meta.responseErrorMessage, 'Unexpected Error');
        assert.equal(err2.method, 'setOk');
        assert.equal(err2.ok, true);
        assert.equal(err2.type, 'tchannel.response-already-started');

        assert.end();
    }
});

allocCluster.test('sending ERROR_FRAME NOT_OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['error', 'not ok']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );
    cluster.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ok(err && (
            err.type === 'tchannel.unexpected'
        ), 'expected "unexpected" error');

        assert.equal(resp, undefined);

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 2);
        var record1 = lines[0];
        var record2 = lines[1];

        var err1 = record1.meta.error;
        var err2 = record2.meta.error;

        assert.equal(record1.msg,
            'Got unexpected error in handler');
        assert.equal(record1.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err1.message, 'Error: foobar');

        assert.equal(record2.msg, 'outgoing response has an error');
        assert.equal(record2.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record2.meta.responseState, 'Error');
        assert.equal(record2.meta.responseCodeString, 'UnexpectedError');
        assert.equal(record2.meta.responseErrorMessage, 'Unexpected Error');
        assert.equal(err2.method, 'setOk');
        assert.equal(err2.ok, false);
        assert.equal(err2.type, 'tchannel.response-already-started');

        assert.end();
    }
});

allocCluster.test('sending ERROR_FRAME ERROR_FRAME', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['error', 'error']
    });

    cluster.logger.whitelist(
        'error',
        'outgoing response has an error'
    );
    cluster.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server'
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ok(err && (
            err.type === 'tchannel.unexpected'
        ), 'expected "unexpected" error');

        assert.equal(resp, undefined);

        setTimeout(afterTime, 100);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 3);
        var record1 = lines[0];
        var record2 = lines[1];
        var record3 = lines[2];

        var err1 = record1.meta.error;
        var err2 = record2.meta.error;
        var err3 = record3.meta.error;

        assert.equal(record1.msg,
            'Got unexpected error in handler');
        assert.equal(record1.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err1.message, 'Error: foobar');

        assert.equal(record2.msg,
            'Got unexpected error in handler');
        assert.equal(record2.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err2.message, 'Error: foobar');

        assert.equal(record3.msg, 'outgoing response has an error');
        assert.equal(record3.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record3.meta.responseState, 'Error');
        assert.equal(record3.meta.responseCodeString, 'UnexpectedError');
        assert.equal(record3.meta.responseErrorMessage, 'Unexpected Error');
        assert.equal(err3.method, 'sendError');
        assert.equal(err3.type, 'tchannel.response-already-done');
        assert.equal(err3.codeString, 'UnexpectedError');
        assert.equal(err3.errMessage, 'Unexpected Error');

        assert.end();
    }
});

allocCluster.test('sending INTERNAL_TIMEOUT OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['timeout', 'ok'],
        timeout: 300
    });

    cluster.logger.whitelist(
        'info',
        'error for timed out outgoing response'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server',
        timeout: 100
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ok(err && (
            err.type === 'tchannel.request.timeout' ||
            err.type === 'tchannel.timeout'
        ), 'expected timeout error');

        setTimeout(afterTime, 500);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 1);
        var record1 = lines[0];

        var err1 = record1.meta.error;

        assert.equal(record1.msg, 'error for timed out outgoing response');
        assert.equal(record1.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record1.meta.responseState, 'Error');
        assert.equal(record1.meta.responseOk, true);
        assert.equal(record1.meta.responseCodeString, 'Timeout');
        assert.equal(err1.method, 'setOk');
        assert.equal(err1.type, 'tchannel.response-already-started');
        assert.equal(err1.ok, true);

        assert.end();
    }
});

allocCluster.test('sending INTERNAL_TIMEOUT NOT_OK', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['timeout', 'not ok'],
        timeout: 300
    });

    cluster.logger.whitelist(
        'info',
        'error for timed out outgoing response'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server',
        timeout: 100
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ok(err && (
            err.type === 'tchannel.request.timeout' ||
            err.type === 'tchannel.timeout'
        ), 'expected timeout error');

        setTimeout(afterTime, 500);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 1);
        var record1 = lines[0];

        var err1 = record1.meta.error;

        assert.equal(record1.msg, 'error for timed out outgoing response');
        assert.equal(record1.meta.requestArg1, 'DoubleResponse::method');
        assert.equal(record1.meta.responseState, 'Error');
        assert.equal(record1.meta.responseOk, true);
        assert.equal(record1.meta.responseCodeString, 'Timeout');
        assert.equal(err1.method, 'setOk');
        assert.equal(err1.type, 'tchannel.response-already-started');
        assert.equal(err1.ok, false);

        assert.end();
    }
});

allocCluster.test('sending INTERNAL_TIMEOUT ERROR_FRAME', {
    numPeers: 2
}, function t(cluster, assert) {
    cluster = allocThrift(cluster, {
        messages: ['timeout', 'error'],
        timeout: 300
    });

    cluster.logger.whitelist(
        'info',
        'error for timed out outgoing response'
    );
    cluster.logger.whitelist(
        'error',
        'Got unexpected error in handler'
    );

    cluster.asThrift.send(cluster.client.request({
        hasNoParent: true,
        serviceName: 'server',
        timeout: 100
    }), 'DoubleResponse::method', null, {
        value: 'foobar'
    }, function onResponse(err, resp) {
        assert.ok(err && (
            err.type === 'tchannel.request.timeout' ||
            err.type === 'tchannel.timeout'
        ), 'expected timeout error');

        setTimeout(afterTime, 500);
    });

    function afterTime() {
        var lines = cluster.logger.items();

        assert.equal(lines.length, 2);
        var record1 = lines[0];
        var record2 = lines[1];

        var err1 = record1.meta.error;
        var err2 = record2.meta.error;

        assert.equal(record1.msg,
            'Got unexpected error in handler');
        assert.equal(record1.meta.endpoint, 'DoubleResponse::method');
        assert.equal(err1.message, 'Error: foobar');

        assert.equal(record2.msg, 'error for timed out outgoing response');
        assert.equal(record2.meta.responseState, 'Error');
        assert.equal(record2.meta.responseOk, true);
        assert.equal(record2.meta.responseCodeString, 'Timeout');
        assert.equal(record2.meta.requestArg1, 'DoubleResponse::method');

        assert.equal(err2.method, 'sendError');
        assert.equal(err2.type, 'tchannel.response-already-done');
        assert.equal(err2.codeString, 'UnexpectedError');
        assert.equal(err2.errMessage, 'Unexpected Error');

        assert.end();
    }
});

function allocThrift(cluster, options) {
    options = options || {};

    var server = cluster.channels[0].makeSubChannel({
        serviceName: 'server'
    });
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
    var DoubleError = TypedError({
        type: 'double',
        message: 'double',
        nameAsThrift: 'error'
    });

    var handler = options.messages ?
        messagesHandler : null;

    var tchannelAsThrift = TChannelAsThrift({
        entryPoint: 'entryPoint',
        idls: {
            entryPoint: throft
        },
        allowFilesystemAccess: false
    });
    tchannelAsThrift.register(
        server, 'DoubleResponse::method', {}, handler
    );

    cluster.server = server;
    cluster.client = client;
    cluster.asThrift = tchannelAsThrift;

    return cluster;

    function messagesHandler(opts, req, head, body, cb) {
        send(cb, {
            type: options.messages[0],
            head: head,
            body: body
        });

        setTimeout(function () {
            send(cb, {
                type: options.messages[1],
                head: head,
                body: body
            });
        }, options.timeout || 50);
    }

    function send(cb, opts) {
        if (opts.type === 'ok') {
            return cb(null, {
                ok: true,
                head: opts.head,
                body: opts.body
            });
        } else if (opts.type === 'not ok') {
            return cb(null, {
                ok: false,
                head: opts.head,
                body: DoubleError({
                    message: opts.body.value
                }),
                typeName: 'error'
            });
        } else if (opts.type === 'error') {
            return cb(new Error('Error: ' + opts.body.value));
        } else if (opts.type === 'timeout') {
            /* do nothing on purpose*/
            void 0;
        } else {
            throw new Error('unknown testing type: ' + opts.type);
        }
    }
}
