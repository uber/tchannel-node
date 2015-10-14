#!/bin/bash
set -e

if [ -z "$1" ]; then
    dest_dir=$(mktemp -d)
    git clone https://github.com/uber/hyperbahn "$dest_dir"
else
    dest_dir=$1
fi

if [ -n "$TCHANNEL_TEST_CONFIG" ]; then
    dest_tchannel_test_config="$dest_dir/from_tchannel_$(echo "$TCHANNEL_TEST_CONFIG" | tr '/' '_')"
    cp -fv "$TCHANNEL_TEST_CONFIG" "$dest_tchannel_test_config"
    TCHANNEL_TEST_CONFIG=$(basename "$dest_tchannel_test_config")
    export TCHANNEL_TEST_CONFIG
fi

npm link

cd "$dest_dir"

npm install
npm link tchannel
npm run test-ci
