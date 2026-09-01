#!/usr/bin/env python3
"""PXD000001 ground-truth scorer for FASTag — rebuilt, and proven to reproduce
the numbers documented in doc/BACKLOG.md.

Recipe (matches the original 2026-07-23 measurement, recovered from the session
transcript after the scratchpad copy was lost):

  Dataset   PXD000001 — Erwinia carotovora, TMT6plex, LTQ Orbitrap Velos HCD;
            the canonical ProteomeXchange demo dataset. It ships a Mascot
            search (F063721.dat) of its own mzML, giving real per-spectrum
            PSMs without running a new search of unknown quality.
  Truth     Top hit per query from the .dat's `peptides` section, competed
            against `decoy_peptides` top hits: q-value (monotone target-decoy
            FDR) <= 1% selects score >= 16.85 — 2,254 accepted target PSMs
            out of 6,103 queries (3,085 queries have a target top hit).
  Tagging   FASTag -tag_length 4 -gaps 1 -max_tags 0 -fragment_tolerance 20
            -fragment_tolerance_unit ppm, plus three flags that pin today's
            binary to the defaults in force when the numbers were measured:
            -peaks_per_window 0 -max_peaks 100 (peak caps were raised to
            10/400 afterwards) and -fixed_modifications '' (the alphabet
            gained a default Carbamidomethyl (C) afterwards; the measurement
            used the unmodified 19-residue alphabet).
  Scoring   A tag is correct iff its I/L-folded sequence occurs in the
            I/L-folded peptide and ONE flank mass agrees within 0.05 Da:
            forward (y-series read)  |prefix[i] - nterm_mass|        <= 0.05
            reversed (b-series read) |prefix[j] - (cterm_mass+H2O)|  <= 0.05
            where prefix[] is the cumulative N-terminal residue mass of the
            identified peptide with the search's FIXED mods folded in
            (TMT6plex +229.162932 on the N-terminus and every K, Methylthio
            +45.98772 on every C). Variable mods (TMT6plex-Y, Oxidation-M)
            are deliberately NOT decoded — they cost a little recall on the
            77 accepted PSMs that carry one, evenly across gapped and
            contiguous tags, not a ranking bias. The reversed check works
            because FASTag stores flanks under a y-ion assumption, so a
            b-derived tag reads reversed and its flanks carry a one-water
            offset (see src/FASTagger.h, struct Tag).
  Ranking   Rows per spectrum sorted by the TSV's `evalue` column (already
            penalty-adjusted; the sort is stable, so ties keep file order).
            rank-1 = first row correct, top-5 = any of the first five, total
            recall = any row. Percentages are over accepted-PSM spectra that
            produced at least one tag (2,253 of 2,254).

Reproduced (this script, current build-rel/FASTag, vs doc/BACKLOG.md):

  -gap_penalty | rank-1 | top-5 | total | gapped rank-1 share | ... correct
   1           | 69.02  | 90.81 | 98.05 | 34.66               | 25.35
   100 default | 86.37  | 96.09 | 98.05 |  3.20               | 27.78
   10000       | 87.08  | 96.36 | 98.05 |  1.64               | 18.92

  documented:   69.0/86.4/87.1 | 90.8/96.1/96.4 | 98.05 flat | 34.7/3.2/1.6
  | 25.4/27.8/18.9 — every cell matches to rounding.

Usage:
  python3 tools/pxd000001_truth.py                 # run + assert default row
  python3 tools/pxd000001_truth.py --gap-penalty 1 # score another table row
  python3 tools/pxd000001_truth.py --tsv X.tsv     # score an existing TSV

The FASTag TSV is cached in --workdir and reused; delete it (or pass
--force) to re-run the tagger. On this Mac the tagger needs
DYLD_LIBRARY_PATH=/opt/homebrew/opt/libomp/lib so that every image resolves
the SAME libomp (a conda-env copy otherwise loads second and aborts with
OMP Error #15); the script sets that itself. Python 3 stdlib only.
"""

