#!/bin/bash
# PREREG-dha: MSFragger 4.4.1 open search on the held-out mzML, opensearch.sh's logic (freeze1):
# the same target + rev_ decoy database (regenerated and compared byte-wise with the dev copy),
# freeze1/open.params byte-identical (sha256 checked), one invocation over all runs.
# usage: heldout_msf.sh <run list> <mzML dir> <out dir> <freeze1 open.params>
set -uo pipefail
LIST=$1; MZ=$2; O=$3; PAR=$4
A=/ceph/ibmi/abi/dont-backup/pride/PXD045734; DB=/scratch/kohlbach/deep/opensearch/human_td.fasta
JAR=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar
JAVA=/ceph/ibmi/abi/oliver/opt/jdk-21.0.12.1/bin/java
mkdir -p $O
[ "$(sha256sum < $PAR | cut -d' ' -f1)" = e67b36ea70344542f79ee986ac3ab4e07bbfa29cf5026e3ebbcfc2813c2bc58a ] || { echo PARAMS_MISMATCH; exit 2; }
python3 - $A/raw/uniprot-human-22.fasta $O/human_td.check.fasta <<'PY'
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
cmp -s $O/human_td.check.fasta $DB || { echo DB_MISMATCH; exit 3; }
rm -f $O/human_td.check.fasta
cp $PAR $O/open.params
while read -r n; do ln -sf $MZ/$n.mzML $O/$n.mzML; done < $LIST
cd $O
/usr/bin/time -v -o $O/msf.time $JAVA -Xmx160G -jar $JAR $O/open.params $(sed "s#\$#.mzML#" $LIST) > $O/msf.log 2>&1
echo "MSF_RC=$?" >> $O/msf.log
rm -f $O/*_uncalibrated.mzBIN
date > $O/DONE
