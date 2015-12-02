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

module.exports.extractParts = extractParts;

function extractParts(str) {
    var parts = [];
    forEachPart(str, function eachPart(part) {
        parts.push(part);
    });
    return parts;
}

function forEachPart(str, each) {
    var i = 0;
    var pat = /\{(.+?)\}/g;
    var match = pat.exec(str);
    while (match) {
        var j = match.index;
        var string = str.slice(i, j);
        var choice = match[1].split(',');
        each(new Part(string, choice));
        i = j + match[0].length;
        match = pat.exec(str);
    }
    each(new Part(str.slice(i), null));
}

function Part(string, choice) {
    this.string = string || '';
    this.choice = choice || null;
}

Part.prototype.each = function each(it) {
    if (!this.choice) {
        it(this.string);
        return;
    }
    for (var i = 0; i < this.choice.length; i++) {
        it(this.string + this.choice[i]);
    }
};
