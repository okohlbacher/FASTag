#!/usr/bin/env bash
# The FASTag 1.12 NEW gate cases (PLAN-INTEGRATION section 4.2), outside
# refs-1.10.0, on node data. Same digest format and PASS rule as the shared
# /ceph/ibmi/abi/oliver/fastag-gate/gate.sh, which stays unchanged: a case
# PASSes when every non-info line of its digest equals the reference.
#
#   gate_new_cases.sh <FASTag binary or wrapper> <outdir>    run, compare with $GATE_NEW_REFS
#   gate_new_cases.sh --refs <binary> <outdir>               run and (re)write $GATE_NEW_REFS
#   gate_new_cases.sh --stage                                copy inputs to $GATE_NEW_IN, verify sha256
#
# Cases (each added by its item; public PXD data only):
#   dia_refuse    #7  PXD006096 raw Orbitrap DIA (msconvert mzML): exit 11, the FASTAG_REFUSED
#                     line, and the sentinel at -out unchanged (nothing written)
#   pseudo_pass   #7  the DIAspeXtract 1.7.0 pseudo-DDA mzML of the same run: exit 0, and the
#                     tags equal to -acquisition_check off
#   profile_mzml  #9  PXD000865 (Q Exactive, TMT8, profile MS2), -pick_profile auto
#   charge_infer  #6  PXD003531 (Q Exactive DDA) with every precursor charge (MS:1000041)
#                     removed (a derived input, written by --stage), -unknown_charge infer
#                     -census: tags with the hypothesis columns and the census charge_used;
#                     info lines: the charge calls against the removed header charges
#   etd_auto      #15 PXD060724 (Orbitrap Fusion EThcD, chymotrypsin; the #15 development
#                     run), -ion_series auto: tags, the "Ion series" line, the hybrid
#                     warning, and whether the tags equal -ion_series by (EThcD is hybrid,
#                     which auto reads as b/y)
#   species_call  #1  the refs-1.10.0 species case (PXD003531) + -species_call decoy with
#                     the staged species_call.tsv: tags equal the species reference, the
#                     species report's first 8 columns, the appended call columns
#   chem_reports  #3  the refs-1.10.0 fasta_recon case (PXD014764) + -digest_out under
#                     -digest_models_version v2, -label_out (label_call rows) and
#                     -massgap_out: tags, recon and delta equal the fasta_recon reference
#   census_dda    #11 the refs-1.10.0 dda_default case (PXD003531) + -census: tags equal
#                     the dda_default reference; census and summary are new
#   census_recon  #11 the refs-1.10.0 fasta_recon case (PXD014764) + -census: tags, recon
#                     and delta equal the fasta_recon reference
# A "same_as <refs-1.10.0 case> <file> yes" line is compared like any other
# line; --refs refuses to write a reference in which it is not "yes".
# The references here are DEVELOPMENT references (tools/gate-1.12/refs-dev,
# written by the item's branch build and reviewed with it). They move into
# refs-1.12.0 only with the user's approval of that reference set.
#
# Environment: GATE_NEW_IN (default /scratch/kohlbach/gate-in-1.12),
# GATE_NEW_REFS (default tools/gate-1.12/refs-dev next to this script),
# GATE_IDENT_REFS (the refs-1.10.0 digests the same_as lines read, default
# /ceph/ibmi/abi/oliver/fastag-gate/refs-1.10.0),
# GATE_CASES or GATE_NEW_CASES (space-separated subset), GATE_THREADS (default 32).
set -u
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
IN_DIR=${GATE_NEW_IN:-/scratch/kohlbach/gate-in-1.12}
REFS=${GATE_NEW_REFS:-$HERE/gate-1.12/refs-dev}
IDENT_REFS=${GATE_IDENT_REFS:-/ceph/ibmi/abi/oliver/fastag-gate/refs-1.10.0}
THREADS=${GATE_THREADS:-32}
export OPENMS_TMPDIR=${OPENMS_TMPDIR:-/dev/shm/$USER-tmp}
export OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-1}
export OPENMS_DISABLE_UPDATE_CHECK=ON
mkdir -p "$OPENMS_TMPDIR"

