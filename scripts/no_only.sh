#!/usr/bin/env bash
set -e
# set -x

if git grep "test\\.only('"; then
    echo "You left an only() in your tests :("
    exit 1
fi

