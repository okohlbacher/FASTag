#!/usr/bin/env bash
# tested-tree.sh <job name>
#
# On a v* tag build: has an identical source tree already passed the tests?
# Looks for an earlier run of THIS workflow whose head commit has the tag's git
# tree and whose job <job name> has a successful "Test" step. Only push runs
# (main, earlier tags) and workflow_dispatch runs (the release dry runs) count:
# a pull_request run tests the merge commit refs/pull/N/merge, while the API
# reports the PR head as its head_sha, so its head tree is not what it tested.
#
# Writes reuse=true|false (and run_url, run_id) to $GITHUB_OUTPUT and a line
# to $GITHUB_STEP_SUMMARY. Never fails the job: any error, or anything but a
# v* tag push, gives reuse=false and the tests run as before.
#
# Needs GH_TOKEN with actions: read (and contents: read), GITHUB_REPOSITORY,
# GITHUB_RUN_ID, GITHUB_SHA, GITHUB_REF and GITHUB_EVENT_NAME.
set -uo pipefail

JOB="${1:-}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

run_tests() {
  echo "Test reuse: $1 -- running the tests."
  { echo "reuse=false"; echo "run_url="; echo "run_id="; } >> "$OUT"
  echo "- ${JOB:-?}: tests run here ($1)" >> "$SUMMARY"
  exit 0
}

[[ "$JOB" =~ ^[A-Za-z0-9._-]+$ ]] || run_tests "no usable job name given"
[ "${GITHUB_EVENT_NAME:-}" = push ] || run_tests "not a push (${GITHUB_EVENT_NAME:-unknown event})"
case "${GITHUB_REF:-}" in refs/tags/v*) ;; *) run_tests "not a v* tag (${GITHUB_REF:-no ref})" ;; esac
for v in GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_SHA GH_TOKEN; do
  [ -n "${!v:-}" ] || run_tests "$v is not set"
done
command -v gh >/dev/null 2>&1 || run_tests "gh is not installed"

REPO="$GITHUB_REPOSITORY"
api() { gh api -H "Accept: application/vnd.github+json" "$@"; }

TREE=$(api "repos/$REPO/git/commits/$GITHUB_SHA" --jq .tree.sha) && [ -n "$TREE" ] \
  || run_tests "could not read the tree of $GITHUB_SHA"
WID=$(api "repos/$REPO/actions/runs/$GITHUB_RUN_ID" --jq .workflow_id) && [ -n "$WID" ] \
  || run_tests "could not read this run's workflow id"
echo "Test reuse: tag $GITHUB_REF at $GITHUB_SHA, tree $TREE, job $JOB, workflow $WID"

# The 100 newest runs of this workflow, newest first: push or dispatch, not
# this run, head commit with the same tree.
CANDIDATES=$(api "repos/$REPO/actions/workflows/$WID/runs?per_page=100" --jq "
  .workflow_runs[]
  | select(.id != $GITHUB_RUN_ID)
  | select(.event == \"push\" or .event == \"workflow_dispatch\")
  | select(.head_commit.tree_id == \"$TREE\")
  | \"\(.id) \(.event) \(.head_branch) \(.head_sha)\"") \
  || run_tests "could not list this workflow's runs"
[ -n "$CANDIDATES" ] || run_tests "no earlier push or dispatch run of tree $TREE among the last 100 runs"

while read -r id event branch sha; do
  [ -n "$id" ] || continue
  # The latest attempt of each job; the Test step of job $JOB must have succeeded.
  ok=$(api "repos/$REPO/actions/runs/$id/jobs?per_page=100" --jq "
    [.jobs[] | select(.name == \"$JOB\") | .steps[]? | select(.name == \"Test\" and .conclusion == \"success\")] | length") \
    || { echo "Test reuse: could not read the jobs of run $id; skipping it"; continue; }
  if [ "${ok:-0}" -ge 1 ]; then
    url="https://github.com/$REPO/actions/runs/$id"
    echo "::notice title=Tests not re-run::$JOB: tree $TREE already passed the Test step in run $id ($event on $branch, $sha): $url"
    { echo "reuse=true"; echo "run_url=$url"; echo "run_id=$id"; } >> "$OUT"
    echo "- $JOB: **Test skipped** -- tree \`$TREE\` already passed it in run [$id]($url) ($event on \`$branch\`, \`${sha:0:12}\`)" >> "$SUMMARY"
    exit 0
  fi
  echo "Test reuse: run $id ($event on $branch) has the tree, but no successful Test step in job $JOB"
done <<< "$CANDIDATES"

run_tests "no run of tree $TREE with a successful Test step in job $JOB"
