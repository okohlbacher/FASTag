#!/usr/bin/env bash
# Independent CLI suite for database-free label discovery (-label_discovery_out).
#
# Written from doc/DESIGN-label-discovery.md (revision 2) alone, not from the
# implementation: every expectation below cites the design section it comes
# from. The input is the synthetic fixture set of
# test/fixtures/make_label_discovery_fixtures.py (in-silico b/y spectra with
# known terminal labels, label-free controls and edge inputs), so the truth of
# every spectrum is known.
#
#   identity   the option off leaves every output byte-identical; with it on,
#              every other output is byte-identical (sections 2, 10, 12)
#   format     header, five non-empty fields, unique (section, key), the
#              documented section order, ld_run format 1, no .part (section 9)
#   counts     ld_count against a recount of the tag TSV (sections 3, 4, 5)
#   labels     TMT, TMTpro, iTRAQ4, Dimethyl (known_label; Dimethyl since evaluation 2, no b0),
#              an unknown +123.4567 (unexplained), each at the N site, and the
#              K site of the K-labelled sets (sections 7, 8, 9)
#   reversed   b ions only: the label is still found from the reversed images;
#              a K delta with n-channel support only is never called (sec. 9)
#   label-free residue and dipeptide flanks are residue_combo, no candidate
#              is called, the call is label-free; 13C precursor picks do not
#              make a label (sections 5, 7, 8, 9)
#   ld_known   the bare-label tags at the -label_out window agree with
#              -label_out and with a recount (section 10)
#   threads    -threads 1 and 8 give a byte-identical report (section 11)
#   edges      no tags (few_spectra), every flank above max_flank
#              (no_reference), Da tolerance (low_resolution), c/z (cz_only)
#   guards     ignored advanced options, invalid values refused with no file,
#              --help/--helphelp/-write_ctd list the options (sections 2, 12)
#
# usage: label_discovery_indep_test.sh <FASTag> <fixtures/label_discovery> <data/digest>
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
FIX="$2"
DATA="$3"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
export FASTAG_DIGEST_DIR="$DATA"
unset FASTAG_FULL_PRECISION

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-ldisc-indep.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
NFAIL=0
fail() { echo "FAIL: $*" >&2; exit 1; }
# soft failure: report and go on, so one run shows every broken expectation
check() { echo "FAIL: $*" >&2; NFAIL=$((NFAIL + 1)); }
same() {
  tr -d '\r' < "$1" > "$1.lf" && tr -d '\r' < "$2" > "$2.lf" || fail "cannot read $1 or $2"
  cmp -s "$1.lf" "$2.lf" && return 0
  diff "$1.lf" "$2.lf" | head -8 | sed -n l >&2
  check "$3"
  return 1
}
run() { "$BIN" "$@" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTag $*"; }; }
# val FILE SECTION KEY
val() { [ -f "$1" ] || return 0; tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }
# site_idx FILE SITE MASS TOL: the rank i of the best-ranked <SITE>.<i>.delta within TOL of MASS
site_idx() {
  [ -f "$1" ] || return 0
  tr -d '\r' < "$1" | awk -F'\t' -v site="$2" -v m="$3" -v tol="$4" '
    $1 == "ld_site" { n = split($2, p, ".")
      if (n == 3 && p[1] == site && p[3] == "delta") { d = $3 - m; if (d < 0) d = -d
        if (d <= tol) { print p[2]; exit } } }'
}
# peak_idx FILE CH MASS TOL: the same for ld_peak <CH>.<i>.mass
peak_idx() {
  [ -f "$1" ] || return 0
  tr -d '\r' < "$1" | awk -F'\t' -v ch="$2" -v m="$3" -v tol="$4" '
    $1 == "ld_peak" { n = split($2, p, ".")
      if (n == 3 && p[1] == ch && p[3] == "mass") { d = $3 - m; if (d < 0) d = -d
        if (d <= tol) { print p[2]; exit } } }'
}
# the classes that are never called (section 8, class 1)
is_null_class() { case "$1" in residue_combo|null_shadow|isotope_error|shadow:*) return 0 ;; esac; return 1; }

if ! "$BIN" --help 2>&1 | grep -q -- '-label_discovery_out'; then
  fail "this binary has no -label_discovery_out (the feature under test is missing)"
fi

COMMON=(-tag_length 4 -threads 2)
# The labels of the fixture (monoisotopic Unimod masses) and their images.
H2O=18.010565
TMT=229.162932; TMTPRO=304.207146; ITRAQ4=144.102063; DIMETHYL=28.0313; UNKNOWN=123.4567
DTOL=0.003   # a site delta / peak mass: the c window floor 0.0015 and the fixture's jitter

