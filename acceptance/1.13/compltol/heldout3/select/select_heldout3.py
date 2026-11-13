#!/usr/bin/env python3
"""compltol held-out 3: candidate draw from PRIDE (metadata only; no spectrum file is read here).

select_heldout3.py search <cache dir>                         PRIDE v3 keyword searches -> <cache>/search.json
select_heldout3.py draw <cache dir> <excl_pxd.txt> <out dir>   -> candidates.tsv, candidates.tsv.log, truth tables

Rule (fixed in PREREG-compltol-heldout3.md before any spectrum file is downloaded):
  draw     = ltq     : instruments within {LTQ Orbitrap, XL, Velos, Velos Pro, Elite; Orbitrap Elite}
                       (keywords 'LTQ Orbitrap Velos', 'LTQ Orbitrap Elite', 'LTQ Orbitrap XL', 'Orbitrap Elite',
                       12 pages of 100 each). One draw feeds two sets; the set of a staged file is decided by its MS2
                       analyser (ITMS -> ion_trap, FTMS -> ft_old: the widening proxy, older Orbitrap MS2).
             timstof : instruments within {timsTOF, timsTOF Pro, Pro 2, SCP, HT, Ultra, Ultra 2, fleX, Bruker Daltonics
                       timsTOF series} (keywords 'timsTOF' and 'Bruker Daltonics timsTOF series', 30 pages of 100
                       each); the text names DDA, PASEF or data-dependent.
  keep     = accession not in the exclusion list; exactly one organism, and it has a panel FASTA; the text (title,
             description, protocols, keywords) names trypsin and iodoacetamide or chloroacetamide, and has none of the
             stop words (labels, enrichments, DIA, cross-linking, non-tryptic digests, special samples).
  order    = ascending sha256('compltol-H3:' + accession) within the draw; the first N_LTQ = 16 (ltq) and
             N_TIMS = 8 (timstof) projects that have an eligible file are the candidates, in that order. No other
             project is ever staged for this test.
  file     = only files of PRIDE category RAW. ltq: among the project's .raw files of 150 MB to 1.6 GB, the first in
             ascending sha256(file name) order. timstof: among its .zip files (a zipped .d) of 150 MB to 4 GB whose
             name does not contain 'dia', the first in ascending sha256(file name) order (staging converts the first
             .d directory of the archive in name order). A project without such a file is skipped (logged).
Truth tables written here (Sage 0.14.7 via acceptance/1.12/scorers/truth_config.py, chosen by stage.sh):
  truth/H3-ltq-itms.tsv  (0.5 Da fragment, not deisotoped; used when >= 95 % of the MS2 filter strings are ITMS)
  truth/H3-ltq-ftms.tsv  (20 ppm, deisotoped; used when >= 95 % are FTMS)
  truth/H3-timstof.tsv   (precursor 20 ppm, fragment 20 ppm, deisotoped; search input = the .noprec.mzML copy)
"""
import hashlib, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

API = "https://www.ebi.ac.uk/pride/ws/archive/v3"
QUERIES = {"ltq": ["LTQ Orbitrap Velos", "LTQ Orbitrap Elite", "LTQ Orbitrap XL", "Orbitrap Elite"],
           "timstof": ["timsTOF", "Bruker Daltonics timsTOF series"]}
PAGES = {"ltq": 12, "timstof": 30}
N = {"ltq": 16, "timstof": 8}
INSTR = {"ltq": re.compile(r"^(ltq orbitrap( xl| velos| velos pro| elite)?|orbitrap elite)$"),
         "timstof": re.compile(r"^(bruker daltonics )?timstof( pro( 2)?| scp| ht| ultra( 2)?| flex| series)?$")}
