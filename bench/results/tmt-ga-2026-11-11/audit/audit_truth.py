#!/usr/bin/env python3
"""Read-only frozen-reference audit; never changes benchmarking truth."""
import csv, hashlib, json, re, sys
from pathlib import Path
import numpy as np
import pandas as pd

HERE=Path(__file__).resolve().parent
SOURCE=HERE.parent/'fastag-tmt-filter-benchmark/source-data'
AA={'G':57.021464,'A':71.037114,'S':87.032028,'P':97.052764,'V':99.068414,
    'T':101.047679,'C':103.009185,'I':113.084064,'L':113.084064,'N':114.042927,
    'D':115.026943,'Q':128.058578,'K':128.094963,'E':129.042593,'M':131.040485,
    'H':137.058912,'F':147.068414,'R':156.101111,'Y':163.063329,'W':186.079313,
    'U':150.953636,'O':237.147727}
WATER=18.010565

def decode(p):
    """Strict Sage numeric-mod parser, including explicit terminal mods."""
    n=c=0.;p=str(p)
    match=re.match(r'^\[([+-]?[0-9.]+)\]-',p)
    if match:n=float(match[1]);p=p[match.end():]
    match=re.search(r'-\[([+-]?[0-9.]+)\]$',p)
    if match:c=float(match[1]);p=p[:match.start()]
    tokens=list(re.finditer(r'([A-Z])((?:\[[+-]?[0-9.]+\])*)',p))
    assert ''.join(m[0] for m in tokens)==p,p
    seq=''.join(m[1] for m in tokens)
    delta=[sum(float(x) for x in re.findall(r'\[([^]]+)\]',m[2])) for m in tokens]
    masses=[AA[a]+d for a,d in zip(seq,delta)]
    return seq,masses,n,c,delta

def kind(prots):
    ps=[p.strip() for p in re.split('[;,]',str(prots)) if p.strip()]
    if all(p.startswith(('rev_','DECOY_')) for p in ps):return 'decoy'
    if all(p.startswith('ENTRAP_') for p in ps):return 'entrap_only'
    if any(p.startswith('ENTRAP_') for p in ps):return 'mixed_entrap_target'
    return 'target_only'

def quantiles(series):
    x=np.asarray(series,dtype=float)
    return {str(q):float(np.quantile(x,q)) for q in [0,.01,.05,.5,.95,.99,1]}

def main():
    manifest=json.loads((SOURCE/'datasets.json').read_text())
    summary=[];per=[]
    for ds in manifest:
        id=ds['id'];root=SOURCE/id
        raw=pd.read_csv(root/'results.sage.tsv',sep='\t')
        truth=pd.read_csv(root/'truth.filtered.sage.tsv',sep='\t')
        assert hashlib.sha256((root/'truth.filtered.sage.tsv').read_bytes()).hexdigest()==ds['truth_sha256']
        raw['kind']=raw.proteins.map(kind)
        eligible=raw[(raw.label==1)&(raw['rank']==1)&(raw.spectrum_q<=.01)]
        decoyq=raw[(raw.label==-1)&(raw['rank']==1)&(raw.spectrum_q<=.01)]
        config=json.loads((root/'sage.json').read_text())
        checks=[]
        for _,r in truth.iterrows():
            seq,masses,n,c,deltas=decode(r.peptide)
            calc=sum(masses)+n+c+WATER
            issues=[]
            for a,d in zip(seq,deltas):
                static=float(config['database'].get('static_mods',{}).get(a,0))
                variable=config['database'].get('variable_mods',{}).get(a,[0])
                if not isinstance(variable,list):variable=[variable]
                if not any(abs(d-static-v)<.001 for v in [0]+variable):issues.append(a+':'+str(d))
            if abs(n-config['database'].get('static_mods',{}).get('^',0))>.001:
                allowed=[]
                for site in ['^','[']:
                    values=config['database'].get('variable_mods',{}).get(site,[])
                    allowed.extend(values if isinstance(values,list) else [values])
                if not any(abs(n-float(v))<.001 for v in allowed):issues.append('N:'+str(n))
            checks.append(dict(dataset=id,key='scan='+str(r.scannr).split('scan=')[-1],peptide=r.peptide,
                               normalized_seq=seq.replace('I','L'),calc_annotation_mass=calc,
                               annotation_calcmass_error=calc-float(r.calcmass),
                               raw_precursor_error=float(r.expmass)-calc,
                               isotope_error=float(r.isotope_error),mod_schema_issues=','.join(issues),
                               TMT_on_Y=any(a=='Y' and abs(d-229.162932)<.001 for a,d in zip(seq,deltas)),
                               **{f:r[f] for f in ['charge','spectrum_q','precursor_ppm','fragment_ppm','hyperscore','delta_next','matched_peaks','longest_b','longest_y','matched_intensity_pct','posterior_error']}))
        frame=pd.DataFrame(checks);per.append(frame)
        ks=eligible.kind.value_counts().to_dict()
        summary.append(dict(dataset=id,n=len(truth),raw_n=len(raw),q01_target_kinds=ks,
                            q01_decoys=len(decoyq),duplicates=int(truth.scannr.duplicated().sum()),
                            annotation_mass_error=quantiles(frame.annotation_calcmass_error),
                            mod_schema_issue_count=int((frame.mod_schema_issues!='').sum()),
                            TMT_Y=int(frame.TMT_on_Y.sum()),
                            q_gt_005=int((truth.spectrum_q>.005).sum()),
                            low_matched_peaks_4to6=int((truth.matched_peaks<=6).sum()),
                            fields={f:quantiles(truth[f]) for f in ['spectrum_q','precursor_ppm','fragment_ppm','hyperscore','delta_next','matched_peaks','longest_b','longest_y','matched_intensity_pct','posterior_error']}))
    (HERE/'truth_audit_summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    pd.concat(per).to_csv(HERE/'truth_rows.tsv.gz',sep='\t',index=False)
    for s in summary:print(s['dataset'],s['n'],s['q01_target_kinds'],'maxMass',s['annotation_mass_error']['1'],'schema',s['mod_schema_issue_count'],'Y',s['TMT_Y'])

if __name__=='__main__':main()