# ---------------------------------------------------------------- format (section 9)
ORDER="run ld_run ld_count ld_peak ld_site ld_known ld_call"
check_format() {   # FILE NAME
  local f="$1" name="$2"
  [ -s "$f" ] || { check "$name: no report"; return 1; }
  [ -e "$f.part" ] && check "$name: $f.part left behind"
  head -1 "$f" | tr -d '\r' | grep -qx $'section\tkey\tvalue\tn\tdescription' || check "$name: header"
  tr -d '\r' < "$f" | awk -F'\t' 'NF != 5 { bad = 1 } { for (i = 1; i <= NF; i++) if ($i == "") bad = 1 } END { exit bad }' \
    || check "$name: a row without five non-empty fields"
  local dup
  dup=$(tr -d '\r' < "$f" | awk -F'\t' 'NR > 1 { if (seen[$1 SUBSEP $2]++) print $1 "/" $2 }' | head -3)
  [ -z "$dup" ] || check "$name: (section, key) repeated: $dup"
  # sections in the documented order, each in one block, none unknown to the design
  tr -d '\r' < "$f" | awk -F'\t' -v order="$ORDER" '
    BEGIN { n = split(order, o, " "); for (i = 1; i <= n; i++) rank[o[i]] = i; last = 0 }
    NR > 1 { if (!($1 in rank)) { print "unknown section " $1; exit 1 }
             if ($1 != cur) { if (rank[$1] <= last) { print "section " $1 " out of order or split"; exit 1 }
                              last = rank[$1]; cur = $1 } }' > "$TMP/order.msg" \
    || check "$name: $(cat "$TMP/order.msg")"
  for s in run ld_run ld_count ld_site ld_call; do
    tr -d '\r' < "$f" | cut -f1 | grep -qx "$s" || check "$name: no $s section"
  done
  [ "$(val "$f" ld_run format)" = 1 ] || check "$name: ld_run format is not 1"
  local st lab rs
  st=$(val "$f" ld_call status); lab=$(val "$f" ld_call labels); rs=$(val "$f" ld_call reason)
  case "$st" in
    call) [ "$rs" = - ] || check "$name: a call with reason '$rs'"
          [ -n "$lab" ] && [ "$lab" != - ] || check "$name: a call without labels" ;;
    no_call) [ "$lab" = - ] || check "$name: a no_call with labels '$lab'"
             case "$rs" in low_resolution|few_spectra|cz_only|no_reference) ;; *) check "$name: no_call reason '$rs'" ;; esac ;;
    *) check "$name: ld_call status '$st'" ;;
  esac
  # the last section is the call (section 9: measurements first, the call last)
  [ "$(tr -d '\r' < "$f" | tail -1 | cut -f1)" = ld_call ] || check "$name: ld_call is not the last section"
}

# ---------------------------------------------------------------- counts (sections 3, 4, 5)
# ld_count against the full-precision tag TSV of the same run: the -label_out
# rows (ungapped, E <= 1), distinct spectra, the clamped zeros and the values
# above max_flank, per channel (n = nterm_mass $5, c = cterm_mass $6).
check_counts() {   # REPORT TAGTSV NAME [MAX_FLANK]
  local f="$1" t="$2" name="$3" mx="${4:-700}" got want
  want=$(tr -d '\r' < "$t" | awk -F'\t' -v mx="$mx" 'NR > 1 && $8 == "0" && $9 + 0 <= 1 {
      n++; s[$1] = 1; if ($5 + 0 == 0) zn++; if ($6 + 0 == 0) zc++; if ($5 + 0 > mx) an++; if ($6 + 0 > mx) ac++ }
    END { k = 0; for (x in s) k++; print n + 0, k, zn + 0, zc + 0, an + 0, ac + 0 }')
  got="$(val "$f" ld_count tags_counted) $(val "$f" ld_count spectra_counted) $(val "$f" ld_count clamped_n)"
  got="$got $(val "$f" ld_count clamped_c) $(val "$f" ld_count above_max_n) $(val "$f" ld_count above_max_c)"
  [ "$got" = "$want" ] || check "$name: ld_count (tags spectra clamped_n clamped_c above_max_n above_max_c) '$got', tag TSV recount '$want'"
  [ "$(val "$f" ld_count tags_excluded_cz)" = 0 ] || check "$name: tags_excluded_cz is not 0 on a b/y run"
  # per site candidate: spectra are distinct spectra (section 4), so
  # spectra_clean <= spectra <= spectra_counted, spectra <= image_hits, share = spectra / counted
  tr -d '\r' < "$f" | awk -F'\t' -v tot="$(val "$f" ld_count spectra_counted)" '
    $1 == "ld_site" { n = split($2, p, "."); if (n == 3) v[p[1] "." p[2], p[3]] = $3; if (n == 3) id[p[1] "." p[2]] = 1 }
    END { for (c in id) { s = v[c, "spectra"]; sc = v[c, "spectra_clean"]; ih = v[c, "image_hits"]; sh = v[c, "share"]
            if (s == "" || s == "-") continue
            if (sc != "-" && sc + 0 > s + 0) { print c ": spectra_clean " sc " > spectra " s; bad = 1 }
            if (s + 0 > tot + 0) { print c ": spectra " s " > spectra_counted " tot; bad = 1 }
            if (ih != "-" && ih != "" && ih + 0 < s + 0) { print c ": image_hits " ih " < spectra " s; bad = 1 }
            if (tot + 0 > 0 && sh != "-" && sh != "") { d = sh - s / tot; if (d < 0) d = -d; if (d > 1e-4) { print c ": share " sh " != " s "/" tot; bad = 1 } } }
          exit bad }' > "$TMP/inv.msg" || check "$name: $(head -3 "$TMP/inv.msg" | tr '\n' ';')"
}

