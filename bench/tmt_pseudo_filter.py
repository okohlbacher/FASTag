#!/usr/bin/env python3
"""Paired benchmark of TMT auto detection and pre-cap pseudo-tag filtering.

The dataset JSON fixes inputs, truth and chemistry before evaluation. Uses the
repository's existing FASTag/Sage readers, paper scorer and process timer.
"""
from __future__ import annotations
import argparse
import functools
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import re
import statistics
import sys

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'fastag-bench'/'src'))
from fastag_bench import parsers as P, score as S
from fastag_bench.timing import run_timed
import pandas as pd

ARMS={'baseline':[], 'off':[], 'on':['-tmt_pseudo_filter','on'],
      'auto':['-tmt_pseudo_filter','auto'],
      'auto_reporters':['-tmt_pseudo_filter','auto','-tmt_reporter_filter']}
MODS={'Oxidation':15.994915,'Phospho':79.966331,'TMT6plex':229.162932,
      'TMT10plex':229.162932,'Methylthio':45.987721,'Carbamidomethyl':57.021464}
TOKEN=re.compile(r'([A-Za-z])((?:\[[^\]]*\])*)')

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(8<<20),b''):h.update(block)
    return h.hexdigest()

@functools.lru_cache(maxsize=250000)
def tag_masses(tag,fixed):
    fixed=dict(fixed); tokens=list(TOKEN.finditer(tag))
    if ''.join(m[0] for m in tokens)!=tag:raise ValueError('Unknown tag notation: '+tag)
    seq=[];masses=[]
    for m in tokens:
        aa=m[1].upper(); mass=S.RESIDUE_MASS[aa]+fixed.get(aa,0)
        for mod in re.findall(r'\[([^\]]*)\]',m[2]):
            mass+=MODS[mod] if mod in MODS else float(mod)
        seq.append(aa.replace('I','L'));masses.append(mass)
    return ''.join(seq),tuple(masses)

@functools.lru_cache(maxsize=100000)
def truth_masses(peptide):return S.peptide_masses(peptide)

def strict_correct(tag,nterm,cterm,peptide,fixed):
    seq,mass=tag_masses(tag,fixed); residues,pref,total=truth_masses(peptide)
    if not seq or not pref:return False
    for reverse in [False,True]:
        needle=seq[::-1] if reverse else seq; masses=mass[::-1] if reverse else mass
        for start in S._find_all(residues,needle):
            end=start+len(seq)
            if any(abs(masses[k]-(pref[start+k+1]-pref[start+k]))>.02 for k in range(len(seq))):continue
            if reverse:
                ok=abs(cterm-(pref[start]-S.WATER))<=S.FLANK_TOL or abs(nterm-(total-pref[end]+S.WATER))<=S.FLANK_TOL
            else:ok=abs(nterm-pref[start])<=S.FLANK_TOL or abs(cterm-(total-pref[end]))<=S.FLANK_TOL
            if ok:return True
    return False

def self_test():
    pep='[+229.162932]-AGPEPK[+229.162932]'
    seq,p,total=truth_masses(pep)
    assert seq=='AGPEPK' and abs(p[0]-229.162932)<1e-6
    assert strict_correct('AGPE',p[0],total-p[4],pep,())
    assert strict_correct('EPGA',total-p[4]+S.WATER,p[0]-S.WATER,pep,())
    assert not strict_correct('PEPK',p[2],0,pep,())
    assert strict_correct('PEPK',p[2],0,pep,(('K',229.162932),))
    assert not strict_correct('GAGP',172.141468,0,pep,())
    print('TMT scorer orientation and fixed-modification checks passed',flush=True)

def load_truth(ds):
    raw=pd.read_csv(ds['truth'],sep='\t')
    if 'proteins' in raw:
        entrap=raw.proteins.fillna('').str.contains(r'ENTRAP_',regex=True)
        if entrap.any():
            raise ValueError('Dataset truth must already exclude all entrapment placements: '+ds['id'])
    truth=P.read_sage_psms(ds['truth'],.01)
    names={Path(str(f)).name for f in truth.filename.unique()}
    if names!={Path(ds['input']).name}:raise ValueError(f"Truth/input mismatch {ds['id']}: {names}")
    if truth.key.duplicated().any() or truth.empty:raise ValueError('Empty or ambiguous truth')
    return truth

