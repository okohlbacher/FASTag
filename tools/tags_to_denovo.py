#!/usr/bin/env python3
"""Export FASTag ``-res_conf`` tags as de-novo "reads" for Stitch or ALPS.

FASTag (with ``-res_conf``) writes a tags TSV whose ``res_conf`` column holds
one integer 0..100 per residue, N->C.  Antibody-assembly consumers want those
tags as de novo *reads*:

* ``--format stitch`` (default): the PEAKS ``Old`` CSV that snijderlab/stitch
  parses **positionally** as 15 fixed columns.  Layout read from
  snijderlab/stitch master 2026-09: ``FileFormat.cs:30-48``
  (``PeaksFileFormat.OldFormat()`` -- scan=0, peptide=1, tag_length=2, alc=3,
  length=4, mz=5, z=6, rt=7, area=8, mass=9, ppm=10, ptm=11,
  local_confidence=12, tag=13, mode=14) and ``Read.cs:316,380-385,234``.
* ``--format alps``: the 5-column CSV denisbeslic/denovopipeline feeds
  ALPS.jar (``src/assembly.py``, ``alps_df`` = Spectrum Name / Peptide /
  aaScore / Score / Area).  ALPS itself documents no input format -- this
  layout is inferred from that one pipeline and is LOWER-CONFIDENCE than the
  Stitch half.

Why Area differs per consumer (the NaN trap)
    Stitch's intensity for a read is ``(log10(Area)-min)/(max-min)`` over the
    log10-areas of all reads with ``Area != 0`` (Read.cs:234 getter,
    min/max accumulation at Read.cs:393-398).  A *constant nonzero* Area --
    e.g. the tempting ``Area=1`` on every row -- makes ``min == max`` and the
    normalization 0/0 = NaN for every read.  ``Area == 0`` short-circuits the
    getter to a constant intensity of 1, which is the only honest value for a
    tagger that exports no XIC areas.  So: **Area 0 for Stitch**.
    denovopipeline, by contrast, hard-codes ``summary_df['Area'] = 1`` ("is
    nedded for ALPS", assembly.py:169) for every read it hands ALPS.jar.
    So: **Area 1 for ALPS**.  Same word, opposite constants, both vendor
    requirements -- do not "fix" either.

Why --top-n 1
    FASTag emits up to 50 tags per spectrum, but they are correlated re-reads
    of ONE fragment-ion ladder, not independent observations.  Exporting them
    all inflates assembly consensus depth ~50x -- a coverage/specificity claim
    the data cannot back.  Default keeps only the best (lowest-evalue) tag per
    spectrum.

Why L, never J
    Stitch's shipped alphabets (blosum62.csv, default_alphabet.csv) contain no
    ``J`` (the ProForma I/L wildcard); an emitted J would fail alignment.  We
    emit ``L`` verbatim as FASTag spells it.

I/L caveat
    Fragment masses cannot distinguish I from L, so contigs will show L where
    I may be the correct residue -- including inside CDRs, exactly where
    antibody assembly cares most.  Unrecoverable from MS2 alone
    (Stitch's own "Natural19WithoutI" situation); flag it in any report built
    on these reads.

Flanks
    ``nterm_mass``/``cterm_mass`` go into Stitch's free-text PTM column as
    ``n=<nterm>;c=<cterm>`` -- metadata only; neither assembler weights them.

Self-validation
    ``--check`` re-parses the EMITTED file with a re-implementation of the
    consumer's parser constraints (Stitch Old: 15 positional comma-split
    fields with no quoting -- ParseHelper.cs SplitLine; confidence ints whose
    count equals the IsUpper-and-IsLetter character count of the peptide
    column -- Read.cs:316,380-385; Area constant 0) and exits nonzero on any
    violation, with line numbers.
"""

import argparse
import csv
import math
import os
import re
import sys

# PEAKS-style deltas for FASTag's inline X[ModName] annotations.
# Values are strings so the emitted spelling is deterministic.
MOD_DELTAS = {
    "oxidation": "+15.99",
    "phospho": "+79.97",
    "carbamidomethyl": "+57.02",
    "acetyl": "+42.01",
    "deamidated": "+0.98",
}

STITCH_HEADER = (
    "Scan,Peptide,Tag Length,ALC (%),length,m/z,z,RT,Area,Mass,ppm,PTM,"
    "local confidence,tag,mode"
)
ALPS_HEADER = ["Spectrum Name", "Peptide", "aaScore", "Score", "Area"]