# delta-0 control rows for N, K and R are always written (section 9, ld_site)
check_delta0() {   # REPORT NAME
  local s
  for s in N K R; do
    [ -n "$(site_idx "$1" $s 0 0.0005)" ] || check "$2: no delta-0 row for site $s"
  done
}

# site_class REPORT SITE MASS NAME WANT_REGEX: the best-ranked candidate at MASS has a class matching WANT
site_class() {
  local f="$1" s="$2" m="$3" name="$4" want="$5" i cls
  i=$(site_idx "$f" "$s" "$m" "$DTOL")
  [ -n "$i" ] || { check "$name: no $s site candidate within $DTOL of $m"; return 1; }
  cls=$(val "$f" ld_site "$s.$i.class")
  [[ "$cls" =~ $want ]] || { check "$name: $s site at $m has class '$cls', want /$want/ (explanation '$(val "$f" ld_site "$s.$i.explanation")')"; return 1; }
  return 0
}

# ======================================================================
# 1. Opt-in identity (sections 2, 10, 12 "Off is identity")
# ======================================================================
DB="$FIX/ld_peptides.fasta"
outs() {   # DIR: the full set of other outputs into DIR, in the array OUTS
  OUTS=(-out "$1/t.tsv" -digest_out "$1/digest.tsv" -label_out "$1/label.tsv" -recon_out "$1/recon.tsv"
        -delta_out "$1/delta.tsv" -massgap_out "$1/gap.tsv" -out_spectra "$1/spectra.mzML")
}
# the -out_spectra mzML records the output paths among its parameters: those
# are the only text allowed to differ, so the run directory (one letter in
# every run, so the index offsets do not move) is masked and the file
# checksum over those paths dropped. The -label_discovery_* options must not
# appear there at all (section 2: the legacy-parameter shim keeps them out).
norm() { for d in a d b c; do sed -e "s#$IDT/$d/#$IDT/R/#g" -e '/<fileChecksum>/d' "$IDT/$d/spectra.mzML" > "$IDT/$d/spectra.norm"; done; }
ADV=(-label_discovery_max_flank 500 -label_discovery_depth 1 -label_discovery_min_spectra 5
     -label_discovery_min_share 0.01 -label_discovery_window_n 0.01 -label_discovery_window_c 0.002
     -label_discovery_unimod_top 1)
OUTFILES="t.tsv digest.tsv label.tsv recon.tsv delta.tsv gap.tsv spectra.norm"
for s in tmt labelfree; do
  IDT="$TMP/id_$s"
  # -recon_min_length 4: the auto floor of this small database is above the tag length
  ID=(-in "$FIX/ld_$s.mgf" "${COMMON[@]}" -recon_fasta "$DB" -recon_min_length 4)
  mkdir -p "$IDT/a" "$IDT/d" "$IDT/b" "$IDT/c"
  outs "$IDT/a"; run "${ID[@]}" "${OUTS[@]}"
  outs "$IDT/d"; run "${ID[@]}" "${OUTS[@]}"
  # on: every other output unchanged
  outs "$IDT/b"; run "${ID[@]}" "${OUTS[@]}" -label_discovery_out "$IDT/b/ld.tsv"
  # advanced options without -label_discovery_out: warned, ignored, no report (section 2)
  outs "$IDT/c"
  "$BIN" "${ID[@]}" "${OUTS[@]}" "${ADV[@]}" > "$IDT/c.log" 2>&1 \
    || { cat "$IDT/c.log" >&2; fail "advanced -label_discovery_* options without -label_discovery_out were refused"; }
  norm
  # a control: two equal runs agree on every compared output
  for o in $OUTFILES; do cmp -s "$IDT/a/$o" "$IDT/d/$o" || check "identity control ($s): $o differs between two equal runs"; done
  for o in $OUTFILES; do
    same "$IDT/a/$o" "$IDT/b/$o" "identity ($s): -label_discovery_out changed $o"
    same "$IDT/a/$o" "$IDT/c/$o" "identity ($s): an ignored -label_discovery_* option changed $o"
  done
  grep -q 'parameter: label_discovery' "$IDT/b/spectra.mzML" "$IDT/c/spectra.mzML" && check "identity ($s): a -label_discovery_* option is in the -out_spectra mzML"
  check_format "$IDT/b/ld.tsv" "identity run ($s)"
  for a in max_flank depth min_spectra min_share window_n window_c unimod_top; do
    grep -- "-label_discovery_$a" "$IDT/c.log" | grep -qi 'ignored' \
      || check "ignored option ($s): no warning that -label_discovery_$a is ignored without -label_discovery_out"
  done
  [ "$(cd "$IDT/a" && printf '%s ' *)" = "$(cd "$IDT/c" && printf '%s ' *)" ] \
    || check "ignored options ($s): the run wrote other files than the run without them: $(cd "$IDT/c" && printf '%s ' *)"
