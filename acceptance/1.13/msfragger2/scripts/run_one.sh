#!/usr/bin/env bash
# One run of the second msfragger held-out test: FASTag export, then MSFragger arms a, aE, b, bE, c, a0 (sequential).
# First-test run_one.sh with three changes: H, the four recipe options in the FASTag command, the added arm a0.
# usage: run_one.sh <run_id> <mzML> <outdir>     (outdir must not exist; nothing is rerun)
set -u
H=/scratch/kohlbach/post1131/msfragger/heldout2
S=$(dirname "$(readlink -f "$0")")
JAR=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
DB=$H/db/human.fasta            # shipped UP000005640 (reviewed), uncompressed
PB=$H/db/closed_b.params        # MSFragger --config closed + the three plumbing edits (make_b_params.sh)
T=32
run=$1; mz=$(readlink -f "$2"); out=$3
[ -e "$out" ] && { echo "$out exists; no rerun" >&2; exit 9; }
mkdir -p "$out"/{fastag,a,b,aE,bE,c,fastag0,a0}
out=$(readlink -f "$out")
tm() { local lab=$1; shift; /usr/bin/time -v -o "$out/$lab.time" "$@" > "$out/$lab.log" 2>&1; echo $? > "$out/$lab.rc"; }
frag() { # <arm> <params>: MSFragger on a per-arm symlink of the mzML (outputs land beside the symlink)
  ln -s "$mz" "$out/$1/$run.mzML"
  (cd "$out/$1" && tm "$1" java -Xmx64g -jar "$JAR" "$2" "$out/$1/$run.mzML")
}

# FASTag: first-test shortlist options with the recipe (-shortlist_max_evalue 10 -shortlist_gapped
# -recon_min_length 6 -recon_missed_cleavages 2) + -search_engine msfragger, all export options at defaults
(cd "$out/fastag" && tm fastag "$H/opt/fastag" -in "$mz" -out tags.tsv -recon_fasta "$DB" \
   -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" \
   -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_max_evalue 10 -shortlist_min_spectra 1 \
   -shortlist_parsimony none -shortlist_top 0 -shortlist_gapped -recon_min_length 6 -recon_missed_cleavages 2 \
   -search_config_out fragger.params -search_engine msfragger -threads $T)
if [ "$(cat "$out/fastag.rc")" != 0 ] || [ ! -s "$out/fastag/red.fasta" ] || [ ! -s "$out/fastag/fragger.params" ]; then
  echo "fastag failed or exported nothing" > "$out/FAILED_fastag"
else
  (cd "$out/fastag" && sha256sum fragger.params red.fasta > "$out/export.sha256.before")
  # arm a: exported files, unedited, run from the directory FASTag wrote them to
  ln -s "$mz" "$out/a/$run.mzML"
  (cd "$out/fastag" && tm a java -Xmx64g -jar "$JAR" fragger.params "$out/a/$run.mzML")
  (cd "$out/fastag" && sha256sum fragger.params red.fasta > "$out/export.sha256.after")
  # arm aE: the exported parameters, database_name alone changed to the entrapment copy of the exported targets
  python3 "$S/mkdb.py" --entrap "$out/aE/db.fasta" "$out/fastag/red.fasta" > "$out/aE/mkdb.txt"
  sed "s|^database_name = .*|database_name = $out/aE/db.fasta|" "$out/fastag/fragger.params" > "$out/aE/fragger.params"
  frag aE "$out/aE/fragger.params"
fi
# arm b: full proteome + reversed decoys, MSFragger default closed parameters
python3 "$S/mkdb.py" "$out/b/db.fasta" "$DB" > "$out/b/mkdb.txt"
sed "s|^database_name = .*|database_name = $out/b/db.fasta|" "$PB" > "$out/b/fragger.params"
frag b "$out/b/fragger.params"
# arm bE: as b with the entrapment copy of the full proteome
python3 "$S/mkdb.py" --entrap "$out/bE/db.fasta" "$DB" > "$out/bE/mkdb.txt"
sed "s|^database_name = .*|database_name = $out/bE/db.fasta|" "$PB" > "$out/bE/fragger.params"
frag bE "$out/bE/fragger.params"
# arm c (informational, no verdict): the exported parameters on the full proteome (database_name alone changed)
if [ ! -e "$out/FAILED_fastag" ]; then
  cp "$out/b/db.fasta" "$out/c/db.fasta"
  sed "s|^database_name = .*|database_name = $out/c/db.fasta|" "$out/fastag/fragger.params" > "$out/c/fragger.params"
  frag c "$out/c/fragger.params"
fi
# arm a0 (informational, no verdict): default shortlist (the first test's options, no recipe), default export
(cd "$out/fastag0" && tm fastag0 "$H/opt/fastag" -in "$mz" -out tags.tsv -recon_fasta "$DB" \
   -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" \
   -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_max_evalue 1 -shortlist_min_spectra 1 \
   -shortlist_parsimony none -shortlist_top 0 \
   -search_config_out fragger.params -search_engine msfragger -threads $T)
if [ "$(cat "$out/fastag0.rc")" = 0 ] && [ -s "$out/fastag0/red.fasta" ] && [ -s "$out/fastag0/fragger.params" ]; then
  ln -s "$mz" "$out/a0/$run.mzML"
  (cd "$out/fastag0" && tm a0 java -Xmx64g -jar "$JAR" fragger.params "$out/a0/$run.mzML")
fi
rm -f "$out"/*/*.pepindex "$out"/*/*.mzBIN* 2>/dev/null   # derived caches only
date -u +%FT%TZ > "$out/DONE"