def command(args,ds,chem,arm,path):
    return [str(args.baseline if arm=='baseline' else args.feature),'-in',ds['input'],'-out',str(path),
            '-threads',str(args.threads),'-tag_length',str(args.length),'-extension','0','-gaps','1',
            '-max_tags','50','-max_evalue','20','-max_peaks','400','-peaks_per_window','10','-gap_penalty','100',
            '-fragment_tolerance','20','-fragment_tolerance_unit','ppm',
            '-fixed_modifications',*chem['fixed_cli'],'-variable_modifications',*chem.get('variable_cli',[]),*ARMS[arm]]

def run(args,datasets):
    out=args.output;out.mkdir(parents=True,exist_ok=True)
    timing_file=out/'timings.jsonl'
    if timing_file.exists():raise ValueError('Refusing to overwrite an existing benchmark')
    manifest=dict(datasets=datasets,baseline_sha256=sha(args.baseline),feature_sha256=sha(args.feature),
                  harness_sha256=sha(__file__),scorer_sha256=sha(S.__file__),parser_sha256=sha(P.__file__),
                  platform=platform.platform(),python=sys.version,cpus=os.cpu_count(),
                  args={k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()})
    for ds in datasets:
        for field in ['input','truth']:
            actual=sha(ds[field]); expected=ds.get(field+'_sha256')
            if expected and actual!=expected:raise ValueError('Hash mismatch: '+ds[field])
            ds[field+'_sha256']=actual
        load_truth(ds)
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    rng=random.Random(20261112)
    for ds in datasets:
        for chem in ds['chemistries']:
            for rep in range(1,args.reps+1):
                arms=list(args.arms);rng.shuffle(arms)
                for pos,arm in enumerate(arms):
                    dest=out/ds['id']/chem['name']/arm;dest.mkdir(parents=True,exist_ok=True)
                    tags=dest/f'rep{rep}.tags.tsv';log=dest/f'rep{rep}.log'
                    cmd=command(args,ds,chem,arm,tags)
                    print(f"RUN {ds['id']} {chem['name']} {arm} {rep}/{args.reps}",flush=True)
                    metrics=run_timed(cmd,log=log,env={'OPENBLAS_NUM_THREADS':'1'})
                    record=dict(dataset=ds['id'],chemistry=chem['name'],arm=arm,rep=rep,position=pos,command=cmd,**metrics)
                    if metrics['returncode']==0:
                        record['tags_sha256']=sha(tags);record['tags_bytes']=tags.stat().st_size
                        record['tmt_diagnostics']=[line for line in log.read_text().splitlines() if 'TMT' in line and ('filter' in line.lower() or 'probe' in line.lower())]
                    with timing_file.open('a') as f:f.write(json.dumps(record)+'\n')
                    if metrics['returncode']!=0:raise RuntimeError('Failed run; see '+str(log))
                    print(f"  wall={metrics['wall_s']}s",flush=True)
                    # Keep every run until scoring/verification is complete.

