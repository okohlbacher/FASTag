#!/usr/bin/env python3
import json,sys
from pathlib import Path
ROOT=Path('/scratch/kohlbach/fastag-tmt-filter-20261111')
sys.path.insert(0,str(ROOT/'src/bench/fastag-bench/src'))
from fastag_bench.parsers import read_fastag_tags
import pandas as pd

tasks=json.loads(Path(sys.argv[1]).read_text());results=[]
for task in tasks:
    if task['id'].endswith('old_conversion'):continue
    keys=set(task['scans'])
    for chem in ['label_blind','label_aware']:
        for arm in ['baseline','auto']:
            path=ROOT/'results-ga-v1'/task['id']/chem/arm/'rep1.tags.tsv'
            frame=read_fastag_tags(path);frame=frame[frame.key.isin(keys)].copy()
            frame['dataset']=task['id'];frame['chemistry']=chem;frame['arm']=arm
            results.append(frame)
            print(task['id'],chem,arm,len(frame),flush=True)
pd.concat(results).to_csv(sys.argv[2],sep='\t',index=False)
