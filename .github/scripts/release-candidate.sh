#!/usr/bin/env bash
# release-candidate.sh <dir>
#
# On a v* tag build (or a promote_to dry run): is there a release CANDIDATE
# for this exact source tree, whose files can be attached instead of built
# again? A candidate is an earlier workflow_dispatch run of THIS workflow,
# completed, whose head commit has the same git tree, whose job
# "release candidate" succeeded (it runs only when every gate of that run
# passed: tests, packaging, smoke and installed-app checks), and whose
# release-candidate-manifest artifact names this tree, this version, that
# run, its latest attempt and this workflow (rc-manifest.py verify), and
# whose every payload artifact still exists, unexpired (a candidate whose
# files expired is skipped, so the tag builds instead of failing). Newest
# first; the first that passes every check wins.
#
# Writes promote=true|false, run_id, run_attempt, manifest_sha256, run_url
# and reason to $GITHUB_OUTPUT,
# the manifest to <dir>/manifest.json, and a line to $GITHUB_STEP_SUMMARY.
# Never fails: any error or no candidate gives promote=false, and the tag
# build builds everything as before.
#
# Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID,
# GITHUB_SHA and VERSION (the release version). RC_META may hold extra
# KEY=VALUE pairs (space-separated) the manifest must carry, e.g. the
# signing policy a tag build would use.
set -uo pipefail
DIR="${1:-rc}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
HERE=$(cd "$(dirname "$0")" && pwd)
PY=$(command -v python3 || command -v python)

no() {
  echo "Promotion: $1 -- building the release files here."
  { echo "promote=false"; echo "run_id="; echo "run_attempt="; echo "manifest_sha256="; echo "run_url="; echo "reason=$1"; } >> "$OUT"
  echo "- release files built here: $1" >> "$SUMMARY"
  exit 0
}
for v in GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_SHA GH_TOKEN VERSION; do
  [ -n "${!v:-}" ] || no "$v is not set"
done
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || no "version '$VERSION' is not X.Y.Z"
command -v gh >/dev/null 2>&1 || no "gh is not installed"
REPO="$GITHUB_REPOSITORY"
api() { gh api -H "Accept: application/vnd.github+json" "$@"; }

TREE=$(api "repos/$REPO/git/commits/$GITHUB_SHA" --jq .tree.sha) && [ -n "$TREE" ] \
  || no "could not read the tree of $GITHUB_SHA"
WID=$(api "repos/$REPO/actions/runs/$GITHUB_RUN_ID" --jq .workflow_id) && [ -n "$WID" ] \
  || no "could not read this run's workflow id"
echo "Promotion: $GITHUB_SHA, tree $TREE, version $VERSION, workflow $WID"
CANDIDATES=$(api "repos/$REPO/actions/workflows/$WID/runs?event=workflow_dispatch&status=completed&per_page=50" --jq "
  .workflow_runs[]
  | select(.id != $GITHUB_RUN_ID)
  | select(.head_commit.tree_id == \"$TREE\")
  | \"\(.id) \(.run_attempt) \(.head_branch) \(.head_sha)\"") \
  || no "could not list this workflow's dispatch runs"
[ -n "$CANDIDATES" ] || no "no completed dispatch run of tree $TREE among the last 50"

META=()
for kv in ${RC_META:-}; do META+=(--meta "$kv"); done
while read -r id attempt branch sha; do
  [ -n "$id" ] || continue
  # The jobs of the run's latest attempt: its "release candidate" job passed.
  ok=$(api "repos/$REPO/actions/runs/$id/attempts/$attempt/jobs?per_page=100" --jq '
    [.jobs[] | select(.name == "release candidate" and .conclusion == "success")] | length') \
    || { echo "Promotion: could not read the jobs of run $id attempt $attempt; skipping it"; continue; }
  if [ "${ok:-0}" -lt 1 ]; then
    echo "Promotion: run $id ($branch) has the tree but no successful release candidate job"
    continue
  fi
  rm -rf "$DIR"; mkdir -p "$DIR"
  if ! bash "$HERE/fetch-artifact.sh" "$id" release-candidate-manifest "$DIR/a" 3 120; then
    echo "Promotion: run $id: no release-candidate-manifest artifact; skipping it"; continue
  fi
  mv "$DIR/a/manifest.json" "$DIR/manifest.json" 2>/dev/null || { echo "Promotion: run $id: no manifest.json in the artifact"; continue; }
  if ! "$PY" "$HERE/rc-manifest.py" verify "$DIR/manifest.json" --tree "$TREE" --version "$VERSION" \
       --run-id "$id" --workflow-id "$WID" --meta "run_attempt=$attempt" "${META[@]}"; then
    echo "Promotion: run $id: its manifest does not match; skipping it"; continue
  fi
  # Every artifact the manifest names is still there and unexpired.
  live=$(api "repos/$REPO/actions/runs/$id/artifacts?per_page=100" --paginate --jq '.artifacts[] | select(.expired == false) | .name') \
    || { echo "Promotion: could not list the artifacts of run $id; skipping it"; continue; }
  gone=""
  for a in $("$PY" "$HERE/rc-manifest.py" list "$DIR/manifest.json" | cut -f1 | sort -u); do
    grep -qxF "$a" <<< "$live" || gone="$gone $a"
  done
  if [ -n "$gone" ]; then
    echo "Promotion: run $id: artifacts expired or missing:$gone; skipping it"; continue
  fi
  msha=$("$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$DIR/manifest.json")
  url="https://github.com/$REPO/actions/runs/$id"
  echo "::notice title=Release files promoted::tree $TREE: the files of candidate run $id ($branch, $sha, attempt $attempt): $url"
  { echo "promote=true"; echo "run_id=$id"; echo "run_attempt=$attempt"; echo "manifest_sha256=$msha"; echo "run_url=$url"; echo "reason=candidate run $id"; } >> "$OUT"
  echo "- **release files promoted** from candidate run [$id]($url) (\`$branch\`, \`${sha:0:12}\`, tree \`$TREE\`)" >> "$SUMMARY"
  exit 0
done <<< "$CANDIDATES"
no "no run of tree $TREE with a successful release candidate job and a matching manifest"