ALL_CASES="dia_refuse pseudo_pass profile_mzml charge_infer etd_auto species_call chem_reports census_dda census_recon"
CASES=${GATE_CASES:-${GATE_NEW_CASES:-$ALL_CASES}}

PA=/ceph/ibmi/abi/oliver/prose-auto-20261029
# relative path under GATE_NEW_IN, persistent source (read only), sha256; tab-separated.
# A source strip_charge:<path> is derived by --stage: <path> without its
# precursor charge cvParams (MS:1000041); the mzML index goes stale, which the
# fast reader handles by scanning (as for the PXD003531 gate input itself).
# A source repo:<path> is a file of this source tree (path from its root), so
# a changed shipped table fails the sha256 check instead of moving a reference.
# The PXD003531, PXD014764, db/ and tax/ rows are the refs-1.10.0 gate inputs
# (fastag-gate/inputs.tsv and inputs.sha256), from the same persistent sources.
R1=PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01
R2=PXD014764/20190412_KEH_HF_SA_ANW_R11_100419_CNOT_R1_f008
TAXSRC=$PA/opt/FASTag/share-FASTag-taxonomy
INPUTS="PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML	$PA/bench2/mzml/PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML	1a27eee3b164ec355620a02a20860a7f49b2b900fe5a6cfc9fd14bc11d6b0d42
PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML	$PA/borg_ho_v9b/out/PXD006096/auto/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML	6020bd4eaa135083d9dbd4455e1d9b2b38cb1c29c1f0f72db3cfa0cdebab27da
PXD000865/0299_F1_R1_P77628B02_TMT8.mzML	/ceph/ibmi/abi/projects/proteomics/kuster_proteome/MZML/8/0299_F1_R1_P77628B02_TMT8.mzML	8ec0952126809c9516cb476f5a79287d1b26ce11dcf631a78d6342340c54441c
$R1.nocharge.mzML	strip_charge:$PA/valset_all/in/$R1.mzML	19d8ee3ffc40d98f1c05a145ab3909f77334e1da0afff9b4d8db6b6ab8cdccbd
PXD060724/Chymotrypsin_EThCD_WZ20spd_161224_1.mzML	$PA/bench2/mzml/PXD060724/Chymotrypsin_EThCD_WZ20spd_161224_1.mzML	119da2307db02cc5b9300a2ee7bcb014b99293c54d41dc8c071ee393c5f784ae
$R1.mzML	$PA/valset_all/in/$R1.mzML	2b1da22229a9d8e8d4cde05d889c3a74dedd68bb9f00f3bdd9d78d2a8d9ace4a
$R2.mzML	$PA/valset_all/in/$R2.mzML	7c95070d94c6b9167882dead65a815cb24c01fa0256264df3c954d1d7f09f0bd
db/Homo_sapiens.fasta	$PA/panel/Homo_sapiens.fasta	dffdff3807ec6eb7e752035b5475aaefa26d1b36e513e3344198d521a2169c42
tax/tax_k7.taxdb	$TAXSRC/tax_k7.taxdb	34427bba2c3ba3240805d4e5266443fcdc4708e0131eb96ea4dfbb4dda771a4f
tax/nodes.dmp	$TAXSRC/nodes.dmp	d20f4f5b38e195c1ad77beef1f82296b96bab18588808c9c7527730928cdcecf
tax/names.dmp	$TAXSRC/names.dmp	397b70d74a91a8e0b46eb68e46f8669296d90396d01a472a71f0c8585df7cb2b
params/species_call.tsv	repo:data/taxonomy/species_call.tsv	8aa40c29d3440d2bde29941dab85426c644c6aeac68487f1403fd653ce2723bf
digest/digest_models.tsv	repo:data/digest/digest_models.tsv	b486bbb2fc97c72192956c0cf1f64ddd5868570a61edb05953a98edc7bff7c36
digest/digest_models_v2.tsv	repo:data/digest/digest_models_v2.tsv	da18f58e28c6b91cd7391e6c5be665ad3e3052debae75d2fd62545b6615e8e6d
digest/digest_calibration.tsv	repo:data/digest/digest_calibration.tsv	45451faf70e8691a95d4f5593fa1013b90505d0118763b42ab6e3467ed7c6a77
digest/massgap_mods.tsv	repo:data/digest/massgap_mods.tsv	c1ec6f57718c4f9ea84a975d9ef35a34ca542fcfcc7026aa21ff50f109caa106"

