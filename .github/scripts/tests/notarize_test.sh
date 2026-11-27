#!/usr/bin/env bash
# notarize.sh against a fake xcrun: each case scripts what notarytool and
# stapler answer, and checks the exit code and how often each was called
# (above all: a lost wait never makes a second upload).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../notarize.sh"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"
# The fake: answers come from $W/case/<subcommand>, one line per call (the
# last line repeats); every call is logged to $W/calls.
cat > "$W/bin/xcrun" <<'EOF'
#!/usr/bin/env bash
tool=$1; sub=$2
key="$tool-$sub"; [ "$tool" = stapler ] && key="stapler-$sub"
echo "$key" >> "$CASE/calls"
n=$(grep -c "^$key\$" "$CASE/calls")
f="$CASE/$key"
[ -f "$f" ] || { echo "no answer for $key" >&2; exit 9; }
line=$(sed -n "${n}p" "$f"); [ -n "$line" ] || line=$(tail -1 "$f")
rc=${line%%|*}; out=${line#*|}
echo "$out"
exit "$rc"
EOF
chmod +x "$W/bin/xcrun"
pass=0; fail=0
run_case() {  # name want_rc expected-calls... ; answers already in $CASE
  local name=$1 want=$2; shift 2
  : > "$CASE/calls"
  export CASE
  PATH="$W/bin:$PATH" RUNNER_TEMP="$CASE" GITHUB_STEP_SUMMARY="$CASE/summary" \
    MACOS_APPLE_ID=a MACOS_TEAM_ID=t MACOS_NOTARY_PASSWORD=p NOTARY_SLEEP=0 NOTARY_WAIT=1 NOTARY_DEADLINE=5 \
    bash "$SCRIPT" "$CASE/x.dmg" x > "$CASE/out" 2>&1
  local rc=$? ok=1
  [ "$rc" = "$want" ] || ok=0
  for c in "$@"; do  # key=count
    [ "$(grep -c "^${c%%=*}\$" "$CASE/calls")" = "${c#*=}" ] || ok=0
  done
  if [ $ok = 1 ]; then pass=$((pass + 1)); echo "ok   $name"; else fail=$((fail + 1)); echo "FAIL $name (exit $rc, want $want)"; sort "$CASE/calls" | uniq -c; cat "$CASE/out"; fi
}
new_case() { CASE="$W/$1"; mkdir -p "$CASE"; touch "$CASE/x.dmg"; }

new_case accepted
echo '0|{"id":"S1","message":"ok"}' > "$CASE/notarytool-submit"
echo '0|{"id":"S1","status":"Accepted"}' > "$CASE/notarytool-wait"
echo '0|stapled' > "$CASE/stapler-staple"; echo '0|valid' > "$CASE/stapler-validate"
run_case "accepted at once" 0 notarytool-submit=1 notarytool-wait=1 stapler-staple=1
grep -q S1 "$CASE/notary-x.id" || { fail=$((fail + 1)); echo "FAIL the submission id was not persisted"; }

new_case lost-wait
echo '0|{"id":"S2","message":"ok"}' > "$CASE/notarytool-submit"
printf '%s\n' '1|Error: NSURLErrorDomain -1001' '1|Error: NSURLErrorDomain -1005' '0|{"id":"S2","status":"Accepted"}' > "$CASE/notarytool-wait"
printf '%s\n' '1|Error: offline' '1|Error: offline' > "$CASE/notarytool-info"
echo '0|stapled' > "$CASE/stapler-staple"; echo '0|valid' > "$CASE/stapler-validate"
run_case "two lost waits, the same submission" 0 notarytool-submit=1 notarytool-wait=3 notarytool-info=2

new_case lost-submit
printf '%s\n' '1|Error: NSURLErrorDomain -1001' '0|{"id":"S3","message":"ok"}' > "$CASE/notarytool-submit"
echo '0|{"id":"S3","status":"Accepted"}' > "$CASE/notarytool-wait"
echo '0|stapled' > "$CASE/stapler-staple"; echo '0|valid' > "$CASE/stapler-validate"
run_case "an upload without an id is submitted again" 0 notarytool-submit=2 notarytool-wait=1

new_case no-id
echo '1|Error: offline' > "$CASE/notarytool-submit"
run_case "no id after three uploads fails" 1 notarytool-submit=3 notarytool-wait=0

new_case invalid
echo '0|{"id":"S4","message":"ok"}' > "$CASE/notarytool-submit"
echo '0|{"id":"S4","status":"Invalid"}' > "$CASE/notarytool-wait"
echo '0|{"issues":[]}' > "$CASE/notarytool-log"
run_case "Invalid fails with the log, no staple" 1 notarytool-submit=1 notarytool-log=1 stapler-staple=0

new_case deadline
echo '0|{"id":"S5","message":"ok"}' > "$CASE/notarytool-submit"
echo '0|{"id":"S5","status":"In Progress"}' > "$CASE/notarytool-wait"
run_case "still in progress at the deadline fails, one upload" 1 notarytool-submit=1 stapler-staple=0

new_case staple-retry
echo '0|{"id":"S6","message":"ok"}' > "$CASE/notarytool-submit"
echo '0|{"id":"S6","status":"Accepted"}' > "$CASE/notarytool-wait"
printf '%s\n' '1|CloudKit -1005' '0|stapled' > "$CASE/stapler-staple"; echo '0|valid' > "$CASE/stapler-validate"
run_case "a failed staple is retried" 0 stapler-staple=2 notarytool-submit=1

echo "notarize_test: $pass passed, $fail failed"
[ "$fail" = 0 ]
