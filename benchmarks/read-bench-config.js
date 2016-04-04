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

/* eslint-disable no-console, no-process-env */

var fs = require('fs');
var parseArgs = require('minimist');
var path = require('path');
var process = require('process');

var extractPartsList = require('../lib/part-list.js').extractPartsList;

module.exports = readBenchConfig;

// TODO: use a topo-sorter to correctly resolve merge order, due to cases like:
//
// A extends C
// B extends C
//
// now say C sets foo => 1
//         A sets foo => 2
//
// then the order "A,B" will have the incorrect foo value of 1 since B
// inherited its parent, and then merged into A overriding it.

function readBenchConfig(minimistOpts, defaults) {
    var opts = defaults || {};
    if (process.env.BENCH_CONFIG) {
        var configParts = extractPartsList(process.env.BENCH_CONFIG);
        opts = mergeConfig(opts, loadConfigParts(configParts.all()));
    }
    if (minimistOpts && minimistOpts.boolean) {
        var def = minimistOpts.defaults || (minimistOpts.defaults = {});
        for (var i = 0; i < minimistOpts.boolean.length; i++) {
            var key = minimistOpts.boolean[i];
            def[key] = opts[key] === undefined ? def[key] || false : opts[key];
        }
        delete minimistOpts.boolean;
    }
    opts = mergeConfig(opts, parseArgs(process.argv.slice(2), minimistOpts));
    return opts;
}

function loadConfigParts(parts) {
    var opts = {};
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        var partPath = path.resolve(part);
        opts = mergeConfig(opts, loadConfigPart(partPath));
    }
    return opts;
}

function loadConfigPart(part) {
    var data = JSON.parse(fs.readFileSync(part));
    if (data._extends) {
        var extendsPath = path.resolve(path.dirname(part), data._extends);
        data = mergeConfig(loadConfigPart(extendsPath), data);
    }
    return data;
}

function mergeConfig(a, b) {
    a.remoteConfig = mergeRemoteConfig(a.remoteConfig, b.remoteConfig);
    for (var key in b) {
        if (b.hasOwnProperty(key)) {
            if (key !== 'remoteConfig') {
                a[key] = b[key];
            }
        }
    }
    return a;
}

function mergeRemoteConfig(a, b) {
    if (!a || !a.length) {
        return b || [];
    }

    if (!b || !b.length) {
        return a;
    }

    var r = [];
    var i;
    var item;
    var seen = {};

    for (i = 0; i < b.length; i++) {
        item = b[i];
        if (!seen[item.key]) {
            seen[item.key] = true;
            r.push(item);
        }
    }

    for (i = 0; i < a.length; i++) {
        item = a[i];
        if (!seen[item.key]) {
            seen[item.key] = true;
            r.push(item);
        }
    }

    return r;
}