TAX="tax/tax_k7.taxdb tax/nodes.dmp tax/names.dmp"
DIGEST="digest/digest_models.tsv digest/digest_models_v2.tsv digest/digest_calibration.tsv digest/massgap_mods.tsv"
define_case() { # sets PXD IN ARGS, EXTRA (further inputs under IN_DIR) and ENVS (VAR=value for the run)
  ARGS=(); EXTRA=""; ENVS=()
  # the refs-1.10.0 gate.sh arguments the 1.12 cases extend (gate.sh define_case)
  local species=(-extension 2 -species -taxdb "$IN_DIR/tax/tax_k7.taxdb" -taxonomy_nodes "$IN_DIR/tax/nodes.dmp"
                 -taxonomy_names "$IN_DIR/tax/names.dmp" -species_out species.tsv)
  local fasta_recon=(-extension 3 -fasta "$IN_DIR/db/Homo_sapiens.fasta" -recon_out recon.tsv -delta_out delta.tsv)
  case $1 in
    dia_refuse)   PXD=PXD006096; IN=PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.mzML ;;
    pseudo_pass)  PXD=PXD006096; IN=PXD006096/100815_MM_ABPP_H1993_DMSO_DIA1_new.pseudo.mzML ;;
    profile_mzml) PXD=PXD000865; IN=PXD000865/0299_F1_R1_P77628B02_TMT8.mzML
                  ARGS=(-pick_profile auto -fixed_modifications 'Carbamidomethyl (C)' 'TMT6plex (K)' 'TMT6plex (N-term)') ;;
    charge_infer) PXD=PXD003531; IN=PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.nocharge.mzML
                  ARGS=(-unknown_charge infer -census) ;;
    etd_auto)     PXD=PXD060724; IN=PXD060724/Chymotrypsin_EThCD_WZ20spd_161224_1.mzML
                  ARGS=(-ion_series auto) ;;
    species_call) PXD=PXD003531; IN=$R1.mzML; EXTRA="$TAX params/species_call.tsv"
                  ARGS=("${species[@]}" -species_call decoy -species_call_params "$IN_DIR/params/species_call.tsv") ;;
    chem_reports) PXD=PXD014764; IN=$R2.mzML; EXTRA="db/Homo_sapiens.fasta $DIGEST"
                  ENVS=("FASTAG_DIGEST_DIR=$IN_DIR/digest")
                  ARGS=("${fasta_recon[@]}" -digest_out digest.tsv -digest_models_version v2
                        -label_out label.tsv -massgap_out massgap.tsv) ;;
    census_dda)   PXD=PXD003531; IN=$R1.mzML
                  ARGS=(-census) ;;
    census_recon) PXD=PXD014764; IN=$R2.mzML; EXTRA="db/Homo_sapiens.fasta"
                  ARGS=("${fasta_recon[@]}" -census) ;;
    *) echo "unknown case $1" >&2; return 1 ;;
  esac
  IN=$IN_DIR/$IN
}

needed() { # the input paths the selected cases read
  local c x; for c in $CASES; do
    define_case "$c" 2>/dev/null || continue
    echo "${IN#$IN_DIR/}"; for x in $EXTRA; do echo "$x"; done
  done
}

# The wave-2 cases run the binary as "${RUN[@]}": without the FASTAG_*_DIR
# overrides of the caller's environment, and with the case's own ENVS.
set_run() { RUN=(env -u FASTAG_DIGEST_DIR -u FASTAG_TAXONOMY_DIR -u FASTAG_ALKYLATION_DIR ${ENVS[@]+"${ENVS[@]}"} "$BIN"); }

