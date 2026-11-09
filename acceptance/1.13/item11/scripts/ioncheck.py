import re, sys, collections
sys.path.insert(0, "/scratch/kohlbach/b113/ax/src/acceptance/1.12/scorers"); sys.path.insert(0, "/scratch/kohlbach/b113/ax/src/acceptance/1.13/scorers")
import acclib as A
import score_item11 as SI
W="/scratch/kohlbach/b113/ax"
stem=sys.argv[1]
hcd=stem.replace("UVPD_recal_","Denoised_HCD_recal_",1)
t1=SI.fragger_psms(f"{W}/dev/truth/{hcd}/by/{hcd}.tsv")
# read UVPD peaks by scan
peaks={}; scan=None; cur=[]
for l in open(f"{W}/data/PXD018176/{stem}.mgf"):
    if l.startswith("BEGIN"): cur=[]; scan=None
    elif l.startswith("TITLE="): scan=int(re.search(r"scan=(\d+)",l).group(1))
    elif l.startswith("END"): peaks[scan]=sorted(cur)
    elif l[:1].isdigit(): a,b=l.split()[:2]; cur.append(float(a))
import bisect
P=1.00727646688; H=1.00782503; CO=27.99491462; CO2=43.98982924; H2O=18.0105647; NH3=17.02654911
off={"a":-CO,"a+1":-CO+H,"a+2":-CO+2*H,"b":0.0,"c":NH3,"x":CO2,"x+1":CO2+H,"x-1":CO2-H,"y":H2O,"y-1":H2O-H,"y-2":H2O-2*H,"z+1":H2O-NH3+H}
cnt=collections.Counter(); tot=collections.Counter(); n=0
for s,pep in zip(t1["scan"],t1["peptide"]):
    pk=peaks.get(s+1)
    if not pk: continue
    res,pref,total=A.S.peptide_masses(pep)
    if not pref: continue
    n+=1
    L=len(res)
    for name,o in off.items():
        nterm = name[0] in "abc"
        for i in range(1,L):
            m=(pref[i] if nterm else total-pref[i])+o+P
            j=bisect.bisect_left(pk,m-m*15e-6)
            tot[name]+=1
            if j<len(pk) and pk[j]<=m+m*15e-6: cnt[name]+=1
    if n>=2000: break
print(stem, "psms", n)
for k in off: print(f"{k:5s} {100*cnt[k]/tot[k]:6.2f}% of positions matched")
