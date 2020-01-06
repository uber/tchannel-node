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

var nodeAssert = require('assert');

module.exports = CollapsedAssert;

// TODO more methods
function CollapsedAssert() {
    if (!(this instanceof CollapsedAssert)) {
        return new CollapsedAssert();
    }

    var self = this;

    self._commands = [];
    self._failed = false;
}

CollapsedAssert.prototype.hasFailed =
function hasFailed() {
    var self = this;
    return self._failed;
};

CollapsedAssert.prototype.ifError = function ifError(err, msg, extra) {
    var self = this;

    if (err) {
        self._failed = true;
    }

    self._commands.push(['ifError', err, msg, extra]);
};

CollapsedAssert.prototype.equal = function equal(a, b, msg, extra) {
    var self = this;

    if (a !== b) {
        self._failed = true;
    }

    self._commands.push(['equal', a, b, msg, extra]);
};

CollapsedAssert.prototype.notEqual = function notEqual(a, b, msg, extra) {
    var self = this;

    if (a === b) {
        self._failed = true;
    }

    self._commands.push(['notEqual', a, b, msg, extra]);
};

CollapsedAssert.prototype.ok = function ok(bool, msg, extra) {
    var self = this;

    if (!bool) {
        self._failed = true;
    }

    self._commands.push(['ok', bool, msg, extra]);
};

CollapsedAssert.prototype.fail = function fail(msg, extra) {
    var self = this;

    self._failed = true;
    self._commands.push(['fail', msg, extra]);
};

CollapsedAssert.prototype.report = function report(realAssert, message) {
    var self = this;

    nodeAssert(message, 'must pass message');
    realAssert.ok(!self._failed, message);
    if (self._failed) {
        self.passthru(realAssert);
    }
};

CollapsedAssert.prototype.passthru = function passthru(realAssert) {
    var self = this;

    for (var i = 0; i < self._commands.length; i++) {
        var command = self._commands[i];

        var method = command.shift();
        realAssert[method].apply(realAssert, command);
    }
};

CollapsedAssert.prototype.comment =
function comment(msg) {
    var self = this;

    self._commands.push(['comment', msg]);
};
