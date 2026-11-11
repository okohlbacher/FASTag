#!/usr/bin/env bash
# a/x ions (FASTag 1.13 backlog item 11): -ion_series ax and -ion_series auto
# -ion_series_photo ax, against the real binary.
#
# Synthetic runs from ax_ions_test --write-mzml (OpenMS
# TheoreticalSpectrumGenerator, 40 tryptic peptides of the fixture FASTA):
#   syn_uvpd    a and x ions, activation photodissociation (MS:1000435);
#   syn_uvpdf   the same peaks, no activation term, filter string @uvpd;
#   syn_cid     b and y ions, CID.
# Checks:
#   - the option off: -ion_series auto on the UVPD run, and -ion_series_photo
#     by explicitly, are byte-identical to 1.12's auto (= by here: no
#     electron activation); auto + photo ax on the CID run and on the
#     vendored CID source equals by in every output;
#   - -ion_series ax: the ion_series column after the by header, every row
#     ax, the INFO line with the a/x and photo counts, census
#     best_ion_series ax; exact placements (-recon_out) far above by on the
#     same run and close to the CID run under by; the digest call from a/x
#     tags is the b/y one (Trypsin);
#   - auto + -ion_series_photo ax equals ax on syn_uvpd and syn_uvpdf (photo
#     from the method and from the filter token), with its own INFO line;
#   - ax on the CID source warns (classified activation); -ion_series_photo
#     without auto warns that it is ignored; -stream refuses it;
#   - threads 1/3/8 identical under ax;
#   - -complement_tolerance_unit auto probes a/x spectra as a/x (more
#     complement pairs than the b/y probe; auto + photo ax equals ax);
#   - -species leaves a/x rows out and says how many (with buildtaxdb).
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
SRC="$2"            # Ecoli_MS2_small.mzML
DB="$3"             # Ecoli_MS2_small.fasta
GEN="$4"            # ax_ions_test
BUILDTAXDB="${5:-}" # buildtaxdb (species check)
TAXDIR="${6:-}"     # data/taxonomy (species check)
DIGDIR="${7:-}"     # data/digest
MGF="${8:-}"        # Ecoli_MS2_small.mgf (no activation)
[ -n "$DIGDIR" ] && export FASTAG_DIGEST_DIR="$DIGDIR"

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-ax-test.XXXXXX") || exit 1
# Windows (MSYS): the native binary and python see C:/..., not /tmp/...; compare and pass that form.
command -v cygpath >/dev/null 2>&1 && TMP=$(cygpath -m "$TMP")
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
GATE_RE='^[0-9]+ MS2 spectra, [0-9]+ tags'

"$GEN" --write-mzml "$DB" "$TMP/syn_uvpd.mzML" uvpd > /dev/null || fail "writing the synthetic UVPD run"
"$GEN" --write-mzml "$DB" "$TMP/syn_uvpdf.mzML" uvpd_filter > /dev/null || fail "writing the filter-string UVPD run"
"$GEN" --write-mzml "$DB" "$TMP/syn_cid.mzML" by > /dev/null || fail "writing the synthetic CID run"
grep -q 'MS:1000435' "$TMP/syn_uvpd.mzML" || fail "the UVPD fixture has no photodissociation term"
grep -q 'MS:1000435' "$TMP/syn_uvpdf.mzML" && fail "the filter fixture has an activation term"
grep -q '@uvpd' "$TMP/syn_uvpdf.mzML" || fail "the filter fixture has no @uvpd token"

# runb <name> <input> <threads> [args]: stdout (no timing), stderr, the phase lines.
runb() {
  local name=$1 in=$2 th=$3; shift 3
  "$BIN" -in "$in" -out "$TMP/$name.tsv" -threads "$th" "$@" > "$TMP/$name.out" 2> "$TMP/$name.err" \
    || { cat "$TMP/$name.err" >&2; fail "FASTag on $name exited non-zero"; }
  # Output paths name the run; the comparison is of the content.
  grep -v 'took .* (wall)' "$TMP/$name.out" | sed "s|$TMP/$name\.|OUT.|g" > "$TMP/$name.stdout"
}
lastcol() { awk -F'\t' 'NR == 1 { print $NF; exit }' "$1"; }
valuesof() { awk -F'\t' 'NR > 1 { print $NF }' "$1" | sort -u | tr '\n' ' ' | sed 's/ $//'; }
same() {  # <a> <b> <what>: tags, stdout, and every given report suffix
  local a=$1 b=$2 what=$3; shift 3
  cmp -s "$TMP/$a.tsv" "$TMP/$b.tsv" || fail "$what: tags differ"
  cmp -s "$TMP/$a.stdout" "$TMP/$b.stdout" || fail "$what: stdout differs"
  for o in "$@"; do cmp -s "$TMP/$a.$o" "$TMP/$b.$o" || fail "$what: $o differs"; done
}

