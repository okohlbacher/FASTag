#!/usr/bin/env bash
# 1.13 (#24): the shipped -alkylation_proteome proteomes (data/alkylation).
#  (a) the manifest proteomes.tsv matches the files: the four names, one
#      UniProt release, the sha256 of each .fasta.gz and of its FASTA, the
#      number of entries, every header's OX= the manifest's taxon, a known
#      protein per proteome, and README.md quotes every sha256;
#  (b) every name (auto, human, mouse, yeast, ecoli) resolves through the
#      digest directory (share/FASTag/digest -> share/FASTag/alkylation) and
#      exits 0 with database_source bundled:<name> and the manifest's
#      database_release row; the tag TSV is the one without -alkylation_out;
#  (c) the flat release layout (share-FASTag-digest -> share-FASTag-alkylation);
#  (d) refusals: a file whose FASTA sha256 differs from the manifest's
#      fasta_sha256 (truncated, or the same entries with one residue changed;
#      a recompressed but unchanged file is accepted), a file whose entry count
#      differs, and a manifest without a valid row stop with exit 3
#      (INPUT_FILE_CORRUPT) before any output is written; a manifest naming a
#      missing file stops with exit 6.
#  At -tag_length 4 nothing places on a shipped proteome: the report's reason
#  is tags_too_short with a min_tag_length row, and the log warns; at the
#  derived minimum (7 on E. coli) tags place and neither appears.
# Exits 77 (ctest SKIP) when the binary cannot start.
set -u
BIN="$1"
IN="$2"
DIGEST="$3"   # data/digest
ALK="$4"      # data/alkylation

