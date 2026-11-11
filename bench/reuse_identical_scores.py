#!/usr/bin/env python3
"""Reuse reference scoring only when every new tag TSV is byte-identical.

Runtimes are always taken from the new execution. Any mismatch aborts, so a
behavior-changing iteration must be scored normally with tmt_pseudo_filter.py.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import shutil
import statistics


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as fh:
        for block in iter(lambda: fh.read(8 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('previous', type=Path)
ap.add_argument('current', type=Path)
args = ap.parse_args()
require(not (args.current / 'summary.tsv').exists(), 'Current scores already exist')
old_manifest = json.loads((args.previous / 'manifest.json').read_text())
new_manifest = json.loads((args.current / 'manifest.json').read_text())
for field in ['scorer_sha256', 'parser_sha256', 'harness_sha256']:
    require(old_manifest[field] == new_manifest[field], field)
require(old_manifest['args']['length'] == new_manifest['args']['length'], 'Tag lengths differ')
for old, new in zip(old_manifest['datasets'], new_manifest['datasets'], strict=True):
    for field in ['id', 'role', 'input_sha256', 'truth_sha256', 'chemistries']:
        require(old[field] == new[field], (new['id'], field))


def verified_timings(root):
    rows = [json.loads(line) for line in (root / 'timings.jsonl').read_text().splitlines()]
    for row in rows:
        require(row['returncode'] == 0, f'Failed run: {root}, {row}')
        require(type(row['rep']) is int and row['rep'] >= 1, f'Invalid repetition: {row}')
        path = root / row['dataset'] / row['chemistry'] / row['arm'] / f"rep{row['rep']}.tags.tsv"
        require(sha256(path) == row['tags_sha256'], f'Tag file differs from recorded hash: {path}')
    return rows


def key(row):
    return row['dataset'], row['chemistry'], row['arm']


old_timings = verified_timings(args.previous)
new_timings = verified_timings(args.current)
hashes = {}
old_reps = {}
for row in old_timings:
    k = key(row)
    require(hashes.setdefault(k, row['tags_sha256']) == row['tags_sha256'], f'Previous outputs are nondeterministic: {k}')
    old_reps.setdefault(k, []).append(row['rep'])
groups = {}
for row in new_timings:
    k = key(row)
    require(k in hashes and hashes[k] == row['tags_sha256'], f'Output differs: {k}; run full scoring')
    groups.setdefault(k, []).append(row)
require(groups.keys() == hashes.keys(), 'Benchmark cells differ')
for k, runs in groups.items():
    previous = old_reps[k]
    current = [r['rep'] for r in runs]
    require(len(previous) == len(set(previous)) and len(current) == len(set(current)), f'Duplicate repetition: {k}')
    require(set(previous) == set(current) and 1 in current, f'Repetition IDs differ or rep1 missing: {k}')

with (args.previous / 'summary.tsv').open() as fh:
    reader = csv.DictReader(fh, delimiter='\t')
    fields, rows = reader.fieldnames, list(reader)
for row in rows:
    runs = groups[key(row)]
    values = [r['wall_s'] for r in runs]
    row.update(wall_median_s=statistics.median(values), wall_min_s=min(values),
               wall_max_s=max(values), reps=len(runs), deterministic=True)
with (args.current / 'summary.tsv').open('w') as fh:
    writer = csv.DictWriter(fh, fields, delimiter='\t')
    writer.writeheader()
    writer.writerows(rows)
sources = {'summary.tsv': sha256(args.previous / 'summary.tsv')}
for name in ['paired_changes.tsv', 'spectrum_outcomes.tsv.gz', 'default_equivalence.json']:
    source = args.previous / name
    shutil.copy2(source, args.current / name)
    sources[name] = sha256(source)
(args.current / 'score-reuse.json').write_text(json.dumps({
    'reason': 'All new tag outputs match previously scored outputs byte-for-byte',
    'previous_results': str(args.previous), 'verified_runs': len(new_timings),
    'verified_cells': len(groups), 'source_scoring_artifacts': sources,
    'runtime_source': 'Current executions, never copied from previous timings',
}, indent=2) + '\n')
print(f'Reused identical-output scoring for {len(groups)} cells; refreshed all runtimes')
