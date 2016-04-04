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

var allocCluster = require('./lib/alloc-cluster');
var TChannel = require('../channel');
var RelayHandler = require('../relay_handler');
var validators = require('./lib/simple_validators');
var process = global.process;

function isNumber(assert, value) {
    assert.ok(typeof value === 'number', 'expected number');
}

function isLoHostPort(assert, value, key) {
    var desc = key + ' value=' + JSON.stringify(value);

    if (typeof value !== 'string') {
        assert.fail(desc + ': expected a string value');
        return;
    }

    var parts = value.split(':');
    assert.ok(parts.length === 2,
              desc + ': should split into two parts');
    assert.ok(parts[0] === '127.0.0.1',
              desc + ': is a lo host:port');
    assert.ok(parseInt(parts[1]).toString() === parts[1],
              desc + ': has number port');
}

var fixture = {
    'tchannel.inbound.calls.latency': {
        'name': 'tchannel.inbound.calls.latency',
        'type': 'timing',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'callingService': 'wat',
            'service': 'two',
            'endpoint': 'echo'
        }
    },
    'tchannel.inbound.calls.recvd': {
        'name': 'tchannel.inbound.calls.recvd',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'callingService': 'wat',
            'service': 'two',
            'endpoint': 'echo'
        }
    },
    'tchannel.inbound.calls.success': {
        'name': 'tchannel.inbound.calls.success',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'callingService': 'wat',
            'service': 'two',
            'endpoint': 'echo'
        }
    },
    'tchannel.inbound.request.size': {
        'name': 'tchannel.inbound.request.size',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'callingService': 'wat',
            'service': 'two',
            'endpoint': 'echo'
        }
    },
    'tchannel.inbound.response.size': {
        'name': 'tchannel.inbound.response.size',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'callingService': 'wat',
            'service': 'two',
            'endpoint': 'echo'
        }
    },
    'tchannel.outbound.calls.per-attempt-latency': {
        'name': 'tchannel.outbound.calls.per-attempt-latency',
        'type': 'timing',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'targetService': 'two',
            'service': 'wat',
            'targetEndpoint': 'echo',
            'peer': isLoHostPort,
            'retryCount': 0
        }
    },
    'tchannel.outbound.calls.sent': {
        'name': 'tchannel.outbound.calls.sent',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'targetService': 'two',
            'service': 'wat',
            'targetEndpoint': 'echo'
        }
    },
    'tchannel.outbound.calls.success': {
        'name': 'tchannel.outbound.calls.success',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'targetService': 'two',
            'service': 'wat',
            'targetEndpoint': 'echo'
        }
    },
    'tchannel.outbound.request.size': {
        'name': 'tchannel.outbound.request.size',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'targetService': 'two',
            'service': 'wat',
            'targetEndpoint': 'echo'
        }
    },
    'tchannel.outbound.response.size': {
        'name': 'tchannel.outbound.response.size',
        'type': 'counter',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': '',
            'targetService': 'two',
            'service': 'wat',
            'targetEndpoint': 'echo'
        }
    },
    'tchannel.relay.latency': {
        'name': 'tchannel.relay.latency',
        'type': 'timing',
        'value': isNumber,
        'tags': {
            'app': '',
            'host': '',
            'cluster': '',
            'version': ''
        }
    }
};

var errorFixture = {
    'tchannel.inbound.calls.recvd': {
        name: 'tchannel.inbound.calls.recvd',
        type: 'counter',
        value: 1,
        tags: {
            app: '',
            host: '',
            cluster: '',
            version: '',
            callingService: 'wat',
            service: 'two',
            endpoint: 'echo'
        }
    },
    'tchannel.inbound.request.size': {
        name: 'tchannel.inbound.request.size',
        type: 'counter',
        value: 91,
        tags: {
            app: '',
            host: '',
            cluster: '',
            version: '',
            callingService: 'wat',
            service: 'two',
            endpoint: 'echo'
        }
    },
    'tchannel.inbound.calls.latency': {
        name: 'tchannel.inbound.calls.latency',
        type: 'timing',
        value: isNumber,
        tags: {
            app: '',
            host: '',
            cluster: '',
            version: '',
            callingService: 'wat',
            service: 'two',
            endpoint: 'echo'
        }
    },
    'tchannel.inbound.calls.system-errors': {
        name: 'tchannel.inbound.calls.system-errors',
        type: 'counter',
        value: 1,
        tags: {
            app: '',
            host: '',
            cluster: '',
            version: '',
            callingService: 'wat',
            service: 'two',
            endpoint: 'echo',
            type: 'Declined'
        }
    }
};

