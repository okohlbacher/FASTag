"""Per-run SILAC truth of PREREG-silac-v2 (section 3.3) from the deposited searches only. No FASTag output is read.

Usage: python3 -I truth_silac_v2.py MANIFEST PXD_ROOT WORKDIR OUT_TSV

MANIFEST  heldout/manifest-silac-heldout-v2.tsv (frozen run list)
PXD_ROOT  the mirror (/ceph/ibmi/abi/data/PXD); search files are read from <PXD>/raw/
WORKDIR   scratch for unpacking archives (zip, tar, 7z, gz)

Per run r and label L (Lys4, Arg6, Lys8, Arg10): h_L = identifications carrying L, e_L = identifications whose
peptide ends in L's residue (K or R, the C-terminal residue whatever its label), share_L = h_L / e_L.
present: h_L >= 20 and share_L >= 0.05; absent: the search could see L and (h_L <= 2 or share_L <= 0.005), or
the search could not see L (L not among its labels: T1-design); otherwise ambiguous. Identifications:
MaxQuant evidence rows identified by MS/MS (MS/MS count >= 1, labeling state >= 0); FragPipe psm.tsv rows;
FragPipe peptide.tsv rows when only those exist (tier T1-peptide); pepXML top hits with PeptideProphet
probability >= 0.95; mzIdentML rank-1 items that pass the threshold. Label-free projects: T2, all absent.
A run with no row in its search is 'no_search' (every label ambiguous, out of the per-label endpoints).
Projects labelled only with an untested label (Lys6) are 'other_label' (listed, not scored). Renamed deposits
are matched by RAWMAP; a search deposited without its label set takes STATES from the deposited protocol text.
"""
import csv, glob, gzip, io, os, re, shutil, subprocess, sys, tarfile, zipfile, collections
import xml.etree.ElementTree as ET

LABELS = ("Lys4", "Arg6", "Lys8", "Arg10")
RES = {"Lys4": "K", "Arg6": "R", "Lys8": "K", "Arg10": "R"}
DELTA = {"Lys4": 4.025107, "Arg6": 6.020129, "Lys8": 8.014199, "Arg10": 10.008269}
RESMASS = {"K": 128.09496, "R": 156.10111}
csv.field_size_limit(1 << 30)


def stem(name):
    return re.sub(r"(\.d\.zip|\.d|\.raw|\.mzML|\.mgf|\.mzXML)$", "", os.path.basename(name.replace("\\", "/")), flags=re.I)


KEEP = re.compile(r"(evidence\.txt|mqpar\.xml|summary\.txt|parameters\.txt|psm\.tsv|\.pep\.xml|\.pepXML|\.mzid|"
                  r"_peptide_label_quant\.tsv|fragger\.params|\.(zip|tar|7z|gz))$", re.I)


def unpack(path, work):
    """The search-relevant files inside an archive (recursively; KEEP), as paths under work."""
    out = os.path.join(work, os.path.basename(path) + ".x")
    if not os.path.exists(out):
        tmp = out + ".tmp"; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
        if path.endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                z.extractall(tmp, [m for m in z.namelist() if KEEP.search(m) and not m.endswith("/")])
        elif path.endswith((".tar", ".tar.gz", ".tgz")):
            with tarfile.open(path) as t:
                t.extractall(tmp, [m for m in t.getmembers() if m.isfile() and KEEP.search(m.name)], filter="data")
        elif path.endswith(".7z"):
            subprocess.run(["7z", "x", "-y", "-o" + tmp, path, "-r", "-i!*evidence.txt", "-i!*mqpar.xml", "-i!*summary.txt",
                            "-i!*parameters.txt", "-i!*psm.tsv"], check=True, stdout=subprocess.DEVNULL)
        elif path.endswith(".gz"):
            with gzip.open(path, "rb") as g, open(os.path.join(tmp, os.path.basename(path)[:-3]), "wb") as o:
                shutil.copyfileobj(g, o)
        os.rename(tmp, out)
    files = []
    for dp, _, fs in os.walk(out):
        for f in fs:
            p = os.path.join(dp, f)
            if p.endswith((".zip", ".tar", ".7z", ".gz")): files += unpack(p, work)
            else: files.append(p)
    return files


