#!/bin/bash
set -ueo pipefail
npm install --no-save \
    "farmhash@^$(node -e 'console.log(/v(\d+)\./.exec(process.version)[1] >= 4 ? 3 : 1)')" \
    "sse4_crc32@^$(node -e 'console.log(/v(\d+)\./.exec(process.version)[1] >= 4 ? 6 : 5)')"
