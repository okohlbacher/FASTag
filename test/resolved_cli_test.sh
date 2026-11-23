#!/usr/bin/env bash
# Tag merging against the real binary (-resolved_out, -tag_graph_out):
#   - the headers; ranks 1..n per spectrum in order, spectra in -out order
#   - members and inside are rows of the spectrum in -out with E <= the cut,
#     every peak list is ascending with 6 decimals, graph path ranks exist,
#     the flanks start the row's own ladder at its low peak
#   - -threads 1 and 4 write the same files; the tags are unchanged by the options
#   - cstar is the default; the schemes, -resolve_threshold and -resolve_max_evalue
#     reach the output; -stream refuses
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-resolved-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# The fixture is ion trap MS2: read at 0.3 Da it has tags to merge.
run() { local name=$1; shift; "$BIN" -in "$IN" -out "$TMP/$name.tsv" -tolerance_by_analyzer off \
          -fragment_tolerance 0.3 -fragment_tolerance_unit Da "$@" >"$TMP/$name.log" 2>&1 \
          || { cat "$TMP/$name.log" >&2; fail "run $name failed"; }; }

run plain -threads 2
run t1 -threads 1 -resolved_out "$TMP/t1.res.tsv" -tag_graph_out "$TMP/t1.graph.tsv"
run t4 -threads 4 -resolved_out "$TMP/t4.res.tsv" -tag_graph_out "$TMP/t4.graph.tsv"
cmp -s "$TMP/plain.tsv" "$TMP/t1.tsv" || fail "the merge options changed -out"
cmp -s "$TMP/t1.res.tsv" "$TMP/t4.res.tsv" || fail "-resolved_out differs between -threads 1 and 4"
cmp -s "$TMP/t1.graph.tsv" "$TMP/t4.graph.tsv" || fail "-tag_graph_out differs between -threads 1 and 4"

[ "$(head -1 "$TMP/t1.res.tsv")" = "$(printf 'spectrum\trank\tsequence\tlength\tseries\tcall\tcharge\tnterm_mass\tcterm_mass\tscore\tbest_e\tweakest_e\tn_tags\tpeaks\tsteps\tmembers\tinside\tjoined\trelations\tscheme\tthreshold')" ] \
  || fail "-resolved_out header: $(head -1 "$TMP/t1.res.tsv")"
[ "$(head -1 "$TMP/t1.graph.tsv")" = "$(printf 'spectrum\tnode\tlayer\tcharge\tseries\tpeaks\tsteps\tevalue\trows\tpath\trole\tnext')" ] \
  || fail "-tag_graph_out header: $(head -1 "$TMP/t1.graph.tsv")"
[ "$(wc -l < "$TMP/t1.res.tsv")" -gt 100 ] || fail "too few resolved tags; the checks would prove nothing"

# Ranks, members and peaks against -out (E <= 1, the default cut).
awk -F'\t' -v OUT="$TMP/t1.tsv" -v GRAPH="$TMP/t1.graph.tsv" '
  BEGIN {
    while ((getline line < OUT) > 0) {
      n = split(line, c, "\t"); if (c[1] == "spectrum") { for (i = 1; i <= n; i++) col[c[i]] = i; continue }
      r = row[c[1]]++; ev[c[1], r] = c[col["evalue"]]
      if (!(c[1] in order)) order[c[1]] = ++nspec
    }
    while ((getline line < GRAPH) > 0) {
      split(line, c, "\t"); if (c[1] == "spectrum") continue
      if (c[10] != "") gpath[c[1], c[10]] = 1
      if (c[11] != "chain" && c[11] != "inside" && c[11] != "none") { print "bad role " c[11]; bad = 1 }
      if ((c[10] == "") != (c[11] == "none")) { print "path and role disagree: " line; bad = 1 }
    }
  }
  NR == 1 { next }
  {
    s = $1
    if (s != last) { if (s in seen) { print "spectrum " s " not contiguous"; bad = 1 }
                     if (order[s] < lastorder) { print "spectra out of -out order at " s; bad = 1 }
                     seen[s] = 1; want = 1; last = s; lastorder = order[s] }
    if ($2 != want) { print "rank " $2 " where " want " was due in " s; bad = 1 }
    want++
    if (!((s, $2) in gpath)) { print "no graph node uses rank " $2 " of " s; bad = 1 }
    for (f = 16; f <= 17; f++) {
      if ($f == "") continue
      m = split($f, idx, ",")
      for (k = 1; k <= m; k++) {
        if (!((s, idx[k]) in ev)) { print "member " idx[k] " is no row of " s; bad = 1 }
        else if (ev[s, idx[k]] + 0 > 1) { print "member " idx[k] " of " s " has E " ev[s, idx[k]]; bad = 1 }
      }
    }
    if ($16 == "") { print "no chain members in " s " rank " $2; bad = 1 }
    p = split($14, pk, ";"); prev = -1
    for (k = 1; k <= p; k++) {
      if (pk[k] !~ /^[0-9]+\.[0-9][0-9][0-9][0-9][0-9][0-9]$/) { print "peak " pk[k] " is not 6 decimals"; bad = 1 }
      if (pk[k] + 0 <= prev) { print "peaks not ascending in " s; bad = 1 }
      prev = pk[k] + 0
    }
    if (split($15, st, ";") != p - 1) { print "steps and peaks disagree in " s " rank " $2; bad = 1 }
    if ($5 !~ /^[bycz]$/ || $6 !~ /^(sure|likely|open)$/) { print "series/call " $5 " " $6; bad = 1 }
    # The flanks are those of the called reading, as in a tag row: the first
    # ion of the series ladder, walked from nterm (b, c) or cterm (y, z), is
    # the low peak.
    z = $7 + 0
    first = ($5 == "b") ? $8 : ($5 == "c") ? $8 + 17.0265491015 : ($5 == "y") ? $9 + 18.0105646837 : $9 + 1.9918406143
    first = (first + z * 1.007276466812) / z
    d = first - pk[1]; if (d < 0) d = -d
    if (d > 0.001) { print "flanks of " s " rank " $2 " (" $5 ") do not start the ladder at " pk[1] ": " $8 " " $9; nflank++; bad = 1 }
  }
  END { if (nflank) print nflank " rows with flanks off their ladder"; exit bad }' "$TMP/t1.res.tsv" || fail "-resolved_out rows are inconsistent"

