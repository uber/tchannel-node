#!/usr/bin/env bash
set -e
# set -x

bash "$(dirname $0)/verify_included.sh"
bash "$(dirname $0)/no_only.sh"
bash "$(dirname $0)/check_unique_test_names.sh"
