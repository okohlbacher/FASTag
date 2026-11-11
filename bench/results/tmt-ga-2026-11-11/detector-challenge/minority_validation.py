#!/usr/bin/env python3
"""Controlled mixtures of real spectra; not experimentally mixed/co-isolated samples."""
import json
import os
from pathlib import Path
import random
import subprocess
import base64
import struct
import xml.etree.ElementTree as ET
import zlib
from run_probe import BIN, EXPECTED, HERE, sha
HERE = HERE / "minority-validation"
HERE.mkdir(exist_ok=True)


def elements(path):
    for _, element in ET.iterparse(path, events=['end']):
        if element.tag.endswith('}spectrum'):
            yield element
            element.clear()


def params(element):
    return {e.get('accession'): e.get('value')
            for e in element.iter() if e.tag.endswith('}cvParam')}


def sample(path, pxd):
    ids, eligible = [], set()
    for s in elements(path):
        ident = s.get('id')
        ids.append(ident)
        cv = params(s)
        if cv.get('MS:1000511') == '2' and int(cv.get('MS:1000041') or 0) > 0 and int(s.get('defaultArrayLength', 0)) > 0:
            eligible.add(ident)
    random.Random(1948).shuffle(ids)
    chosen = [ident for ident in ids if ident in eligible][:1024]
    assert len(chosen) == 1024
    selected, decoded = set(chosen), {}
    for s in elements(path):
        ident = s.get('id')
        if ident not in selected:
            continue
        cv, arrays = params(s), {}
        for array in s.iter():
            if not array.tag.endswith('}binaryDataArray'):
                continue
            acv = params(array)
            kind = 'mz' if 'MS:1000514' in acv else 'intensity' if 'MS:1000515' in acv else None
            if kind is None:
                continue
            assert not any(k in acv for k in ('MS:1002312', 'MS:1002313', 'MS:1002314')), 'Numpress unsupported'
            binary = next(e for e in array if e.tag.endswith('}binary'))
            raw = base64.b64decode(binary.text or '')
            if 'MS:1000574' in acv:
                raw = zlib.decompress(raw)
            width, code = (8, 'd') if 'MS:1000523' in acv else (4, 'f')
            arrays[kind] = struct.unpack('<' + str(len(raw) // width) + code, raw)
        assert len(arrays['mz']) == len(arrays['intensity']) == int(s.get('defaultArrayLength'))
        decoded[ident] = (pxd + '__' + ident, float(cv['MS:1000744']),
                          int(cv['MS:1000041']), arrays['mz'], arrays['intensity'])
    return [decoded[ident] for ident in chosen]


assert sha(BIN) == EXPECTED
manifest = json.loads((HERE.parent / 'manifest.json').read_text())['rows']
pools = {}
for label, pxd in [('TMT', 'PXD021560'), ('TMTpro', 'PXD039509')]:
    row = next(r for r in manifest if r['pxd'] == pxd)
    path = Path(row['root']) / row['fastag_input']
    spectra = sample(path, pxd)
    pools[label] = spectra
    print('sampled', label, len(spectra), flush=True)

cases = {'pure_TMT': {'TMT': 1024}, 'pure_TMTpro': {'TMTpro': 1024},
         'TMT_pro_50_50': {'TMT': 512, 'TMTpro': 512},
         'TMT_pro_90_10': {'TMT': 922, 'TMTpro': 102},
         'TMT_pro_95_5': {'TMT': 973, 'TMTpro': 51}}
env = dict(os.environ, LD_LIBRARY_PATH='/ceph/ibmi/abi/oliver/opt/openms-develop-70cebcd144/lib:/ceph/ibmi/abi/oliver/envs/fastag-omsdev/lib')
results = []
for name, composition in cases.items():
    out = HERE / 'synthetic-mixtures' / name
    out.mkdir(parents=True, exist_ok=True)
    spectra = [s for label, n in composition.items() for s in pools[label][:n]]
    random.Random(403).shuffle(spectra)
    assert len(spectra) == 1024
    mgf = out / 'mixture.mgf'
    with mgf.open('w') as f:
        for title, mz, z, peak_mz, intensity in spectra:
            f.write(f'BEGIN IONS\nTITLE={title}\nPEPMASS={mz:.12g}\nCHARGE={z}+\n')
            for m, i in zip(peak_mz, intensity):
                f.write(f'{m:.12g} {i:.12g}\n')
            f.write('END IONS\n')
    cmd = [str(BIN), '-in', str(mgf), '-out', str(out / 'tags.tsv'),
           '-tag_length', '4', '-subsample_spectra', '1', '-threads', '2',
           '-tmt_pseudo_filter', 'auto']
    with (out / 'log.txt').open('w') as f:
        done = subprocess.run(cmd, env=env, stdout=f, stderr=subprocess.STDOUT)
    gate = [s for s in (out / 'log.txt').read_text().splitlines()
            if s.startswith('TMT pseudo-filter (auto):')]
    assert done.returncode == 0 and gate, name
    result = dict(name=name, composition=composition, input_sha256=sha(mgf),
                  binary_sha256=EXPECTED, returncode=done.returncode,
                  command=cmd, decision=gate[-1])
    results.append(result)
    print(name, result['decision'], flush=True)
(HERE / 'synthetic-mixtures.json').write_text(json.dumps(results, indent=2) + '\n')