done
[ "$(tr -d '\r' < "$TMP/id_labelfree/a/recon.tsv" | wc -l)" -gt 1 ] || check "identity: the label-free run places no tag in -recon_out (fixture check)"
# tags_source (section 4): all without -fasta, fasta_filtered with it
[ "$(val "$TMP/id_tmt/b/ld.tsv" ld_run tags_source)" = all ] || check "tags_source is not 'all' without -fasta"
run -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -fasta "$DB" -min_filter_length 4 -out "$TMP/ff.tsv" -label_discovery_out "$TMP/ff.ld.tsv"
[ "$(val "$TMP/ff.ld.tsv" ld_run tags_source)" = fasta_filtered ] || check "tags_source is not 'fasta_filtered' with -fasta"
# FASTAG_FULL_PRECISION widens numbers only: the same (section, key) rows
FASTAG_FULL_PRECISION=1 run -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -out "$TMP/fp.tsv" -label_discovery_out "$TMP/fp.ld.tsv"
run -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -out "$TMP/np.tsv" -label_discovery_out "$TMP/np.ld.tsv"
tr -d '\r' < "$TMP/fp.ld.tsv" | cut -f1,2 > "$TMP/fp.keys"; tr -d '\r' < "$TMP/np.ld.tsv" | cut -f1,2 > "$TMP/np.keys"
same "$TMP/np.keys" "$TMP/fp.keys" "FASTAG_FULL_PRECISION changed the report's rows, not only its numbers"

# ======================================================================
# 2. Labelled sets: the call and the classes (sections 7, 8, 9)
# ======================================================================
ldrun() {   # SET: report $TMP/SET.ld.tsv, full-precision tag TSV $TMP/SET.t.tsv, -label_out $TMP/SET.label.tsv
  FASTAG_FULL_PRECISION=1 run -in "$FIX/ld_$1.mgf" "${COMMON[@]}" -out "$TMP/$1.t.tsv" \
    -label_out "$TMP/$1.label.tsv" -label_discovery_out "$TMP/$1.ld.tsv"
  check_format "$TMP/$1.ld.tsv" "$1" || return 0
  check_counts "$TMP/$1.ld.tsv" "$TMP/$1.t.tsv" "$1"
  check_delta0 "$TMP/$1.ld.tsv" "$1"
}
labels() { val "$TMP/$1.ld.tsv" ld_call labels; }
status() { echo "$(val "$TMP/$1.ld.tsv" ld_call status) $(val "$TMP/$1.ld.tsv" ld_call reason)"; }
expect_call() { [ "$(status "$1")" = "call -" ] || check "$1: ld_call is '$(status "$1")', want a call"; }

for s in tmt tmtpro itraq4 dimethyl unknown tmt_bonly labelfree labelfree_iso; do ldrun "$s"; done

# TMT6plex at N and K: known_label at both sites, the N0r image is a known_label peak
expect_call tmt
L=$(labels tmt)
[[ "$L" =~ TMT ]] && ! [[ "$L" =~ [Pp][Rr][Oo]|iTRAQ|ambiguous|unknown|label-free ]] || check "tmt: labels '$L', want TMT only"
[[ "$L" =~ K: ]] || check "tmt: labels '$L' do not call the K site (K0f, K1f and K1r present in every K spectrum)"
site_class "$TMP/tmt.ld.tsv" N $TMT tmt '^known_label$'
site_class "$TMP/tmt.ld.tsv" K $TMT tmt '^known_label$'
i=$(peak_idx "$TMP/tmt.ld.tsv" c "$(awk -v l=$TMT -v w=$H2O 'BEGIN { printf "%.6f", l - w }')" $DTOL)
if [ -z "$i" ]; then check "tmt: no c-channel peak at the N0r image TMT - H2O (211.1524)"
else
  [ "$(val "$TMP/tmt.ld.tsv" ld_peak c.$i.class)" = known_label ] || check "tmt: the N0r peak is '$(val "$TMP/tmt.ld.tsv" ld_peak c.$i.class)', not known_label"
  [[ "$(val "$TMP/tmt.ld.tsv" ld_peak c.$i.explanation)" =~ N0r ]] || check "tmt: the N0r peak's explanation '$(val "$TMP/tmt.ld.tsv" ld_peak c.$i.explanation)' does not name N0r"
