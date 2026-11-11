#!/usr/bin/env python3
"""Mirror the same raw spectrum with two independent peptide assignments."""
import argparse
import json
import os
from pathlib import Path
import tempfile

os.environ.setdefault('MPLCONFIGDIR', str(Path(tempfile.gettempdir()) / 'fastag-tmt-mpl'))
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('support', type=Path)
ap.add_argument('output', type=Path)
args = ap.parse_args()
cases = {(r['dataset'], r['key']): r for r in json.loads(args.support.read_text())['cases']}
selection = [
    ('PXD037999', 'scan=49759', 'Fragment evidence favors the reference'),
    ('PXD037999', 'scan=55112', 'Oxidation site is unresolved'),
    ('PXD000001', 'scan=1273', 'Reference assignment is questionable'),
    ('PXD000001', 'scan=5076', 'Both peptides have distinct fragment support'),
]
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10,
                     'axes.spines.top': False, 'axes.spines.right': False,
                     'svg.fonttype': 'none', 'pdf.fonttype': 42})


def peptide(text):
    for token, label in [('[+229.162932]', '[TMT]'), ('[+229.16293]', '[TMT]'),
                         ('[+15.994915]', '[Ox]'), ('[+45.987721]', '[MT]'), ('[+45.98772]', '[MT]'),
                         ('[+57.021465]', '[CAM]'), ('[+57.021464]', '[CAM]')]:
        text = text.replace(token, label)
    return text


fig, axes = plt.subplots(4, 1, figsize=(13, 13.5), layout='constrained')
for ax, (dataset, key, title), letter in zip(axes, selection, 'ABCD'):
    row = cases[dataset, key]
    mz = np.asarray(row['spectrum']['mz'])
    intensity = np.asarray(row['spectrum']['intensity'])
    shown = mz >= 150
    height = intensity / intensity[shown].max() * 100
    top = next(s for s in row['supports'] if s['engine'] == 'Sage')
    bottom = next(s for s in row['supports'] if s['engine'] == 'Comet')
    ax.axhline(0, color='#607080', linewidth=.6)
    for sign, support in [(1, top), (-1, bottom)]:
        ax.vlines(mz[shown], 0, sign * height[shown], color='#cbd0d5', linewidth=.65)
        for series, color in [('b', '#187ba4'), ('y', '#c46b25')]:
            ids = sorted({m['peak_index'] for m in support['matches'] if m['series'] == series and mz[m['peak_index']] >= 150})
            ax.vlines(mz[ids], 0, sign * height[ids], color=color, linewidth=1.2)
        # Label only separated strong matches; the complete annotation table is retained.
        occupied = []
        for match in sorted(support['matches'], key=lambda x: x['intensity'], reverse=True):
            m = match['mz']
            if m < 150 or any(abs(m - old) < 65 for old in occupied):
                continue
            occupied.append(m)
            y = sign * (height[match['peak_index']] + 4)
            ax.text(m, y, match['ion'], fontsize=8, ha='center',
                    va='bottom' if sign == 1 else 'top', color='#187ba4' if match['series'] == 'b' else '#a65019')
            if len(occupied) == 7:
                break
        label = (f"{support['engine']}: {peptide(support['peptide'])}   |   "
                 f"{support['matched_unique_peaks']} peaks; {support['unique_peak_explained_TIC_pct']:.1f}% raw TIC")
        ax.text(.995, .97 if sign == 1 else .03, label, transform=ax.transAxes,
                ha='right', va='top' if sign == 1 else 'bottom', fontsize=9,
                bbox={'facecolor': 'white', 'alpha': .85, 'edgecolor': 'none', 'pad': 2})
    ax.set_title(f'{letter}. {dataset} · {key} — {title}', loc='left', fontweight='bold')
    ax.set_xlim(145, max(mz[shown]) + 30)
    ax.set_ylim(-125, 125)
    ax.set_yticks([-100, -50, 0, 50, 100], ['100', '50', '0', '50', '100'])
    ax.set_ylabel('Relative intensity')
    ax.set_xlabel('m/z')
fig.suptitle('Reference identifications are evidence, not infallible truth', fontsize=17, fontweight='bold')
fig.supxlabel('Each mirror uses the same raw spectrum. Blue: b ions; orange: y ions; gray: unmatched.\n'
              '20 ppm; charges 1–2; m/z <150 hidden; TIC percentages use the full raw spectrum. '
              'MT: methylthio; Ox: oxidation; CAM: carbamidomethyl.', fontsize=9)
args.output.mkdir(parents=True, exist_ok=True)
for ext in ['png', 'svg', 'pdf']:
    path = args.output / f'truth_cases.{ext}'
    fig.savefig(path, dpi=180, facecolor='white')
    if ext == 'svg':
        path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines()) + '\n')
