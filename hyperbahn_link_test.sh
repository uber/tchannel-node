#!/bin/bash
set -e

if [ -z "$1" ]; then
    dest_dir=$(mktemp -d)
    git clone https://github.com/uber/hyperbahn "$dest_dir"
else
    dest_dir=$1
fi

npm link

cd "$dest_dir"

npm install
npm link tchannel
npm run test-ci
