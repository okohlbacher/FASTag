#!/usr/bin/env python3
"""Independent-engine corroboration, not replacement truth. Mass deltas retained."""
import bisect, json, re, urllib.parse
from pathlib import Path
import numpy as np
import pandas as pd
from audit_truth import HERE, SOURCE, decode, kind

def notation(seq,per,n=0.,c=0.):
    return (f'[{n:+.6f}]-' if n else '')+''.join(a+(f'[{d:+.6f}]' if d else '') for a,d in zip(seq,per))+(f'-[{c:+.6f}]' if c else '')

def comet(ds):
    root=HERE/'independent'/ds
    conf={}
    for line in (root/'comet.params').read_text().splitlines():
        line=line.split('#')[0].strip()
        if '=' in line:
            k,v=line.split('=',1);conf[k.strip()]=v.strip()
    static={k.split('_')[1]:float(v) for k,v in conf.items() if re.match('add_[A-Z]_',k)}
    def pep(r):
        seq=r.plain_peptide;n=float(conf.get('add_Nterm_peptide',0));c=float(conf.get('add_Cterm_peptide',0))
        per=[static.get(a,0) for a in seq]
        for mod in str(r.modifications).split(','):
            f=mod.split('_')
            if len(f)<3 or f[1]=='S':continue
            pos=int(f[0]);delta=float(f[2])
            if len(f)>3 and f[3]=='n':n+=delta
            elif len(f)>3 and f[3]=='c':c+=delta
            elif pos==0:n+=delta
            elif pos>len(per):c+=delta
            else:per[pos-1]+=delta
        return notation(seq,per,n,c)
    raw=pd.read_csv(root/'comet.txt',sep='\t',skiprows=1)
    raw=raw[raw.num==1].copy()
    raw['kind']=raw.protein.map(kind)
    raw['peptide']=raw.apply(pep,axis=1)
    # One competition per spectrum; retain all tied best candidates for ambiguity audit.
    raw=raw[raw['e-value']==raw.groupby('scan')['e-value'].transform('min')]
    groups=[]
    for scan,g in raw.groupby('scan',sort=False):
        groups.append(dict(scan=scan,score=float(g['e-value'].iloc[0]),
                           decoy=bool((g.kind=='decoy').any()),
                           tied_candidates=len(g),raw_indices=list(g.index)))
    table=pd.DataFrame(groups).sort_values('score',kind='stable')
    # Conservative ties: any all-decoy peptide tied for best makes spectrum a decoy.
    grouped=table.groupby('score',sort=True).agg(d=('decoy','sum'),n=('decoy','size'))
    grouped['q']=(grouped.d.cumsum()/((grouped.n-grouped.d).cumsum()).clip(lower=1)).clip(upper=1)
    grouped['q']=grouped.q.iloc[::-1].cummin().iloc[::-1]
    table['q']=table.score.map(grouped.q)
    raw['q']=raw.scan.map(table.set_index('scan').q)
    raw['competition_decoy']=raw.scan.map(table.set_index('scan').decoy)
    raw['key']='scan='+raw.scan.astype(str)
    raw['engine']='Comet'
    raw['accepted']=(raw.q<=.01)&(~raw.competition_decoy)&(raw.kind=='target_only')
    raw['mass_error']=raw.apply(lambda r: sum(decode(r.peptide)[1])+decode(r.peptide)[2]+decode(r.peptide)[3]+18.010565-r.calc_neutral_mass,axis=1)
    print(ds,'Comet',len(table),'spectra',raw.loc[raw.accepted,'key'].nunique(),'accepted','max annotation error',raw.mass_error.abs().max())
    return raw[['key','engine','peptide','q','accepted','e-value','xcorr','delta_cn','ions_matched','ions_total','tied_candidates'] if 'tied_candidates' in raw else ['key','engine','peptide','q','accepted','e-value','xcorr','delta_cn','ions_matched','ions_total']]

