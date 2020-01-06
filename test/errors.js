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

var fs = require('fs');
var path = require('path');
var split2 = require('split2');
var test = require('tape');
var util = require('util');

var Errors = require('../errors.js');

var errorsPath = path.resolve(path.join(__dirname, '..', 'errors.js'));

test('errors module should be in sorted order', function t(assert) {
    var exportedErrors = [];

    processLineMatches({
        filePath: errorsPath,
        caseRegex: /^Errors\.([^ ]+) *= *([\w_\-]+)/,
        onMatch: function each(match) {
            if (/Error$/.test(match[2])) {
                exportedErrors.push(match[1]);
            }
        },
        onFinish: checkExportedErrors
    });

    function checkExportedErrors() {
        var expected = exportedErrors.slice().sort();
        var allOk = true;
        for (var i = 0; i < expected.length; i++) {
            if (exportedErrors[i] !== expected[i]) {
                allOk = false;
                assert.fail(util.format(
                    'errors module not in sorted order: %s is out of place (expected %s)',
                    exportedErrors[i], expected[i]));
            }
        }
        if (allOk) assert.pass('errors module is in sorted order');
        assert.end();
    }
});

test('error classification cases must be sorted', function t(assert) {
    var caseAccum = [];
    var cases = {};

    processLineMatches({
        filePath: errorsPath,
        caseRegex: /\breturn +'(\w+)'|case\s+(['"])(.+?)\2/,
        onMatch: function each(match) {
            if (match[1]) {
                cases[match[1]] = caseAccum;
                caseAccum = [];
            } else {
                caseAccum.push(match[3]);
            }
        },
        onFinish: checkCases
    });

    function checkCases() {
        Object.keys(cases).forEach(checkCase);
        assert.end();
    }

    function checkCase(category) {
        var catCases = cases[category];
        var expected = catCases.slice().sort();
        var allOk = true;
        for (var i = 0; i < expected.length; i++) {
            if (catCases[i] !== expected[i]) {
                allOk = false;
                assert.fail(util.format(
                    '%s cases not in sorted order: %s is out of place (expected %s)',
                    category, catCases[i], expected[i]));
            }
        }

        if (allOk) {
            assert.pass(util.format('%s cases are in sorted order', category));
        }
    }
});

test('error case statements should not be duplicates', function t(assert) {
    var caseTypes = [];
    processLineMatches({
        filePath: errorsPath,
        startRegex: /Errors\.classify = function classify\(err\) \{/,
        caseRegex: /case\s+(['"])(.+?)\1/,
        endRegex: /\};/,
        onMatch: function each(match) {
            caseTypes.push(match[2]);
        },
        onFinish: checkCases
    });

    function checkCases() {
        var errorTypes = getValueTypes(Errors);
        caseTypes.sort();
        errorTypes.sort();
        assert.equal(caseTypes.length, errorTypes.length);
        assert.deepEqual(caseTypes, errorTypes);
        assert.end();
    }

    function getValueTypes(obj) {
        var types = [];
        var keys = Object.keys(obj);
        for (var i = 0; i < keys.length; i++) {
            var val = obj[keys[i]];
            if (val && val.type) {
                types.push(val.type);
            }
        }
        return types;
    }
});

test('all errors are classified', function t(assert) {
    var keys = Object.keys(Errors);
    for (var i = 0; i < keys.length; i++) {
        var errorFn = Errors[keys[i]];
        if (!errorFn || !errorFn.type) {
            continue;
        }

        var errObj = errorFn(new Error('e'));

        var errorClass = Errors.classify(errObj);
        assert.ok(errorClass, errorFn.type + ' can be classified');
    }

    assert.end();
});

var expectedErrorCodes = [
    'BadRequest',
    'Busy',
    'Cancelled',
    'Declined',
    'NetworkError',
    'ProtocolError',
    'Timeout',
    'UnexpectedError',
    'Unhealthy'
];

test('error code classification coverage', function t(assert) {
    var func = '';
    var cases = null;

    processLineMatches({
        filePath: errorsPath,
        caseRegex: /^Errors\.([^ ]+) *= function *([\w_\-]+)|switch *\(\s*(.+?)\s*\)|case *'(.+?)' *:/,
        onMatch: function each(match) {
            if (match[2]) {
                checkFunc();
                func = match[2];
                cases = null;
            } else if (func && match[3]) {
                if (match[3] === 'codeName') { // XXX bit fragile?
                    cases = [];
                }
            } else if (cases !== null && match[4]) {
                cases.push(match[4]);
            }
        },
        onFinish: finish
    });

    function checkFunc() {
        if (!func) {
            return;
        }
        if (cases === null) {
            return;
        }

        var i;
        var got = {};
        for (i = 0; i < cases.length; i++) {
            assert.ok(expectedErrorCodes.indexOf(cases[i]) !== -1,
                      func + ' should not cover unexpected error classes: ' +
                      cases[i]);
            got[cases[i]] = true;
        }

        for (i = 0; i < expectedErrorCodes.length; i++) {
            assert.ok(got[expectedErrorCodes[i]],
                      func + ' should cover all expected error classes: ' +
                      expectedErrorCodes[i]);
        }

    }

    function finish() {
        checkFunc();

        assert.end();
    }
});

function processLineMatches(options) {
    var inScope = false;

    fs.createReadStream(options.filePath, 'utf8')
        .pipe(split2())
        .on('data', eachLine)
        .on('end', streamDone);

    function eachLine(line) {
        if (options.startRegex && !inScope) {
            if (options.startRegex.test(line)) {
                inScope = true;
            }
        }

        if (!options.startRegex || inScope) {
            var match = options.caseRegex.exec(line);
            if (match) {
                options.onMatch(match);
            }
        }

        if (options.endRegex && inScope) {
            if (options.endRegex.test(line)) {
                inScope = false;
            }
        }
    }

    function streamDone() {
        process.nextTick(options.onFinish);
    }
}
