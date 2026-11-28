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
"$PY" "$S/rc-manifest.py" merge --out "$M/m.json" --meta tree=t1 --meta version=1.2.3 --meta run_id=801 --meta workflow_id=7 --meta run_attempt=1 \
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
arts() {  # run-id live artifact names... (any name prefixed with "-" is expired)
  local id=$1; shift; local j='{"artifacts": [' sep=""
  for a in "$@"; do e=false; case $a in -*) e=true; a=${a#-};; esac
    j="$j$sep{\"name\": \"$a\", \"expired\": $e}"; sep=,; done
  echo "$j]}" > "$F/repos_o_r_actions_runs_${id}_artifacts_per_page_100.json"
}
cand() {  # run-id manifest-run-id
  mkdir -p "$F/artifacts/$1/release-candidate-manifest"
  sed "s/\"run_id\": \"801\"/\"run_id\": \"$2\"/" "$M/m.json" > "$F/artifacts/$1/release-candidate-manifest/manifest.json"
  jobs "release candidate" "Merge" success > "$F/repos_o_r_actions_runs_$1_attempts_1_jobs_per_page_100.json"
  arts "$1" release-candidate-manifest A1 A2
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
jobs "release candidate" "Merge" failure > "$F/repos_o_r_actions_runs_801_attempts_1_jobs_per_page_100.json"
rc false "a failed release candidate job is no candidate"
fixtures; runs 803:workflow_dispatch:t1 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
jobs "release candidate" "Merge" success > "$F/repos_o_r_actions_runs_803_attempts_1_jobs_per_page_100.json"
rc true "a newer run without its manifest is skipped, the older candidate counts"
fixtures; touch "$F/${LIST%.json}.fail"
rc false "an API error builds everything"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
rm -f "$F/repos_o_r_git_commits_$SHA.json"
rc false "an unreadable tag commit builds everything"

fixtures; runs 803:workflow_dispatch:t1 801:workflow_dispatch:t1 > "$F/$LIST"; cand 803 803; cand 801 801
arts 803 release-candidate-manifest A1 -A2
rc true "a newer candidate with an expired artifact is skipped, the complete older one counts"
grep -qx 'run_id=801' "$F/out" && ok "release-candidate: ... and it is the older run" || bad "release-candidate: ... and it is the older run" "$F/log"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801; arts 801 release-candidate-manifest A1
rc false "a candidate whose payload artifact is gone builds everything"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
sed -i.bak 's/"run_attempt": "1"/"run_attempt": "2"/' "$F/artifacts/801/release-candidate-manifest/manifest.json"
rc false "a manifest of another attempt is refused"
fixtures; runs 801:workflow_dispatch:t1 > "$F/$LIST"; cand 801 801
rc true "the manifest's sha256 is an output" && grep -q '^manifest_sha256=[0-9a-f]\{64\}$' "$F/out" \
  && ok "release-candidate: manifest_sha256 written" || bad "release-candidate: manifest_sha256 written" "$F/out"

# ------------------------------------------------------------------ rc-manifest.py inventory
INV="$W/inv"; mkdir -p "$INV"
printf '{"files": [{"name": "a.deb", "size": 3, "sha256": "aa"}, {"name": "b.dmg", "size": 4, "sha256": "bb"}]}' > "$INV/unix.json"
printf '{"files": [{"name": "c.exe", "size": 5, "sha256": "cc"}]}' > "$INV/win.json"
asset() { printf '{"id": %s, "name": "%s", "size": %s, "digest": "sha256:%s"}' "$1" "$2" "$3" "$4"; }
inv() { "$PY" "$S/rc-manifest.py" inventory "$INV/rel.json" "$INV/unix.json" "$INV/win.json" --unexpected-out "$INV/extra" > "$INV/log" 2>&1; }
echo "[$(asset 1 a.deb 3 aa), $(asset 2 b.dmg 4 bb), $(asset 3 c.exe 5 cc)]" > "$INV/rel.json"
inv && ok "inventory: exactly the expected files" || bad "inventory: exactly the expected files" "$INV/log"
echo "[$(asset 1 a.deb 3 aa), $(asset 2 b.dmg 4 bb), $(asset 3 c.exe 5 cc), $(asset 9 old.AppImage 7 ff)]" > "$INV/rel.json"
inv && bad "inventory: a stale asset fails" "$INV/log" || { [ "$(cat "$INV/extra")" = 9 ] && ok "inventory: a stale asset fails and is named for removal" || bad "inventory: a stale asset fails and is named for removal" "$INV/log"; }
echo "[$(asset 1 a.deb 3 aa), $(asset 2 b.dmg 4 bb)]" > "$INV/rel.json"
inv && bad "inventory: a missing Windows file fails" || ok "inventory: a missing Windows file fails"
echo "[$(asset 1 a.deb 3 aa), $(asset 2 b.dmg 4 xx), $(asset 3 c.exe 5 cc)]" > "$INV/rel.json"
inv && bad "inventory: an old file of the same name (other digest) fails" || ok "inventory: an old file of the same name (other digest) fails"

# ------------------------------------------------------------------ release-draft.sh
rd() { env GH_REPO=$R GH_TOKEN=x RELEASE_POLL=0 bash "$S/release-draft.sh" "$@" 2> "$F/log"; }
st() { echo "$1" > "$F/releases.state.json"; }
mut() { grep -cE '^api (-X|--method) (POST|DELETE|PATCH)|uploads' "$F/calls" || true; }
fixtures; id=$(rd create v1.2.3) && [ "$(jq 'length' "$F/releases.state.json")" = 1 ] && [ "$(jq '.[0].draft' "$F/releases.state.json")" = true ] \
  && [ "$id" = "$(jq '.[0].id' "$F/releases.state.json")" ] && ok "release-draft: create makes one draft, prints its id" || bad "release-draft: create makes one draft, prints its id" "$F/log"
id2=$(rd create v1.2.3) && [ "$id2" = "$id" ] && [ "$(jq 'length' "$F/releases.state.json")" = 1 ] \
  && ok "release-draft: a second create finds it" || bad "release-draft: a second create finds it" "$F/log"
fixtures; st '[{"id": 50, "tag_name": "v1.2.3", "draft": true, "body": "x", "assets": []}, {"id": 60, "tag_name": "v1.2.3", "draft": true, "body": "y", "assets": []}]'
rd create v1.2.3 > /dev/null && bad "release-draft: two drafts of one tag fail" || { [ "$(mut)" = 0 ] && [ "$(jq length "$F/releases.state.json")" = 2 ] \
  && ok "release-draft: two drafts of one tag fail, and nothing is deleted or created" || bad "release-draft: two drafts fail without mutation" "$F/calls"; }
fixtures; st '[{"id": 50, "tag_name": "v1.2.3", "draft": false, "body": "", "assets": [{"id": 1}]}]'
rd create v1.2.3 > /dev/null && bad "release-draft: a published release is refused" || ok "release-draft: a published release is refused (a tag run never writes to it)"
id=$(RELEASE_ALLOW_PUBLISHED=1 rd find v1.2.3) && [ "$id" = 50 ] && ok "release-draft: ... unless the repair switch is set" || bad "release-draft: ... unless the repair switch is set" "$F/log"
fixtures; st '[{"id": 50, "tag_name": "ci-promotion-test-x", "draft": false, "body": "", "assets": []}]'
RELEASE_DRAFT_ONLY=1 RELEASE_ALLOW_PUBLISHED=1 rd create ci-promotion-test-x > /dev/null && bad "release-draft: draft-only refuses a published target" \
  || { [ "$(mut)" = 0 ] && ok "release-draft: draft-only refuses a published target before any mutation" || bad "release-draft: draft-only mutated" "$F/calls"; }
fixtures; RELEASE_DRAFT_ONLY=1 rd create ci-promotion-test-x > /dev/null && bad "release-draft: draft-only does not create" \
  || { [ "$(mut)" = 0 ] && ok "release-draft: draft-only with no draft fails without creating one" || bad "release-draft: draft-only created" "$F/calls"; }
fixtures; echo '{"id": 70, "tag_name": "v1.2.3", "draft": true, "body": "", "assets": []}' > "$F/appear"; echo 3 > "$F/appear.after"
id=$(RELEASE_WAIT=30 rd find v1.2.3) && [ "$id" = 70 ] && [ "$(mut)" = 0 ] \
  && ok "release-draft: find waits for the creator's draft and never creates one" || bad "release-draft: find waits" "$F/log"
fixtures; RELEASE_WAIT=0 rd find v1.2.3 > /dev/null && bad "release-draft: find without a draft fails" || { [ "$(mut)" = 0 ] && ok "release-draft: find without a draft fails, creating nothing" || bad "release-draft: find created" "$F/calls"; }
fixtures; st '[{"id": 50, "tag_name": "v1.2.3\" or true", "draft": true, "body": "", "assets": []}, {"id": 51, "tag_name": "v9", "draft": false, "body": "", "assets": []}]'
id=$(rd find 'v1.2.3" or true') && [ "$id" = 50 ] && ok "release-draft: a tag with a quote is compared as data, not jq code" || bad "release-draft: tag quoting" "$F/log"

# ------------------------------------------------------------------ release-upload.sh
ru() { env GH_REPO=$R GH_TOKEN=x RELEASE_UPLOAD_SLEEP=0 bash "$S/release-upload.sh" "$@" 2> "$F/log"; }
fixtures; st '[{"id": 50, "tag_name": "v1.2.3", "draft": true, "body": "", "assets": [{"id": 7, "name": "f.deb", "size": 3, "digest": "sha256:old"}]}]'
echo new-bytes > "$F/f.deb"
ru 50 "$F/f.deb" > "$F/up" && [ "$(jq '.[0].assets | length' "$F/releases.state.json")" = 1 ] \
  && [ "$(jq -r '.[0].assets[0].digest' "$F/releases.state.json")" = "sha256:$(cut -d' ' -f1 "$F/up")" ] \
  && ok "release-upload: replaces the old asset of the same name, by release id" || bad "release-upload: replace" "$F/log"
fixtures; st '[{"id": 50, "tag_name": "v1.2.3", "draft": true, "body": "", "assets": []}]'; touch "$F/corrupt"; echo x > "$F/g.deb"
ru 50 "$F/g.deb" > /dev/null && bad "release-upload: a wrong digest after upload fails" \
  || { [ "$(grep -c uploads "$F/calls")" = 3 ] && ok "release-upload: a wrong digest is retried 3 times, then fails" || bad "release-upload: retries" "$F/calls"; }

# ------------------------------------------------------------------ wait-release-gates.sh
wg() { echo '{"workflow_id": 7, "created_at": "2026-11-28T10:00:00Z"}' > "$F/repos_o_r_actions_runs_$RUN.json"
  env GITHUB_REPOSITORY=$R GITHUB_SHA=$SHA GITHUB_RUN_ID=$RUN GH_TOKEN=x GATES_POLL=0 bash "$S/wait-release-gates.sh" windows.yml "$@" > "$F/log" 2>&1; }
gates() {  # run-id release
  mkdir -p "$F/artifacts/$1/release-gates-$2"
  echo "{\"release\": \"$2\", \"commit\": \"$SHA\", \"run\": $1, \"files\": [{\"name\": \"c.exe\", \"size\": 5, \"sha256\": \"cc\"}]}" > "$F/artifacts/$1/release-gates-$2/gates.json"
  arts "$1" "release-gates-$2"
  jobs release-complete x success > "$F/repos_o_r_actions_runs_$1_attempts_1_jobs_per_page_100.json"
}
wruns() { echo "{\"workflow_runs\": [$1]}" > "$F/repos_o_r_actions_workflows_windows.yml_runs_head_sha_${SHA}_per_page_20.json"; }
fixtures; wruns '{"id": 950, "run_attempt": 1, "event": "push", "status": "completed", "conclusion": "success", "head_branch": "v1.2.3", "created_at": "2026-11-28T10:00:05Z"}'; gates 950 v1.2.3
wg v1.2.3 "$F/g" 5 && grep -q c.exe "$F/g/gates.json" && ok "wait-release-gates: Windows passed its gates for this release" || bad "wait-release-gates: passed" "$F/log"
fixtures; wruns '{"id": 950, "run_attempt": 1, "event": "push", "status": "completed", "conclusion": "failure", "head_branch": "v1.2.3", "created_at": "2026-11-28T10:00:05Z"}'; arts 950 x
wg v1.2.3 "$F/g" 60 && bad "wait-release-gates: a failed Windows run fails at once" || { grep -q 'without passing' "$F/log" && ok "wait-release-gates: a failed Windows tag run fails at once" || bad "wait-release-gates: fail fast" "$F/log"; }
fixtures; wruns '{"id": 950, "run_attempt": 1, "event": "workflow_dispatch", "status": "in_progress", "conclusion": null, "head_branch": "b", "created_at": "2026-11-28T09:59:50Z"}'; arts 950 x
wg ci-promotion-test-x "$F/g" 2 && bad "wait-release-gates: no gates in time fails" || ok "wait-release-gates: no gates within the wait fails (the release stays a draft)"
fixtures; wruns '{"id": 950, "run_attempt": 1, "event": "workflow_dispatch", "status": "completed", "conclusion": "success", "head_branch": "b", "created_at": "2026-11-28T09:59:50Z"}'; gates 950 ci-promotion-test-y
wg ci-promotion-test-x "$F/g" 2 && bad "wait-release-gates: another release's gates do not count" || ok "wait-release-gates: another release's gates do not count"
fixtures; wruns '{"id": 940, "run_attempt": 1, "event": "workflow_dispatch", "status": "completed", "conclusion": "success", "head_branch": "b", "created_at": "2026-11-28T08:00:00Z"}'; gates 940 ci-promotion-test-x
wg ci-promotion-test-x "$F/g" 2 && bad "wait-release-gates: an older run's gates of the same release do not count" || ok "wait-release-gates: an older run's gates of the same release do not count"

echo "release_scripts_test: $pass passed, $fail failed"
[ "$fail" = 0 ]