# steps run in ascending m/z order, as peaks: for b/c rows their labels read
# as sequence, for y/z the reverse of it (rows with plain one-residue steps).
awk -F'\t' 'NR > 1 && $3 ~ /^[A-Z]+$/ {
    n = split($15, st, ";"); lab = ""
    for (k = 1; k <= n; k++) { sub(/:.*/, "", st[k]); lab = ($5 == "b" || $5 == "c") ? lab st[k] : st[k] lab }
    if (lab != $3) { print "steps " $15 " of " $1 " rank " $2 " (" $5 ") do not read as " $3; bad = 1 }
    if ($5 == "y" || $5 == "z") ny++; else nb++
  }
  END { if (!ny || !nb) { print "no y/z or no b/c rows to check the step order on"; bad = 1 }; exit bad }' "$TMP/t1.res.tsv" \
  || fail "-resolved_out steps are not in ascending m/z order"
# The help says so, and that a node's series is its own call (not the resolved tag's).
"$BIN" --helphelp >"$TMP/help.txt" 2>&1
tr -s ' \n' ' ' <"$TMP/help.txt" >"$TMP/help1.txt"
grep -q "steps (both in ascending m/z order: for y and z the steps run C->N, the reverse of sequence)" "$TMP/help1.txt" \
  || fail "-resolved_out help does not give the order of steps"
grep -q "the ranking it was made with (scheme, threshold" "$TMP/help1.txt" \
  || fail "-resolved_out help does not name the ranking columns"
grep -q "series (as judged on its own peaks, before complement pairing" "$TMP/help1.txt" \
  || fail "-tag_graph_out help does not say a node's series is its own call"

# The options reach the output; cstar is the default.
run cs -threads 2 -resolved_out "$TMP/cs.res.tsv" -resolve_score cstar
cmp -s "$TMP/t1.res.tsv" "$TMP/cs.res.tsv" || fail "the default is not -resolve_score cstar"
run sl -threads 2 -resolved_out "$TMP/sl.res.tsv" -resolve_score steplogodds
# Every row records the ranking it was made with (scheme, threshold).
ranking() { awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; i++) c[$i] = i; next } { print $c["scheme"] "/" $c["threshold"] }' "$1" | sort -u | tr '\n' ' '; }
[ "$(ranking "$TMP/t1.res.tsv")" = "cstar/3 " ] || fail "the default rows do not record cstar/3: $(ranking "$TMP/t1.res.tsv")"
[ "$(ranking "$TMP/sl.res.tsv")" = "steplogodds/3 " ] || fail "steplogodds rows do not record it: $(ranking "$TMP/sl.res.tsv")"
cmp -s "$TMP/t1.res.tsv" "$TMP/sl.res.tsv" && fail "-resolve_score steplogodds changed nothing"
run t4c -threads 2 -resolved_out "$TMP/t4c.res.tsv" -resolve_threshold 4
[ "$(ranking "$TMP/t4c.res.tsv")" = "cstar/4 " ] || fail "-resolve_threshold 4 rows do not record it: $(ranking "$TMP/t4c.res.tsv")"
cmp -s "$TMP/t1.res.tsv" "$TMP/t4c.res.tsv" && fail "-resolve_threshold 4 changed nothing under cstar"
run ev -threads 2 -resolved_out "$TMP/ev.res.tsv" -resolve_score evidence
[ "$(ranking "$TMP/ev.res.tsv")" = "evidence/ " ] || fail "evidence rows do not record it: $(ranking "$TMP/ev.res.tsv")"
cmp -s "$TMP/t1.res.tsv" "$TMP/ev.res.tsv" && fail "-resolve_score evidence changed nothing"
run an -threads 2 -resolved_out "$TMP/an.res.tsv" -resolve_score anchor
cmp -s "$TMP/t1.res.tsv" "$TMP/an.res.tsv" && fail "-resolve_score anchor changed nothing"
run cut -threads 2 -resolved_out "$TMP/cut.res.tsv" -resolve_max_evalue 0.01
[ "$(wc -l < "$TMP/cut.res.tsv")" -lt "$(wc -l < "$TMP/t1.res.tsv")" ] || fail "-resolve_max_evalue 0.01 kept as many resolved tags"
run js -threads 2 -resolved_out "$TMP/js.res.tsv" -resolve_join
awk -F'\t' 'NR > 1 && $18 != "" { f = 1 } END { exit !f }' "$TMP/js.res.tsv" || fail "-resolve_join joined nothing"
awk -F'\t' 'NR > 1 && $18 != "" { f = 1 } END { exit f }' "$TMP/t1.res.tsv" || fail "a junction without -resolve_join"

# -stream refuses the tables.
"$BIN" -stream -resolved_out "$TMP/s.tsv" </dev/null >"$TMP/stream.log" 2>&1 && fail "-stream accepted -resolved_out"
grep -q "resolved_out" "$TMP/stream.log" || { cat "$TMP/stream.log" >&2; fail "-stream refusal does not name -resolved_out"; }
echo "resolved_cli_test: ok"