import argparse
import bisect
import csv
import os
import re
import subprocess
import sys
import urllib.parse

# --- documented inputs and numbers -----------------------------------------

DAT = '/Users/kohlbach/Claude/pxd000001/F063721.dat'
MZML = ('/Users/kohlbach/Claude/mzpeak-example-data/data/general-ms/'
        'thermo-ltq-orbitrap-velos/'
        'TMT_Erwinia_1uLSike_Top10HCD_isol2_45stepped_60min_01-20141210.mzML')
FASTAG = '/Users/kohlbach/Claude/FasTag/build-rel/FASTag'
LIBOMP_DIR = '/opt/homebrew/opt/libomp/lib'
DEFAULT_WORKDIR = ('/private/tmp/claude-501/-Users-kohlbach-Claude-OpenMS---'
                   'DirecTag/df88f9b0-cc80-48db-8780-e2bc44da5d34/scratchpad/'
                   'pxd000001')

# doc/BACKLOG.md, gap-penalty table: {penalty: (rank-1 %, top-5 %, total %)}
DOCUMENTED = {1: (69.0, 90.8, 98.05), 10: (83.0, 95.2, 98.05),
              30: (85.1, 95.7, 98.05), 100: (86.4, 96.1, 98.05),
              300: (86.8, 96.2, 98.05), 1000: (86.9, 96.4, 98.05),
              10000: (87.1, 96.4, 98.05)}
TOLERANCE_PP = 0.3   # percentage points allowed around the documented row

# --- mass model (verbatim from the original scorer) ------------------------

MASS = {
    'G': 57.02146, 'A': 71.03711, 'S': 87.03203, 'P': 97.05276, 'V': 99.06841,
    'T': 101.04768, 'C': 103.00919, 'L': 113.08406, 'I': 113.08406,
    'N': 114.04293, 'D': 115.02694, 'Q': 128.05858, 'K': 128.09496,
    'E': 129.04259, 'M': 131.04049, 'H': 137.05891, 'F': 147.06841,
    'R': 156.10111, 'Y': 163.06333, 'W': 186.07931,
}
WATER = 18.01056
FLANK_TOL = 0.05          # Da, one flank must agree
TMT = 229.162932          # TMT6plex: fixed on the N-terminus and every K
METHYLTHIO = 45.98772     # fixed on every C

# --- Mascot .dat -----------------------------------------------------------

def parse_dat(path):
    """Return (targets, decoys, scan_of_query, n_queries).

    targets/decoys map query -> (peptide, ion score) for the q<N>_p1 top
    hits; scan_of_query maps query -> mzML scan number from the URL-decoded
    query title ('mzXML scan 6989: ...').
    """
    targets, decoys, scans = {}, {}, {}
    n_queries = 0
    section = None
    hit_re = re.compile(r'^q(\d+)_p1=(.*)$')
    with open(path, 'r', errors='replace') as fh:
        for line in fh:
            line = line.rstrip('\n')
            if line.startswith('Content-Type:'):
                m = re.search(r'name="([^"]+)"', line)
                if m:
                    section = m.group(1)
                    if section.startswith('query'):
                        n_queries += 1
                continue
            if section in ('peptides', 'decoy_peptides'):
                m = hit_re.match(line)
                if not m or m.group(2).strip() == '-1':
                    continue
                fields = m.group(2).split(';')[0].split(',')
                if len(fields) < 8:
                    continue
                dest = targets if section == 'peptides' else decoys
                dest[int(m.group(1))] = (fields[4], float(fields[7]))
            elif section and section.startswith('query') and line.startswith('title='):
                sm = re.search(r'scan\s+(\d+)', urllib.parse.unquote(line[6:]),
                               re.IGNORECASE)
                if sm:
                    scans[int(section[5:])] = int(sm.group(1))
    return targets, decoys, scans, n_queries


