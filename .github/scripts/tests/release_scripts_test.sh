#!/usr/bin/env bash
# shellcheck disable=SC2015  # ok/bad never fail: A && ok || bad is the intent
# The release scripts against written API responses (stub-gh): tested-tree.sh
# (test reuse on a tag), release-candidate.sh and rc-manifest.py (promotion),
# release-draft.sh (one draft per tag, also when jobs race). Each case states
# what the script must decide.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
S="$HERE/.."
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"; cp "$HERE/stub-gh" "$W/bin/gh"; chmod +x "$W/bin/gh"
export PATH="$W/bin:$PATH"
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; [ -n "${2:-}" ] && cat "$2"; }
R=o/r; TREE=t1; SHA=c1; RUN=900; WID=7
fixtures() {  # fresh fixture dir in $F
  F="$W/f$((++n))"; mkdir -p "$F"; export GH_FIXTURES="$F"
  echo "{\"tree\": {\"sha\": \"$TREE\"}}" > "$F/repos_o_r_git_commits_$SHA.json"
  echo "{\"workflow_id\": $WID}" > "$F/repos_o_r_actions_runs_$RUN.json"
}
n=0
run_env() { env GITHUB_REPOSITORY=$R GITHUB_RUN_ID=$RUN GITHUB_SHA=$SHA GH_TOKEN=x "$@"; }

# ------------------------------------------------------------------ tested-tree.sh
tt() {  # expect-reuse case-name; the runs list and jobs are in $F
  local out="$F/out"; : > "$out"
  run_env GITHUB_EVENT_NAME=push GITHUB_REF=refs/tags/v1.2.3 GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY=/dev/null \
    bash "$S/tested-tree.sh" linux-x64 > "$F/log" 2>&1
  if grep -qx "reuse=$1" "$out"; then ok "tested-tree: $2"; else bad "tested-tree: $2" "$F/log"; fi
}
runs() {  # id:event:tree ...
  local j='{"workflow_runs": ['; local sep=""
  for r in "$@"; do IFS=: read -r id ev tr <<< "$r"
    j="$j$sep{\"id\": $id, \"event\": \"$ev\", \"head_branch\": \"b\", \"head_sha\": \"s$id\", \"run_attempt\": 1, \"head_commit\": {\"tree_id\": \"$tr\"}}"; sep=,; done
  echo "$j]}"
}
jobs() {  # job-name step-name conclusion
  echo "{\"jobs\": [{\"name\": \"$1\", \"conclusion\": \"$3\", \"steps\": [{\"name\": \"$2\", \"conclusion\": \"$3\"}]}]}"
}
fixtures; runs 801:workflow_dispatch:t1 > "$F/repos_o_r_actions_workflows_7_runs_per_page_100.json"
jobs linux-x64 Test success > "$F/repos_o_r_actions_runs_801_jobs_per_page_100.json"
tt true "a dispatch run of the tree passed Test"
fixtures; runs 801:pull_request:t1 > "$F/repos_o_r_actions_workflows_7_runs_per_page_100.json"
jobs linux-x64 Test success > "$F/repos_o_r_actions_runs_801_jobs_per_page_100.json"
tt false "a pull_request run does not count"
fixtures; runs 801:workflow_dispatch:t2 > "$F/repos_o_r_actions_workflows_7_runs_per_page_100.json"
jobs linux-x64 Test success > "$F/repos_o_r_actions_runs_801_jobs_per_page_100.json"
tt false "another tree does not count"
fixtures; runs 801:workflow_dispatch:t1 > "$F/repos_o_r_actions_workflows_7_runs_per_page_100.json"
jobs linux-x64 Test failure > "$F/repos_o_r_actions_runs_801_jobs_per_page_100.json"
tt false "a failed Test step does not count"
fixtures; runs 801:workflow_dispatch:t1 > "$F/repos_o_r_actions_workflows_7_runs_per_page_100.json"
jobs "linux-x64 build" Test success > "$F/repos_o_r_actions_runs_801_jobs_per_page_100.json"
tt false "the build job (another name) does not count"
fixtures; runs 801:workflow_dispatch:t1 802:push:t1 > "$F/repos_o_r_actions_workflows_7_runs_per_page_100.json"
touch "$F/repos_o_r_actions_runs_801_jobs_per_page_100.fail"
jobs linux-x64 Test success > "$F/repos_o_r_actions_runs_802_jobs_per_page_100.json"
tt true "an unreadable run is skipped, the next one counts"
fixtures; touch "$F/repos_o_r_actions_workflows_7_runs_per_page_100.fail"
tt false "an API error runs the tests"

