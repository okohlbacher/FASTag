import json,csv,re,sys
pool=json.load(open("pride/pool.json"))
sel=[r for r in csv.DictReader((l for l in open("sel/selected.tsv") if not l.startswith("# ")),delimiter="\t") if r["rank"]=="0"]
R=re.compile(r"TMT|tandem mass tag|iTRAQ|SILAC|dimethyl|label|isotop|heavy|light|Lys[- ]?\d|Arg[- ]?\d|13C|15N|plex|isobaric|formaldehyde|LFQ|iBAQ|spectral count|enrich|phospho|acetyl|ubiquit|glyc",re.I)
for r in sel:
    p=pool[r["pxd"]]
    t=" ".join(str(p.get(k) or "") for k in ("title","projectDescription","sampleProcessingProtocol","dataProcessingProtocol"))
    hits=[]
    for m in R.finditer(t):
        s=t[max(0,m.start()-50):m.end()+60].replace("\n"," ")
        if not hits or m.start()>hits[-1][0]+90: hits.append((m.start(),s))
    print("###",r["pxd"],r["truth"],r["cell"],r["file"],"|",";".join(p.get("quantificationMethods") or []),"|",";".join(p.get("instruments") or []))
    print("  T:",p.get("title","")[:150])
    for _,s in hits[:7]: print("   ..."+s)