TAG_TOKEN = re.compile(r"([A-Z])(?:\[([^\]]*)\])?")

REQUIRED_COLUMNS = (
    "spectrum", "tag", "length", "charge", "nterm_mass", "cterm_mass",
    "evalue", "res_conf",
)


def parse_tag(tag):
    """Split a tag like ``AS[Phospho]DK`` into [(residue, mod-or-None), ...].

    Returns None when the tag does not fully match residue(+annotation)
    grammar (the row is then skipped with a note).
    """
    residues = []
    pos = 0
    for m in TAG_TOKEN.finditer(tag):
        if m.start() != pos:
            return None
        residues.append((m.group(1), m.group(2)))
        pos = m.end()
    if pos != len(tag) or not residues:
        return None
    return residues


class Row:
    __slots__ = ("spectrum", "residues", "confs", "charge", "nterm", "cterm",
                 "evalue", "order")

    def __init__(self, spectrum, residues, confs, charge, nterm, cterm,
                 evalue, order):
        self.spectrum = spectrum
        self.residues = residues        # [(res, mod-or-None), ...]
        self.confs = confs              # [int, ...] verbatim from res_conf
        self.charge = charge
        self.nterm = nterm
        self.cterm = cterm
        self.evalue = evalue
        self.order = order


def read_tsv(path, min_length, notes):
    """Parse the FASTag tags TSV. Returns (rows, n_read, n_short, n_bad)."""
    rows, n_read, n_short, n_bad = [], 0, 0, 0
    with open(path, newline="") as fh:
        header_line = fh.readline()
        if not header_line:
            sys.exit(f"error: {path} is empty")
        header = header_line.rstrip("\r\n").split("\t")
        idx = {name: i for i, name in enumerate(header)}
        missing = [c for c in REQUIRED_COLUMNS if c not in idx]
        if missing:
            hint = (" (re-run FASTag with -res_conf)"
                    if "res_conf" in missing else "")
            sys.exit(f"error: {path} lacks column(s) {', '.join(missing)}"
                     f"{hint}; header has: {', '.join(header)}")
        for lineno, line in enumerate(fh, start=2):
            line = line.rstrip("\r\n")
            if not line:
                continue
            n_read += 1
            f = line.split("\t")
            if len(f) < len(header):
                n_bad += 1
                notes.append(f"line {lineno}: {len(f)} fields, "
                             f"expected {len(header)} -- skipped")
                continue
            tag = f[idx["tag"]]
            residues = parse_tag(tag)
            if residues is None:
                n_bad += 1
                notes.append(f"line {lineno}: unparseable tag {tag!r} "
                             "-- skipped")
                continue
            conf_txt = f[idx["res_conf"]].split()
            try:
                confs = [int(c) for c in conf_txt]
            except ValueError:
                n_bad += 1
                notes.append(f"line {lineno}: non-integer res_conf -- skipped")
                continue
            if not (len(residues) == len(confs) == int(f[idx["length"]])):
                n_bad += 1
                notes.append(
                    f"line {lineno}: residue/length/res_conf count mismatch "
                    f"({len(residues)}/{f[idx['length']]}/{len(confs)}) "
                    "-- skipped")
                continue
            if any(c < 0 or c > 100 for c in confs):
                n_bad += 1
                notes.append(f"line {lineno}: res_conf outside 0..100 "
                             "-- skipped")
                continue
            if len(residues) < min_length:
                n_short += 1
                continue
            try:
                evalue = float(f[idx["evalue"]])
            except ValueError:
                evalue = math.inf
                notes.append(f"line {lineno}: unparseable evalue "
                             f"{f[idx['evalue']]!r} -- ranked last")
            try:
                charge = str(int(f[idx["charge"]]))
            except ValueError:
                charge = "0"
            rows.append(Row(f[idx["spectrum"]], residues, confs, charge,
                            f[idx["nterm_mass"]], f[idx["cterm_mass"]],
                            evalue, n_read))
    return rows, n_read, n_short, n_bad


def thin_top_n(rows, top_n):
    """Keep the top_n lowest-evalue rows per spectrum (stable on ties).

    Applied AFTER the --min-length filter, so a spectrum whose best tag is
    short still contributes its best long-enough tag.
    """
    by_spec = {}
    spec_order = []
    for r in rows:
        if r.spectrum not in by_spec:
            by_spec[r.spectrum] = []
            spec_order.append(r.spectrum)
        by_spec[r.spectrum].append(r)
    kept = []
    for spec in spec_order:
        group = sorted(by_spec[spec], key=lambda r: (r.evalue, r.order))
        kept.extend(group[:top_n])
    return kept