def label_of_maxquant(name):
    """MaxQuant label names -> our labels (Lys6 etc. ignored)."""
    m = {"Arg6": "Arg6", "Arg10": "Arg10", "Lys4": "Lys4", "Lys8": "Lys8"}
    return {m[x] for x in re.split(r"[;,\s]+", name or "") if x in m}


def mq_labels(files):
    """Labels per labeling state from mqpar.xml (first parameter group with labels) or parameters/summary."""
    for p in files:
        if os.path.basename(p).lower() == "mqpar.xml":
            root = ET.parse(p).getroot()
            for lm in root.iter("labelMods"):
                states = [label_of_maxquant(s.text) for s in lm.findall("string")]
                if any(states): return states
            for pg in root.iter("parameterGroup"):
                for lm in pg.iter("labelMods"):
                    states = [label_of_maxquant(s.text) for s in lm.findall("string")]
                    if any(states): return states
    for p in files:
        if os.path.basename(p).lower().endswith("summary.txt"):
            with open(p, newline="") as f:
                r = csv.DictReader(f, delimiter="\t")
                for row in r:
                    states = [label_of_maxquant(row.get(f"Labels{i}", "")) for i in range(3) if f"Labels{i}" in row]
                    if any(states): return states
    return None


# Deposited raw files renamed against the names inside the search (per PXD; from the names alone):
RAWMAP = {
    "PXD064721": [(r"\+", "-")],                                        # PRIDE turned '+' into '-'
    "PXD066221": [(r"^.*_(TP|ssABE)_LPS_(\d)[HL]$", r"SILAC_\1_rep\2")],   # deposited as SILAC_<set>_rep<N>
    "PXD065290": [(r"^(CCE\d+)_Jeremy_Bono_Exp2_(rep\d)_.*_(hfx\d)$", r"SILAC-SFP-\1-\2-\3"),
                  (r"^.*_arizonae_sperm_.*$", "ARI-sperm")],
}
# Labels of a search whose deposit names no label set (MaxQuant states from the deposited protocol text):
STATES = {"PXD065290": {"quant_evidence.txt": [set(), {"Lys4"}, {"Lys8"}],   # 'triple SILAC: heavy Lys8, medium Lys4, light Lys'
                        "Sperm-ARI-evidence.txt": [set()], "Sperm-MOV-evidence.txt": [set()]}}
# Projects labelled only with a label FASTag does not test (section 3.1): listed, not scored.
OTHER_LABEL = {"PXD066863": "Lys6 (MaxQuant Labels1 = Lys6; Lys-C digest)"}
CURRENT = {"pxd": ""}


def mapped(raw):
    s = stem(raw)
    for a, b in RAWMAP.get(CURRENT["pxd"], []):
        s = re.sub(a, b, s)
    return s


def count_maxquant(evidence, states, want):
    """{run stem: Counter(h_L, e_K, e_R)} over evidence rows identified by MS/MS."""
    out = collections.defaultdict(collections.Counter)
    with open(evidence, newline="", encoding="utf-8-sig", errors="replace") as f:
        r = csv.DictReader(f, delimiter="\t")
        for row in r:
            raw = mapped(row.get("Raw file", ""))
            if raw not in want: continue
            try:
                if int(float(row.get("MS/MS count") or 0)) < 1: continue
            except ValueError:
                continue
            st = row.get("Labeling state", row.get("Labeling State", ""))
            try: st = int(st) if st not in ("", None) else 0
            except ValueError: continue
            if st < 0: continue
            seq = row.get("Sequence", "")
            if not seq or seq[-1] not in "KR": continue
            c = out[raw]; c["e_" + seq[-1]] += 1
            labs = states[st] if states and st < len(states) else set()
            for L in labs:
                if RES[L] == seq[-1]: c["h_" + L] += 1
    return out


def mods_fragpipe(s):
    """'8K(8.0142), 15R(10.0083)' -> [(residue, delta)]."""
    return [(m.group(2), float(m.group(3))) for m in re.finditer(r"(\d*)([A-Zn])\(([-\d.]+)\)", s or "")]