same_as() { # $1 refs-1.10.0 case, then files in the current directory: "same_as <case> <file> yes|no|noref"
  local rc=$1 f want; shift
  for f in "$@"; do
    want=$(awk -v f="$f" '$1 == "file" && $2 == f { print $3 }' "$IDENT_REFS/$rc.digest" 2>/dev/null)
    if [ -z "$want" ]; then echo "same_as $rc $f noref"
    elif [ -f "$f" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$want" ]; then echo "same_as $rc $f yes"
    else echo "same_as $rc $f no"; fi
  done
}

check_inputs() {
  local ok=0 rel src want need
  need=$(needed)
  while IFS=$'\t' read -r rel src want; do
    grep -qxF "$rel" <<< "$need" || continue
    [ -f "$IN_DIR/$rel" ] || { echo "missing $IN_DIR/$rel (gate_new_cases.sh --stage)"; ok=1; continue; }
    [ "$(sha256sum "$IN_DIR/$rel" | cut -d' ' -f1)" = "$want" ] || { echo "sha256 mismatch: $IN_DIR/$rel"; ok=1; }
  done <<< "$INPUTS"
  return $ok
}

stage() {
  local rel src want need
  need=$(needed)
  while IFS=$'\t' read -r rel src want; do
    grep -qxF "$rel" <<< "$need" || continue
    mkdir -p "$IN_DIR/$(dirname "$rel")"
    if [ ! -f "$IN_DIR/$rel" ]; then
      case $src in
        strip_charge:*) grep -v 'accession="MS:1000041"' "${src#strip_charge:}" > "$IN_DIR/$rel.tmp" \
                          && mv "$IN_DIR/$rel.tmp" "$IN_DIR/$rel" || return 1 ;;
        repo:*) cp "$HERE/../${src#repo:}" "$IN_DIR/$rel" || return 1 ;;
        *) cp "$src" "$IN_DIR/$rel" || return 1 ;;
      esac
    fi
  done <<< "$INPUTS"
  check_inputs && echo "inputs OK in $IN_DIR"
}

summary() { echo "summary $(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' "$1" || echo MISSING)"; }

digest_case() { # in the case directory; $1 = exit code (as gate.sh)
  local rc=$1 f
  echo "summary $(grep -m1 -E '^[0-9]+ MS2 spectra, [0-9]+ tags' run.log || echo MISSING)"
  echo "exit $rc"
  for f in $(ls | sort); do
    [ -d "$f" ] && continue  # a comparison run of the case (etd_auto by/)
    case $f in
      run.log|time.txt) ;;
      *.mzML)
        echo "mzml $f masked=$(sed -E -e 's/(name="completion time" value=")[^"]*"/\1MASKED"/' \
              -e 's/(<software id="so_dp_[^"]*" version=")[^"]*"/\1MASKED"/' "$f" | sha256sum | cut -d' ' -f1)" ;;
      *) echo "file $f $(sha256sum "$f" | cut -d' ' -f1)" ;;
    esac
  done
  # Not compared: what picking did, for the reader of a failing diff.
  echo "info $(grep -m1 -oE '^mzML: centroided [0-9]+ profile spectra on read.*' run.log || echo 'mzML: no centroiding line')"
}