def spell_peptide(residues, unknown_mods):
    """PEAKS-style modified spelling: S[Phospho] -> S(+79.97).

    Unknown mod names are stripped (bare residue) and tallied. The delta
    spelling contains no uppercase letters, so Stitch's
    IsUpper-and-IsLetter sequence extraction (Read.cs:316) sees exactly the
    bare residues -- an inline [ModName] would leak its uppercase letters
    into the sequence, which is why annotations are converted, never
    passed through.
    """
    out = []
    for res, mod in residues:
        if mod is None:
            out.append(res)
            continue
        delta = MOD_DELTAS.get(mod.lower())
        if delta is None:
            unknown_mods[mod] = unknown_mods.get(mod, 0) + 1
            out.append(res)
        else:
            out.append(f"{res}({delta})")
    return "".join(out)


def alc(confs):
    return str(int(round(sum(confs) / len(confs))))


def write_stitch(rows, out_path, unknown_mods):
    """Emit the PEAKS `Old` 15-column positional CSV.

    Stitch splits on ',' with NO quote handling (ParseHelper.cs SplitLine),
    so every field must be comma-free; the Scan field additionally truncates
    at the first ';' (Read.cs Split(';')[0]) -- both are replaced with '_'.
    A trailing empty `mode` field survives SplitLine (it always appends the
    remainder), keeping the count at 15.
    """
    with open(out_path, "w", newline="") as fh:
        fh.write(STITCH_HEADER + "\n")
        for r in rows:
            scan = r.spectrum.replace(",", "_").replace(";", "_")
            n = str(len(r.residues))
            fields = [
                scan,                                    # 0 Scan
                spell_peptide(r.residues, unknown_mods),  # 1 Peptide
                n,                                       # 2 Tag Length
                alc(r.confs),                            # 3 ALC (%)
                n,                                       # 4 length
                "0",                                     # 5 m/z (not exported)
                r.charge,                                # 6 z
                "0",                                     # 7 RT (not exported)
                "0",                                     # 8 Area -- MUST be 0
                "0",                                     # 9 Mass (not exported)
                "0",                                     # 10 ppm (not exported)
                f"n={r.nterm};c={r.cterm}",              # 11 PTM (flanks, free text)
                " ".join(str(c) for c in r.confs),       # 12 local confidence
                "".join(res for res, _ in r.residues),   # 13 tag (bare)
                "",                                      # 14 mode
            ]
            for f in fields:
                assert "," not in f, f"comma survived sanitization: {f!r}"
            fh.write(",".join(fields) + "\n")


def write_alps(rows, out_path):
    """Emit the 5-column CSV denovopipeline feeds ALPS.jar.

    Mods are stripped to bare residues; the pipeline's own length check
    (assembly.py: len(peptide) != len(aaScore list) -> row dropped) then
    holds by construction. Area is hard-coded 1 exactly as
    assembly.py:169 does.
    """
    with open(out_path, "w", newline="") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(ALPS_HEADER)
        for r in rows:
            w.writerow([
                r.spectrum.replace(",", "_"),
                "".join(res for res, _ in r.residues),
                " ".join(str(c) for c in r.confs),
                alc(r.confs),
                "1",
            ])


def write_batchfile(batch_path, csv_path):
    csv_abs = os.path.abspath(csv_path)
    snippet = f"""\
- Stitch input snippet for FASTag reads, generated by tags_to_denovo.py.
- CutoffALC below is a PLACEHOLDER. It MUST be set from the step-2
- calibration measurement (doc/BACKLOG-PLAN-2026-09.md, F14 validation
- gate), NEVER Stitch's default 90: FASTag's ALC derives from res_conf,
- and the median min_conf for CORRECT tags is ~0.45 on PXD000001
- (doc/BACKLOG.md) -- a cutoff of 90 on this scale discards nearly
- every correct read.
Input ->
    Peaks ->
        Path     : {csv_abs}
        Format   : Old
        Name     : FASTag
        CutoffALC: <MEASURED>
    <-
<-
"""
    with open(batch_path, "w") as fh:
        fh.write(snippet)