def count_fragpipe(path, want, key):
    """psm.tsv (key=spectrum) or peptide.tsv (key=experiment name -> runs)."""
    out = collections.defaultdict(collections.Counter)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        r = csv.DictReader(f, delimiter="\t")
        for row in r:
            run = key(row)
            if run not in want: continue
            seq = row.get("Peptide", "")
            if not seq or seq[-1] not in "KR": continue
            c = out[run]; c["e_" + seq[-1]] += 1
            n = len(seq)
            # the label of the C-terminal residue: a mod at position n on that residue
            for m in re.finditer(r"(\d+)([KR])\(([-\d.]+)\)", row.get("Assigned Modifications", "") or ""):
                if int(m.group(1)) == n:
                    for L in LABELS:
                        if m.group(2) == RES[L] and abs(float(m.group(3)) - DELTA[L]) < 0.002: c["h_" + L] += 1
    return out


def count_pepxml(path, want, pmin=0.95):
    out = collections.defaultdict(collections.Counter)
    ns = ""
    for ev, el in ET.iterparse(path, events=("end",)):
        tag = el.tag.split("}")[-1]
        if tag != "spectrum_query": continue
        run = stem(re.sub(r"\.\d+\.\d+\.\d+$", "", el.get("spectrum", "")))
        hit = next((h for h in el.iter() if h.tag.split("}")[-1] == "search_hit" and h.get("hit_rank", "1") == "1"), None)
        if run in want and hit is not None:
            prob = None
            for a in hit.iter():
                t = a.tag.split("}")[-1]
                if t in ("peptideprophet_result", "interprophet_result"): prob = float(a.get("probability", "0"))
            if prob is None or prob >= pmin:   # PEAKS pepXML exports carry no prophet result: exported hits count
                seq = hit.get("peptide", "")
                if seq and seq[-1] in "KR":
                    c = out[run]; c["e_" + seq[-1]] += 1
                    for m in hit.iter():
                        if m.tag.split("}")[-1] == "mod_aminoacid_mass" and int(m.get("position", "0")) == len(seq):
                            d = float(m.get("mass", "0")) - RESMASS[seq[-1]]
                            for L in LABELS:
                                if RES[L] == seq[-1] and abs(d - DELTA[L]) < 0.01: c["h_" + L] += 1
        el.clear()
    return out


def count_mzid(path, want):
    out = collections.defaultdict(collections.Counter)
    peps, sdata = {}, {}
    for ev, el in ET.iterparse(path, events=("end",)):
        tag = el.tag.split("}")[-1]
        if tag == "Peptide":
            seq = "".join(x.text or "" for x in el if x.tag.split("}")[-1] == "PeptideSequence")
            mods = [(int(x.get("location", "0")), float(x.get("monoisotopicMassDelta", "0")), x.get("residues", ""))
                    for x in el if x.tag.split("}")[-1] == "Modification"]
            peps[el.get("id")] = (seq, mods); el.clear()
        elif tag == "SpectraData":
            sdata[el.get("id")] = stem(el.get("location", "") or el.get("name", ""))
        elif tag == "SpectrumIdentificationResult":
            run = sdata.get(el.get("spectraData_ref"), "")
            if run in want:
                for it in el:
                    if it.tag.split("}")[-1] != "SpectrumIdentificationItem": continue
                    if it.get("rank") != "1" or it.get("passThreshold") not in ("true", "1"): continue
                    seq, mods = peps.get(it.get("peptide_ref"), ("", []))
                    if seq and seq[-1] in "KR":
                        c = out[run]; c["e_" + seq[-1]] += 1
                        for loc, d, res in mods:
                            if loc == len(seq):
                                for L in LABELS:
                                    if RES[L] == seq[-1] and abs(d - DELTA[L]) < 0.01: c["h_" + L] += 1
                    break
            el.clear()
    return out


def classify(c, seen):
    row = {}
    for L in LABELS:
        h, e = c.get("h_" + L, 0), c.get("e_" + RES[L], 0)
        sh = h / e if e else 0.0
        if L not in seen: t = "absent"
        elif h >= 20 and sh >= 0.05: t = "present"
        elif h <= 2 or sh <= 0.005: t = "absent"
        else: t = "ambiguous"
        row.update({f"h_{L}": h, f"e_{L}": e, f"share_{L}": f"{sh:.4f}", f"truth_{L}": t})
    return row