RX=(-recon_fasta "$DB" -tag_length 4 -extension 1 -fragment_tolerance 20 -fragment_tolerance_unit ppm)
sruns() {  # name input [args]
  local name=$1 in=$2; shift 2
  runb "$name" "$in" 2 "${RX[@]}" -recon_out "$TMP/$name.recon.tsv" -digest_out "$TMP/$name.digest.tsv" \
    -label_out "$TMP/$name.label.tsv" -massgap_out "$TMP/$name.massgap.tsv" -census -census_out "$TMP/$name.census.tsv" "$@"
}
REPORTS=(recon.tsv digest.tsv label.tsv massgap.tsv census.tsv)

# ---- the option off: 1.12's auto ----
sruns u_by "$TMP/syn_uvpd.mzML"
sruns u_auto "$TMP/syn_uvpd.mzML" -ion_series auto
sruns u_auto_by "$TMP/syn_uvpd.mzML" -ion_series auto -ion_series_photo by
same u_auto u_auto_by "-ion_series_photo by explicit vs absent" "${REPORTS[@]}"
cmp -s "$TMP/u_by.tsv" "$TMP/u_auto.tsv" || fail "auto on a photo run (no electron activation) differs from by"
for o in "${REPORTS[@]}"; do
  # digest/label/massgap carry the mode in their run rows; tags and recon do not.
  case $o in recon.tsv|census.tsv) cmp -s "$TMP/u_by.$o" "$TMP/u_auto.$o" || fail "auto vs by on the photo run: $o differs";; esac
done
grep -q 'a/x' "$TMP/u_auto.err" && fail "auto without -ion_series_photo ax mentions a/x"
[ "$(lastcol "$TMP/u_auto.tsv")" = ion_series ] && fail "auto without photo ax wrote the ion_series column"
sruns c_auto "$TMP/syn_cid.mzML" -ion_series auto
sruns c_auto_ph "$TMP/syn_cid.mzML" -ion_series auto -ion_series_photo ax
cmp -s "$TMP/c_auto.tsv" "$TMP/c_auto_ph.tsv" || fail "auto + photo ax on CID: tags differ from auto"
for o in recon.tsv census.tsv; do cmp -s "$TMP/c_auto.$o" "$TMP/c_auto_ph.$o" || fail "auto + photo ax on CID: $o differs"; done
runb e_by "$SRC" 2
runb e_auto_ph "$SRC" 2 -ion_series auto -ion_series_photo ax
cmp -s "$TMP/e_by.tsv" "$TMP/e_auto_ph.tsv" || fail "auto + photo ax on the CID source: tags differ from by"
[ "$(wc -l < "$TMP/e_by.tsv")" -gt 100 ] || fail "too few tags on the source for a meaningful comparison"

# ---- -ion_series ax ----
sruns u_ax "$TMP/syn_uvpd.mzML" -ion_series ax
[ "$(lastcol "$TMP/u_ax.tsv")" = ion_series ] || fail "ax: no ion_series column"
[ "$(valuesof "$TMP/u_ax.tsv")" = ax ] || fail "ax: rows not all ax ($(valuesof "$TMP/u_ax.tsv"))"
[ "$(wc -l < "$TMP/u_ax.tsv")" -gt 40 ] || fail "ax: too few tags for a meaningful check"
head -1 "$TMP/u_ax.tsv" | tr -d '\r' | cmp -s - <(head -1 "$TMP/u_by.tsv" | tr -d '\r' | sed 's/$/\tion_series/') \
  || fail "ax: the header is not the by header plus ion_series"
[ "$(awk -F'\t' '{ print NF }' "$TMP/u_ax.tsv" | sort -u | wc -l)" -eq 1 ] || fail "ax: ragged rows"
grep -q '^Ion series (-ion_series ax): 0 MS2 spectra tagged as c/z-dot ions, 0 as b/y ions, 40 as a/x ions (activation: 0 collisional, 0 electron, 0 hybrid, 40 unknown, of them 40 photodissociation)' "$TMP/u_ax.err" \
  || fail "ax: INFO line: $(grep '^Ion series' "$TMP/u_ax.err")"
