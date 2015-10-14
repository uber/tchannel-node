#!/bin/bash
set -e

npm link

cd "$(mktemp -d)"

git clone https://github.com/uber/hyperbahn .
npm install
npm link tchannel
npm run test-ci
