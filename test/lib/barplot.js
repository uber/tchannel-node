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

module.exports = barplot;

function barplot(emit, pairs) {
    var key, i;

    var maxKeyLen = 0;
    for (i = 0; i < pairs.length; i++) {
        key = pairs[i][0];
        var keyLen = pairs[i][0].length;
        if (keyLen > maxKeyLen) {
            maxKeyLen = keyLen;
        }
    }

    maxKeyLen++;
    for (i = 0; i < pairs.length; i++) {
        key = pairs[i][0];
        var count = pairs[i][1];
        var countStr = 'count=' + count.toString();
        emit(pad(maxKeyLen, ' ', key) +
             pad(10, ' ', countStr) +
             mulchr(count, '*'));
    }
}

function pad(n, c, s) {
    while (s.length < n) {
        s += c;
    }
    return s;
}

function mulchr(n, c) {
    var s = '';
    while (s.length < n) {
        s += c;
    }
    return s;
}