grep -qE 'Ion series|a/x' "$TMP/u_ax.out" && fail "an a/x line reached stdout"
grep -E '^(Ion series|Activation)' "$TMP/u_ax.err" | grep -qE "$GATE_RE" && fail "an a/x line matches the gate pattern"
[ "$(awk -F'\t' 'NR == 1 { print $NF; exit }' "$TMP/u_ax.census.tsv")" = best_ion_series ] || fail "census: no best_ion_series under ax"
[ "$(awk -F'\t' 'NR > 1 && $NF != "" { print $NF }' "$TMP/u_ax.census.tsv" | sort -u)" = ax ] || fail "census: best tags not ax"
# The census summary carries the versioned run rows (src/RunMeta.h).
grep -q $'^run\tion_series_ax\t40\t40\t' "$TMP/u_ax.census_summary.tsv" || fail "ax: the census summary lacks ion_series_ax 40 of 40"
grep -q $'^run\tion_series_cz\t' "$TMP/u_auto.census_summary.tsv" || fail "auto: no ion_series_cz run row (the check is weak)"
grep -q 'ion_series_ax\|ion_series_photo' "$TMP/u_auto.census_summary.tsv" && fail "auto without photo ax writes an a/x run row"
# exact placements (both flanks match) per spectrum
placed() { awk -F'\t' 'NR > 1 && $7 == "1" && $8 == "1" { print $1 }' "$1" | sort -u | wc -l | tr -d ' '; }
sruns c_by "$TMP/syn_cid.mzML"
pa=$(placed "$TMP/u_ax.recon.tsv"); pb=$(placed "$TMP/u_by.recon.tsv"); pc=$(placed "$TMP/c_by.recon.tsv")
echo "synthetic: spectra with an exact placement: UVPD ax $pa, UVPD by $pb, CID by $pc (of 40)"
[ "$pc" -ge 30 ] || fail "synthetic CID under by: only $pc of 40 spectra place exactly (the fixture is weak)"
[ "$pa" -ge $((pc * 3 / 4)) ] || fail "synthetic UVPD under ax: $pa spectra place exactly, CID under by $pc"
[ "$pa" -ge $((pb * 2 + 5)) ] || fail "synthetic UVPD: ax ($pa) does not place far more spectra than by ($pb)"
[ "$(awk -F'\t' 'NR > 1 && $6 == "1" && $7 == "1" && $8 == "1"' "$TMP/u_ax.recon.tsv" | wc -l)" -gt 5 ] \
  || fail "synthetic UVPD under ax: too few reversed (a-ion) exact placements"
dcall() { awk -F'\t' '$1 == "call" && ($2 == "status" || $2 == "model") { printf "%s ", $3 }' "$1"; }
dc=$(dcall "$TMP/c_by.digest.tsv"); da=$(dcall "$TMP/u_ax.digest.tsv")
echo "synthetic digest call: CID by [$dc], UVPD ax [$da], UVPD by [$(dcall "$TMP/u_by.digest.tsv")]"
[ "$dc" = "call Trypsin " ] && [ "$dc" = "$da" ] || fail "synthetic: the digest call from a/x tags ($da) differs from b/y ($dc)"

# ---- auto + -ion_series_photo ax ----
sruns u_ph "$TMP/syn_uvpd.mzML" -ion_series auto -ion_series_photo ax
sruns uf_ph "$TMP/syn_uvpdf.mzML" -ion_series auto -ion_series_photo ax
sruns uf_ax "$TMP/syn_uvpdf.mzML" -ion_series ax
cmp -s "$TMP/u_ax.tsv" "$TMP/u_ph.tsv" || fail "auto + photo ax differs from ax on an all-photo run"
cmp -s "$TMP/u_ax.recon.tsv" "$TMP/u_ph.recon.tsv" || fail "auto + photo ax: recon differs from ax"
cmp -s "$TMP/u_ax.tsv" "$TMP/uf_ph.tsv" || fail "the @uvpd filter token is not read as photodissociation"
cmp -s "$TMP/u_ax.tsv" "$TMP/uf_ax.tsv" || fail "ax: the filter run differs from the method run"
grep -q '^Ion series (-ion_series auto): 0 MS2 spectra tagged as c/z-dot ions, 0 as b/y ions, 40 as a/x ions .*of them 40 photodissociation' "$TMP/u_ph.err" \
  || fail "auto + photo ax: INFO line: $(grep '^Ion series' "$TMP/u_ph.err")"
grep -q $'^run\tion_series_photo\tax\t' "$TMP/u_ph.census_summary.tsv" || fail "auto + photo ax: no ion_series_photo run row"
# MGF carries no activation: auto + photo ax reads it as b/y; ax reads it as a/x.
if [ -n "$MGF" ]; then
  runb m_by "$MGF" 2
  runb m_ph "$MGF" 2 -ion_series auto -ion_series_photo ax
  runb m_ax "$MGF" 2 -ion_series ax
  cmp -s "$TMP/m_by.tsv" "$TMP/m_ph.tsv" || fail "MGF: auto + photo ax differs from by"
  [ "$(valuesof "$TMP/m_ax.tsv")" = ax ] || fail "MGF: ax rows not all ax"
  grep -q '^Activation:' "$TMP/m_ax.err" && fail "MGF (unknown activation) under ax warns about classified spectra"
  grep -q 'of them 0 photodissociation' "$TMP/m_ax.err" || fail "MGF under ax: photo count not 0"
