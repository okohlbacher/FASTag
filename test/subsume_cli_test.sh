#!/usr/bin/env bash
# -subsume_tags and -terminus against the real binary.
#
# -subsume_tags (on by default) leaves out of -out every row whose path peaks
# are a contiguous run of another row's on which that row reads exactly its
# residues, step by step (same spectrum, charge, series and hypothesis), when
# that row is at least as significant, E <= its own (of two copies the lower
# E-value stays; an unscored E-value counts as +infinity). FASTAG_PATH_PEAKS=1
# adds the path peaks as a last column (path_mz; the two peaks of a gap step
# joined by ':'), so the rule is checked on the peaks and steps it compares.
# The tag is written N->C from the high m/z end, so a row's residues on a run
# of its steps start after the residues of the steps above the run:
#   - on writes a subset of off's rows, in off's order, and says how many it
#     dropped;
#   - no written row lies in another written row with a lower E-value;
#   - every dropped row lies in a written row whose E-value is <= its own
#     (the rule is transitive, so a chain of drops ends in a written row);
#   - the E-value condition acts: with three seed lengths some written rows
#     lie in a written row with a worse E-value;
#   - the reports that count every tag (-digest_out, -label_out) are the same
#     under on and off; threads 1 and 4 write the same rows;
#   - at the defaults (one seed length, no extension) a row can only lie in
#     a copy of itself, so nothing is dropped;
#   - -stream drops the same way (the #end counts are the written rows);
#   - with -fasta and -entrapment_fasta a row lies only in a row of its hit
#     class (a target row never gives way to an entrapment-only one).
# -terminus appends series and terminus as the last two columns and changes
# no other column; its values are b/y/'-' and tokens or '-' (a c/z row's series
# is always '-'); -stream refuses it.
# Inputs: the Ecoli ion-trap run (0.5 Da) at seed lengths 3 4 5, and the
# synthetic CID run of hybrid_ions_test (exact b/y peaks, 20 ppm) with extension.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
export LC_ALL=C
BIN="$1"
SRC="$2"            # Ecoli_MS2_small.mzML
GEN="${3:-}"        # hybrid_ions_test (synthetic CID run); optional
DB="${4:-}"         # Ecoli_MS2_small.fasta (for GEN)
MGF="${5:-}"        # Ecoli_MS2_small.mgf (the -stream blocks); optional
DIGDIR="${6:-}"     # data/digest (-digest_out, -label_out)
[ -n "$DIGDIR" ] && export FASTAG_DIGEST_DIR="$DIGDIR"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-subsume-test.XXXXXX") || exit 1
command -v cygpath >/dev/null 2>&1 && TMP=$(cygpath -m "$TMP")
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
# lf FILE: FILE with its line endings made LF in place. On Windows FASTag
# writes its text outputs with CRLF; awk keeps the CR in the last field, so
# a column cut or compared there (path_mz, -terminus) would differ by it.
lf() { tr -d '\r' < "$1" > "$1.lf" && mv "$1.lf" "$1" || fail "cannot read $1"; }

run() {  # <name> <input> [args]
  local name=$1 in=$2; shift 2
  FASTAG_PATH_PEAKS=1 "$BIN" -in "$in" -out "$TMP/$name.tsv" "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
    || { cat "$TMP/$name.err" >&2; fail "FASTag on $name exited non-zero"; }
  lf "$TMP/$name.tsv"
}
# The containment rule on path_mz (pk) and the tag (sq), for awk:
# liesIn(pa, sa, pb, sb): row a's peaks a contiguous run of row b's, and on
# them b reads a's residues, step by step.
LIES_AWK='
  function toks(s, out,   n) { n = 0; while (match(s, /^[A-Z](\[[^]]*\])?/)) { out[++n] = substr(s, 1, RLENGTH); s = substr(s, RLENGTH + 1) }
                               return n }
  function steps(p,   c, i, ch) { c = ""; for (i = 1; i <= length(p); i++) { ch = substr(p, i, 1); if (ch == ";") c = c "1"; else if (ch == ":") c = c "2" }
                                  return c }
  function liesIn(pa, sa, pb, sb,   na, nb, x, y, ca, cb, qa, qb, pos, k, off, i, j) {
    if (pa == "" || pb == "") return 0
    qa = pa; gsub(/:/, ";", qa); qb = pb; gsub(/:/, ";", qb)
    pos = index(";" qb ";", ";" qa ";"); if (pos == 0) return 0
    k = 0; for (i = 1; i < pos; i++) if (substr(";" qb ";", i, 1) == ";") k++
    ca = steps(pa); cb = steps(pb)
    if (substr(cb, k + 1, length(ca)) != ca) return 0  # k: the peaks below the run
    off = 0; for (i = k + length(ca) + 1; i <= length(cb); i++) off += substr(cb, i, 1)
    na = toks(sa, x); nb = toks(sb, y)
    if (off + na > nb) return 0
    for (j = 1; j <= na; j++) if (x[j] != y[off + j]) return 0
    return 1
  }'
