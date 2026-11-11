#!/usr/bin/env python3
"""Plot within-configuration changes from the frozen TMT benchmark summary."""
import argparse
import csv
import os
from pathlib import Path
import tempfile
os.environ.setdefault('MPLCONFIGDIR',str(Path(tempfile.gettempdir())/'fastag-tmt-mpl'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('results',type=Path)
args=ap.parse_args()
rows=list(csv.DictReader(open(args.results/'summary.tsv'),delimiter='\t'))
figdir=args.results/'figures';figdir.mkdir(exist_ok=True)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'svg.fonttype':'none','pdf.fonttype':42})
labels={'PXD004541_fr02':'TMT10 fr02 (development)','PXD004541_fr09':'TMT10 fr09 (same project)',
        'PXD037999':'TMT10 PXD037999','PXD000001':'TMT6 PXD000001','PXD003531':'Label-free control'}
for rule,title in [('paper_flank','Sequence and flank correctness'),('strict_mass','Sequence, flank and residue-mass correctness')]:
    rr=[r for r in rows if r['rule']==rule]
    cells=list(dict.fromkeys((r['dataset'],r['chemistry']) for r in rr))
    index={(r['dataset'],r['chemistry'],r['arm']):r for r in rr}
    y=np.arange(len(cells))
    ticklabels=[labels[d]+' · '+{'label_blind':'TMT omitted','label_aware':'TMT specified','control':'correct chemistry'}.get(c,c) for d,c in cells]
    fig,axes=plt.subplots(1,2,figsize=(13,7),sharey=True,layout='constrained')
    for ax,metric,label in zip(axes,['recall50','rank1_accuracy'],['Recall@50','Rank-1 accuracy']):
        ax.axvline(0,color='#555',lw=.8)
        for arm,offset,color,marker,legend in [('auto',-.14,'#167ca4','o','Automatic narrow filter'),('auto_reporters',.14,'#9462a5','s','Automatic + reporter endpoints')]:
            values=np.array([100*(float(index[d,c,arm][metric])-float(index[d,c,'baseline'][metric])) for d,c in cells])
            for yy,delta in zip(y+offset,values): ax.plot([0,delta],[yy,yy],color=color,lw=2,alpha=.45)
            ax.scatter(values,y+offset,color=color,marker=marker,label=legend,s=32,zorder=3)
        ax.set_title(label,fontweight='bold');ax.set_xlabel('Change from baseline (percentage points)')
        ax.grid(axis='x',alpha=.15);ax.margins(x=.15)
    axes[0].set_yticks(y,ticklabels);axes[0].invert_yaxis()
    axes[1].legend(loc='lower right',fontsize=9,frameon=False)
    fig.suptitle(title,fontsize=16,fontweight='bold')
    fig.supxlabel('Same spectra, ground truth and residue alphabet within each comparison · length 4 · all reference PSMs in denominators',fontsize=9)
    for ext in ['png','svg','pdf']:fig.savefig(figdir/f'{rule}.{ext}',dpi=180,facecolor='white')
    svg=figdir/f'{rule}.svg'
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
    plt.close(fig)