fi

# ---- warnings and refusals ----
runb e_ax "$SRC" 2 -ion_series ax
N=$(grep -oE "$GATE_RE" "$TMP/e_by.out" | head -1 | awk '{print $1}')
grep -q "^Activation: $N of $N MS2 spectra were activated by collision" "$TMP/e_ax.err" || fail "ax on CID: no classified WARN"
runb e_ign "$SRC" 2 -ion_series_photo ax
grep -q -- '-ion_series_photo is only read for -ion_series auto; it is ignored here' "$TMP/e_ign.err" || fail "no ignored-option WARN"
cmp -s "$TMP/e_by.tsv" "$TMP/e_ign.tsv" || fail "-ion_series_photo ax under by changes the tags"
"$BIN" -in "$SRC" -out "$TMP/s.tsv" -stream -ion_series_photo ax > "$TMP/s.out" 2>&1 && fail "-stream accepted -ion_series_photo"
grep -q -- '-stream cannot be combined with -ion_series_photo' "$TMP/s.out" || fail "-stream refusal message"

# ---- threads ----
for t in 1 3 8; do
  runb th$t "$TMP/syn_uvpd.mzML" $t -ion_series ax "${RX[@]}" -recon_out "$TMP/th$t.recon.tsv"
done
for t in 3 8; do
  cmp -s "$TMP/th1.tsv" "$TMP/th$t.tsv" || fail "ax: tags differ at $t threads"
  cmp -s "$TMP/th1.recon.tsv" "$TMP/th$t.recon.tsv" || fail "ax: recon differs at $t threads"
done

# ---- -complement_tolerance_unit auto (1.13 item 15) probes a/x spectra as a/x ----
# The probe reads each spectrum as the tagging pass does: under ax, and under
# auto + -ion_series_photo ax, the UVPD spectra are probed as a/x and give
# more complement pairs than the same probe read as b/y.
probe_pairs() {  # <name>: the probe's pair count from its stderr line
  sed -n 's/^Complement tolerance (auto): .* confident tags, \([0-9]*\) pairs within .*/\1/p' "$TMP/$1.err"
}
runb ct_by "$TMP/syn_uvpd.mzML" 2 -ion_series by -complement_tolerance_unit auto
runb ct_ax "$TMP/syn_uvpd.mzML" 2 -ion_series ax -complement_tolerance_unit auto
runb ct_ph "$TMP/syn_uvpd.mzML" 2 -ion_series auto -ion_series_photo ax -complement_tolerance_unit auto
pb=$(probe_pairs ct_by); pa=$(probe_pairs ct_ax); pp=$(probe_pairs ct_ph)
[ -n "$pb" ] && [ -n "$pa" ] && [ -n "$pp" ] || { cat "$TMP/ct_ax.err" >&2; fail "compltol auto: no probe line"; }
[ "$pa" -gt "$pb" ] || fail "compltol auto: the a/x probe has no more pairs ($pa) than the b/y probe ($pb); a/x spectra probed as b/y?"
[ "$pp" = "$pa" ] || fail "compltol auto: auto + photo ax probe pairs ($pp) differ from ax ($pa)"

# ---- -species counts b/y tags only ----
if [ -n "$BUILDTAXDB" ] && [ -n "$TAXDIR" ]; then
  mkdir -p "$TMP/prot"
  awk '/^>/ { if (s != "") print s; print; s = ""; next } { s = s $0 } END { if (s != "") print s }' "$DB" > "$TMP/prot/562.fasta"
  "$BUILDTAXDB" "$TMP/prot" "$TMP/toy.taxdb" 7 > "$TMP/buildtaxdb.log" 2>&1 || { cat "$TMP/buildtaxdb.log" >&2; fail "buildtaxdb"; }
  SP=(-tag_length 5 -extension 1 -fragment_tolerance 20 -fragment_tolerance_unit ppm -species -taxdb "$TMP/toy.taxdb"
      -taxonomy_nodes "$TAXDIR/nodes.dmp" -taxonomy_names "$TAXDIR/names.dmp")
  runb sp_ax "$TMP/syn_uvpd.mzML" 2 -ion_series ax "${SP[@]}"
  rows=$(($(wc -l < "$TMP/sp_ax.tsv") - 1))
  [ "$rows" -gt 0 ] || fail "species: no a/x rows"
  grep -q "^Ion series: $rows tag rows read as a/x ions were left out of -species" "$TMP/sp_ax.err" \
    || { grep 'species' "$TMP/sp_ax.err" >&2; fail "species: the exclusion count is not the a/x row count ($rows)"; }
fi
echo "ax_cli_test: all checks passed"
