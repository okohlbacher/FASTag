#!/bin/bash
# b113-ax DEV-2: PXD003109 OR7_20150805_KLF_Hela_3mJ_50ms_ (193 nm UVPD, HeLa, Q Exactive), TRFP mzML.
# MSFragger 4.4.1 a,b,x,y / a,x / b,y searches (human UniProt of the gate inputs + reversed decoys, 10 ppm
# precursor, 20 ppm fragment) and FASTag arms by, ax, auto + -ion_series_photo ax.
set -u
W=/scratch/kohlbach/b113/ax; D=$W/dev2; mkdir -p $D/params $D/truth $D/runs; stem=OR7_20150805_KLF_Hela_3mJ_50ms_
M=$W/data/PXD003109/$stem.mzML
J=/ceph/ibmi/abi/oliver/spextract/tools/MSFragger-4.4.1.jar; JAVA=/ceph/ibmi/abi/oliver/opt/jdk-21.0.12.1/bin/java
python3 - <<PY
src="/scratch/kohlbach/fastag112-rcb/in/db/Homo_sapiens.fasta"; out="$D/params/human.td.fasta"
e=[];h=None;s=[]
for l in open(src):
    l=l.rstrip("\n")
    if l.startswith(">"):
        if h: e.append((h,"".join(s)))
        h,s=l[1:],[]
    else: s.append(l.strip())
if h: e.append((h,"".join(s)))
with open(out,"w") as f:
    for h,q in e: f.write(f">{h}\n{q}\n")
    for h,q in e: f.write(f">rev_{h}\n{q[::-1]}\n")
t=open("$W/dev/params/msfragger_by.params").read()
t=t.replace("database_name = $W/dev/params/ecoli.td.fasta","database_name = $D/params/human.td.fasta").replace("fragment_mass_tolerance = 15","fragment_mass_tolerance = 20")
assert "human.td" in t and "fragment_mass_tolerance = 20" in t
for n,ser in (("by","b,y"),("abxy","a,b,x,y"),("ax","a,x")):
    open(f"$D/params/msfragger_{n}.params","w").write(t.replace("fragment_ion_series = b,y",f"fragment_ion_series = {ser}"))
print(len(e),"proteins")
PY
E=/ceph/ibmi/abi/oliver/envs/fastag-omsdev
export MAMBA_ROOT_PREFIX=$HOME/micromamba
eval "$(~/.local/bin/micromamba shell hook -s bash)"
micromamba activate $E
export TMPDIR=$W/tmp OPENMS_TMPDIR=$W/tmp
for arm in by ax ph; do
  case $arm in by) X=();; ax) X=(-ion_series ax);; ph) X=(-ion_series auto -ion_series_photo ax);; esac
  d=$D/runs/$arm/$stem; mkdir -p $d
  ( cd $d && $W/build/FASTag -in $M -out tags.tsv -threads 8 -fragment_tolerance 20 "${X[@]}" > run.log 2>&1; echo "FASTAG_RC=$?" >> run.log ) &
done
wait
grep -o 'accession="MS:100[0-9]*" name="[a-z -]*dissociation[a-z ]*"' $M | sort | uniq -c > $D/activation_terms.txt
grep -o 'name="filter string" value="[^"]*"' $M | sed 's/.*value="//; s/ [0-9.]*@/ X@/; s/\[.*//' | sort | uniq -c | sort -rn | head > $D/filter_strings.txt
for n in abxy ax by; do
  T=$D/truth/$stem/$n; mkdir -p $T; cd $T; ln -sf $M .; cp $D/params/msfragger_$n.params search.params
  $JAVA -Xmx32G -jar $J search.params $stem.mzML > fragger.log 2>&1; echo "FRAGGER_RC=$?" >> fragger.log; rm -f $stem.mzML
done
echo DONE > $D/DONE