# <on.tsv> <off.tsv> [hit column]: "notsubset dropped uncontained written_inside [example]";
# with a -fasta hit column, a row lies only in a row of its hit class (target
# fwd/rev, entrapment efwd/erev).
check() {
  awk -F'\t' -v ON="$1" -v HIT="${3:-0}" "$LIES_AWK"'
    # Row a lies in row b (both of one spectrum); 2 = a duplicate (same peaks, same residues).
    function within(a, b) {
      if (a == b || key[a] != key[b] || !liesIn(pk[a], sq[a], pk[b], sq[b])) return 0
      return (pk[a] == pk[b] && sq[a] == sq[b]) ? 2 : 1
    }
    # Row a subsumed by row b. The E-values are compared as printed (6
    # significant digits; rounding keeps their order, not strict order): a
    # dropped row needs a container with E <= its own (strict "lies"), a
    # written row must lie in no written row with E < its own (strict "<").
    function inside(a, b, strict,   w) {
      w = within(a, b)
      if (w == 2) return ev[a] > ev[b] || (ev[a] == ev[b] && a > b)  # a duplicate
      if (w == 1) return strict ? ev[b] < ev[a] : ev[b] <= ev[a]
      return 0
    }
    function flush(   i, j, f) {
      for (i = 1; i <= n; i++) {
        if (drop[i]) { ++nd; f = 0; for (j = 1; j <= n; j++) if (!drop[j] && inside(i, j, 0)) { f = 1; break }
                       if (!f) { ++nu; if (ex == "") ex = "dropped, in no written row as significant: " id " " sq[i] } }
        else {
          for (j = 1; j <= n; j++) if (!drop[j] && inside(i, j, 1)) { ++nw; if (ex == "") ex = "written inside a more significant one: " id " " sq[i] " in " sq[j]; break }
          for (j = 1; j <= n; j++) if (!drop[j] && within(i, j) == 1 && ev[j] > ev[i]) { ++nk; break }
        }
      }
      n = 0
    }
    BEGIN { while ((getline l < ON) > 0) { if (++m == 1) { hon = l; continue } on[m - 1] = l }; op = 1 }
    NR == 1 { if ($0 != hon) bad = 1; pc = NF; for (c = 1; c <= NF; c++) { col[c] = $c; if ($c == "path_mz") pc = c }; next }
    {
      if ($1 != id && n) flush()
      id = $1; ++n; sq[n] = $2; pk[n] = $pc  # path_mz: last, or before q_db
      ev[n] = (tolower($9) ~ /^[-+]?(nan|inf)/) ? 1e308 : $9 + 0  # unscored: +infinity
      k = $4; for (c = 13; c <= NF; c++) if (c != pc && col[c] != "q_db") k = k "\t" $c  # charge, then hypothesis / series columns
      if (HIT) k = k "\t" ($HIT ~ /^e/ ? "E" : "T"); key[n] = k
      if (op < m && on[op] == $0) { drop[n] = 0; ++op } else drop[n] = 1
    }
    END { if (n) flush(); print (bad ? "header" : (op == m ? 0 : m - op)), nd + 0, nu + 0, nw + 0, nk + 0, ex }' "$2"
}
verify() {  # <name> [hit column]: <name>_on and <name>_off; prints "dropped kept-by-E"
  local name=$1 r ns nd nu nw nk
  r=$(check "$TMP/${name}_on.tsv" "$TMP/${name}_off.tsv" "${2:-0}")
  read -r ns nd nu nw nk _ <<< "$r"
  echo "$name: off $(($(wc -l < "$TMP/${name}_off.tsv") - 1)) rows, on $(($(wc -l < "$TMP/${name}_on.tsv") - 1)), dropped $nd, kept inside a less significant row $nk" >&2
  [ "$ns" = 0 ] || fail "$name: on is not a subset of off in off's order ($ns): $r"
  [ "$nu" = 0 ] || fail "$name: dropped rows not inside a written row: $r"
  [ "$nw" = 0 ] || fail "$name: written rows inside another written row: $r"
  grep -q "^Subsumed tags dropped: $nd\$" "$TMP/${name}_on.out" || fail "$name: the summary does not count $nd dropped rows"
  grep -q "^Subsumed tags dropped" "$TMP/${name}_off.out" && fail "$name: off prints a subsumed count"
  echo "$nd $nk"
}