# ------------------------------------------------------------------ rc-manifest.py
PY=$(command -v python3)
M="$W/m"; mkdir -p "$M/a/A1" "$M/a/A2"
echo deb > "$M/a/A1/x.deb"; echo tgz > "$M/a/A1/x.tar.gz"; echo img > "$M/a/A2/FASTag-1.2.3-gui-macos-arm64.dmg"
"$PY" "$S/rc-manifest.py" part --job gui-linux --artifact A1 --group linux-x64 --out "$M/p1.json" \
  fastag-gui_1.2.3_amd64.deb="$M/a/A1/x.deb" FASTag-1.2.3-gui-linux-x64.tar.gz="$M/a/A1/x.tar.gz" > /dev/null \
  && "$PY" "$S/rc-manifest.py" part --job macos-app --artifact A2 --group macos --out "$M/p2.json" \
     FASTag-1.2.3-gui-macos-arm64.dmg="$M/a/A2/FASTag-1.2.3-gui-macos-arm64.dmg" > /dev/null \
  && ok "rc-manifest: parts" || bad "rc-manifest: parts"
"$PY" "$S/rc-manifest.py" merge --out "$M/m.json" --meta tree=t1 --meta version=1.2.3 --meta run_id=801 --meta workflow_id=7 \
  --meta macos_signed=true --require fastag-gui_1.2.3_amd64.deb "$M/p1.json" "$M/p2.json" > /dev/null \
  && ok "rc-manifest: merge" || bad "rc-manifest: merge"
"$PY" "$S/rc-manifest.py" merge --out "$M/m2.json" --meta tree=t1 --meta version=1.2.3 --meta run_id=801 --meta workflow_id=7 \
  --require FASTag-1.2.3-linux-x64.tar.gz "$M/p1.json" 2> /dev/null && bad "rc-manifest: a missing required file fails the merge" \
  || ok "rc-manifest: a missing required file fails the merge"
vf() { "$PY" "$S/rc-manifest.py" verify "$M/m.json" --tree "$1" --version "$2" --run-id "$3" --workflow-id 7 ${4:+--meta "$4"} > /dev/null 2>&1; }
vf t1 1.2.3 801 && ok "rc-manifest: verify" || bad "rc-manifest: verify"
vf t2 1.2.3 801 && bad "rc-manifest: another tree is refused" || ok "rc-manifest: another tree is refused"
vf t1 1.2.4 801 && bad "rc-manifest: another version is refused" || ok "rc-manifest: another version is refused"
vf t1 1.2.3 802 && bad "rc-manifest: another run is refused" || ok "rc-manifest: another run is refused"
vf t1 1.2.3 801 macos_signed=false && bad "rc-manifest: another signing is refused" || ok "rc-manifest: another signing is refused"
"$PY" "$S/rc-manifest.py" check "$M/m.json" --dir "$M/a" --out "$M/out" --group linux-x64 > /dev/null \
  && [ -f "$M/out/fastag-gui_1.2.3_amd64.deb" ] && ok "rc-manifest: check copies the verified files under their names" \
  || bad "rc-manifest: check copies the verified files under their names"
echo tampered > "$M/a/A1/x.deb"
"$PY" "$S/rc-manifest.py" check "$M/m.json" --dir "$M/a" --out "$M/out2" --group linux-x64 > /dev/null 2>&1 \
  && bad "rc-manifest: a changed byte is refused" || ok "rc-manifest: a changed byte is refused"
d=$("$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$M/a/A2/FASTag-1.2.3-gui-macos-arm64.dmg")
echo "{\"assets\": [{\"name\": \"FASTag-1.2.3-gui-macos-arm64.dmg\", \"size\": 4, \"digest\": \"sha256:$d\"}]}" > "$M/assets.json"
"$PY" "$S/rc-manifest.py" release "$M/m.json" "$M/assets.json" --group macos > /dev/null \
  && ok "rc-manifest: release digests match" || bad "rc-manifest: release digests match"
echo '{"assets": [{"name": "FASTag-1.2.3-gui-macos-arm64.dmg", "size": 4, "digest": "sha256:00"}]}' > "$M/assets.json"
"$PY" "$S/rc-manifest.py" release "$M/m.json" "$M/assets.json" --group macos > /dev/null \
  && bad "rc-manifest: another release digest is refused" || ok "rc-manifest: another release digest is refused"

