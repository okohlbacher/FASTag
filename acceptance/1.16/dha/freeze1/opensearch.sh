#!/bin/bash
# Item 1 / acceptance B, development part: MSFragger 4.4.1 open search on the
# six PXD045734 donor-4068 runs (the FASTag dev runs). Target + reversed decoys
# (rev_), Carbamidomethyl (C) fixed, no variable modifications (every shift is
# a mass offset), precursor window -150..+500 Da, 20 ppm fragments, delta-mass
# localization on. FDR is computed afterwards (fdr_compare.py).
set -uo pipefail
B=/ceph/ibmi/abi/oliver/fastag-deepexam; A=/ceph/ibmi/abi/dont-backup/pride/PXD045734
W=/scratch/kohlbach/deep/opensearch; O=$B/item1-opensearch
JAR=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
JAVA=/ceph/ibmi/abi/oliver/opt/jdk-21.0.12.1/bin/java
mkdir -p $W $O
# Database: targets + reversed sequences (rev_ prefix).
python3 - $A/raw/uniprot-human-22.fasta $W/human_td.fasta <<'PY'
import sys
src, dst = sys.argv[1:]
ent, h, seq = [], None, []
for line in open(src):
    line = line.rstrip("\n")
    if line.startswith(">"):
        if h is not None: ent.append((h, "".join(seq)))
        h, seq = line[1:], []
    elif line: seq.append(line.strip())
if h is not None: ent.append((h, "".join(seq)))
with open(dst, "w") as f:
    for h, s in ent: f.write(">%s\n%s\n" % (h, s))
    for h, s in ent: f.write(">rev_%s\n%s\n" % (h.split()[0], s[::-1]))
print(len(ent), "targets +", len(ent), "decoys")
PY
cat > $W/open.params <<P
database_name = $W/human_td.fasta
decoy_prefix = rev_
num_threads = 48
precursor_mass_lower = -150
precursor_mass_upper = 500
precursor_mass_units = 0
precursor_true_tolerance = 20
precursor_true_units = 1
fragment_mass_tolerance = 20
fragment_mass_units = 1
calibrate_mass = 0
isotope_error = 0
localize_delta_mass = 1
delta_mass_exclude_ranges = (-0.5,0.5)
mass_diff_to_variable_mod = 0
search_enzyme_name_1 = trypsin
search_enzyme_cut_1 = KR
search_enzyme_nocut_1 = P
allowed_missed_cleavage_1 = 2
num_enzyme_termini = 2
digest_min_length = 7
digest_max_length = 50
digest_mass_range = 500.0 5000.0
max_variable_mods_per_peptide = 1
add_C_cysteine = 57.021464
precursor_charge = 2 4
override_charge = 0
output_format = tsv
output_report_topN = 1
output_max_expect = 50
minimum_peaks = 15
min_matched_fragments = 4
use_topN_peaks = 150
P
cd $W
for m in $A/mzML/ah_4068_ZW_032115_*_57yo.mzML; do ln -sf $m $W/$(basename $m); done
/usr/bin/time -v -o $W/msf.time $JAVA -Xmx160G -jar $JAR $W/open.params $W/ah_4068_ZW_032115_*_57yo.mzML > $W/msf.log 2>&1
echo "MSF_RC=$?" >> $W/msf.log
cp $W/open.params $W/msf.log $W/msf.time $W/*.tsv $O/ 2>/dev/null
date > $O/DONE