def score(args,datasets):
    out=args.output;timings=[json.loads(x) for x in (out/'timings.jsonl').read_text().splitlines()]
    summaries=[];outcomes=[];equivalence=[]
    for ds in datasets:
        truth=load_truth(ds)
        for chem in ds['chemistries']:
            fixed=tuple(sorted((k,float(v)) for k,v in chem['fixed_masses'].items() if k in S.RESIDUE_MASS))
            tr=[r for r in timings if r['dataset']==ds['id'] and r['chemistry']==chem['name']]
            first={r['arm']:r['tags_sha256'] for r in tr if r['rep']==1}
            if 'baseline' in first and 'off' in first:
                equivalence.append(dict(dataset=ds['id'],chemistry=chem['name'],default_identical=first['baseline']==first['off']))
            for arm in args.arms:
                print(f"SCORE {ds['id']} {chem['name']} {arm}",flush=True)
                tags=P.read_fastag_tags(out/ds['id']/chem['name']/arm/'rep1.tags.tsv')
                marked=S._mark(tags,truth,'flank')
                marked['strict']=[bool(ok) and strict_correct(t,float(n),float(c),p,fixed)
                                  for t,n,c,p,ok in zip(marked.tag,marked.nterm_mass,marked.cterm_mass,marked.peptide,marked.correct)]
                runs=[r for r in tr if r['arm']==arm]
                timing=dict(wall_median_s=statistics.median(r['wall_s'] for r in runs),
                            wall_min_s=min(r['wall_s'] for r in runs),wall_max_s=max(r['wall_s'] for r in runs),
                            reps=len(runs),deterministic=len({r['tags_sha256'] for r in runs})==1)
                tagged=set(marked.key)
                for rule,col in [('paper_flank','correct'),('strict_mass','strict')]:
                    recall=marked[marked['rank']<=50].groupby('key')[col].any()
                    rank1=marked[marked['rank']==1].groupby('key')[col].any()
                    n=len(truth);r=int(recall.reindex(truth.key,fill_value=False).sum());t=int(rank1.reindex(truth.key,fill_value=False).sum())
                    nt=sum(k in tagged for k in truth.key)
                    summaries.append(dict(dataset=ds['id'],role=ds['role'],chemistry=chem['name'],length=args.length,
                                          arm=arm,rule=rule,psms=n,tagged_psms=nt,recall50_correct=r,recall50=r/n,
                                          rank1_correct=t,rank1_accuracy=t/n,rank1_precision_tagged=t/nt if nt else 0,**timing))
                    for key in truth.key:
                        outcomes.append(dict(dataset=ds['id'],chemistry=chem['name'],arm=arm,rule=rule,key=key,
                                             any50=bool(recall.get(key,False)),rank1=bool(rank1.get(key,False))))
    pd.DataFrame(summaries).to_csv(out/'summary.tsv',sep='\t',index=False)
    (out/'default_equivalence.json').write_text(json.dumps(equivalence,indent=2)+'\n')
    spec=pd.DataFrame(outcomes);spec.to_csv(out/'spectrum_outcomes.tsv.gz',sep='\t',index=False)
    pairs=[]
    for (dataset,chemistry,rule),g in spec.groupby(['dataset','chemistry','rule']):
        base=g[g.arm=='baseline'].set_index('key')
        for arm in args.arms:
            if arm=='baseline':continue
            other=g[g.arm==arm].set_index('key')
            for metric in ['any50','rank1']:
                a=base[metric];b=other[metric].reindex(base.index)
                assert not b.isna().any()
                pairs.append(dict(dataset=dataset,chemistry=chemistry,rule=rule,arm=arm,metric=metric,
                                  psms=len(a),gained=int((~a&b).sum()),lost=int((a&~b).sum()),unchanged=int((a==b).sum())))
    pd.DataFrame(pairs).to_csv(out/'paired_changes.tsv',sep='\t',index=False)
    print(pd.DataFrame(summaries).to_string(index=False),flush=True)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--datasets-json',type=Path)
    ap.add_argument('--output',type=Path)
    ap.add_argument('--baseline',type=Path);ap.add_argument('--feature',type=Path)
    ap.add_argument('--threads',type=int,default=8);ap.add_argument('--reps',type=int,default=3)
    ap.add_argument('--length',type=int,default=4)
    ap.add_argument('--arms',nargs='+',choices=ARMS,default=list(ARMS))
    ap.add_argument('--steps',nargs='+',choices=['test','run','score'],default=['test','run','score'])
    args=ap.parse_args()
    if 'test' in args.steps:self_test()
    if any(s in args.steps for s in ['run','score']):
        if args.datasets_json is None or args.output is None:ap.error('dataset JSON and output required')
        datasets=json.loads(args.datasets_json.read_text())
        if isinstance(datasets,dict):datasets=datasets['datasets']
        if 'run' in args.steps:
            if args.baseline is None or args.feature is None:ap.error('both binaries required')
            run(args,datasets)
        if 'score' in args.steps:score(args,datasets)

if __name__=='__main__':main()
