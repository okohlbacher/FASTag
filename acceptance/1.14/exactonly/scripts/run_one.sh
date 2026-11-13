#!/usr/bin/env bash
# One run of the -shortlist_exact_only held-out test (1.14): FASTag 1.13.4 exports (primary: exact-only; secondary:
# the gapped msfragger default), MSFragger 4.4.1 arms a, aE, b, bE, then g/{fastag,a,aE} (sequential).
# After acceptance/1.13/msfragger2/scripts/run_one.sh. Changes: H; 12 threads; the FASTag command leaves the four
# msfragger shortlist defaults ungiven and adds -shortlist_exact_only (primary); arm c and arm a0 dropped; secondary
# arm g = the same command without -shortlist_exact_only, laid out as a run directory of its own ($out/g, b linked)
# so that the unchanged scorer scores it.
# usage: run_one.sh <run_id> <mzML> <outdir>     (outdir must not exist; nothing is rerun)
set -u
H=/scratch/kohlbach/acc114/exactonly
S=$(dirname "$(readlink -f "$0")")
JAR=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
DB=$H/db/human.fasta            # shipped UP000005640 (reviewed), uncompressed; copy of the msfragger2 file
PB=$H/db/closed_b.params        # MSFragger --config closed + the three plumbing edits (make_b_params.sh, 12 threads)
T=12
run=$1; mz=$(readlink -f "$2"); out=$3
[ -e "$out" ] && { echo "$out exists; no rerun" >&2; exit 9; }
mkdir -p "$out"/{fastag,a,b,aE,bE} "$out"/g/{fastag,a,aE}
out=$(readlink -f "$out")
tm() { local lab=$1; shift; /usr/bin/time -v -o "$lab.time" "$@" > "$lab.log" 2>&1; echo $? > "$lab.rc"; }
# export <dir> [extra FASTag options]: FASTag in <dir>/fastag, MSFragger on the unedited export (arm a), arm aE
export_arms() {
  local d=$1; shift
  (cd "$d/fastag" && tm "$d/fastag" "$H/opt/fastag" -in "$mz" -out tags.tsv -recon_fasta "$DB" \
     -tag_length 4 -extension 6 -fixed_modifications "Carbamidomethyl (C)" -variable_modifications "Oxidation (M)" \
     -shortlist_out sl.tsv -fasta_out red.fasta -shortlist_min_spectra 1 -shortlist_parsimony none -shortlist_top 0 \
     "$@" -search_config_out fragger.params -search_engine msfragger -threads $T)
  if [ "$(cat "$d/fastag.rc")" != 0 ] || [ ! -s "$d/fastag/red.fasta" ] || [ ! -s "$d/fastag/fragger.params" ]; then
    echo "fastag failed or exported nothing" > "$d/FAILED_fastag"; return
  fi
  (cd "$d/fastag" && sha256sum fragger.params red.fasta > "$d/export.sha256.before")
  ln -s "$mz" "$d/a/$run.mzML"
  (cd "$d/fastag" && tm "$d/a" java -Xmx64g -jar "$JAR" fragger.params "$d/a/$run.mzML")
  (cd "$d/fastag" && sha256sum fragger.params red.fasta > "$d/export.sha256.after")
  python3 "$S/mkdb.py" --entrap "$d/aE/db.fasta" "$d/fastag/red.fasta" > "$d/aE/mkdb.txt"
  sed "s|^database_name = .*|database_name = $d/aE/db.fasta|" "$d/fastag/fragger.params" > "$d/aE/fragger.params"
  ln -s "$mz" "$d/aE/$run.mzML"
  (cd "$d/aE" && tm "$d/aE" java -Xmx64g -jar "$JAR" "$d/aE/fragger.params" "$d/aE/$run.mzML")
}
frag() { # <arm> <params>: MSFragger on a per-arm symlink of the mzML (outputs land beside the symlink)
  ln -s "$mz" "$out/$1/$run.mzML"
  (cd "$out/$1" && tm "$out/$1" java -Xmx64g -jar "$JAR" "$2" "$out/$1/$run.mzML")
}

# primary: -shortlist_exact_only, the other three msfragger shortlist defaults (-shortlist_max_evalue 10,
# -recon_min_length 6, -recon_missed_cleavages 2) applied by FASTag itself; all export options at defaults
export_arms "$out" -shortlist_exact_only
# arm b: full proteome + reversed decoys, MSFragger default closed parameters
python3 "$S/mkdb.py" "$out/b/db.fasta" "$DB" > "$out/b/mkdb.txt"
sed "s|^database_name = .*|database_name = $out/b/db.fasta|" "$PB" > "$out/b/fragger.params"
frag b "$out/b/fragger.params"
# arm bE (informational): as b with the entrapment copy of the full proteome
python3 "$S/mkdb.py" --entrap "$out/bE/db.fasta" "$DB" > "$out/bE/mkdb.txt"
sed "s|^database_name = .*|database_name = $out/bE/db.fasta|" "$PB" > "$out/bE/fragger.params"
frag bE "$out/bE/fragger.params"
# secondary arm g: the 1.13.4 msfragger default (gapped placement on), same command without -shortlist_exact_only
ln -s ../b "$out/g/b"; ln -s ../b.rc "$out/g/b.rc"; ln -s ../b.time "$out/g/b.time"
export_arms "$out/g"
rm -f "$out"/*/*.pepindex "$out"/*/*.mzBIN* "$out"/g/*/*.pepindex "$out"/g/*/*.mzBIN* 2>/dev/null   # derived caches only
date -u +%FT%TZ > "$out/DONE"