if ! "$BIN" --help > /dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
unset FASTAG_FULL_PRECISION FASTAG_ALKYLATION_DIR
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-proteomes-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
sha() { if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
val() { tr -d '\r' < "$1" | awk -F'\t' -v s="$2" -v k="$3" '$1 == s && $2 == k { print $3; exit }'; }
# man NAME COLUMN: the manifest's value
man() { awk -F'\t' -v n="$1" -v c="$2" 'NR == 1 { for (i = 1; i <= NF; ++i) col[$i] = i; next } $1 == n { print $col[c] }' "$ALK/proteomes.tsv"; }
command -v gzip > /dev/null 2>&1 || { echo "SKIP: no gzip" >&2; exit 77; }

# ---- (a) manifest against the files
[ -s "$ALK/proteomes.tsv" ] || fail "no $ALK/proteomes.tsv"
[ -s "$ALK/README.md" ] || fail "no $ALK/README.md"
[ "$(head -1 "$ALK/proteomes.tsv")" = "$(printf 'name\tproteome\ttaxon\trelease\trelease_date\tentries\tsha256\tfasta_sha256\tfile')" ] \
  || fail "manifest header"
[ "$(awk -F'\t' 'NR > 1 { printf "%s ", $1 }' "$ALK/proteomes.tsv")" = "human mouse yeast ecoli " ] || fail "manifest names"
[ "$(awk -F'\t' 'NR > 1 { print $4 }' "$ALK/proteomes.tsv" | sort -u | wc -l | tr -d ' ')" = 1 ] || fail "more than one UniProt release"
grep -q "CC BY 4.0" "$ALK/README.md" || fail "README has no licence notice"
grep -q "$(man human release)" "$ALK/README.md" || fail "README does not name the release"
for name in human mouse yeast ecoli; do
  f="$ALK/$(man $name file)"
  [ "$(man $name file)" = "$name.fasta.gz" ] || fail "$name: file $(man $name file)"
  [ -s "$f" ] || fail "$name: no $f"
  [ "$(sha "$f")" = "$(man $name sha256)" ] || fail "$name: sha256 of $f is $(sha "$f"), the manifest says $(man $name sha256)"
  grep -q "$(man $name sha256)  $name.fasta.gz" "$ALK/README.md" || fail "$name: README does not quote the sha256"
  gzip -dc "$f" > "$TMP/$name.fasta" || fail "$name: not gzip"
  [ "$(sha "$TMP/$name.fasta")" = "$(man $name fasta_sha256)" ] || fail "$name: fasta_sha256"
  [ "$(grep -c '^>' "$TMP/$name.fasta")" = "$(man $name entries)" ] || fail "$name: entries"
  [ "$(man $name entries)" -gt 4000 ] || fail "$name: only $(man $name entries) entries"
  # reviewed entries only, all of the manifest's taxon
  bad=$(grep '^>' "$TMP/$name.fasta" | grep -v -c -e "^>sp|.* OX=$(man $name taxon) ")
  [ "$bad" = 0 ] || fail "$name: $bad headers are not reviewed entries of taxon $(man $name taxon)"
done
grep -q '^>sp|P04637|P53_HUMAN ' "$TMP/human.fasta" || fail "human: no P04637 (P53_HUMAN)"
grep -q '^>sp|P02340|P53_MOUSE ' "$TMP/mouse.fasta" || fail "mouse: no P02340 (P53_MOUSE)"
grep -q '^>sp|P00330|ADH1_YEAST ' "$TMP/yeast.fasta" || fail "yeast: no P00330 (ADH1_YEAST)"
grep -q '^>sp|P0A7G6|RECA_ECOLI ' "$TMP/ecoli.fasta" || fail "ecoli: no P0A7G6 (RECA_ECOLI)"
[ "$(man human proteome) $(man mouse proteome) $(man yeast proteome) $(man ecoli proteome)" \
  = "UP000005640 UP000000589 UP000002311 UP000000625" ] || fail "proteome ids"
echo "proteomes_cli_test: manifest matches the four files (UniProt $(man human release))"

# ---- (b) every name, installed layout share/FASTag/{digest,alkylation}
COMMON=(-in "$IN" -tag_length 4 -fragment_tolerance 0.5 -fragment_tolerance_unit Da -threads 2)
"$BIN" "${COMMON[@]}" -out "$TMP/base.tsv" > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "base run"; }
mkdir -p "$TMP/inst/share/FASTag"
cp -R "$DIGEST" "$TMP/inst/share/FASTag/digest"
cp -R "$ALK" "$TMP/inst/share/FASTag/alkylation"
for prot in default auto human mouse yeast ecoli; do
  want=$prot; { [ "$want" = default ] || [ "$want" = auto ]; } && want=human
  # ${args[@]+...}: bash 3.2 (macOS) treats an empty array as unset under set -u
  args=(); [ "$prot" = default ] || args=(-alkylation_proteome "$prot")
  FASTAG_DIGEST_DIR="$TMP/inst/share/FASTag/digest" "$BIN" "${COMMON[@]}" -out "$TMP/$prot.tsv" \
    -alkylation_out "$TMP/$prot.alk.tsv" ${args[@]+"${args[@]}"} > "$TMP/log" 2>&1
  rc=$?
  [ "$rc" = 0 ] || { cat "$TMP/log" >&2; fail "-alkylation_proteome $prot: exit $rc"; }
  [ "$(val "$TMP/$prot.alk.tsv" alk_run database_source)" = "bundled:$want" ] || fail "$prot: database_source"
  # suffix only: on Windows/MSYS the binary reports the C:/ spelling of $TMP
  case "$(val "$TMP/$prot.alk.tsv" alk_run database)" in */inst/share/FASTag/alkylation/$want.fasta.gz) ;; *) false ;; esac \
    || fail "$prot: database $(val "$TMP/$prot.alk.tsv" alk_run database)"
  rel="UniProt $(man $want release) $(man $want proteome) (taxon $(man $want taxon), reviewed, $(man $want entries) entries, FASTA sha256 $(man $want fasta_sha256))"
  [ "$(val "$TMP/$prot.alk.tsv" alk_run database_release)" = "$rel" ] \
    || fail "$prot: database_release '$(val "$TMP/$prot.alk.tsv" alk_run database_release)', want '$rel'"
  tr -d '\r' < "$TMP/$prot.alk.tsv" | awk -F'\t' 'NF != 5 || $5 == "" { bad = 1 } END { exit bad }' || fail "$prot: a malformed row"
  [ "$(val "$TMP/$prot.alk.tsv" alk_run tags)" -gt 0 ] || fail "$prot: no tag looked at"
  cmp -s "$TMP/base.tsv" "$TMP/$prot.tsv" || fail "$prot: -alkylation_out changed the tag TSV"
  # the placements are on the whole shipped proteome: the index holds its entries
  grep -q "^Recon index: $(man $want entries) proteins, " "$TMP/log" \
    || { grep "Recon index" "$TMP/log" >&2; fail "$prot: the placement index is not the $(man $want entries) entries of $want"; }
  # 1.13 (#24) review: at -tag_length 4 no tag reaches the derived minimum on a
  # proteome-scale database, so the no_call says why (tags_too_short, not
  # few_cys_spectra), the min_tag_length row says what to give, and the log warns
  mt=$(val "$TMP/$prot.alk.tsv" alk_run min_tag_length)
  [ "${mt:-0}" -gt 4 ] 2> /dev/null || fail "$prot: min_tag_length '$mt', want the derived minimum above 4"
  [ "$(tr -d '\r' < "$TMP/$prot.alk.tsv" | awk -F'\t' '$1 == "alk_run" && $2 == "min_tag_length" { print $4 }')" = 4 ] \
    || fail "$prot: min_tag_length does not name the longest tag (4)"
  [ "$(val "$TMP/$prot.alk.tsv" alkylation_call reason)" = tags_too_short ] \
    || fail "$prot: reason '$(val "$TMP/$prot.alk.tsv" alkylation_call reason)', want tags_too_short"
  grep -q -- "this run's longest tag has 4 .*Give -tag_length $mt or more" "$TMP/log" \
    || { cat "$TMP/log" >&2; fail "$prot: no warning that the tags are too short"; }
  echo "proteomes_cli_test: $prot -> bundled:$want ($(man $want entries) entries, tags place from $mt)"