def design(row):
    pres = [L for L in LABELS if row[f"truth_{L}"] == "present"]
    if all(row[f"truth_{L}"] == "absent" for L in LABELS): return "light-only"
    if not pres: return "unresolved"
    if all(float(row[f"share_{L}"]) >= 0.8 for L in pres): return "heavy-only"
    return "single-label" if len(pres) == 1 else "mixed"




# ---- per-PXD configuration (written after the search files were fetched, before any held-out FASTag run) ----

def count_label_quant(path, run, pmin=0.95):
    """FragPipe peptide_label_quant.tsv of one experiment (= one run): identified light and heavy forms."""
    out = collections.defaultdict(collections.Counter)
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            seq = row.get("Peptide Sequence", "")
            if not seq or seq[-1] not in "KR": continue
            def ok(k):
                try: return float(row.get(k) or "nan") >= pmin
                except ValueError: return False
            light, heavy = ok("Best Light PeptideProphet Probability"), ok("Best Heavy PeptideProphet Probability")
            c = out[run]
            c["e_" + seq[-1]] += light + heavy
            if heavy:
                m = re.search(r"([KR])\[([-\d.]+)\]$", row.get("Heavy Modified Peptide", "") or "")
                if m:
                    for L in LABELS:
                        if m.group(1) == RES[L] and abs(float(m.group(2)) - DELTA[L]) < 0.002: c["h_" + L] += 1
    return out


def fragpipe_labels(params):
    """Labels a FragPipe search could see: variable mods at a label delta on K or R."""
    seen = set()
    for line in open(params, errors="replace"):
        m = re.match(r"\s*variable_mod_\d+\s*=\s*([-\d.]+)\s+(\S+)", line)
        if m:
            d, res = float(m.group(1)), m.group(2)
            for L in LABELS:
                if RES[L] in res and abs(d - DELTA[L]) < 0.002: seen.add(L)
    return seen


def mzid_labels(path):
    seen = set()
    for ev, el in ET.iterparse(path, events=("end",)):
        t = el.tag.split("}")[-1]
        if t == "SearchModification":
            res, d = el.get("residues", ""), float(el.get("massDelta", "0"))
            for L in LABELS:
                if RES[L] in res and abs(d - DELTA[L]) < 0.002: seen.add(L)
        elif t == "SpectraData":
            break
    return seen


def pepxml_labels(path):
    seen = set()
    for ev, el in ET.iterparse(path, events=("end",)):
        t = el.tag.split("}")[-1]
        if t == "aminoacid_modification":
            aa, d = el.get("aminoacid", ""), float(el.get("massdiff", "0"))
            for L in LABELS:
                if aa == RES[L] and abs(d - DELTA[L]) < 0.002: seen.add(L)
        elif t == "spectrum_query":
            break
    return seen


def truth_for(pxd, runs, files, work, label_override=None):
    """{run stem: (counts, seen labels, tier, source)} for one PXD: the search with the most identifications per run."""
    want = set(runs)
    best = {}
    def offer(counts, seen, tier, src):
        for r, c in counts.items():
            n = c.get("e_K", 0) + c.get("e_R", 0)
            if r not in best or n > best[r][4]: best[r] = (c, seen, tier, src, n)
    allf = []
    for f in files:
        allf += unpack(f, work) if f.endswith((".zip", ".tar", ".7z", ".gz")) else [f]
    # MaxQuant: every evidence.txt, labels from the mqpar.xml / summary.txt next to it (or anywhere in the set)
    for ev in [f for f in allf if re.search(r"(^|[-_])evidence\.txt$", os.path.basename(f), re.I)]:
        d = os.path.dirname(ev); near = [f for f in allf if os.path.dirname(f) in (d, os.path.dirname(d))]
        states = STATES.get(pxd, {}).get(os.path.basename(ev)) or mq_labels(near) or mq_labels(allf)
        if not states: continue
        seen = set().union(*states)
        offer(count_maxquant(ev, states, want), seen, "T1", os.path.relpath(ev, work))
    for f in allf:
        b = os.path.basename(f)
        if b.endswith("psm.tsv"):
            par = next((x for x in allf if x.endswith("fragger.params")), None)
            seen = fragpipe_labels(par) if par else set()
            offer(count_fragpipe(f, want, lambda row: stem(re.sub(r"\.\d+\.\d+\.\d+$", "", row.get("Spectrum", "")))), seen, "T1", os.path.relpath(f, work))
        elif b.endswith((".pep.xml", ".pepXML")):
            offer(count_pepxml(f, want), pepxml_labels(f), "T1", os.path.relpath(f, work))
        elif b.endswith(".mzid"):
            offer(count_mzid(f, want), mzid_labels(f), "T1", os.path.relpath(f, work))
    # FragPipe per-experiment label quant (peptide level), experiment name inside the run name
    lq = [f for f in allf if f.endswith("_peptide_label_quant.tsv")]
    if lq:
        par = next((x for x in allf if x.endswith("fragger.params")), None)
        seen = fragpipe_labels(par) if par else set()
        for f in lq:
            exp = os.path.basename(f)[: -len("_peptide_label_quant.tsv")]
            hits = [r for r in runs if re.search(r"(^|_)" + re.escape(exp) + r"(_|$)", r)]
            if len(hits) == 1:
                offer(count_label_quant(f, hits[0]), seen, "T1-peptide", os.path.relpath(f, work))
    return best


