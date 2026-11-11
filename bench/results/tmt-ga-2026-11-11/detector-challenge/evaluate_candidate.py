#!/usr/bin/env python3
"""Apply frozen old/candidate gate rules to observed pre-filter probe counts."""
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent


def evaluate(message, minimum):
    counts = {k: int(v) for k, v in re.findall(
        r'(eligible|threshold|TMT_N|TMT_K|TMTpro_N|TMTpro_K)=(\d+)', message)}
    veto_limit = max(minimum, (counts['eligible'] + 99) // 100)
    if 'Da_tolerance' in message or counts['eligible'] < 100:
        on = False
    else:
        on = (counts['TMT_N'] >= counts['threshold'] and
              counts['TMT_K'] >= counts['threshold'] and not
              (counts['TMTpro_N'] >= veto_limit and counts['TMTpro_K'] >= veto_limit))
    return on, veto_limit, counts


records = []
for row in json.loads((HERE / 'old-main-gate-decisions.json').read_text()):
    if row['arm'] == 'auto':
        records.append(dict(source='old_main', id=row['dataset'] + '/' + row['chemistry'],
                            message=row['messages'][0]))
for row in json.loads((HERE / 'summary.json').read_text())['rows']:
    records.append(dict(source='challenge', id=row['id'] + '/' + row['mode'], message=row['decision']))
for source, path in [('development_mixtures', HERE / 'synthetic-mixtures.json'),
                     ('validation_mixtures', HERE / 'minority-validation' / 'synthetic-mixtures.json')]:
    if path.exists():
        for row in json.loads(path.read_text()):
            records.append(dict(source=source, id=row['name'], message=row['decision']))
for record in records:
    old, _, counts = evaluate(record['message'], 20)
    candidate, limit, _ = evaluate(record['message'], 5)
    assert old == ('(auto): on;' in record['message']), record
    record.update(old_on=old, candidate_on=candidate, candidate_veto_limit=limit, counts=counts)
result = dict(rule='Keep TMT positive gate unchanged; veto when BOTH ~304-Da site counts >= max(5,ceil(eligible/100)).',
              records=records, changed=[r for r in records if r['old_on'] != r['candidate_on']])
(HERE / 'candidate-evaluation.json').write_text(json.dumps(result, indent=2) + '\n')
for record in records:
    if record['source'] == 'validation_mixtures' or record in result['changed']:
        print(record['source'], record['id'], 'old', record['old_on'], 'candidate', record['candidate_on'],
              'veto_limit', record['candidate_veto_limit'], 'counts', record['counts'])
print(len(records), 'records checked;', len(result['changed']), 'changed decisions')
