#!/usr/bin/env python3
"""Run a fixed metadata-stratified challenge of the existing TMT automatic gate."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
BIN = Path('/ceph/ibmi/abi/oliver/fastag-tmt-filter-20261111/bin/FASTag-feature')
EXPECTED = '81d2d34df21c1d3f752e947fcded203ace1b3ee820190d4bd8ad8d17672b07eb'


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(4 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


if __name__ == '__main__':
    assert sha(BIN) == EXPECTED, 'Existing binary changed; freeze a new challenge explicitly.'
    env = dict(os.environ,
               LD_LIBRARY_PATH='/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/lib:/ceph/ibmi/abi/oliver/envs/fastag-omsdev/lib',
               OPENMS_TMPDIR='/dev/shm/kohlbach-tmt-detector-challenge',
               FASTAG_FULL_PRECISION='1')
    Path(env['OPENMS_TMPDIR']).mkdir(exist_ok=True)
    rows = json.loads((HERE / 'manifest.json').read_text())['rows']
    for r in rows:
        source = Path(r['root']) / r['fastag_input']
        digest = sha(source)
        assert digest == r['fastag_input_sha256'], (source, 'source checksum changed')
        modes = [('primary', r['primary_tolerance'])]
        if r['ms2_analyzer'] == 'IT':
            modes.append(('ppm_stress', '20 ppm'))
        for mode, tol in modes:
            out = HERE / 'runs' / r['id'] / mode
            out.mkdir(parents=True, exist_ok=True)
            value, unit = tol.split()
            cmd = [str(BIN), '-in', str(source), '-out', str(out / 'tags.tsv'),
                   '-tag_length', '4', '-extension', '0', '-gaps', '1',
                   '-max_tags', '50', '-max_evalue', '20', '-threads', '2',
                   '-subsample_spectra', '1', '-fragment_tolerance', value,
                   '-fragment_tolerance_unit', unit, '-tmt_pseudo_filter', 'auto']
            start = time.monotonic()
            with (out / 'log.txt').open('w') as f:
                done = subprocess.run(cmd, env=env, stdout=f, stderr=subprocess.STDOUT)
            elapsed = time.monotonic() - start
            lines = (out / 'log.txt').read_text().splitlines()
            gate = [x for x in lines if x.startswith('TMT pseudo-filter (auto):')]
            result = dict(id=r['id'], truth=r['label_class'], analyzer=r['ms2_analyzer'],
                          acquisition=r['acquisition'], mode=mode, tolerance=tol,
                          source_sha256=digest, binary_sha256=EXPECTED, command=cmd,
                          elapsed_seconds=elapsed, returncode=done.returncode,
                          decision=gate[-1] if gate else None)
            (out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
            with (HERE / 'results.jsonl').open('a') as f:
                f.write(json.dumps(result) + '\n')
            print(r['id'], mode, done.returncode, f'{elapsed:.2f}s', result['decision'], flush=True)
            assert done.returncode == 0 and gate, result