# ---- Ecoli, seed lengths 3 4 5 ----
L=(-tag_lengths 3 4 5)
run e_on "$SRC" "${L[@]}" -digest_out "$TMP/e_on.digest.tsv" -label_out "$TMP/e_on.label.tsv"
run e_off "$SRC" "${L[@]}" -subsume_tags off -digest_out "$TMP/e_off.digest.tsv" -label_out "$TMP/e_off.label.tsv"
[ "$(head -1 "$TMP/e_on.tsv" | awk -F'\t' '{ print $NF }')" = path_mz ] || fail "FASTAG_PATH_PEAKS=1 adds no path_mz column"
r=$(verify e) || exit 1; read -r nd nk <<< "$r"
[ "$nd" -gt 100 ] || fail "Ecoli at three seed lengths: only $nd rows dropped"
[ "$nk" -gt 0 ] || fail "Ecoli at three seed lengths: no row kept inside a less significant one (the E-value condition is vacuous)"
cmp -s "$TMP/e_on.digest.tsv" "$TMP/e_off.digest.tsv" || fail "-digest_out depends on -subsume_tags"
cmp -s "$TMP/e_on.label.tsv" "$TMP/e_off.label.tsv" || fail "-label_out depends on -subsume_tags"
run e_on4 "$SRC" "${L[@]}" -threads 4
cmp -s "$TMP/e_on.tsv" "$TMP/e_on4.tsv" || fail "threads 1 and 4 write different rows"
# Without the test column the rows are the same, less it.
"$BIN" -in "$SRC" -out "$TMP/e_plain.tsv" "${L[@]}" > /dev/null 2>&1 || fail "FASTag without FASTAG_PATH_PEAKS"
lf "$TMP/e_plain.tsv"
awk -F'\t' -v OFS='\t' '{ NF--; print }' "$TMP/e_on.tsv" | cmp -s - "$TMP/e_plain.tsv" \
  || fail "FASTAG_PATH_PEAKS changes more than its column"

# ---- defaults: one seed length, no extension ----
run d_on "$SRC"
run d_off "$SRC" -subsume_tags off
r=$(verify d) || exit 1; read -r nd nk <<< "$r"
[ "$nd" = 0 ] || fail "at the defaults $nd rows dropped (one length, no extension: only copies could be)"

