#!/usr/bin/env python3
"""Re-run frozen 31+7+5 detector inputs with a supplied final binary/hash."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
binary, expected_sha = sys.argv[1:3]


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def counts(message):
    return {k: int(v) for k, v in re.findall(
        r'(?<![A-Za-z_])(eligible|threshold|TMT_N|TMT_K|TMTpro_N|TMTpro_K)=(\d+)', message)}


def candidate(message):
    c = counts(message)
    veto = max(5, (c['eligible'] + 99) // 100)
    return ('Da_tolerance' not in message and c['eligible'] >= 100 and
            c['TMT_N'] >= c['threshold'] and c['TMT_K'] >= c['threshold'] and not
            (c['TMTpro_N'] >= veto and c['TMTpro_K'] >= veto))


assert sha(binary) == expected_sha
out = HERE / 'final-binary-validation'
out.mkdir(exist_ok=True)
env = dict(os.environ, LD_LIBRARY_PATH='/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/lib:/ceph/ibmi/abi/oliver/envs/fastag-omsdev/lib')
rows = [dict(row, group='challenge', name=row['id'] + '__' + row['mode'])
        for row in map(json.loads, (HERE / 'results.jsonl').read_text().splitlines())]
for group, path in [('development_mixtures', HERE / 'synthetic-mixtures.json'),
                    ('validation_mixtures', HERE / 'minority-validation' / 'synthetic-mixtures.json')]:
    rows += [dict(row, group=group) for row in json.loads(path.read_text())]
assert len(rows) == 43
checked, results = {}, []
for row in rows:
    case = out / row['group'] / row['name']
    case.mkdir(parents=True, exist_ok=True)
    cmd = row['command'][:]
    cmd[0] = binary
    source = cmd[cmd.index('-in') + 1]
    if source not in checked:
        checked[source] = sha(source)
        assert checked[source] == row.get('source_sha256', row.get('input_sha256')), source
    cmd[cmd.index('-out') + 1] = str(case / 'tags.tsv')
    with (case / 'log.txt').open('w') as f:
        done = subprocess.run(cmd, env=env, stdout=f, stderr=subprocess.STDOUT)
    messages = [s for s in (case / 'log.txt').read_text().splitlines()
                if s.startswith('TMT pseudo-filter (auto):')]
    assert done.returncode == 0 and len(messages) == 1, (row['name'], done.returncode)
    message = messages[0]
    result = dict(group=row['group'], name=row['name'], command=cmd,
                  binary_sha256=expected_sha, source_sha256=checked[source],
                  returncode=done.returncode, old_decision=row['decision'],
                  decision=message, counts_identical=counts(message) == counts(row['decision']),
                  matches_frozen_candidate=('(auto): on;' in message) == candidate(row['decision']))
    results.append(result)
    (case / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(row['group'], row['name'], message, flush=True)
    assert result['counts_identical'] and result['matches_frozen_candidate'], result
(out / 'summary.json').write_text(json.dumps(dict(binary_sha256=expected_sha,
    count=len(results), passed=all(r['counts_identical'] and r['matches_frozen_candidate'] for r in results),
    results=results), indent=2) + '\n')
