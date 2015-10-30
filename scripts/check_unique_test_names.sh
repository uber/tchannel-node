#!/usr/bin/env bash
set -e

text=$(git grep "\<test('[^']*'" test | \
    sed -e "s/:[^']*'/ /" -e "s/'.*$//" | \
    cut -d' ' -f2- | \
    sort | \
    uniq -d\
)

if [ -z "$text" ]; then
    exit 0
fi

git grep -f <(echo $text)

if [ "$?" == "0" ]; then
    echo "Found duplicate test names. This is not allowed"
    exit 1
fi
