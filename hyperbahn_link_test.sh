#!/bin/bash

# Copyright (c) 2015 Uber Technologies, Inc.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

set -e

if [ -z "$1" ]; then
    dest_dir=$(mktemp -d -t tchannel.XXXXXX)
    git clone https://github.com/uber/hyperbahn "$dest_dir"
else
    dest_dir=$1
fi

if [ -n "$TCHANNEL_TEST_CONFIG" ]; then
    for part in $(eval "echo $TCHANNEL_TEST_CONFIG"); do
        dest_part="$dest_dir/from_tchannel_$(echo "$part" | tr '/' '_')"
        cp -fv "$part" "$dest_part"
    done
    TCHANNEL_TEST_CONFIG=from_tchannel_$(echo "$TCHANNEL_TEST_CONFIG" | tr '/' '_')
    export TCHANNEL_TEST_CONFIG
fi

npm link

cd "$dest_dir"

npm install
npm link tchannel
npm run test-ci