run_case() { # $1 case, $2 case dir; writes the digest to stdout, sets rc and the time file
  local c=$1 d=$2 rc_off RUN; set_run
  case $c in
    dia_refuse) # #7: refused before any output opens
      printf 'sentinel\n' > "$d/tags.tsv"
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      echo "exit $rc"
      echo "refused $(grep -m1 '^FASTAG_REFUSED ' "$d/run.log" || echo MISSING)"
      echo "sentinel tags.tsv $(sha256sum "$d/tags.tsv" | cut -d' ' -f1)"
      echo "files $(cd "$d" && ls | grep -v -x -e run.log -e tags.tsv -e time.txt | tr '\n' ' ')"
      echo "advice $(grep -c 'DIAspeXtract -in ' "$d/run.log")"
      [ $rc = 11 ] && rc=0 ;;  # the expected outcome
    pseudo_pass) # #7: passes, tags equal to -acquisition_check off
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      mkdir -p "$d/off"
      ( cd "$d/off" && "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -acquisition_check off -threads "$THREADS" > run.log 2>&1 ); rc_off=$?
      summary "$d/run.log"
      echo "exit $rc"
      echo "acquisition $(grep -m1 -o '^Acquisition check: [^ ]*' "$d/run.log" || echo MISSING)"
      echo "file tags.tsv $(sha256sum "$d/tags.tsv" | cut -d' ' -f1)"
      if [ $rc_off = 0 ] && cmp -s "$d/tags.tsv" "$d/off/tags.tsv"; then echo "equals_off yes"; else echo "equals_off no"; fi ;;
    charge_infer) # #6: the default digest, plus the calls against the removed charges (info)
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      (cd "$d" && digest_case $rc)
      echo "info $(grep -m1 -o '[0-9]* of [0-9]* MS2 spectra carry no precursor charge; under .*charges;' "$d/run.log" || echo 'no -unknown_charge line')"
      local orig=$PA/valset_all/in/PXD003531/20130611_QE3_UPLC10_CFR_SA_OC_T_NO_03_01_01.mzML  # read only
      [ -f "$orig" ] && echo "info $(grep 'accession="MS:1000041"' "$orig" | sed -E 's/.*value="([0-9]+)".*/\1/' \
        | paste - <(awk -F'\t' 'NR > 1 { print $6 }' "$d/tags.census.tsv") \
        | awk '{ n++; if ($1 == $2) ok++ } END { printf "charge calls equal to the removed header charge: %d of %d", ok, n }')" ;;
    etd_auto) # #15: auto, plus the same run under by (EThcD is hybrid: auto reads it as b/y)
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "${RUN[@]}" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      mkdir -p "$d/by"
      ( cd "$d/by" && "${RUN[@]}" -in "$IN" -out tags.tsv -ion_series by -threads "$THREADS" > run.log 2>&1 ); rc_off=$?
      (cd "$d" && digest_case $rc)
      echo "series $(grep -m1 -o '^Ion series (-ion_series [a-z]*): .*' "$d/run.log" || echo MISSING)"
      echo "hybrid_warning $(grep -c 'Hybrid activation: ' "$d/run.log")"
      if [ $rc_off = 0 ] && cmp -s "$d/tags.tsv" "$d/by/tags.tsv"; then echo "equals_by yes"; else echo "equals_by no"; fi
      echo "info by run: exit $rc_off, $(grep -c 'Electron activation: ' "$d/by/run.log") electron-activation warning lines" ;;
    species_call) # #1: species + -species_call decoy; the forward report is a column prefix
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "${RUN[@]}" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      (cd "$d" && digest_case $rc && same_as species tags.tsv)
      echo "columns species.tsv $(head -n1 "$d/species.tsv" | tr '\t' ' ')"
      echo "cols1_8 species.tsv $(cut -f1-8 "$d/species.tsv" | sha256sum | cut -d' ' -f1)"
      local refsp=$IDENT_REFS/out/species/species.tsv  # the refs-1.10.0 output, when kept
      [ -f "$refsp" ] && { cmp -s <(cut -f1-8 "$d/species.tsv") <(cut -f1-8 "$refsp") \
        && echo "info cols1_8 species.tsv equal to refs-1.10.0 species.tsv: yes" \
        || echo "info cols1_8 species.tsv equal to refs-1.10.0 species.tsv: no"; }
      echo "info calls $(awk -F'\t' 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "call") c = i; next }
        c { n[$c]++ } END { for (k in n) printf "%s=%d ", k, n[k] }' "$d/species.tsv" | tr ' ' '\n' | sort | tr '\n' ' ')" ;;
    chem_reports|census_dda|census_recon) # #3, #11: the existing outputs stay the refs-1.10.0 ones
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "${RUN[@]}" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      case $c in
        census_dda) (cd "$d" && digest_case $rc && same_as dda_default tags.tsv) ;;
        *) (cd "$d" && digest_case $rc && same_as fasta_recon tags.tsv recon.tsv delta.tsv) ;;
      esac
      [ $c = chem_reports ] && for f in digest label massgap; do
        echo "info $f.tsv $(awk -F'\t' '$1 ~ /call/ || $2 ~ /call/' "$d/$f.tsv" | head -n 3 | tr '\t\n' ' |')"
      done ;;
    *)
      ( cd "$d" && /usr/bin/time -f '%e %M' -o time.txt "$BIN" -in "$IN" -out tags.tsv "${ARGS[@]}" -threads "$THREADS" > run.log 2>&1 ); rc=$?
      (cd "$d" && digest_case $rc) ;;
  esac
}