done
cnt() { tr -d '\r' < "$1" | awk -F'\t' '$1 == "alk_cys" { printf "%s=%s/%s ", $2, $3, $4 }'; }
cmp -s "$TMP/auto.alk.tsv" "$TMP/human.alk.tsv" || fail "auto is not human"
cmp -s "$TMP/default.alk.tsv" "$TMP/human.alk.tsv" || fail "the default is not human"

# ---- (c) the flat release layout, and FASTAG_ALKYLATION_DIR
mkdir -p "$TMP/flat"
cp -R "$DIGEST" "$TMP/flat/share-FASTag-digest"
cp -R "$ALK" "$TMP/flat/share-FASTag-alkylation"
FASTAG_DIGEST_DIR="$TMP/flat/share-FASTag-digest" "$BIN" "${COMMON[@]}" -out "$TMP/f.tsv" \
  -alkylation_out "$TMP/f.alk.tsv" -alkylation_proteome yeast > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "flat layout"; }
case "$(val "$TMP/f.alk.tsv" alk_run database)" in */flat/share-FASTag-alkylation/yeast.fasta.gz) ;; *) fail "flat: database";; esac
FASTAG_ALKYLATION_DIR="$ALK" "$BIN" "${COMMON[@]}" -out "$TMP/e.tsv" \
  -alkylation_out "$TMP/e.alk.tsv" -alkylation_proteome ecoli > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTAG_ALKYLATION_DIR"; }
[ "$(val "$TMP/e.alk.tsv" alk_run database_source)" = bundled:ecoli ] || fail "FASTAG_ALKYLATION_DIR: database_source"
grep -v -e '^alk_run	database	' "$TMP/e.alk.tsv" > "$TMP/e.cmp"
grep -v -e '^alk_run	database	' "$TMP/ecoli.alk.tsv" > "$TMP/ecoli.cmp"
cmp -s "$TMP/e.cmp" "$TMP/ecoli.cmp" || fail "FASTAG_ALKYLATION_DIR and the installed layout differ beyond the path"
# a FASTA path gives no database_release row (1.12 behaviour)
"$BIN" "${COMMON[@]}" -out "$TMP/p.tsv" -alkylation_out "$TMP/p.alk.tsv" -alkylation_proteome "$TMP/ecoli.fasta" \
  > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "FASTA path"; }