# ---- synthetic CID run: exact peaks, extension ----
if [ -n "$GEN" ] && [ -n "$DB" ]; then
  "$GEN" --write-mzml "$DB" "$TMP/syn_cid.mzML" cid > /dev/null || fail "writing the synthetic CID run"
  run s_on "$TMP/syn_cid.mzML" "${L[@]}" -extension 2
  run s_off "$TMP/syn_cid.mzML" "${L[@]}" -extension 2 -subsume_tags off
  r=$(verify s) || exit 1; read -r nd nk <<< "$r"
  [ "$nd" -gt 100 ] || fail "synthetic CID with extension: only $nd rows dropped"
  # -fasta with -entrapment_fasta: a row is only subsumed by a row of its hit
  # class. The target is the proteome with every 9th residue changed, the
  # entrapment the proteome itself, so both classes are written.
  awk '/^>/ { print $0 "_mut"; next }
       { s = ""; for (i = 1; i <= length($0); ++i) { c = substr($0, i, 1); if (i % 9 == 0) c = (c == "W" ? "Y" : "W"); s = s c }
         print s }' "$DB" > "$TMP/tgt.fasta"
  EN=(-tag_length 4 -extension 2 -max_evalue 0 -fasta "$TMP/tgt.fasta" -entrapment_fasta "$DB")
  run n_on "$TMP/syn_cid.mzML" "${EN[@]}"
  run n_off "$TMP/syn_cid.mzML" "${EN[@]}" -subsume_tags off
  hc=$(head -1 "$TMP/n_on.tsv" | awk -F'\t' '{ for (i = 1; i <= NF; i++) if ($i == "fasta_hit") print i }')
  [ -n "$hc" ] || fail "entrapment: no fasta_hit column"
  [ "$(awk -F'\t' -v c="$hc" 'NR > 1 && $c ~ /^e/' "$TMP/n_on.tsv" | wc -l)" -gt 0 ] \
    && [ "$(awk -F'\t' -v c="$hc" 'NR > 1 && $c !~ /^e/' "$TMP/n_on.tsv" | wc -l)" -gt 0 ] \
    || fail "entrapment: rows of both hit classes expected"
  r=$(verify n "$hc") || exit 1; read -r nd nk <<< "$r"
  [ "$nd" -gt 100 ] || fail "entrapment: only $nd rows dropped"
  # Not vacuous: written target rows lie in written entrapment rows at least
  # as significant (a class-blind rule would have dropped them).
  pcol=$(head -1 "$TMP/n_on.tsv" | awk -F'\t' '{ for (i = 1; i <= NF; i++) if ($i == "path_mz") print i }')
  nx=$(awk -F'\t' -v hc="$hc" -v pc="$pcol" "$LIES_AWK"'NR > 1 { id[NR] = $1; sq[NR] = $2; z[NR] = $4; e[NR] = ($hc ~ /^e/); pk[NR] = $pc; ev[NR] = $9 + 0; n = NR }
         END { c = 0; for (a = 2; a <= n; a++) if (!e[a]) for (b = 2; b <= n; b++)
                 if (e[b] && id[a] == id[b] && z[a] == z[b] && liesIn(pk[a], sq[a], pk[b], sq[b]) && ev[b] <= ev[a]) { c++; break }
               print c }' "$TMP/n_on.tsv")
  [ "$nx" -gt 0 ] || fail "entrapment: no target row lies in an entrapment row (the class check is vacuous)"
fi

# ---- -stream ----
if [ -n "$MGF" ]; then
  awk '/^BEGIN IONS/ { t = ""; pm = ""; z = 2; n = 0; next }
       /^TITLE=/ { t = substr($0, 7); gsub(/[ \t]/, "_", t); next }
       /^PEPMASS=/ { split(substr($0, 9), a, /[ \t]/); pm = a[1]; next }
       /^CHARGE=/ { z = substr($0, 8) + 0; next }
       /^END IONS/ { print "spectrum " t " " pm " " z; for (i = 1; i <= n; i++) print pk[i]; print ""; next }
       /^[0-9]/ { pk[++n] = $1 " " $2 }' "$MGF" > "$TMP/blocks.txt"
  for s in on off; do
    FASTAG_PATH_PEAKS=1 "$BIN" -stream "${L[@]}" -fragment_tolerance 0.5 -fragment_tolerance_unit Da -subsume_tags $s \
      < "$TMP/blocks.txt" > "$TMP/st_$s.raw" 2> /dev/null || fail "-stream -subsume_tags $s exited non-zero"
    lf "$TMP/st_$s.raw"
    grep -v '^#' "$TMP/st_$s.raw" > "$TMP/st_$s.tsv"
    [ "$(grep -c '^#end ' "$TMP/st_$s.raw")" = "$(grep -c '^BEGIN IONS' "$MGF")" ] || fail "-stream $s: not one #end per block"
    [ "$(awk '/^#end / { s += $3 } END { print s + 0 }' "$TMP/st_$s.raw")" = "$(($(wc -l < "$TMP/st_$s.tsv") - 1))" ] \
      || fail "-stream $s: the #end counts are not the rows written"
  done
  r=$(check "$TMP/st_on.tsv" "$TMP/st_off.tsv"); read -r ns nd nu nw nk _ <<< "$r"
  echo "-stream: dropped $nd of $(($(wc -l < "$TMP/st_off.tsv") - 1))"
  [ "$ns" = 0 ] && [ "$nu" = 0 ] && [ "$nw" = 0 ] || fail "-stream: $r"
  [ "$nd" -gt 100 ] || fail "-stream: only $nd rows dropped"
fi

# ---- -terminus ----
# Ecoli's ion-trap spectra are tagged at 0.5 Da (-tolerance_by_analyzer on):
# above 25 ppm or 0.02 Da the series column is "-", the tokens are still
# listed. With -tolerance_by_analyzer off the run is tagged at 20 ppm and the
# series is called, only through the anchor kinds that were measured to hold
# (Terminus::anchorUsed: any N side, C, y1 of K/R, a C-terminal set holding
# K or R).
run t_on "$SRC" -terminus
run t_ppm "$SRC" -terminus -tolerance_by_analyzer off
[ "$(head -1 "$TMP/t_on.tsv" | awk -F'\t' '{ print $(NF - 2) "," $(NF - 1) }')" = series,terminus ] \
  || fail "-terminus: series and terminus are not the last columns: $(head -1 "$TMP/t_on.tsv")"
awk -F'\t' '{ o = $1; for (i = 2; i <= NF; i++) if (i != NF - 2 && i != NF - 1) o = o "\t" $i; print o }' "$TMP/t_on.tsv" \
  | cmp -s - "$TMP/d_on.tsv" || fail "-terminus changes other columns or rows"
# series and terminus well formed; a called series has a used token in its reading.
TERM_AWK='
  function used(r, t,   c, a, s) {  # reading r (b/y), its tokens t
    if (t == "") return 0
    if (t ~ /^N/) return 1
    c = t; sub(/^.*,/, "", c)
    if (c == "C") return 1
    if (c !~ /^C\+/) return 0
    a = substr(c, 3)
    if (a == "K" || a == "R") return r == "y"
    if (a !~ /^\[.*\]$/) return 0
    s = substr(a, 2, length(a) - 2); while (match(s, /[A-Z](\[[^]]*\])?/)) { if (RLENGTH == 1 && substr(s, RSTART, 1) ~ /[KR]/) return 1; s = substr(s, RSTART + RLENGTH) }
    return 0
  }
  NR > 1 { s = $(NF - 2); t = $(NF - 1); ty = ""; tb = ""
    if (t ~ /^y:[^;]+;b:.+$/) { ty = t; sub(/;b:.*$/, "", ty); sub(/^y:/, "", ty); tb = t; sub(/^.*;b:/, "", tb) }
    else if (t != "-" && t !~ /^[NC]/) { print "malformed: " $0; exit }
    if (s !~ /^[by-]$/) { print "malformed: " $0; exit }
    if (s != "-" && t == "-") { print "called without a token: " $0; exit }
    if ((ty != "" || tb != "") && GATED == 0) { uy = used("y", ty); ub = used("b", tb)
      if (s == "-" && uy != ub) { print "one reading used, no call: " $0; exit }
      if (s != "-" && (s == "y" ? !uy || ub : !ub || uy)) { print "wrong call: " $0; exit } }
    else if (t != "-" && GATED == 0) {  # one reading anchored (the column does not say which)
      if (s != "-" && !used(s, t)) { print "called through an unused token: " $0; exit }
      if (s == "-" && used("y", t) && used("b", t)) { print "a token used by either reading, no call: " $0; exit } }
    if (GATED && s != "-") { print "called above 0.02 Da: " $0; exit }
  }'
