'use strict';

var parseArgs = require('minimist');
var process = require('process');
var assert = require('assert');
var console = require('console');

/*eslint no-console: 0*/
var Channel = require('./channel.js');

function main(opts) {
    assert(opts.p || opts.peer, 'peer required');
    assert(opts._[0], 'serviceName required');
    assert(opts._[1], 'endpoint required');
    assert(opts['2'], 'arg2 required');
    assert(opts['3'], 'arg3 required');

    var channel = new Channel();

    channel.listen(0, '127.0.0.1', onListen);

    function onListen() {
        channel.send({
            host: opts.p || opts.peer,
            ttl: 100,
            headers: {
                as: 'raw'
            },
            serviceName: opts._[0],
            arg1: opts._[1],
            arg2: opts['2'],
            arg3: opts['3']
        }, onResponse);
    }

    function onResponse(err, frame) {
        if (err) {
            console.error('got error', err);
            return;
        }

        console.log('got resp', {
            arg2: frame.readResArg2(),
            arg3: frame.readResArg3()
        });

        channel.close();
    }
}

if (require.main === module) {
    main(parseArgs(process.argv.slice(2)));
}