def check_stitch(path):
    """Re-parse an emitted Stitch CSV with the consumer's constraints.

    Mimics stitch's ParseHelper.cs SplitLine (plain comma split, no quoting,
    trailing field kept, fields trimmed) + Read.cs: sequence = IsUpper and
    IsLetter chars of the peptide column (:316); local confidence =
    space-separated integers, count == sequence length (:380-385); Area must
    be constant 0 (:234 NaN trap). Returns a list of violation strings.
    """
    violations = []
    with open(path, newline="") as fh:
        lines = fh.read().split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if not lines:
        return [f"{path}: empty file"]
    for lineno, line in enumerate(lines[1:], start=2):
        fields = [f.strip() for f in line.split(",")]
        if len(fields) != 15:
            violations.append(
                f"line {lineno}: {len(fields)} fields, expected exactly 15 "
                "(Stitch Old is positional; a stray comma shifts every "
                "column)")
            continue
        peptide = fields[1]
        seq = [c for c in peptide if c.isupper() and c.isalpha()]
        if not seq:
            violations.append(f"line {lineno}: empty sequence in peptide "
                              f"column {peptide!r}")
        if "[" in peptide or "]" in peptide:
            violations.append(
                f"line {lineno}: raw [ModName] annotation left in peptide "
                f"{peptide!r} -- its uppercase letters would corrupt "
                "Stitch's extracted sequence")
        conf_txt = fields[12].split(" ")
        confs = []
        for tok in conf_txt:
            try:
                confs.append(int(tok))
            except ValueError:
                violations.append(
                    f"line {lineno}: local confidence token {tok!r} is not "
                    "an integer (Convert.ToInt32 throws)")
                confs = None
                break
        if confs is not None:
            if len(confs) != len(seq):
                violations.append(
                    f"line {lineno}: {len(confs)} confidence values for "
                    f"{len(seq)} sequence residues (SetPositionalScore "
                    "rejects the read)")
            elif any(c < 0 or c > 100 for c in confs):
                violations.append(
                    f"line {lineno}: confidence outside 0..100: {confs}")
        if fields[8] != "0":
            violations.append(
                f"line {lineno}: Area is {fields[8]!r}, must be constant 0 "
                "for Stitch (constant nonzero => min==max => NaN intensity, "
                "Read.cs:234)")
        for pos, name in ((2, "Tag Length"), (4, "length"), (6, "z")):
            try:
                int(fields[pos])
            except ValueError:
                violations.append(f"line {lineno}: {name} {fields[pos]!r} "
                                  "is not an integer")
        for pos, name in ((3, "ALC (%)"), (5, "m/z"), (7, "RT"),
                          (9, "Mass"), (10, "ppm")):
            try:
                float(fields[pos])
            except ValueError:
                violations.append(f"line {lineno}: {name} {fields[pos]!r} "
                                  "is not a number")
        if not fields[0]:
            violations.append(f"line {lineno}: empty Scan identifier")
    return violations


