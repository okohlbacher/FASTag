#!/usr/bin/env python3
"""Read-only audit of retained tag endpoints against the frozen reference scorer."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path('/scratch/kohlbach/fastag-tmt-filter-20261111')
sys.path.insert(0, str(ROOT/'src'/'bench'))
import tmt_pseudo_filter as B
import pandas as pd
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--results', default='results')
ap.add_argument('--arms', nargs='+', default=['baseline', 'auto'])
ap.add_argument('--dataset', action='append')
args = ap.parse_args()
datasets = json.loads((ROOT/'datasets.json').read_text())
if isinstance(datasets, dict): datasets = datasets['datasets']
out = {'results': args.results, 'reference': 'frozen Sage PSMs, paper_flank scorer',
       'note': 'Exploratory window/isotope candidates; counts do not establish safe filtering. TSV masses have 4 decimal places.',
       'tables': []}
LABEL, WATER, ISOTOPE = 229.162932, 18.010564684, 1.003354835
timing_path=ROOT/args.results/'timings.jsonl'
completed=None
if timing_path.exists():
    completed={(r['dataset'],r['chemistry'],r['arm']) for line in timing_path.read_text().splitlines()
               if (r:=json.loads(line)).get('rep')==1 and r.get('returncode')==0}

def samples(marked, n=5):
    cols=['key','rank','tag','charge','nterm_mass','cterm_mass','evalue','gapped','peptide','correct']
    return marked.sort_values('rank',kind='stable')[cols].head(n).to_dict('records')

for ds in datasets:
    if args.dataset and ds['id'] not in args.dataset: continue
    truth = B.load_truth(ds)
    for chem in ds['chemistries']:
        fixed = chem['fixed_masses']
        for arm in args.arms:
            path = ROOT/args.results/ds['id']/chem['name']/arm/'rep1.tags.tsv'
            if not path.exists(): continue
            if completed is not None and (ds['id'],chem['name'],arm) not in completed: continue
            print(ds['id'],chem['name'],arm,file=sys.stderr,flush=True)
            tags = B.P.read_fastag_tags(path)
            tags = tags[tags.key.isin(set(truth.key))].copy()
            n = tags.nterm_mass.to_numpy(); c = tags.cterm_mass.to_numpy()
            first = tags.tag.str.extract(r'^([A-Za-z])',expand=False).fillna('')
            last = tags.tag.str.extract(r'([A-Za-z])(?:\[[^\]]*\])?$',expand=False).fillna('')
            first_mod = tags.tag.str.match(r'^[A-Za-z]\[').to_numpy()
            last_mod = tags.tag.str.endswith(']').to_numpy()
            lower = first.str.islower().to_numpy() | last.str.islower().to_numpy()
            current = np.zeros(len(tags), dtype=bool)
            normalized = current.copy(); modified = current.copy()
            n_tail = current.copy(); c_tail = current.copy(); isotope = current.copy()
            isotope_masks = {}
            for aa,mass in [('G',57.021463735),('A',71.037113805)]:
                f = (first.str.upper()==aa).to_numpy()
                l = (last.str.upper()==aa).to_numpy()
                nd = n-(LABEL-mass); cd = c-(LABEL-WATER-mass)
                if abs(fixed.get(aa,0))<=1e-8:
                    cur = (f & ~first_mod & (abs(nd)<=.020)) | (l & ~last_mod & (abs(cd)<=.006))
                    normalized |= cur
                    current |= cur & ~lower
                    n_tail |= f & ~first_mod & (abs(nd)>.020) & (abs(nd)<=.050)
                    c_tail |= l & ~last_mod & (abs(cd)>.006) & (abs(cd)<=.020)
                    for offset in [-2,-1,1,2]:
                        mask = f & ~first_mod & (abs(nd-offset*ISOTOPE)<=.020)
                        isotope_masks[offset] = isotope_masks.get(offset,False) | mask
                        isotope |= mask
                modified |= (f & first_mod & (abs(nd)<=.050)) | (l & last_mod & (abs(cd)<=.020))
            masks = {'current_GA': current, 'lowercase_GA_bypass': normalized & ~current,
                     'N_tail_020_to_050': n_tail & ~normalized,
                     'C_tail_006_to_020': c_tail & ~normalized,
                     'modified_GA_endpoint_near_unmodified_anchor': modified}
            masks.update({'N_isotope_'+str(k):v & ~normalized for k,v in isotope_masks.items()})
            top = B.S._mark(tags[tags['rank']==1],truth,'flank')
            fixed_tuple=tuple(sorted((k,float(v)) for k,v in fixed.items() if k in B.S.RESIDUE_MASS))
            top['strict'] = [bool(ok) and B.strict_correct(t,float(nn),float(cc),p,fixed_tuple)
                             for t,nn,cc,p,ok in zip(top.tag,top.nterm_mass,top.cterm_mass,top.peptide,top.correct)]
            rec = dict(dataset=ds['id'],chemistry=chem['name'],arm=arm,truth_psms=len(truth),
                tagged_psms=len(top),top1_paper_correct=int(top.correct.sum()),top1_strict_correct=int(top.strict.sum()),
                top1_wrong=int((~top.correct).sum()),top1_wrong_gapped=int(((~top.correct)&(top.gapped==1)).sum()),
                endpoint_lowercase_rows=int(lower.sum()),patterns={})
            for name,mask in masks.items():
                m=B.S._mark(tags[mask],truth,'flank')
                m['correct']=m.correct.astype(bool)
                mt=m[m['rank']==1]
                rec['patterns'][name]=dict(rows=len(m),spectra=int(m.key.nunique()),paper_correct_rows=int(m.correct.sum()),
                    paper_correct_spectra=int(m[m.correct].key.nunique()),top1_rows=len(mt),
                    top1_paper_correct=int(mt.correct.sum()),top1_wrong=int((~mt.correct).sum()),
                    gapped_rows=int((m.gapped==1).sum()),examples_wrong=samples(m[~m.correct]),examples_correct=samples(m[m.correct]))
            # A gap's order is not supported by an intermediate peak. Identify
            # wrong top-1 spellings with a paper-correct tag on the same rounded
            # score/flank/charge evidence, and distinguish adjacent transpositions.
            wrong_gap=top[(~top.correct)&(top.gapped==1)]
            alt=B.S._mark(tags[(tags.gapped==1)&tags.key.isin(wrong_gap.key)],truth,'flank')
            tied=[]
            for r in wrong_gap.itertuples():
                same=alt[(alt.key==r.key)&alt.correct&(alt.charge==r.charge)&
                    (abs(alt.evalue-r.evalue)<=max(1e-10,abs(r.evalue)*1e-6))&
                    (abs(alt.nterm_mass-r.nterm_mass)<=.00011)&(abs(alt.cterm_mass-r.cterm_mass)<=.00011)]
                if same.empty: continue
                seq=B.S.normalize_tag(r.tag)
                swaps={seq[:i]+seq[i+1]+seq[i]+seq[i+2:] for i in range(len(seq)-1)}
                adjacent=any(B.S.normalize_tag(t) in swaps for t in same.tag)
                tied.append(dict(key=r.key,wrong_tag=r.tag,correct_tag=same.iloc[0].tag,
                                 correct_rank=int(same.iloc[0]['rank']),adjacent_swap=adjacent))
            rec['gapped_top1_wrong_with_tied_correct_spelling']=len(tied)
            rec['gapped_tied_adjacent_swaps']=sum(t['adjacent_swap'] for t in tied)
            rec['gapped_tie_examples']=tied[:8]
            rec['posthoc_rank1_replay']={}
            before=top.set_index('key').correct
            for name,mask in [('tails',n_tail|c_tail),('isotopes',isotope),('tails_and_isotopes',n_tail|c_tail|isotope)]:
                remaining=tags[~mask].groupby('key',sort=False).head(1)
                after=B.S._mark(remaining,truth,'flank').set_index('key').correct.reindex(before.index,fill_value=False)
                rec['posthoc_rank1_replay'][name]=dict(gained=int((~before&after).sum()),lost=int((before&~after).sum()),
                    gained_keys=list(before.index[~before&after]),lost_keys=list(before.index[before&~after]),
                    emptied_spectra=len(top)-len(remaining))
            out['tables'].append(rec)
            print('  top1 wrong',rec['top1_wrong'],'gap ties',len(tied),
                  'candidate counts',{k:(v['rows'],v['paper_correct_rows'],v['top1_wrong']) for k,v in rec['patterns'].items()},
                  file=sys.stderr,flush=True)
print(json.dumps(out,indent=2))
