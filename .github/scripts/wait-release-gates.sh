#!/usr/bin/env bash
# wait-release-gates.sh <workflow file> <release> <dir> [seconds]
#
# ci.yml publishes; this is how it waits for windows.yml. windows.yml's
# release-complete, once every Windows gate passed and its two files are on
# the release with the right digests, uploads the artifact
# release-gates-<release> (gates.json: the release, the commit, the run and
# the files with size and sha256). This waits, bounded, for a run of
# <workflow file> for this same commit ($GITHUB_SHA) that has that artifact
# and a successful release-complete job in its latest attempt, and puts
# gates.json into <dir>. A push run of <release> that completed without it
# fails at once; otherwise the wait ends after [seconds] (default 5400) and
# fails, and the release stays a draft.
#
# Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY and GITHUB_SHA.
set -uo pipefail
WF="${1:?workflow file}"; REL="${2:?release}"; DIR="${3:?dir}"; WAIT="${4:-5400}"
REPO="${GITHUB_REPOSITORY:?}"; SHA="${GITHUB_SHA:?}"
HERE=$(cd "$(dirname "$0")" && pwd)
NAME="release-gates-$REL"
end=$(( $(date +%s) + WAIT ))
api() { gh api -H "Accept: application/vnd.github+json" "$@"; }
while :; do
  runs=$(api "repos/$REPO/actions/workflows/$WF/runs?head_sha=$SHA&per_page=20" \
    | jq -r '.workflow_runs[] | "\(.id) \(.run_attempt) \(.event) \(.status) \(.conclusion) \(.head_branch)"') || runs=""
  while read -r id attempt event status conclusion branch; do
    [ -n "$id" ] || continue
    has=$(api "repos/$REPO/actions/runs/$id/artifacts?per_page=100" \
      | jq -r --arg n "$NAME" '[.artifacts[] | select(.name == $n and .expired == false)] | length') || has=0
    if [ "${has:-0}" -ge 1 ]; then
      ok=$(api "repos/$REPO/actions/runs/$id/attempts/$attempt/jobs?per_page=100" \
        | jq -r '[.jobs[] | select(.name == "release-complete" and .conclusion == "success")] | length') || ok=0
      if [ "${ok:-0}" -ge 1 ] && bash "$HERE/fetch-artifact.sh" "$id" "$NAME" "$DIR" 3 120 \
         && jq -e --arg r "$REL" --arg s "$SHA" '.release == $r and .commit == $s and (.files | length) > 0' "$DIR/gates.json" > /dev/null; then
        echo "$WF run $id (attempt $attempt): its gates passed for $REL at $SHA"
        exit 0
      fi
    fi
    if [ "$event" = push ] && [ "$branch" = "$REL" ] && [ "$status" = completed ]; then
      echo "::error::$WF run $id of $REL completed ($conclusion) without passing its release gates; not publishing"
      exit 1
    fi
  done <<< "$runs"
  [ "$(date +%s)" -lt "$end" ] || { echo "::error::no $WF run of $SHA passed its release gates for $REL within ${WAIT} s; the release stays a draft"; exit 1; }
  echo "waiting for $WF's release gates for $REL ($(( end - $(date +%s) )) s left)"
  sleep "${GATES_POLL:-60}"
done