bad=$(awk -F'\t' -v GATED=1 "$TERM_AWK" "$TMP/t_on.tsv")
[ -z "$bad" ] || fail "-terminus at 0.5 Da: $bad"
tok=$(awk -F'\t' 'NR > 1 && $(NF - 1) != "-"' "$TMP/t_on.tsv" | wc -l | tr -d ' ')
[ "$tok" -gt 0 ] || fail "-terminus at 0.5 Da lists no tokens"
bad=$(awk -F'\t' -v GATED=0 "$TERM_AWK" "$TMP/t_ppm.tsv")
[ -z "$bad" ] || fail "-terminus at 20 ppm: $bad"
called=$(awk -F'\t' 'NR > 1 && $(NF - 2) != "-"' "$TMP/t_ppm.tsv" | wc -l | tr -d ' ')
ny=$(awk -F'\t' 'NR > 1 && $(NF - 2) == "y" && $(NF - 1) ~ /C\+[KR]$|C\+[KR],/' "$TMP/t_ppm.tsv" | wc -l | tr -d ' ')
nu=$(awk -F'\t' 'NR > 1 && $(NF - 2) == "-" && $(NF - 1) != "-"' "$TMP/t_ppm.tsv" | wc -l | tr -d ' ')
echo "-terminus: 0.5 Da $tok rows with tokens, none called; 20 ppm $called of $(($(wc -l < "$TMP/t_ppm.tsv") - 1)) rows called, y with a C-terminal K/R $ny, tokens but no call $nu"
[ "$called" -gt 0 ] || fail "-terminus calls nothing on the Ecoli run at 20 ppm"
# The synthetic CID run (exact b/y peaks at 20 ppm, tryptic): y1 of K/R calls y.
if [ -n "$GEN" ] && [ -n "$DB" ]; then
  run t_syn "$TMP/syn_cid.mzML" -terminus
  bad=$(awk -F'\t' -v GATED=0 "$TERM_AWK" "$TMP/t_syn.tsv")
  [ -z "$bad" ] || fail "-terminus on the synthetic run: $bad"
  ny=$(awk -F'\t' 'NR > 1 && $(NF - 2) == "y" && $(NF - 1) ~ /C\+[KR]$|C\+[KR],/' "$TMP/t_syn.tsv" | wc -l | tr -d ' ')
  nb=$(awk -F'\t' 'NR > 1 && $(NF - 2) == "-" && $(NF - 1) ~ /^C\+[KR]$/' "$TMP/t_syn.tsv" | wc -l | tr -d ' ')
  echo "-terminus, synthetic: $(awk -F'\t' 'NR > 1 && $(NF - 2) != "-"' "$TMP/t_syn.tsv" | wc -l | tr -d ' ') rows called, y with a C-terminal K/R $ny, a lone C+K/R left uncalled $nb"
  [ "$ny" -gt 0 ] || fail "-terminus: no y1 of K/R called y on the synthetic run"
  # c/z rows (a synthetic ETD run, -ion_series auto) are never called: c/z
  # anchors were not measured; their tokens are still listed.
  "$GEN" --write-mzml "$DB" "$TMP/syn_etd.mzML" etd > /dev/null || fail "writing the synthetic ETD run"
  run t_etd "$TMP/syn_etd.mzML" -terminus -ion_series auto
  ic=$(head -1 "$TMP/t_etd.tsv" | awk -F'\t' '{ for (i = 1; i <= NF; i++) if ($i == "ion_series") print i }')
  [ -n "$ic" ] || fail "-terminus on the ETD run: no ion_series column"
  ncz=$(awk -F'\t' -v c="$ic" 'NR > 1 && $c == "cz"' "$TMP/t_etd.tsv" | wc -l | tr -d ' ')
  ncs=$(awk -F'\t' -v c="$ic" 'NR > 1 && $c == "cz" && $(NF - 2) != "-"' "$TMP/t_etd.tsv" | wc -l | tr -d ' ')
  nct=$(awk -F'\t' -v c="$ic" 'NR > 1 && $c == "cz" && $(NF - 1) != "-"' "$TMP/t_etd.tsv" | wc -l | tr -d ' ')
  echo "-terminus, synthetic ETD: $ncz c/z rows, $nct with tokens, $ncs called"
  [ "$ncz" -gt 0 ] && [ "$nct" -gt 0 ] || fail "-terminus on the ETD run: no c/z rows with tokens ($ncz, $nct)"
  [ "$ncs" = 0 ] || fail "-terminus called $ncs c/z rows"
fi
printf 'spectrum s 500.25 2\n300.1 10\n400.2 20\n\n' | "$BIN" -stream -terminus > /dev/null 2> "$TMP/st_t.err" \
  && fail "-stream -terminus accepted"
grep -q -- '-stream cannot be combined with -terminus' "$TMP/st_t.err" || fail "-stream -terminus: no refusal message"
echo "subsume_cli_test: all checks passed"