# ------------------------------------------------------------------ release-candidate.sh
rc() {  # expect case-name [RC_META]
  local out="$F/out"; : > "$out"
  run_env VERSION=1.2.3 GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY=/dev/null RC_META="${3:-}" \
    bash "$S/release-candidate.sh" "$F/rc" > "$F/log" 2>&1
  if grep -qx "promote=$1" "$out"; then ok "release-candidate: $2"; else bad "release-candidate: $2" "$F/log"; fi
}
cand() {  # run-id manifest-run-id
  mkdir -p "$F/artifacts/$1/release-candidate-manifest"
  sed "s/\"run_id\": \"801\"/\"run_id\": \"$2\"/" "$M/m.json" > "$F/artifacts/$1/release-candidate-manifest/manifest.json"
  jobs "release candidate" "Merge" success > "$F/repos_o_r_actions_runs_$1_jobs_filter_latest_per_page_100.json"
}
LIST=repos_o_r_actions_workflows_7_runs_event_workflow_dispatch_status_completed_per_page_50.json
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
rc true "a candidate of the tree with a matching manifest"
grep -q '"version": "1.2.3"' "$F/rc/manifest.json" && ok "release-candidate: the manifest is kept" || bad "release-candidate: the manifest is kept"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
rc false "a manifest without the required signing" "macos_signed=false"
fixtures; runs 801:workflow_dispatch:t2 > "$F/$LIST"; cand 801 801
rc false "another tree is no candidate"
fixtures; runs 802:workflow_dispatch:t1 > "$F/$LIST"; cand 802 801
rc false "a manifest naming another run is refused"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
jobs "release candidate" "Merge" failure > "$F/repos_o_r_actions_runs_801_jobs_filter_latest_per_page_100.json"
rc false "a failed release candidate job is no candidate"
fixtures; runs 803:workflow_dispatch:t1 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
jobs "release candidate" "Merge" success > "$F/repos_o_r_actions_runs_803_jobs_filter_latest_per_page_100.json"
rc true "a newer run without its manifest is skipped, the older candidate counts"
fixtures; touch "$F/${LIST%.json}.fail"
rc false "an API error builds everything"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
rm -f "$F/repos_o_r_git_commits_$SHA.json"
rc false "an unreadable tag commit builds everything"

# ------------------------------------------------------------------ release-draft.sh
rd() { env GH_REPO=$R GH_TOKEN=x bash "$S/release-draft.sh" "$@" 2> "$F/log"; }
fixtures; id=$(rd v1.2.3) && [ "$(jq 'length' "$F/releases.state.json")" = 1 ] && [ "$(jq '.[0].draft' "$F/releases.state.json")" = true ] \
  && [ "$id" = "$(jq '.[0].id' "$F/releases.state.json")" ] && ok "release-draft: creates one draft" || bad "release-draft: creates one draft" "$F/log"
id2=$(rd v1.2.3) && [ "$id2" = "$id" ] && [ "$(jq 'length' "$F/releases.state.json")" = 1 ] \
  && ok "release-draft: a second call keeps it" || bad "release-draft: a second call keeps it" "$F/log"
fixtures; touch "$F/race"; id=$(rd v1.2.3) && [ "$(jq 'length' "$F/releases.state.json")" = 1 ] && [ "$id" = 101 ] \
  && ok "release-draft: a racing job's newer draft is removed, the oldest kept" || bad "release-draft: a racing job's newer draft is removed, the oldest kept" "$F/log"
fixtures; echo '[{"id": 50, "tag_name": "v1.2.3", "draft": false, "assets": [{}]}, {"id": 60, "tag_name": "v1.2.3", "draft": true, "assets": []}]' > "$F/releases.state.json"
id=$(rd v1.2.3) && [ "$id" = 50 ] && [ "$(jq 'length' "$F/releases.state.json")" = 1 ] \
  && ok "release-draft: the published release is kept" || bad "release-draft: the published release is kept" "$F/log"
fixtures; echo '[{"id": 50, "tag_name": "ci-promotion-test-x", "draft": false, "assets": []}]' > "$F/releases.state.json"
RELEASE_DRAFT_ONLY=1 rd ci-promotion-test-x > /dev/null && bad "release-draft: a published target is refused in draft-only mode" \
  || ok "release-draft: a published target is refused in draft-only mode"
fixtures; echo '[{"id": 50, "tag_name": "v1.2.3", "draft": true, "assets": []}, {"id": 60, "tag_name": "v1.2.3", "draft": true, "assets": [{}]}]' > "$F/releases.state.json"
rd v1.2.3 > /dev/null && bad "release-draft: a second draft with assets fails" || ok "release-draft: a second draft with assets fails"

echo "release_scripts_test: $pass passed, $fail failed"
[ "$fail" = 0 ]