fi
# the leak offsets of the K label (section 7): L_K + H2O and K + L_K + H2O are not N labels
for m in "$(awk -v l=$TMT -v w=$H2O 'BEGIN { printf "%.6f", l + w }')" \
         "$(awk -v l=$TMT -v w=$H2O 'BEGIN { printf "%.6f", 128.094963 + l + w }')" 18.010565 146.105528 174.111676; do
  i=$(site_idx "$TMP/tmt.ld.tsv" N "$m" $DTOL)
  [ -z "$i" ] && continue
  c=$(val "$TMP/tmt.ld.tsv" ld_site N.$i.class)
  is_null_class "$c" || check "tmt: the N candidate at the leak offset $m is '$c', not a never-called class"
done
[[ "$L" =~ 247\.|375\.|18\.01 ]] && check "tmt: a leak offset is called: '$L'"

# TMTpro at N and K; not iTRAQ8plex (304.2054) and not ambiguous on exact masses (section 5)
expect_call tmtpro
L=$(labels tmtpro)
[[ "$L" =~ TMTpro ]] && ! [[ "$L" =~ iTRAQ|ambiguous|unknown|label-free ]] || check "tmtpro: labels '$L', want TMTpro only"
[[ "$L" =~ K: ]] || check "tmtpro: labels '$L' do not call the K site"
site_class "$TMP/tmtpro.ld.tsv" N $TMTPRO tmtpro '^known_label$'
site_class "$TMP/tmtpro.ld.tsv" K $TMTPRO tmtpro '^known_label$'

# iTRAQ4plex at N and K
expect_call itraq4
L=$(labels itraq4)
[[ "$L" =~ iTRAQ4 ]] && ! [[ "$L" =~ TMT|iTRAQ8|ambiguous|unknown|label-free ]] || check "itraq4: labels '$L', want iTRAQ4 only"
site_class "$TMP/itraq4.ld.tsv" N $ITRAQ4 itraq4 '^known_label$'
site_class "$TMP/itraq4.ld.tsv" K $ITRAQ4 itraq4 '^known_label$'

# Dimethyl at N and K, with no b0 ion: named Dimethyl (sections 3, 8). Evaluation 2 made
# dimethyl light/medium/heavy known labels (class known_label, the lower evidence bar of
# section 9); format 1 found it as a Unimod entry (class unimod).
expect_call dimethyl
L=$(labels dimethyl)
[[ "$L" =~ Dimethyl ]] && ! [[ "$L" =~ TMT|iTRAQ|unknown|label-free|Ethyl|Delta ]] || check "dimethyl: labels '$L', want Dimethyl only"
if site_class "$TMP/dimethyl.ld.tsv" N $DIMETHYL dimethyl '^known_label$'; then
  i=$(site_idx "$TMP/dimethyl.ld.tsv" N $DIMETHYL $DTOL)
  [[ "$(val "$TMP/dimethyl.ld.tsv" ld_site N.$i.explanation)" =~ Dimethyl ]] \
    || check "dimethyl: the N site is explained as '$(val "$TMP/dimethyl.ld.tsv" ld_site N.$i.explanation)', not Dimethyl"
fi
site_class "$TMP/dimethyl.ld.tsv" K $DIMETHYL dimethyl '^known_label$'

# An unknown +123.4567 at N only: unexplained, called as unknown:N+123.45..; K not labelled
expect_call unknown
L=$(labels unknown)
[[ "$L" =~ unknown:N\+123\.45 ]] || check "unknown: labels '$L', want unknown:N+123.4567"
[[ "$L" =~ TMT|iTRAQ|Dimethyl|K: ]] && check "unknown: labels '$L' name a known label or a K site"
site_class "$TMP/unknown.ld.tsv" N $UNKNOWN unknown '^unexplained$'

# Reversed (b-ladder) tags only (sections 3, 9): the N label from N0r/N1r in
# channel c; the K label has n-channel images only (K1r), so it is never called
expect_call tmt_bonly
L=$(labels tmt_bonly)
[[ "$L" =~ TMT ]] && ! [[ "$L" =~ [Pp][Rr][Oo]|iTRAQ|unknown|label-free ]] || check "tmt_bonly: labels '$L', want TMT"
[[ "$L" =~ K: ]] && check "tmt_bonly: labels '$L' call the K site on n-channel support only"
site_class "$TMP/tmt_bonly.ld.tsv" N $TMT tmt_bonly '^known_label$'
i=$(site_idx "$TMP/tmt_bonly.ld.tsv" N $TMT $DTOL)
[ -n "$i" ] && { sc=$(val "$TMP/tmt_bonly.ld.tsv" ld_site N.$i.support_c)
  [ "$sc" != - ] && [ "${sc:-0}" -ge 20 ] 2>/dev/null || check "tmt_bonly: the N site's support_c '$sc' is below min_spectra 20 (every spectrum has b0..b4)"; }