PANEL = {"homo sapiens (human)": "Homo_sapiens", "mus musculus (mouse)": "Mus_musculus",
         "saccharomyces cerevisiae (baker's yeast)": "Saccharomyces_cerevisiae",
         "escherichia coli": "Escherichia_coli", "rattus norvegicus (rat)": "Rattus_norvegicus",
         "arabidopsis thaliana (mouse-ear cress)": "Arabidopsis_thaliana", "bos taurus (bovine)": "Bos_taurus",
         "sus scrofa domesticus (domestic pig)": "Sus_scrofa", "sus scrofa (pig)": "Sus_scrofa",
         "danio rerio (zebrafish) (brachydanio rerio)": "Danio_rerio",
         "drosophila melanogaster (fruit fly)": "Drosophila_melanogaster",
         "caenorhabditis elegans": "Caenorhabditis_elegans", "bacillus subtilis": "Bacillus_subtilis"}
SPECIES = {v: v.replace("_", " ") for v in PANEL.values()}
STOP = re.compile(r"tmt|itraq|silac|dimethyl|isobaric|label(l)?ed|heavy|15n|13c|phospho|glyc|acetyl|ubiquit|enrich|"
                  r"cross-?link|\bdia\b|data-independent|swath|\bprm\b|\bsrm\b|targeted|top-down|intact|immunopeptid|"
                  r"\bhla\b|\bmhc\b|peptidom|chymotrypsin|glu-?c|asp-?n|lys-?n|elastase|pepsin|metaproteom|microbiom|"
                  r"single[- ]cell|\betd\b|ethcd|\buvpd\b|faims|adp-rib|sumo|citrullin|palmitoy|degradom|terminom|n-termin|"
                  r"limited proteolysis|lip-ms|hdx|native|ancient|paleo", re.I)
TRUTH_COLS = ["manifest", "pxd", "run_dir", "search_input", "organism", "fasta", "fasta_sha256", "enzyme",
              "static_mods", "variable_mods", "max_variable_mods", "precursor_ppm", "fragment", "deisotope",
              "ms2_analyser", "evaluable", "note"]
TRUTH = {"H3-ltq-itms": ("10", "0.5 Da", "false", "ion_trap"), "H3-ltq-ftms": ("10", "20 ppm", "true", "orbitrap"),
         "H3-timstof": ("20", "20 ppm", "true", "tof")}


def get(url):
    for a in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except Exception:
            time.sleep(3 + 3 * a)
    raise SystemExit(f"FAIL {url}")


def text(p):
    return " ".join(str(p.get(k, "")) for k in ("title", "projectDescription", "sampleProcessingProtocol",
                                                 "dataProcessingProtocol", "keywords", "quantificationMethods",
                                                 "identifiedPTMStrings", "experimentTypes"))


def search(cache):
    from concurrent.futures import ThreadPoolExecutor
    jobs = [(st, q, page) for st, qs in QUERIES.items() for q in qs for page in range(PAGES[st])]

    def one(j):
        st, q, page = j
        d = get(f"{API}/search/projects?keyword={urllib.parse.quote(q)}&pageSize=100&page={page}")
        print(st, q, page, len(d), file=sys.stderr, flush=True)
        return st, d
    out = {}
    with ThreadPoolExecutor(4) as ex:
        for st, d in ex.map(one, jobs):
            for p in d:
                e = out.setdefault(p["accession"], {"p": p, "strata": []})
                if st not in e["strata"]:
                    e["strata"].append(st)
    Path(cache).mkdir(parents=True, exist_ok=True)
    (Path(cache) / "search.json").write_text(json.dumps(out, sort_keys=True))


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def files_of(cache, acc):
    fp = Path(cache) / f"{acc}.files.json"
    if not fp.exists():
        files, page = [], 0
        while True:
            d = get(f"{API}/projects/{acc}/files?pageSize=500&page={page}")
            if not d:
                break
            files += d
            page += 1
            if len(d) < 500:
                break
        fp.write_text(json.dumps(files))
    return json.loads(fp.read_text())


