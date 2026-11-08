# item06 held-out (PREREG-item06.md amendment 1), manifest item06-H1-r2; sourced by the item06 jobs
FT=/pfs/10/project/bw26g016/fastag-1.12
. $FT/bin/fastag-env.sh
MAN=item06-H1-r2
S=$FT/src-ed0a7e0/acceptance/1.12          # git archive of acceptance/1.12 ed0a7e0
PY=$FT/envs/pyscore-np246-pd310/bin/python
row() { awk -F'\t' '$1=="#6"' $S/manifests/$MAN.tsv | sed -n "${1}p"; }
