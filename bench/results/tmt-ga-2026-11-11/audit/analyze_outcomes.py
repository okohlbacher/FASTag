#!/usr/bin/env python3
"""Supplemental reference-quality strata; primary outcomes stay unchanged."""
import argparse,json
from pathlib import Path
import pandas as pd
from audit_truth import HERE

def main():
    ap=argparse.ArgumentParser();ap.add_argument('outcomes',type=Path);args=ap.parse_args()
    truth=pd.read_csv(HERE/'truth_rows.tsv.gz',sep='\t',low_memory=False)
    comp=pd.read_csv(HERE/'engine_comparisons.tsv.gz',sep='\t')
    accepted=comp[comp.accepted]
    agrees=set(zip(accepted.loc[accepted.same_modified_peptide,'dataset'],accepted.loc[accepted.same_modified_peptide,'key']))
    sequence_agrees=set(zip(accepted.loc[accepted.same_sequence,'dataset'],accepted.loc[accepted.same_sequence,'key']))
    independent=set(zip(accepted.dataset,accepted.key))
    truth['independent_same_modified_peptide']=[(d,k) in agrees for d,k in zip(truth.dataset,truth.key)]
    truth['independent_same_sequence']=[(d,k) in sequence_agrees for d,k in zip(truth.dataset,truth.key)]
    truth['independent_accepted_any']=[(d,k) in independent for d,k in zip(truth.dataset,truth.key)]
    truth['low_fragments_le6']=truth.matched_peaks<=6
    truth['q_gt_005']=truth.spectrum_q>.005
    truth['independent_accepted_disagreement']=truth.independent_accepted_any & ~truth.independent_same_modified_peptide
    outcomes=pd.read_csv(args.outcomes,sep='\t')
    data=outcomes.merge(truth,on=['dataset','key'],validate='many_to_one')
    data=data[data.arm.isin(['baseline','auto'])]
    paired=[];strata=[]
    for (ds,chem,rule),g in data.groupby(['dataset','chemistry','rule']):
        base=g[g.arm=='baseline'].set_index('key');auto=g[g.arm=='auto'].set_index('key').reindex(base.index)
        for name,col in [('all_reference',None),('independent_same_modified_peptide','independent_same_modified_peptide'),('independent_same_sequence','independent_same_sequence')]:
            subset=base if col is None else base[base[col]]
            other=auto.reindex(subset.index)
            for metric in ['any50','rank1']:
                a=subset[metric];b=other[metric]
                paired.append(dict(dataset=ds,chemistry=chem,rule=rule,reference_subset=name,metric=metric,n=len(a),baseline_correct=int(a.sum()),auto_correct=int(b.sum()),gained=int((~a&b).sum()),lost=int((a&~b).sum())))
        for trait in ['low_fragments_le6','q_gt_005','TMT_on_Y','independent_same_modified_peptide','independent_accepted_disagreement']:
            for flag in [False,True]:
                sub=auto[auto[trait]==flag]
                for metric in ['any50','rank1']:
                    failures=int((~sub[metric]).sum())
                    strata.append(dict(dataset=ds,chemistry=chem,rule=rule,trait=trait,flag=flag,metric=metric,n=len(sub),failures=failures,failure_rate=failures/len(sub) if len(sub) else None))
    pd.DataFrame(paired).to_csv(HERE/'quality_subset_paired.tsv',sep='\t',index=False)
    strata=pd.DataFrame(strata)
    strata.to_csv(HERE/'failure_quality_strata.tsv',sep='\t',index=False)
    aware=strata[(strata.chemistry=='label_aware')&(strata.rule=='paper_flank')]
    summaries={}
    for ids,name in [(['PXD004541_fr02','PXD004541_fr09','PXD037999','PXD000001'],'all_TMT'),(['PXD037999','PXD000001'],'independent_validation')]:
        aggregate=aware[aware.dataset.isin(ids)].groupby(['trait','flag','metric'])[['n','failures']].sum().reset_index()
        aggregate['failure_rate']=aggregate.failures/aggregate.n
        summaries[name]=aggregate.to_dict('records')
    (HERE/'quality_audit_summary.json').write_text(json.dumps(summaries,indent=2)+'\n')
    # Exact selected case outcomes for joining to raw-spectrum evidence.
    cases=json.loads((HERE/'spectrum_support.json').read_text())['cases']
    keys={(c['dataset'],c['key']) for c in cases}
    selected=data[[(d,k) in keys for d,k in zip(data.dataset,data.key)]]
    selected.to_csv(HERE/'selected_case_outcomes.tsv',sep='\t',index=False)
    print('Wrote paired supplemental subsets and failure-quality strata:',len(data),'outcomes')

if __name__=='__main__':main()