mode=check
case ${1:-} in
  --refs) mode=refs; shift ;;
  --stage) stage; exit $? ;;
  ""|-h|--help) sed -n '2,/^set -u$/p' "$0" | sed '$d'; exit 2 ;;
esac
BIN=${1:?binary}
BIN=$(readlink -f "$BIN")
OUT=${2:?outdir}
mkdir -p "$OUT"; OUT=$(readlink -f "$OUT")
check_inputs || exit 1

VER=$("$BIN" --help 2>&1 | grep -m1 '^Version:')
{ echo "binary $BIN"; echo "sha256 $(sha256sum "$BIN" | cut -d' ' -f1)"
  [ -f "$(dirname "$BIN")/FASTag.bin" ] && echo "FASTag.bin sha256 $(sha256sum "$(dirname "$BIN")/FASTag.bin" | cut -d' ' -f1)"
  echo "$VER"; echo "digest python none pyarrow none (sha256sum and sed only)"
  echo "host $(hostname) threads $THREADS date $(date -Is)"; } > "$OUT/BINARY.txt"
echo "gate (1.12 new cases): $VER, $mode, out $OUT"

fails=""
for c in $CASES; do
  define_case "$c" || { fails="$fails $c"; continue; }
  d=$OUT/$c; rm -rf "$d"; mkdir -p "$d"
  rc=0
  run_case "$c" "$d" > "$OUT/$c.digest"
  read -r wall rss < <(tail -n1 "$d/time.txt")
  if [ $mode = refs ]; then
    [ $rc = 0 ] || { echo "$c: exit $rc, see $d/run.log"; fails="$fails $c"; continue; }
    if grep -qE '^same_as .* (no|noref)$' "$OUT/$c.digest"; then
      echo "$c: an output differs from refs-1.10.0 ($IDENT_REFS):"; grep -E '^same_as .* (no|noref)$' "$OUT/$c.digest" | sed 's/^/    /'
      fails="$fails $c"; continue
    fi
    echo "$c: ran (${wall}s, ${rss} KB)"
  else
    ref=$REFS/$c.digest
    if [ ! -f "$ref" ]; then status=NOREF
    elif diff -q <(grep -v '^info ' "$ref") <(grep -v '^info ' "$OUT/$c.digest") > /dev/null; then status=PASS
    else status=FAIL; fi
    [ $status = PASS ] || fails="$fails $c"
    echo "$c: $status (${wall}s)"
    [ $status = FAIL ] && diff <(grep -v '^info ' "$ref") <(grep -v '^info ' "$OUT/$c.digest") | sed 's/^/    /'
  fi
done

if [ $mode = refs ]; then
  [ -z "$fails" ] || { echo "refs NOT written, failing cases:$fails"; exit 1; }
  mkdir -p "$REFS"
  for c in $CASES; do cp "$OUT/$c.digest" "$REFS/"; cp "$OUT/BINARY.txt" "$REFS/BINARY.$c.txt"; done
  echo "refs written to $REFS for:$CASES"
  exit 0
fi
[ -z "$fails" ] && { echo "NEW CASES PASS ($(echo $CASES | wc -w) cases)"; exit 0; }
echo "NEW CASES FAIL:$fails"; exit 1