# ld_known parity with -label_out (section 10): at the -label_out window
# 0.008 the bare-label N0f tags (n = L) and K0f tags (c = L, all residues)
# equal a recount, and their sum is -label_out's nlabel <label>.count
known_parity() {   # SET LABELNAME MASS
  local f="$TMP/$1.ld.tsv" t="$TMP/$1.t.tsv" rn rc n0f k0f lo
  read -r rn rc < <(tr -d '\r' < "$t" | awk -F'\t' -v m="$3" -v w=0.008 'NR > 1 && $8 == "0" && $9 + 0 <= 1 {
      if ($5 >= m - w && $5 <= m + w) n++; if ($6 >= m - w && $6 <= m + w) c++ } END { print n + 0, c + 0 }')
  n0f=$(tr -d '\r' < "$f" | awk -F'\t' -v lab="$2" '$1 == "ld_known" && index($2, lab) && $2 ~ /N0f/ && $2 ~ /tag/ && !(lab == "TMT" && $2 ~ /[Pp]ro/) { print $3; exit }')
  k0f=$(tr -d '\r' < "$f" | awk -F'\t' -v lab="$2" '$1 == "ld_known" && index($2, lab) && $2 ~ /K0f/ && $2 ~ /tag/ && !(lab == "TMT" && $2 ~ /[Pp]ro/) { print $3; exit }')
  [ -n "$n0f" ] || { check "$1: no ld_known row with $2, N0f and tags in its key"; return; }
  [ -n "$k0f" ] || { check "$1: no ld_known row with $2, K0f and tags in its key"; return; }
  [ "$n0f $k0f" = "$rn $rc" ] || check "$1: ld_known $2 N0f/K0f tags '$n0f $k0f', recount at 0.008 '$rn $rc'"
  lo=$(val "$TMP/$1.label.tsv" nlabel "$2.count")
  [ "$((n0f + k0f))" = "$lo" ] || check "$1: ld_known $2 N0f + K0f = $((n0f + k0f)), -label_out nlabel $2.count = $lo"
}
known_parity tmt TMT $TMT
known_parity tmtpro TMTpro $TMTPRO
known_parity itraq4 iTRAQ4 $ITRAQ4

# ======================================================================
# 3. Label-free controls (sections 6, 7, 8, 9; design tests 3, 11, 13)
# ======================================================================
for s in labelfree labelfree_iso; do
  f="$TMP/$s.ld.tsv"
  [ "$(status $s) $(labels $s)" = "call - label-free" ] || check "$s: ld_call '$(status $s)' labels '$(labels $s)', want call label-free"
  # no candidate other than delta 0 is of a class that can be called
  tr -d '\r' < "$f" | awk -F'\t' '$1 == "ld_site" { n = split($2, p, "."); if (n == 3 && p[3] == "delta") d[p[1] "." p[2]] = $3
      if (n == 3 && p[3] == "class") c[p[1] "." p[2]] = $3 }
    END { for (k in d) { x = d[k] + 0; if (x < 0) x = -x; if (x <= 0.0005) continue
            if (c[k] !~ /^(residue_combo|null_shadow|isotope_error|shadow:.*)$/) print k " delta " d[k] " class " c[k] } }' \
    > "$TMP/$s.bad"
  [ -s "$TMP/$s.bad" ] && check "$s: candidates of a callable class on a label-free run: $(head -5 "$TMP/$s.bad" | tr '\n' ';')"
  # no channel peak is called a known label
  tr -d '\r' < "$f" | awk -F'\t' '$1 == "ld_peak" && $2 ~ /\.class$/ && $3 == "known_label" { print $2 }' > "$TMP/$s.kl"
  [ -s "$TMP/$s.kl" ] && check "$s: known_label peaks on a label-free run: $(head -3 "$TMP/$s.kl" | tr '\n' ' ')"
done
# the strong residue and dipeptide flanks are residue_combo peaks (section 8)
f="$TMP/labelfree.ld.tsv"
for spec in "c 128.094963 K" "c 156.101111 R" "c 241.179027 L+K" "n 184.121178 A+L" "n 71.037114 A"; do
  set -- $spec
  i=$(peak_idx "$f" "$1" "$2" $DTOL)
  if [ -z "$i" ]; then check "labelfree: no $1-channel peak at the $3 flank $2 (present in over 100 spectra)"
  else
    c=$(val "$f" ld_peak "$1.$i.class")
    [ "$c" = residue_combo ] || check "labelfree: the $3 flank peak at $2 ($1) is '$c', not residue_combo"
  fi
done
# 13C picks (section 5): a +1.0034 N candidate, if one is kept, is isotope_error or null_shadow
i=$(site_idx "$TMP/labelfree_iso.ld.tsv" N 1.003355 $DTOL)
if [ -n "$i" ]; then
  c=$(val "$TMP/labelfree_iso.ld.tsv" ld_site N.$i.class)
  case "$c" in isotope_error|null_shadow) ;; *) check "labelfree_iso: the +1.0034 N candidate is '$c'" ;; esac