def fdr_threshold(targets, decoys, fdr=0.01):
    """Smallest score with target-decoy q-value <= fdr (as the original:
    FDR = decoys >= s / targets >= s, made monotone from the top)."""
    tscores = sorted((s for _, s in targets.values()), reverse=True)
    dscores = sorted(s for _, s in decoys.values())
    rows = []
    for i, score in enumerate(tscores):
        n_d = len(dscores) - bisect.bisect_left(dscores, score)
        rows.append((score, n_d / (i + 1)))
    qval, running = [0.0] * len(rows), 1.0
    for i in range(len(rows) - 1, -1, -1):
        running = min(running, rows[i][1])
        qval[i] = running
    threshold = None
    for (score, _), q in zip(rows, qval):
        if q <= fdr:
            threshold = score
    n_pass = sum(1 for s in tscores if s >= threshold)
    return threshold, n_pass

# --- FASTag ----------------------------------------------------------------

def run_fastag(tsv, mzml, gap_penalty, threads, force=False):
    """Run FASTag with the measurement-era parameters; cache the TSV."""
    if os.path.exists(tsv) and os.path.getsize(tsv) > 0 and not force:
        print(f'reusing cached {tsv}')
        return
    env = dict(os.environ)
    env['DYLD_LIBRARY_PATH'] = LIBOMP_DIR  # single libomp; see module docstring
    cmd = [FASTAG, '-in', mzml, '-out', tsv,
           '-tag_length', '4', '-gaps', '1', '-gap_penalty', str(gap_penalty),
           '-max_tags', '0', '-fragment_tolerance', '20',
           '-fragment_tolerance_unit', 'ppm',
           # pin today's binary to the defaults the numbers were measured with:
           '-peaks_per_window', '0', '-max_peaks', '100',
           '-fixed_modifications', '',
           '-threads', str(threads)]
    print('running:', ' '.join(cmd))
    res = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f'FASTag failed ({res.returncode}):\n{res.stderr[-2000:]}')
    print(res.stderr.strip().splitlines()[-1] if res.stderr.strip() else 'done')

# --- scoring (verbatim semantics of the original scorer) -------------------

def prefix_masses(pep):
    """Cumulative N-terminal mass of the identified peptide, fixed mods only."""
    pref = [TMT]  # N-terminal TMT tag, present before any residue
    for c in pep:
        add = MASS.get(c, 0.0)
        if c == 'K':
            add += TMT
        elif c == 'C':
            add += METHYLTHIO
        pref.append(pref[-1] + add)
    return pref


def find_all(hay, needle):
    out, start = [], 0
    while True:
        i = hay.find(needle, start)
        if i < 0:
            return out
        out.append(i)
        start = i + 1


def tag_correct(seq, nterm_mass, cterm_mass, pep_folded, pref):
    """Forward: the tag read off the y series, nterm_mass = mass N-terminal
    of the match. Reversed: read off the b series, so the stored (reversed)
    flank carries a one-water offset: prefix = cterm_mass + H2O."""
    t = seq.replace('I', 'L')
    for i in find_all(pep_folded, t):
        if abs(pref[i] - nterm_mass) <= FLANK_TOL:
            return True
    for j in find_all(pep_folded, t[::-1]):
        if abs(pref[j] - (cterm_mass + WATER)) <= FLANK_TOL:
            return True
    return False


def score(tsv, gt):
    """gt: scan -> peptide. Returns the stats dict of the original scorer."""
    by_scan = {}
    with open(tsv) as fh:
        for row in csv.DictReader(fh, delimiter='\t'):
            m = re.search(r'scan=(\d+)', row['spectrum'])
            if not m:
                continue
            scan = int(m.group(1))
            if scan in gt:
                by_scan.setdefault(scan, []).append(row)

    st = dict(n_gt=len(gt), with_tags=0, rank1=0, top5=0, total=0,
              g1=0, g1_correct=0)
    for scan, pep in gt.items():
        rows = by_scan.get(scan)
        if not rows:
            continue
        st['with_tags'] += 1
        pep_folded = pep.replace('I', 'L')
        pref = prefix_masses(pep_folded)
        rows = sorted(rows, key=lambda r: float(r['evalue']))  # stable: ties keep file order
        ok = [tag_correct(r['tag'], float(r['nterm_mass']),
                          float(r['cterm_mass']), pep_folded, pref)
              for r in rows]
        st['rank1'] += ok[0]
        st['top5'] += any(ok[:5])
        st['total'] += any(ok)
        if rows[0]['gapped'] == '1':
            st['g1'] += 1
            st['g1_correct'] += ok[0]
    return st

