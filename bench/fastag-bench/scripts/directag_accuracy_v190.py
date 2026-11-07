"""directag_accuracy_pxd000001_v190.tsv from tag_accuracy_topk_v190.tsv: PXD000001, Mascot truth,
flank rule, fastag_matched (FASTag 1.9.0) vs directag_matched (DirecTag 1.4.21142 run of the 1.8.0
harness pass, reused)."""
import io,sys,datetime as dt,pandas as pd
from pathlib import Path
R=Path(sys.argv[1])
def rd(p):
    t=Path(p).read_text().splitlines(True)
    return pd.read_csv(io.StringIO("".join(l for l in t if not l.startswith("#"))),sep="\t"),[l[1:].strip() for l in t if l.startswith("#")]
t,prov=rd(R/"tag_accuracy_topk_v190.tsv")
s,_=rd(R/"tag_accuracy_summary_v190.tsv")
t=t[(t.pxd=="PXD000001")&(t.truth=="mascot")&(t.rule=="flank")]
n=int(s[(s.pxd=="PXD000001")&(s.truth=="mascot")&(s.profile=="fastag_matched")&(s.rule=="flank")&(s.control=="none")].psm_spectra.iloc[0])
rows=[]
for k in (1,5,10,20,50):
    f=t[(t.profile=="fastag_matched")&(t.k==k)].iloc[0]; d=t[(t.profile=="directag_matched")&(t.k==k)].iloc[0]
    rows.append({"top_k":k,"fastag_spectra":int(f.spectra),"fastag_pct":round(100*f.spectra/n,2),
                 "directag_spectra":int(d.spectra),"directag_pct":round(100*d.spectra/n,2)})
part=[p for p in prov if "PXD000001" in p and "Mascot" in p]
now=dt.datetime.now().astimezone().isoformat(timespec="seconds")
head=[f"source: results/tag_accuracy_topk_v190.tsv (fastag-bench accuracy, scored {now}); profiles fastag_matched (FASTag 1.9.0, /ceph/ibmi/abi/oliver/opt/fastag-1.9.0/FASTag/FASTag, 'Version: 1.9.0 (OpenMS 3.7.0-pre-HEAD-2026-11-02)') and directag_matched (DirecTag 1.4.21142, output of the 1.8.0 harness pass on ibminode05 2026-11-03, reused, not re-run); host ibminode05",
      f"PXD000001, {n:,} Mascot F063721.dat PSMs at 1% FDR; valid = rule flank of fastag-bench (tag or reverse in peptide, I=L, one flanking mass within 0.05 Da, reversed flanks with the H2O offset); TL 3, 100 peaks, 50 tags, 0.02 Da, no gaps, no deisotoping (DirecTag: fragment/complement 0.02 Da, isotope 0.01 Da)",
      "differs from directag_accuracy_pxd000001.tsv (FASTag 1.2.x, DirecTag run and scorer of doc/BENCHMARK-DirecTag.md): both tools re-scored here by the harness rule; pct = spectra / all Mascot PSM spectra",
      "usability: OK (public PXD)"]+[f"part: {p}" for p in part]
out=R/"directag_accuracy_pxd000001_v190.tsv"
with open(out,"w") as fo:
    for h in head: fo.write("# "+h+"\n")
    pd.DataFrame(rows).to_csv(fo,sep="\t",index=False)
print(out); print(pd.DataFrame(rows).to_string())