allocCluster.test('relay emits expected stats', {
    numPeers: 2
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var stats = [];

    one.setLazyHandling(false);
    one.on('stat', function onStat(stat) {
        stats.push(stat);
    });

    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: [two.hostPort]
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);

    var twoSvc = two.makeSubChannel({
        serviceName: 'two'
    });
    twoSvc.register('echo', echo);

    var client = TChannel({
        logger: one.logger,
        timeoutFuzz: 0
    });
    var twoClient = client.makeSubChannel({
        serviceName: 'two',
        peers: [one.hostPort],
        requestDefaults: {
            serviceName: 'two',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    twoClient.request({
        hasNoParent: true
    }).send('echo', 'foo', 'bar', function done(err, res, arg2, arg3) {
        assert.ifError(err, 'no unexpected error');
        assert.equal(String(arg2), 'foo', 'expected arg2');
        assert.equal(String(arg3), 'bar', 'expected arg3');

        client.close();

        process.nextTick(checkStat);

        function checkStat() {
            var statsByName = collectStatsByName(assert, stats);
            validators.validate(assert, statsByName, fixture);
        }

        assert.end();
    });
});

allocCluster.test('lazy relay emits expected stats', {
    numPeers: 2
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var two = cluster.channels[1];
    var stats = [];

    one.setLazyHandling(true);
    one.on('stat', function onStat(stat) {
        stats.push(stat);
    });

    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: [two.hostPort]
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);

    var twoSvc = two.makeSubChannel({
        serviceName: 'two'
    });
    twoSvc.register('echo', echo);

    var client = TChannel({
        logger: one.logger,
        timeoutFuzz: 0
    });
    var twoClient = client.makeSubChannel({
        serviceName: 'two',
        peers: [one.hostPort],
        requestDefaults: {
            serviceName: 'two',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    twoClient.request({
        hasNoParent: true
    }).send('echo', 'foo', 'bar', function done(err, res, arg2, arg3) {
        assert.ifError(err, 'no unexpected error');
        assert.equal(String(arg2), 'foo', 'expected arg2');
        assert.equal(String(arg3), 'bar', 'expected arg3');

        client.close();

        process.nextTick(checkStat);

        function checkStat() {
            var statsByName = collectStatsByName(assert, stats);
            validators.validate(assert, statsByName, fixture);
        }

        assert.end();
    });
});

allocCluster.test('eager relay emits no peer stat', {
    numPeers: 2
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var stats = [];

    one.setLazyHandling(false);
    one.on('stat', function onStat(stat) {
        stats.push(stat);
    });

    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: []
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);

    var twoClient = createClient(cluster);

    twoClient.request({
        hasNoParent: true
    }).send('echo', 'foo', 'bar', function done(err, res, arg2, arg3) {
        assert.ok(err, 'expected err');
        assert.equal(err.type, 'tchannel.declined');

        twoClient.topChannel.close();

        process.nextTick(checkStat);

        function checkStat() {
            // console.log('FFFFFFFFFF---', stats);
            var statsByName = collectStatsByName(assert, stats);
            validators.validate(assert, statsByName, errorFixture);

            assert.end();
        }
    });
});

allocCluster.test('lazy relay emits no peer stat', {
    numPeers: 2
}, function t(cluster, assert) {
    var one = cluster.channels[0];
    var stats = [];

    one.setLazyHandling(true);
    one.on('stat', function onStat(stat) {
        stats.push(stat);
    });

    var oneToTwo = one.makeSubChannel({
        serviceName: 'two',
        peers: []
    });
    oneToTwo.handler = new RelayHandler(oneToTwo);

    var twoClient = createClient(cluster);

    twoClient.request({
        hasNoParent: true
    }).send('echo', 'foo', 'bar', function done(err, res, arg2, arg3) {
        assert.ok(err, 'expected err');
        assert.equal(err.type, 'tchannel.declined');

        twoClient.topChannel.close();

        process.nextTick(checkStat);

        function checkStat() {
            // console.log('FFFFFFFFFF---', stats);
            var statsByName = collectStatsByName(assert, stats);
            validators.validate(assert, statsByName, errorFixture);

            assert.end();
        }
    });
});

function createClient(cluster) {
    var client = TChannel({
        logger: cluster.channels[0].logger,
        timeoutFuzz: 0
    });
    var twoClient = client.makeSubChannel({
        serviceName: 'two',
        peers: [cluster.channels[0].hostPort],
        requestDefaults: {
            serviceName: 'two',
            headers: {
                as: 'raw',
                cn: 'wat'
            }
        }
    });

    return twoClient;
}

function echo(req, res, arg2, arg3) {
    res.headers.as = 'raw';
    res.sendOk(arg2, arg3);
}

function collectStatsByName(assert, stats) {
    var byName = {};
    for (var i = 0; i < stats.length; i++) {
        var stat = stats[i];
        if (byName[stat.name]) {
            assert.fail('duplicate stat ' + stat.name);
        } else {
            byName[stat.name] = stat;
        }
    }
    return byName;
}
