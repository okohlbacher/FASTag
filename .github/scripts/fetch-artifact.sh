#!/usr/bin/env bash
# fetch-artifact.sh <run id> <artifact name> <dir> [attempts] [seconds per attempt]
#
# Downloads one workflow artifact with gh run download, bounded: each attempt
# gets a time limit and a fresh, empty directory, and the next attempt starts
# over. The v1.16.4 Windows release-assets job sat 53 minutes in a stalled
# actions/download-artifact; its rerun took a minute. Exits non-zero after the
# last failed attempt; on success <dir> holds the artifact's files and
# nothing of an earlier attempt.
#
# Needs GH_TOKEN (actions: read) and GH_REPO or GITHUB_REPOSITORY.
set -uo pipefail
RUN="${1:?run id}"; NAME="${2:?artifact name}"; DIR="${3:?directory}"
ATTEMPTS="${4:-3}"; LIMIT="${5:-300}"
REPO="${GH_REPO:-${GITHUB_REPOSITORY:?GH_REPO or GITHUB_REPOSITORY}}"

# A time limit without coreutils' timeout (macOS runners have none).
bounded() {
  local s=$1; shift
  if command -v timeout >/dev/null 2>&1 && timeout --version >/dev/null 2>&1; then
    timeout "$s" "$@"
  else
    perl -e '$SIG{ALRM} = sub { kill "TERM", $pid; exit 124 }; alarm shift; $pid = fork // die; if (!$pid) { exec @ARGV or exit 127 } waitpid $pid, 0; exit($? >> 8)' "$s" "$@"
  fi
}

for ((i = 1; i <= ATTEMPTS; i++)); do
  rm -rf "$DIR"; mkdir -p "$DIR"
  start=$(date +%s)
  if bounded "$LIMIT" gh run download "$RUN" --repo "$REPO" --name "$NAME" --dir "$DIR"; then
    if [ -n "$(find "$DIR" -type f | head -1)" ]; then
      echo "artifact $NAME of run $RUN: attempt $i, $(( $(date +%s) - start )) s, $(find "$DIR" -type f | wc -l | tr -d ' ') file(s)"
      exit 0
    fi
    echo "::warning::artifact $NAME of run $RUN: attempt $i gave no file"
  else
    echo "::warning::artifact $NAME of run $RUN: attempt $i failed or exceeded ${LIMIT} s"
  fi
  [ "$i" -lt "$ATTEMPTS" ] && sleep $((i * 10))
done
rm -rf "$DIR"
echo "::error::could not download artifact $NAME of run $RUN in $ATTEMPTS attempts"
exit 1