def main():
    man, root, work, out = sys.argv[1:5]
    overrides = {}
    if len(sys.argv) > 5:   # optional TSV: pxd, evidence basename, labels per state (L;H joined by '|'), source
        for r in csv.DictReader(open(sys.argv[5]), delimiter="\t"):
            overrides.setdefault(r["pxd"], {})[r["evidence"]] = [label_of_maxquant(x) for x in r["states"].split("|")]
    rows = list(csv.DictReader(open(man), delimiter="\t"))
    by = collections.OrderedDict()
    for r in rows: by.setdefault(r["pxd"], []).append(r)
    res = []
    for pxd, rs in by.items():
        runs = [r for r in rs if r["role"] == "run"]
        if runs[0]["group"] == "label-free":
            for r in runs:
                row = {f"{k}_{L}": v for L in LABELS for k, v in (("h", 0), ("e", 0), ("share", "0.0000"), ("truth", "absent"))}
                res.append(dict(pxd=pxd, file=r["file"], instrument_class=r["instrument_class"], tier="T2", design="light-only",
                                source="label-free project (design)", **row))
            continue
        files = sorted(glob.glob(os.path.join(root, pxd, "raw", "*")))
        files = [f for f in files if not re.search(r"\.(raw|d\.zip)$", f)]
        w = os.path.join(work, pxd); os.makedirs(w, exist_ok=True)
        CURRENT["pxd"] = pxd
        if pxd in OTHER_LABEL:
            for r in runs:
                row = {f"{k}_{L}": v for L in LABELS for k, v in (("h", ""), ("e", ""), ("share", ""), ("truth", "other_label"))}
                res.append(dict(pxd=pxd, file=r["file"], instrument_class=r["instrument_class"], tier="other_label",
                                design="other-label", source=OTHER_LABEL[pxd], **row))
            print(pxd, "other label:", OTHER_LABEL[pxd], flush=True)
            continue
        best = truth_for(pxd, [stem(r["file"]) for r in runs], files, w, overrides.get(pxd))
        for r in runs:
            s = stem(r["file"])
            if s in best:
                c, seen, tier, src, n = best[s]
                row = classify(c, seen); d = design(row)
            else:
                row = {f"{k}_{L}": v for L in LABELS for k, v in (("h", 0), ("e", 0), ("share", ""), ("truth", "ambiguous"))}
                tier, src, d, seen = "no_search", "-", "unresolved", set()
            res.append(dict(pxd=pxd, file=r["file"], instrument_class=r["instrument_class"], tier=tier, design=d,
                            source=f"{src} (labels seen: {'+'.join(sorted(seen)) or 'none'})", **row))
        print(pxd, sum(1 for r in res if r["pxd"] == pxd and r["tier"] != "no_search"), "of", len(runs), "runs with a search", flush=True)
    keys = ["pxd", "file", "instrument_class", "tier", "design"] + [f"{k}_{L}" for L in LABELS for k in ("h", "e", "share", "truth")] + ["source"]
    with open(out, "w") as f:
        wr = csv.DictWriter(f, keys, delimiter="\t"); wr.writeheader(); wr.writerows(res)


if __name__ == "__main__":
    main()