def mascot():
    path=HERE/'independent/PXD000001/F063721.dat'
    section='';targets={};decoys={};scans={};deltas={}
    for line in path.read_text(errors='replace').splitlines():
        if line.startswith('Content-Type:'):
            m=re.search('name="([^"]+)"',line);section=m[1] if m else '';continue
        m=re.match(r'delta(\d+)=([0-9.]+),',line)
        if m:deltas[int(m[1])]=float(m[2])
        if section in ['peptides','decoy_peptides']:
            m=re.match(r'q(\d+)_p1=(.*)',line)
            if not m or m[2]=='-1':continue
            f=m[2].split(';')[0].split(',')
            seq=f[4];codes=f[6]
            assert len(codes)==len(seq)+2,(seq,codes)
            per=[(229.162932 if a=='K' else 45.987721 if a=='C' else 0)+deltas.get(int(c),0) for a,c in zip(seq,codes[1:-1])]
            r=dict(peptide=notation(seq,per,229.162932+deltas.get(int(codes[0]),0),deltas.get(int(codes[-1]),0)),score=float(f[7]),calc_mass=float(f[1]),mass_diff=float(f[2]),ions_matched=int(f[3]))
            (targets if section=='peptides' else decoys)[int(m[1])]=r
        elif section.startswith('query') and line.startswith('title='):
            m=re.search(r'scan[\s=]+(\d+)',urllib.parse.unquote(line[6:]),re.I)
            if m:scans[int(section[5:])]=int(m[1])
    # Replicate deposited-reference separate-search D/T threshold; explicitly no per-scan competition.
    score_counts={}
    for r in targets.values():score_counts.setdefault(r['score'],[0,0])[0]+=1
    for r in decoys.values():score_counts.setdefault(r['score'],[0,0])[1]+=1
    cumulative=[];nt=nd=0
    for score,(t,d) in sorted(score_counts.items(),reverse=True):
        nt+=t;nd+=d;cumulative.append((score,min(1,nd/max(1,nt))))
    qs={};running=1
    for score,q in reversed(cumulative):running=min(running,q);qs[score]=running
    rows=[]
    for query,r in targets.items():
        if query not in scans:continue
        rows.append(dict(key='scan='+str(scans[query]),engine='Mascot',q=qs[r['score']],accepted=qs[r['score']]<=.01,**r))
    df=pd.DataFrame(rows)
    assert not df.key.duplicated().any()
    print('Mascot',len(df),'targets',int(df.accepted.sum()),'accepted',df.loc[df.accepted,'score'].min())
    return df

def agrees(a,b):
    sa,ma,na,ca,_=decode(a);sb,mb,nb,cb,_=decode(b)
    seq=sa.replace('I','L')==sb.replace('I','L')
    mass=seq and all(abs(x-y)<.001 for x,y in zip(ma,mb)) and abs(na-nb)<.001 and abs(ca-cb)<.001
    return seq,mass

def main():
    allrows=[];comparisons=[];summaries=[]
    for ds in ['PXD037999','PXD004541_fr09','PXD000001']:
        ref=pd.read_csv(SOURCE/ds/'truth.filtered.sage.tsv',sep='\t')
        ref['key']=ref.scannr.str.extract(r'(scan=\d+)')[0]
        if ref.key.isna().any():ref['key']='scan='+ref.scannr.astype(str)
        refs=ref.set_index('key').peptide.to_dict()
        engines=[comet(ds)]+([mascot()] if ds=='PXD000001' else [])
        for engine in engines:
            engine.insert(0,'dataset',ds);allrows.append(engine)
            joined=engine[engine.key.isin(refs)].copy()
            joined['sage_peptide']=joined.key.map(refs)
            checks=[agrees(a,b) for a,b in zip(joined.peptide,joined.sage_peptide)]
            joined['same_sequence']=[a for a,b in checks];joined['same_modified_peptide']=[b for a,b in checks]
            comparisons.append(joined)
            both=joined[joined.accepted]
            print(ds,engine.engine.iloc[0],'shared accepted spectra',both.key.nunique(),'sequence agree',both[both.same_sequence].key.nunique(),'mod agree',both[both.same_modified_peptide].key.nunique())
            summaries.append(dict(dataset=ds,engine=engine.engine.iloc[0],sage_reference=len(ref),independent_accepted=engine[engine.accepted].key.nunique(),shared_accepted=both.key.nunique(),same_sequence=both[both.same_sequence].key.nunique(),same_modified_peptide=both[both.same_modified_peptide].key.nunique(),mapping_verified=ds!='PXD000001',method='Comet rank1 per-spectrum min E, conservative any-decoy tie, tied-score cumulative D/T monotone q; exclude any entrapment assignments' if engine.engine.iloc[0]=='Comet' else 'Deposited Mascot separate target and decoy top hits; tied-score cumulative D/T monotone q; variable modifications decoded'))
    pd.concat(allrows).to_csv(HERE/'independent_candidates.tsv.gz',sep='\t',index=False)
    pd.concat(comparisons).to_csv(HERE/'engine_comparisons.tsv.gz',sep='\t',index=False)
    (HERE/'engine_summary.json').write_text(json.dumps(summaries,indent=2)+'\n')

if __name__=='__main__':main()
