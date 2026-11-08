# Round 4 jobs (DECISIONS-2026-11-08 round 4; PREREG-item02.md and PREREG-item06.md amendment 2). Sourced by every job.
FT=/pfs/10/project/bw26g016/fastag-1.12
. $FT/bin/fastag-env.sh
S=$FT/src-r4/acceptance/1.12              # git archive of the amendment commit (src-r4/COMMIT)
R2=$FT/acc112-item02                      # #2 FASTag outputs, timing and the round-3 truths (job 6472365)
PY=$FT/envs/pyscore-np246-pd310/bin/python   # Python 3.12.15, numpy 2.4.6, pandas 3.1.0
check_scorers() {   # the archive's scorer files must equal its SHA256SUMS (the PREREG amendment 2 values)
  ( cd $S/scorers && sha256sum -c --quiet SHA256SUMS ) || { echo "SCORER_SHA_MISMATCH"; exit 3; }
  echo "d3820543a31bfa2a556e04f91719204ce0ac6f34dcca6670314a13df87064625  $FASTAG_SAGE_BIN" | sha256sum -c --quiet - || exit 3
}
# #6 round 4 runs: manifest <TAB> manifest row number (1-based, '#6' rows) ; the high-resolution H2/H2r runs
I6=( "item06-H2	3" "item06-H2r	1" )      # PXD020394 (qe), PXD055983 (astral)
row6() { local m=${1%%	*} n=${1##*	}; awk -F'\t' '$1=="#6"' $S/manifests/$m.tsv | sed -n "${n}p"; }
