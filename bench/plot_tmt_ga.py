#!/usr/bin/env python3
"""Plot the G/A-only iteration against its unchanged baseline and prior filter."""
import argparse
import csv
import os
from pathlib import Path
import tempfile

os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir()) / 'fastag-tmt-mpl'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('results', type=Path)
ap.add_argument('--previous', type=Path,
                default=Path(__file__).parent / 'results/tmt-pseudo-2026-11-11')
args = ap.parse_args()


def read(path):
    with (path / 'summary.tsv').open() as fh:
        return {(r['dataset'], r['chemistry'], r['arm'], r['rule']): r
                for r in csv.DictReader(fh, delimiter='\t')}


now, old = read(args.results), read(args.previous)
datasets = ['PXD004541_fr02', 'PXD037999', 'PXD000001', 'PXD004541_fr09']
labels = ['TMT10 fr02\nDevelopment', 'TMT10 PXD037999\nIndependent',
          'TMT6 PXD000001\nIndependent', 'TMT10 fr09\nWithin project']
colors = {'label_blind': '#147fa3', 'label_aware': '#bf6b20'}
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'svg.fonttype': 'none', 'pdf.fonttype': 42})
out = args.results / 'figures'
out.mkdir(exist_ok=True)
for rule, title in [('paper_flank', 'G/A-only filtering: recall and rank-1 changes'),
                    ('strict_mass', 'Supplement: residue masses must also match')]:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5), layout='constrained')
    for ax, metric, metric_label in zip(axes, ['recall50', 'rank1_accuracy'],
                                       ['Recall@50', 'Rank-1 accuracy']):
        ax.axhline(0, color='#555', linewidth=.8)
        for chem, offset, label in [('label_blind', -.11, 'TMT masses omitted'),
                                    ('label_aware', .11, 'TMT masses configured')]:
            x = np.arange(4) + offset
            y = [100 * (float(now[d, chem, 'auto', rule][metric]) -
                        float(now[d, chem, 'baseline', rule][metric])) for d in datasets]
            prev = [100 * (float(old[d, chem, 'auto', rule][metric]) -
                           float(old[d, chem, 'baseline', rule][metric])) for d in datasets]
            ax.scatter(x, prev, color=colors[chem], marker='x', s=45, alpha=.6)
            ax.vlines(x, prev, y, color=colors[chem], alpha=.3, linewidth=1.3)
            ax.scatter(x, y, color=colors[chem], s=50, label=label, zorder=3)
        ax.set_xticks(np.arange(4), labels, fontsize=9)
        ax.set_title(metric_label, fontweight='bold')
        ax.set_ylabel('Change from baseline (percentage points)')
        ax.grid(axis='y', alpha=.15)
        ax.margins(x=.1, y=.15)
    axes[1].legend(loc='best', frameon=False, fontsize=9)
    fig.suptitle(title, fontsize=17, fontweight='bold')
    fig.supxlabel('● G/A-only filter   × Previous G/A + terminal-K filter\n'
                  'Length 4 · all reference PSMs in denominators · no reporter filtering', fontsize=10)
    for ext in ['png', 'svg', 'pdf']:
        path = out / f'{rule}.{ext}'
        fig.savefig(path, dpi=180, facecolor='white')
        if ext == 'svg':
            path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines()) + '\n')
    plt.close(fig)