fi

# ======================================================================
# 4. Threads (section 11): byte-identical at 1 and 8 threads
# ======================================================================
for s in tmt labelfree; do
  for t in 1 8; do
    run -in "$FIX/ld_$s.mgf" -tag_length 4 -threads $t -out "$TMP/$s.t$t.tsv" -label_discovery_out "$TMP/$s.ld$t.tsv"
  done
  cmp -s "$TMP/$s.ld1.tsv" "$TMP/$s.ld8.tsv" || { diff "$TMP/$s.ld1.tsv" "$TMP/$s.ld8.tsv" | head -6 >&2
    check "$s: the report differs between -threads 1 and -threads 8"; }
done

# ======================================================================
# 5. Edge inputs
# ======================================================================
# no tags at all: written, no_call few_spectra, nothing counted
run -in "$FIX/ld_noise.mgf" "${COMMON[@]}" -out "$TMP/noise.t.tsv" -label_discovery_out "$TMP/noise.ld.tsv"
check_format "$TMP/noise.ld.tsv" noise &&
check_counts "$TMP/noise.ld.tsv" "$TMP/noise.t.tsv" noise
check_delta0 "$TMP/noise.ld.tsv" noise
[ "$(status noise)" = "no_call few_spectra" ] || check "noise: ld_call '$(status noise)', want no_call few_spectra"
[ "$(val "$TMP/noise.ld.tsv" ld_count tags_counted)" = 0 ] || check "noise: tags_counted is not 0 (the fixture has no ladders)"
tr -d '\r' < "$TMP/noise.ld.tsv" | cut -f1 | grep -qx ld_peak && check "noise: ld_peak rows without any tag"

# every flank above max_flank 700: counted but never binned; no peak; no N reference
run -in "$FIX/ld_largeflank.mgf" "${COMMON[@]}" -out "$TMP/big.t.tsv" -label_discovery_out "$TMP/big.ld.tsv"
check_format "$TMP/big.ld.tsv" largeflank &&
check_counts "$TMP/big.ld.tsv" "$TMP/big.t.tsv" largeflank
f="$TMP/big.ld.tsv"
tc=$(val "$f" ld_count tags_counted)
[ "${tc:-0}" -gt 0 ] 2>/dev/null || check "largeflank: no tags counted (fixture check)"
[ "$(val "$f" ld_count above_max_n) $(val "$f" ld_count above_max_c)" = "$tc $tc" ] \
  || check "largeflank: above_max_n/_c '$(val "$f" ld_count above_max_n) $(val "$f" ld_count above_max_c)', want every counted tag ($tc)"
tr -d '\r' < "$f" | cut -f1 | grep -qx ld_peak && check "largeflank: ld_peak rows although no flank is in range"
[ "$(val "$f" ld_call status) $(val "$f" ld_call reason)" = "no_call no_reference" ] \
  || check "largeflank: ld_call '$(val "$f" ld_call status) $(val "$f" ld_call reason)', want no_call no_reference"
# the same input with max_flank raised past the flanks bins them (the option is read)
run -in "$FIX/ld_largeflank.mgf" "${COMMON[@]}" -out "$TMP/big2.t.tsv" -label_discovery_out "$TMP/big2.ld.tsv" -label_discovery_max_flank 1500
[ "$(val "$TMP/big2.ld.tsv" ld_count above_max_c)" -lt "$tc" ] 2>/dev/null \
  || check "largeflank: -label_discovery_max_flank 1500 still has every c flank above max"
[ "$(val "$TMP/big2.ld.tsv" ld_run max_flank_da)" = 1500 ] || check "largeflank: ld_run max_flank_da is not 1500"

# Da fragment tolerance: no_call low_resolution (section 5)
run -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -fragment_tolerance 0.02 -fragment_tolerance_unit Da \
  -out "$TMP/da.t.tsv" -label_discovery_out "$TMP/da.ld.tsv"
check_format "$TMP/da.ld.tsv" da
[ "$(val "$TMP/da.ld.tsv" ld_call status) $(val "$TMP/da.ld.tsv" ld_call reason)" = "no_call low_resolution" ] \
  || check "da: ld_call '$(val "$TMP/da.ld.tsv" ld_call status) $(val "$TMP/da.ld.tsv" ld_call reason)', want no_call low_resolution"
tr -d '\r' < "$TMP/da.ld.tsv" | cut -f1 | grep -qx ld_count || check "da: no ld_count section on a Da run"

# c/z only: excluded and counted, no_call cz_only (section 4)
run -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -ion_series cz -out "$TMP/cz.t.tsv" -label_discovery_out "$TMP/cz.ld.tsv"
check_format "$TMP/cz.ld.tsv" cz
[ "$(val "$TMP/cz.ld.tsv" ld_count tags_excluded_cz)" -gt 0 ] 2>/dev/null || check "cz: tags_excluded_cz is not > 0"
[ "$(val "$TMP/cz.ld.tsv" ld_count tags_counted)" = 0 ] || check "cz: c/z tags were counted"
[ "$(val "$TMP/cz.ld.tsv" ld_call status) $(val "$TMP/cz.ld.tsv" ld_call reason)" = "no_call cz_only" ] \
  || check "cz: ld_call '$(val "$TMP/cz.ld.tsv" ld_call status) $(val "$TMP/cz.ld.tsv" ld_call reason)', want no_call cz_only"