def eligible(st, f):
    n, b = f["fileName"].lower(), f.get("fileSizeBytes", 0)
    if (f.get("fileCategory") or {}).get("value") != "RAW":
        return False
    if st == "ltq":
        return n.endswith(".raw") and 150e6 <= b <= 1.6e9
    return n.endswith(".zip") and 150e6 <= b <= 4e9 and "dia" not in n


def draw(cache, excl, outdir):
    excl = set(Path(excl).read_text().split())
    S = json.loads((Path(cache) / "search.json").read_text())
    out = Path(outdir)
    rows, log = [], []
    for st in QUERIES:
        cand = []
        for acc, e in S.items():
            p = e["p"]
            ins = [i.lower() for i in p.get("instruments", [])]
            if st not in e["strata"] or not ins or not all(INSTR[st].match(i) for i in ins) or acc in excl:
                continue
            org = [o.lower() for o in p.get("organisms", [])]
            t = text(p)
            if len(org) != 1 or org[0] not in PANEL:
                continue
            if not re.search(r"trypsin", t, re.I) or not re.search(r"iodoacetamide|chloroacetamide", t, re.I):
                continue
            if STOP.search(t):
                continue
            if st == "timstof" and not re.search(r"\bdda\b|pasef|data[- ]dependent", t, re.I):
                continue
            cand.append((h("compltol-H3:" + acc), acc, PANEL[org[0]], ins))
        cand.sort()
        log.append(f"{st}: {len(cand)} projects pass the metadata rule")
        got = 0
        for hh, acc, fasta, ins in cand:
            if got >= N[st]:
                break
            files = files_of(cache, acc)
            el = [f for f in files if eligible(st, f)]
            if not el:
                log.append(f"{st}: {acc} skipped, no eligible file ({len(files)} files)")
                continue
            f = sorted(el, key=lambda f: h(f["fileName"]))[0]
            got += 1
            url = [l["value"] for l in f["publicFileLocations"] if l["name"].startswith("FTP")][0]
            url = url.replace("ftp://ftp.pride.ebi.ac.uk", "https://ftp.pride.ebi.ac.uk")
            rows.append([st, str(got), acc, f["fileName"], str(f["fileSizeBytes"]), f.get("checksum", "-") or "-",
                         url, fasta, ";".join(ins), hh[:12]])
        log.append(f"{st}: {got} candidates")
    with open(out / "candidates.tsv", "w") as o:
        o.write("draw\tdraw_rank\tpxd\tfile\tbytes\tsha1\turl\tfasta\tinstruments\tsha256_accession_prefix\n")
        for r in rows:
            o.write("\t".join(r) + "\n")
    (out / "candidates.tsv.log").write_text("\n".join(log) + "\n")
    # truth tables (one row per candidate; stage.sh picks the table by the MS2 analyser)
    for name, (pp, frag, dei, an) in TRUTH.items():
        with open(out.parent / "truth" / f"{name}.tsv", "w") as o:
            o.write(f"# compltol held-out 3: Sage truth configuration ({name}), written by select_heldout3.py before any download; fasta_sha256 '-' = see the staged fasta.sha256\n")
            o.write("\t".join(TRUTH_COLS) + "\n")
            for r in rows:
                if (r[0] == "timstof") != (name == "H3-timstof"):
                    continue
                stem = re.sub(r"(\.d)?\.zip$", "", r[3], flags=re.I) if r[0] == "timstof" else r[3][:-4]
                rel = f"compltol/H3/{r[2]}/{stem}"
                si = rel + (".noprec.mzML" if r[0] == "timstof" else ".mzML")
                o.write("\t".join(["compltol-H3", r[2], rel, si, SPECIES[r[7]], r[7] + ".fasta", "-", "Trypsin",
                                   '{"C": 57.021464}', '{"M": [15.994915]}', "2", pp, frag, dei, an, "yes",
                                   "PRIDE text: trypsin, iodoacetamide/chloroacetamide, no label (select_heldout3.py rule)"]) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    if sys.argv[1] == "search":
        search(sys.argv[2])
    else:
        draw(sys.argv[2], sys.argv[3], sys.argv[4])