def check_alps(path):
    """Validate an emitted ALPS CSV against denovopipeline's checks:
    5 columns; aaScore floats whose count == len(peptide string); Area 1;
    bare uppercase peptide (mods must have been stripped)."""
    violations = []
    with open(path, newline="") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            return [f"{path}: empty file"]
        if len(header) != 5:
            violations.append(f"line 1: {len(header)} header columns, "
                              "expected 5")
        for lineno, fields in enumerate(reader, start=2):
            if len(fields) != 5:
                violations.append(f"line {lineno}: {len(fields)} fields, "
                                  "expected 5")
                continue
            peptide = fields[1]
            if not peptide or not all(c.isupper() and c.isalpha()
                                      for c in peptide):
                violations.append(
                    f"line {lineno}: peptide {peptide!r} is not bare "
                    "uppercase residues (mods must be stripped for ALPS)")
            try:
                scores = [float(t) for t in fields[2].split()]
            except ValueError:
                violations.append(f"line {lineno}: non-numeric aaScore "
                                  f"{fields[2]!r}")
                scores = None
            if scores is not None and len(scores) != len(peptide):
                violations.append(
                    f"line {lineno}: {len(scores)} aaScores for "
                    f"{len(peptide)} residues (denovopipeline drops the "
                    "row)")
            try:
                float(fields[3])
            except ValueError:
                violations.append(f"line {lineno}: non-numeric Score "
                                  f"{fields[3]!r}")
            if fields[4] != "1":
                violations.append(f"line {lineno}: Area is {fields[4]!r}, "
                                  "must be constant 1 for ALPS "
                                  "(denovopipeline assembly.py:169)")
    return violations


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="tags_to_denovo.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=(
            "Export a FASTag -res_conf tags TSV as de-novo reads for "
            "antibody assembly.\n\n"
            "  stitch : PEAKS 'Old' 15-column positional CSV "
            "(snijderlab/stitch, verified\n"
            "           against FileFormat.cs:30-48 / Read.cs:316,380-385,"
            "234, master 2026-09).\n"
            "  alps   : 5-column CSV as fed to ALPS.jar by "
            "denisbeslic/denovopipeline.\n"
            "           LOWER-CONFIDENCE: ALPS documents no input format; "
            "this layout is\n"
            "           inferred from that one pipeline's assembly.py."),
        epilog=(
            "--top-n defaults to 1 because FASTag's <=50 tags per spectrum "
            "are correlated\n"
            "re-reads of one fragment ladder, not independent observations; "
            "exporting all\n"
            "of them inflates assembly consensus depth ~50x. --min-length "
            "defaults to 8:\n"
            "ALPS assembles k-mers (k=6..8) and gets zero k-mers from "
            "shorter reads, and\n"
            "Stitch template matching needs overlap. Area is 0 for stitch "
            "and 1 for alps\n"
            "by vendor requirement (see the module docstring for the NaN "
            "trap). Filters\n"
            "apply min-length first, then top-n per spectrum."),
    )
    ap.add_argument("input", help="FASTag tags TSV (needs the -res_conf "
                    "column); with --check and no -o, an already-emitted "
                    "CSV to validate")
    ap.add_argument("--format", choices=("stitch", "alps"), default="stitch",
                    dest="fmt", help="output flavor (default: stitch)")
    ap.add_argument("-o", "--out", help="output CSV path (required unless "
                    "running --check on an emitted CSV)")
    ap.add_argument("--top-n", type=int, default=1, metavar="N",
                    help="best (lowest-evalue) tags kept per spectrum "
                    "(default: 1; see epilog)")
    ap.add_argument("--min-length", type=int, default=8, metavar="N",
                    help="drop reads shorter than N residues (default: 8)")
    ap.add_argument("--check", action="store_true",
                    help="validate the EMITTED file against the consumer's "
                    "re-implemented parser constraints; with -o, convert "
                    "then validate; without -o, treat INPUT as the emitted "
                    "CSV")
    ap.add_argument("--batchfile", metavar="OUT.txt",
                    help="also write a minimal Stitch batchfile snippet "
                    "pointing at the CSV (stitch only); its CutoffALC is a "
                    "placeholder that must come from the calibration "
                    "measurement, never Stitch's default 90")
    args = ap.parse_args(argv)

    if args.batchfile and args.fmt != "stitch":
        ap.error("--batchfile only applies to --format stitch")
    if not args.out and not args.check:
        ap.error("-o/--out is required (or use --check on an emitted CSV)")
    if args.top_n < 1:
        ap.error("--top-n must be >= 1")

    checker = check_stitch if args.fmt == "stitch" else check_alps

    if args.out:
        notes = []
        unknown_mods = {}
        rows, n_read, n_short, n_bad = read_tsv(args.input, args.min_length,
                                                notes)
        rows = thin_top_n(rows, args.top_n)
        if args.fmt == "stitch":
            write_stitch(rows, args.out, unknown_mods)
        else:
            write_alps(rows, args.out)
        if args.batchfile:
            write_batchfile(args.batchfile, args.out)
        for note in notes:
            print(f"note: {note}", file=sys.stderr)
        for mod, count in sorted(unknown_mods.items()):
            print(f"note: unknown mod name {mod!r} stripped from {count} "
                  f"read(s) -- not in the built-in delta map "
                  f"({', '.join(sorted(MOD_DELTAS))})", file=sys.stderr)
        print(f"{args.input}: {n_read} rows -> {len(rows)} reads written to "
              f"{args.out} ({args.fmt}; {n_short} below --min-length "
              f"{args.min_length}, {n_bad} malformed, top-n {args.top_n} "
              "per spectrum)", file=sys.stderr)
        if args.batchfile:
            print(f"batchfile snippet: {args.batchfile} (set CutoffALC from "
                  "the calibration measurement)", file=sys.stderr)
        target = args.out
    else:
        target = args.input

    if args.check:
        violations = checker(target)
        if violations:
            for v in violations:
                print(f"CHECK FAIL {target}: {v}", file=sys.stderr)
            print(f"--check: {len(violations)} violation(s) in {target}",
                  file=sys.stderr)
            return 1
        print(f"--check: {target} conforms ({args.fmt})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