# ======================================================================
# 6. Guards and interface (sections 2, 9, 12)
# ======================================================================
refuse() {   # NAME ARGS...: refused, no report and no .part
  local name="$1"; shift
  rm -f "$TMP/r.ld.tsv" "$TMP/r.ld.tsv.part"
  "$BIN" -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -out "$TMP/r.t.tsv" -label_discovery_out "$TMP/r.ld.tsv" "$@" > "$TMP/r.log" 2>&1
  local rc=$?
  [ $rc -ne 0 ] || check "$name was accepted"
  [ $rc -lt 128 ] || check "$name crashed (exit $rc)"
  [ -e "$TMP/r.ld.tsv" ] && check "$name left a report"
  [ -e "$TMP/r.ld.tsv.part" ] && check "$name left a .part file"
}
refuse "-label_discovery_depth 3" -label_discovery_depth 3
refuse "-label_discovery_depth -1" -label_discovery_depth -1
refuse "-label_discovery_max_flank 0" -label_discovery_max_flank 0
refuse "-label_discovery_max_flank -5" -label_discovery_max_flank -5
refuse "-label_discovery_min_share 1.5" -label_discovery_min_share 1.5
refuse "-label_discovery_max_flank nan" -label_discovery_max_flank nan
# upper bounds: the null image set's memory (max_flank) and the
# half-integer background, which must stay outside the window
refuse "-label_discovery_max_flank 5000" -label_discovery_max_flank 5000
refuse "-label_discovery_max_flank 1500.5" -label_discovery_max_flank 1500.5
refuse "-label_discovery_window_n 10" -label_discovery_window_n 10
refuse "-label_discovery_window_c 0.3" -label_discovery_window_c 0.3
refuse "-label_discovery_window_c 0.051" -label_discovery_window_c 0.051
# the report naming the input is refused like any other output
"$BIN" -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -out "$TMP/x.t.tsv" -label_discovery_out "$TMP/x.t.tsv" > "$TMP/r.log" 2>&1 \
  && check "-label_discovery_out naming -out was accepted"
# an option given is recorded in ld_run (the advanced options are read when on)
run -in "$FIX/ld_tmt.mgf" "${COMMON[@]}" -out "$TMP/o.t.tsv" -label_discovery_out "$TMP/o.ld.tsv" \
  -label_discovery_depth 1 -label_discovery_min_spectra 7 -label_discovery_window_c 0.002
[ "$(val "$TMP/o.ld.tsv" ld_run depth) $(val "$TMP/o.ld.tsv" ld_run min_spectra)" = "1 7" ] \
  || check "ld_run depth/min_spectra '$(val "$TMP/o.ld.tsv" ld_run depth) $(val "$TMP/o.ld.tsv" ld_run min_spectra)', want '1 7'"
[ "$(val "$TMP/o.ld.tsv" ld_run window_source_c)" = option ] || check "ld_run window_source_c is not 'option' with -label_discovery_window_c"
[ "$(val "$TMP/id_tmt/b/ld.tsv" ld_run depth) $(val "$TMP/id_tmt/b/ld.tsv" ld_run min_spectra) $(val "$TMP/id_tmt/b/ld.tsv" ld_run max_flank_da)" = "2 20 700" ] \
  || check "ld_run defaults depth/min_spectra/max_flank_da are not 2 20 700"
# --help, --helphelp and -write_ctd list the options
"$BIN" --help 2>&1 | grep -q -- '-label_discovery_out' || check "--help does not list -label_discovery_out"
HH=$("$BIN" --helphelp 2>&1)
for a in out max_flank depth min_spectra min_share window_n window_c unimod_top; do
  grep -q -- "-label_discovery_$a" <<< "$HH" || check "--helphelp does not list -label_discovery_$a"
done
mkdir -p "$TMP/ctd"
if "$BIN" -write_ctd "$TMP/ctd" > "$TMP/ctd.log" 2>&1 && [ -s "$TMP/ctd/FASTag.ctd" ]; then
  for a in out max_flank depth min_spectra min_share window_n window_c unimod_top; do
    grep -q "name=\"label_discovery_$a\"" "$TMP/ctd/FASTag.ctd" || check "-write_ctd does not list label_discovery_$a"
  done
else
  check "-write_ctd failed"
fi

if [ "$NFAIL" -gt 0 ]; then
  echo "label_discovery_indep_test: $NFAIL failed expectation(s)" >&2
  exit 1
fi
echo "label_discovery_indep_test: PASS"