[ "$(val "$TMP/p.alk.tsv" alk_run database_source)" = proteome ] || fail "FASTA path: database_source"
tr -d '\r' < "$TMP/p.alk.tsv" | cut -f2 | grep -qx database_release && fail "FASTA path: a database_release row"
# the same proteome as a FASTA path gives the same counts as the shipped name
[ "$(cnt "$TMP/p.alk.tsv")" = "$(cnt "$TMP/ecoli.alk.tsv")" ] || fail "the shipped ecoli and its FASTA give different counts"
# ...also where tags place: at -tag_length 7 (the derived minimum on E. coli;
# shorter tags place nothing on a proteome-scale database) the fixture's tags
# have placements, and the shipped name and the FASTA path count the same
L7=(-in "$IN" -tag_length 7 -fragment_tolerance 0.5 -fragment_tolerance_unit Da -threads 2)
FASTAG_DIGEST_DIR="$TMP/inst/share/FASTag/digest" "$BIN" "${L7[@]}" -out "$TMP/s7.tsv" -alkylation_out "$TMP/s7.alk.tsv" \
  -alkylation_proteome ecoli > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "shipped ecoli at tag length 7"; }
"$BIN" "${L7[@]}" -out "$TMP/p7.tsv" -alkylation_out "$TMP/p7.alk.tsv" -alkylation_proteome "$TMP/ecoli.fasta" \
  > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "ecoli FASTA at tag length 7"; }
placed=$(tr -d '\r' < "$TMP/s7.alk.tsv" | awk -F'\t' '$1 == "alk_cys" && $2 == "excluded.no_cys" { print $4 }')
[ "${placed:-0}" -gt 0 ] || fail "tag length 7: no placement on the shipped ecoli; the equality check would be vacuous"
[ "$(cnt "$TMP/s7.alk.tsv")" = "$(cnt "$TMP/p7.alk.tsv")" ] || fail "tag length 7: the shipped ecoli and its FASTA give different counts"
[ "$(val "$TMP/s7.alk.tsv" alk_run spectra)" = "$(val "$TMP/p7.alk.tsv" alk_run spectra)" ] || fail "tag length 7: spectra differ"
[ "$(val "$TMP/s7.alk.tsv" alk_run min_tag_length)" = 7 ] || fail "tag length 7: min_tag_length $(val "$TMP/s7.alk.tsv" alk_run min_tag_length), want 7"
[ "$(val "$TMP/s7.alk.tsv" alkylation_call reason)" != tags_too_short ] || fail "tag length 7: tags_too_short although tags place"
grep -q "no tag will place" "$TMP/log" && fail "tag length 7: the too-short warning although tags place"
# a FASTA path keeps the 1.12 report: no min_tag_length row, the 1.12 reason
tr -d '\r' < "$TMP/p.alk.tsv" | cut -f2 | grep -qx min_tag_length && fail "FASTA path: a min_tag_length row"
[ "$(val "$TMP/p.alk.tsv" alkylation_call reason)" = few_cys_spectra ] || fail "FASTA path: reason changed"

