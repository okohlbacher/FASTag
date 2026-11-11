#!/usr/bin/env python3
"""Independent complete-design/hash audit for the 108-run GA benchmark."""
import collections
import hashlib
import json
from pathlib import Path
import sys

root, output = map(Path, sys.argv[1:3])
previous = Path(sys.argv[3]) if len(sys.argv) > 3 else None
rows = [json.loads(s) for s in (root / 'timings.jsonl').read_text().splitlines()]
groups = collections.defaultdict(list)
for row in rows:
    groups[(row['dataset'], row['chemistry'], row['arm'])].append(row)
result = dict(root=str(root), completed_processes=len(rows),
              complete_design=len(rows) == 108 and len(groups) == 36 and all(len(v) == 3 for v in groups.values()),
              all_returncodes_zero=all(r['returncode'] == 0 for r in rows),
              repeat_checks=[], equality_checks=[], auto_decisions=[], output_hashes_recomputed=[])
for key, group in sorted(groups.items()):
    result['repeat_checks'].append(dict(dataset=key[0], chemistry=key[1], arm=key[2],
        n=len(group), identical=len({r['tags_sha256'] for r in group}) == 1))
    if key[2] == 'auto':
        messages = {m for r in group for m in r.get('tmt_diagnostics', [])
                    if m.startswith('TMT pseudo-filter (auto):')}
        result['auto_decisions'].append(dict(dataset=key[0], chemistry=key[1], messages=sorted(messages),
            stable=len(messages) == 1, expected=bool(messages) and all(
                ('(auto): off;' if key[0] == 'PXD003531' else '(auto): on;') in m for m in messages)))
for dataset, chemistry in sorted({key[:2] for key in groups}):
    for left, right in [('baseline', 'off'), ('auto', 'baseline' if dataset == 'PXD003531' else 'on')]:
        a, b = groups[(dataset, chemistry, left)], groups[(dataset, chemistry, right)]
        result['equality_checks'].append(dict(dataset=dataset, chemistry=chemistry, left=left, right=right,
            identical=bool(a) and bool(b) and {r['tags_sha256'] for r in a} == {r['tags_sha256'] for r in b}))
for row in rows:
    path = Path(row['command'][row['command'].index('-out') + 1])
    with path.open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    result['output_hashes_recomputed'].append(dict(path=str(path), match=digest == row['tags_sha256']))
if previous:
    prior_rows = [json.loads(s) for s in (previous / 'timings.jsonl').read_text().splitlines()]
    def hashes(records):
        h = collections.defaultdict(set)
        for r in records:
            h[(r['dataset'], r['chemistry'], r['arm'])].add(r['tags_sha256'])
        return h
    old, current = hashes(prior_rows), hashes(rows)
    result['previous_root'] = str(previous)
    result['previous_output_match'] = set(old) == set(current) and all(old[k] == current[k] for k in current)
    result['changed_cells'] = [list(k) for k in sorted(set(old) | set(current)) if old[k] != current[k]]
result['passed'] = (result['complete_design'] and result['all_returncodes_zero']
    and all(r['identical'] for r in result['repeat_checks'] + result['equality_checks'])
    and all(r['stable'] and r['expected'] for r in result['auto_decisions'])
    and all(r['match'] for r in result['output_hashes_recomputed'])
    and result.get('previous_output_match', True))
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if not isinstance(v, list)}, indent=2))
assert result['passed'], 'Benchmark validation failed; inspect JSON.'
