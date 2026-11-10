#!/bin/bash
# wait_for.sh <seconds> <count> <glob...>: return when at least <count> of the files exist, or after <seconds>.
end=$(( $(date +%s) + $1 )); n=$2; shift 2
while [ "$(ls "$@" 2>/dev/null | wc -l)" -lt "$n" ] && [ "$(date +%s)" -lt "$end" ]; do sleep 20; done
ls "$@" 2>/dev/null