# ---- (d) refusals
refused() {  # DIR NAME WANT_RC MESSAGE
  printf 'sentinel\n' > "$TMP/r.tsv"
  FASTAG_ALKYLATION_DIR="$1" "$BIN" "${COMMON[@]}" -out "$TMP/r.tsv" -alkylation_out "$TMP/r.alk.tsv" \
    -alkylation_proteome "$2" > "$TMP/log" 2>&1
  rc=$?
  [ "$rc" = "$3" ] || { cat "$TMP/log" >&2; fail "$1 $2: exit $rc, want $3"; }
  grep -q -- "$4" "$TMP/log" || { cat "$TMP/log" >&2; fail "$1 $2: no message '$4'"; }
  { [ ! -e "$TMP/r.alk.tsv" ] && [ ! -e "$TMP/r.alk.tsv.part" ]; } || fail "$1 $2: -alkylation_out written"
  [ "$(tr -d '\r' < "$TMP/r.tsv")" = sentinel ] || fail "$1 $2: -out written"
}
mkdir -p "$TMP/trunc" "$TMP/badman" "$TMP/missing"
cp "$ALK/proteomes.tsv" "$TMP/trunc/"
awk '/^>/ { ++n } n <= 100' "$TMP/yeast.fasta" | gzip -n -c > "$TMP/trunc/yeast.fasta.gz"
# the sha256 is checked first: a truncated file, and a file of the same
# entries with one residue changed (the entry count alone passes it)
gzsha() { gzip -dc "$1" > "$TMP/gzsha.fasta" && sha "$TMP/gzsha.fasta"; }
refused "$TMP/trunc" yeast 3 "reads as a FASTA with sha256 $(gzsha "$TMP/trunc/yeast.fasta.gz"), its proteomes.tsv records $(man yeast fasta_sha256)"
mkdir -p "$TMP/edit"
cp "$ALK/proteomes.tsv" "$TMP/edit/"
awk 'done || /^>/ { print; next } { sub(/^./, $0 ~ /^W/ ? "Y" : "W"); print; done = 1 }' "$TMP/yeast.fasta" | gzip -n -c > "$TMP/edit/yeast.fasta.gz"
[ "$(gzip -dc "$TMP/edit/yeast.fasta.gz" | grep -c '^>')" = "$(man yeast entries)" ] || fail "edited yeast: entry count changed"
cmp -s <(gzip -dc "$TMP/edit/yeast.fasta.gz") "$TMP/yeast.fasta" && fail "edited yeast: not edited"
refused "$TMP/edit" yeast 3 "reads as a FASTA with sha256 $(gzsha "$TMP/edit/yeast.fasta.gz"), its proteomes.tsv records"
# a recompressed but unchanged file is the same FASTA: accepted
mkdir -p "$TMP/regz"
cp "$ALK/proteomes.tsv" "$TMP/regz/"
gzip -1 -c "$TMP/yeast.fasta" > "$TMP/regz/yeast.fasta.gz"
cmp -s "$TMP/regz/yeast.fasta.gz" "$ALK/yeast.fasta.gz" && fail "recompressed yeast: same bytes as shipped"
FASTAG_ALKYLATION_DIR="$TMP/regz" "$BIN" "${COMMON[@]}" -out "$TMP/rz.tsv" -alkylation_out "$TMP/rz.alk.tsv" \
  -alkylation_proteome yeast > "$TMP/log" 2>&1 || { cat "$TMP/log" >&2; fail "recompressed yeast refused"; }
# the entry count is still checked: a manifest whose sha256 matches the file but not its entries
awk -F'\t' -v h="$(gzsha "$TMP/trunc/yeast.fasta.gz")" 'BEGIN { OFS = "\t" } NR > 1 && $1 == "yeast" { $8 = h } 1' \
  "$ALK/proteomes.tsv" > "$TMP/trunc/proteomes.tsv"
refused "$TMP/trunc" yeast 3 "holds 100 entries, its proteomes.tsv records $(man yeast entries)"
awk -F'\t' 'BEGIN { OFS = "\t" } NR > 1 && $1 == "yeast" { $8 = "ab" } 1' "$ALK/proteomes.tsv" > "$TMP/edit/proteomes.tsv"
refused "$TMP/edit" yeast 3 "has no valid row for the yeast proteome"
awk -F'\t' 'NR == 1 || $1 != "mouse"' "$ALK/proteomes.tsv" > "$TMP/badman/proteomes.tsv"
cp "$ALK/mouse.fasta.gz" "$TMP/badman/"
refused "$TMP/badman" mouse 3 "has no valid row for the mouse proteome"
awk -F'\t' 'BEGIN { OFS = "\t" } NR > 1 && $1 == "ecoli" { $6 = "many" } 1' "$ALK/proteomes.tsv" > "$TMP/badman/proteomes.tsv"
refused "$TMP/badman" ecoli 3 "has no valid row for the ecoli proteome"
cp "$ALK/proteomes.tsv" "$TMP/missing/"
refused "$TMP/missing" human 6 "no shipped human proteome found"

echo "proteomes_cli_test: all checks passed"
