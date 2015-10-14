#!/bin/bash
set -e

if [ -z "$1" ]; then
    dest_dir=$(mktemp -d)
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