# --- main ------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dat', default=DAT)
    ap.add_argument('--mzml', default=MZML)
    ap.add_argument('--gap-penalty', type=float, default=100.0)
    ap.add_argument('--tsv', help='score this TSV instead of running FASTag')
    ap.add_argument('--workdir', default=DEFAULT_WORKDIR)
    ap.add_argument('--threads', type=int, default=8)
    ap.add_argument('--force', action='store_true', help='re-run FASTag even if cached')
    ap.add_argument('--no-assert', action='store_true')
    args = ap.parse_args()

    # 1. ground truth
    targets, decoys, scans, n_queries = parse_dat(args.dat)
    thr, n_pass = fdr_threshold(targets, decoys)
    print(f'queries {n_queries}; target top hits {len(targets)}; '
          f'decoy top hits {len(decoys)}')
    print(f'FDR<=1%: score >= {thr}  ->  {n_pass} accepted target PSMs')
    if not args.no_assert:
        assert n_queries == 6103, n_queries
        assert len(targets) == 3085, len(targets)
        assert abs(thr - 16.85) < 0.005, thr
        assert n_pass == 2254, n_pass
    gt = {scans[q]: pep for q, (pep, sc) in sorted(targets.items())
          if sc >= thr and q in scans}

    # 2. tags
    if args.tsv:
        tsv = args.tsv
    else:
        os.makedirs(args.workdir, exist_ok=True)
        gp = f'{args.gap_penalty:g}'
        tsv = os.path.join(args.workdir, f'pxd000001_tl4_g1_gp{gp}.tsv')
        run_fastag(tsv, args.mzml, gp, args.threads, args.force)

    # 3. score
    st = score(tsv, gt)
    n = st['with_tags']
    pct = {k: 100.0 * st[k] / n for k in ('rank1', 'top5', 'total')}
    print(f"accepted-PSM spectra {st['n_gt']}, with >=1 tag {n}")
    print(f"rank-1: {st['rank1']:5d}  ({pct['rank1']:.2f}%)")
    print(f"top-5 : {st['top5']:5d}  ({pct['top5']:.2f}%)")
    print(f"total : {st['total']:5d}  ({pct['total']:.2f}%)")
    print(f"gapped share of rank-1: {st['g1']} ({100.0*st['g1']/n:.2f}%); "
          f"of those correct: {st['g1_correct']} "
          f"({100.0*st['g1_correct']/st['g1']:.2f}%)" if st['g1'] else
          'no gapped rank-1 rows')

    # 4. prove reproduction of the documented row
    doc = DOCUMENTED.get(args.gap_penalty)
    if doc:
        dev = [pct['rank1'] - doc[0], pct['top5'] - doc[1], pct['total'] - doc[2]]
        print(f'documented (gap_penalty {args.gap_penalty:g}): '
              f'{doc[0]}/{doc[1]}/{doc[2]}; deviation '
              f'{dev[0]:+.2f}/{dev[1]:+.2f}/{dev[2]:+.2f} pp')
        if not args.no_assert:
            for name, d in zip(('rank-1', 'top-5', 'total'), dev):
                assert abs(d) <= TOLERANCE_PP, (
                    f'{name} off by {d:+.2f} pp (allowed +-{TOLERANCE_PP})')
            print(f'REPRODUCED within +-{TOLERANCE_PP} pp.')


if __name__ == '__main__':
    main()
