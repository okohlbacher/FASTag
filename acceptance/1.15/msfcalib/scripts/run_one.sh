#!/usr/bin/env bash
# One run of the msfcalib held-out test (post-1.15): the candidate's MSFragger export (calibrate_mass 2) against the
# same export with calibrate_mass 0. Everything sequential, 32 threads, node data.
# After acceptance/1.13/msfragger2/scripts/run_one.sh and the development script pair_one.sh
# (/scratch/kohlbach/b115/msfcalib). Steps:
#   fastag   candidate FASTag, the third test's command (msfragger defaults applied by FASTag)
#   p0       arm 0 parameters: the export with the one line calibrate_mass = 2 -> 0
#   b        full search: closed_b.params (MSFragger closed defaults, 32 threads), human.fasta + rev_ decoys
#   aE0 aE2  entrapment: each arm's parameters, database_name alone -> targets of red.fasta + ENTRAP_ copy + rev_
#   a0_r1 a2_r1 a2_r2 a0_r2   the export arms (interleaved, mirrored); MSFragger run from the directory FASTag wrote
#            to, on the exported red.fasta; r1 is scored, r1 and r2 give the wall clock (median)
# Derived caches (*.pepindex beside the database, *.mzBIN* beside the mzML) are removed after every search, so no
# search reuses another's index.
# usage: run_one.sh <run_id> <mzML> <outdir>     (outdir must not exist; nothing is rerun)
set -u
H=/scratch/kohlbach/acc115/msfcalib
S=$(dirname "$(readlink -f "$0")")
JAR=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
DB=$H/db/human.fasta            # UP000005640 reviewed, copy of the msfragger2 file
PB=$H/db/closed_b.params        # copy of the msfragger2 file (num_threads = 32)
T=32
run=$1; mz=$(readlink -f "$2"); out=$3
[ -e "$out" ] && { echo "$out exists; no rerun" >&2; exit 9; }
mkdir -p "$out"/{fastag,p0,b,aE0,aE2,a0_r1,a2_r1,a2_r2,a0_r2}
out=$(readlink -f "$out")
tm() { local lab=$1; shift; /usr/bin/time -v -o "$out/$lab.time" "$@" > "$out/$lab.log" 2>&1; echo $? > "$out/$lab.rc"; }
clean() { rm -f "$out"/*.pepindex "$out"/*/*.pepindex "$out"/*/*.mzBIN* 2>/dev/null; }
# search <arm> <params> [<work dir>]: MSFragger on a per-arm symlink of the mzML (outputs land beside the symlink)
search() {
  ln -s "$mz" "$out/$1/$run.mzML"
  (cd "${3:-$out/$1}" && tm "$1" java -Xmx64g -jar "$JAR" "$2" "$out/$1/$run.mzML")
  clean
}

(cd "$out/fastag" && tm fastag "$H/opt/fastag" -in "$mz" -out tags.tsv -recon_fasta "$DB" \
   -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" \
   -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 \
   -search_config_out fragger.params -search_engine msfragger -threads $T)
grep -c "MSFragger export (development runs only, no held-out test): calibrate_mass 2" "$out/fastag.log" > "$out/calib_logline" 2>/dev/null
F=$out/fastag
if [ "$(cat "$out/fastag.rc")" != 0 ] || [ ! -s "$F/red.fasta" ] || [ ! -s "$F/fragger.params" ]; then
  echo "fastag failed or exported nothing" > "$out/FAILED_fastag"
else
  (cd "$F" && sha256sum fragger.params red.fasta > "$out/export.sha256.before")
  # arm 0 parameters: the one line calibrate_mass = 2 replaced, nothing else
  sed 's|^calibrate_mass = 2$|calibrate_mass = 0|' "$F/fragger.params" > "$out/p0/fragger.params"
  diff "$F/fragger.params" "$out/p0/fragger.params" > "$out/p0/params.diff"
  python3 "$S/mkdb.py" --entrap "$out/e.fasta" "$F/red.fasta" > "$out/e.txt"
fi
python3 "$S/mkdb.py" "$out/b.fasta" "$DB" > "$out/b.txt"
sed "s|^database_name = .*|database_name = $out/b.fasta|" "$PB" > "$out/b/fragger.params"
search b "$out/b/fragger.params"
if [ ! -e "$out/FAILED_fastag" ]; then
  sed "s|^database_name = .*|database_name = $out/e.fasta|" "$out/p0/fragger.params" > "$out/aE0/fragger.params"
  sed "s|^database_name = .*|database_name = $out/e.fasta|" "$F/fragger.params" > "$out/aE2/fragger.params"
  search aE0 "$out/aE0/fragger.params"
  search aE2 "$out/aE2/fragger.params"
  search a0_r1 "$out/p0/fragger.params" "$F"
  search a2_r1 "$F/fragger.params" "$F"
  search a2_r2 "$F/fragger.params" "$F"
  search a0_r2 "$out/p0/fragger.params" "$F"
  (cd "$F" && sha256sum fragger.params red.fasta > "$out/export.sha256.after")
fi
rm -f "$out/b.fasta" "$out/e.fasta"   # rebuilt deterministically by mkdb.py
date -u +%FT%TZ > "$out/DONE"
