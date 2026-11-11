#!/usr/bin/env python3
"""Case-level alternate-peptide sensitivity; no relabeling of reference."""
import json,sys
from pathlib import Path
import pandas as pd
from audit_truth import HERE,SOURCE
sys.path.insert(0,str(HERE.parent/'fastag-tmt-filter/bench'))
import tmt_pseudo_filter as B

tags=pd.read_csv(HERE/'case_tags.tsv.gz',sep='\t')
cases=json.loads((HERE/'spectrum_support.json').read_text())['cases']
manifest={d['id']:d for d in json.loads((SOURCE/'datasets.json').read_text())}
out=[]
for case in cases:
    ds=case['dataset'];key=case['key']
    for chem in manifest[ds]['chemistries']:
        fixed=tuple(sorted((k,float(v)) for k,v in chem['fixed_masses'].items() if k in B.S.RESIDUE_MASS))
        group=tags[(tags.dataset==ds)&(tags.key==key)&(tags.chemistry==chem['name'])]
        for arm,g in group.groupby('arm'):
            for candidate in case['supports']:
                pep=candidate['peptide'];seq,pref,total=B.truth_masses(pep)
                paper=[];strict=[]
                for r in g.itertuples():
                    paper.append(B.S.tag_correct_flank(r.tag,float(r.nterm_mass),float(r.cterm_mass),seq,pref,total))
                    strict.append(B.strict_correct(r.tag,float(r.nterm_mass),float(r.cterm_mass),pep,fixed))
                t=g[g['rank']==1].iloc[0];index=list(g.index).index(t.name)
                out.append(dict(dataset=ds,key=key,chemistry=chem['name'],arm=arm,engine=candidate['engine'],
                                engine_accepted=candidate['independent_engine_accepted'],engine_q=candidate['engine_q'],peptide=pep,
                                top_tag=t.tag,nterm_mass=t.nterm_mass,cterm_mass=t.cterm_mass,
                                paper_rank1=paper[index],strict_rank1=strict[index],paper_any50=any(paper),strict_any50=any(strict)))
pd.DataFrame(out).to_csv(HERE/'case_alternate_peptide_scores.tsv',sep='\t',index=False)
print(pd.DataFrame(out)[pd.DataFrame(out).key.isin(['scan=5076','scan=1273','scan=49759'])].to_string(index=False))
