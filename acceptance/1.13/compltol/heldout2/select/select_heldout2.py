#!/usr/bin/env python3
"""compltol held-out 2: candidate draw from PRIDE (metadata only; no spectrum file is read here).

select_heldout2.py search <cache dir>            keyword searches of the PRIDE v3 API -> <cache>/search.json
select_heldout2.py draw <cache dir> <excl_pxd.txt> <out candidates.tsv> [n per stratum]

Rule (fixed before any file was downloaded):
  stratum  = astral   : instruments == {Orbitrap Astral*}                    (keyword search 'Orbitrap Astral', 8 pages of 100)
             ion_trap : instruments within {LTQ Orbitrap, XL, Velos, Elite}  ('LTQ Orbitrap Velos', 'LTQ Orbitrap Elite', 'LTQ Orbitrap XL', 4 pages each)
             qe       : instruments within {Q Exactive, Plus, HF, HF-X}      ('Q Exactive', 5 pages)
  keep     = accession not in the exclusion list; exactly one organism, and it has a panel FASTA; the text (title,
             description, protocols, keywords) names trypsin and iodoacetamide or chloroacetamide, and has none of the
             stop words (labels, enrichments, DIA, cross-linking, non-tryptic digests, special samples);
             astral additionally: the text names DDA or data-dependent.
  order    = ascending sha256(accession) within the stratum; the first n (ion_trap: 2n, because many LTQ Orbitrap
             projects record MS2 in the Orbitrap) are the candidates, in that order.
  file     = ion_trap, qe: among the project's .raw files of 150 MB to 1.6 GB, the first in ascending
             sha256(file name) order. astral: the two smallest .raw files of 150 MB to 10 GB whose name contains
             'DDA' (Astral DDA projects are rare; their files are several GB). A project without such a file is skipped.
"""
import hashlib, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

API = "https://www.ebi.ac.uk/pride/ws/archive/v3"
QUERIES = {"astral": ["Orbitrap Astral"],
           "ion_trap": ["LTQ Orbitrap Velos", "LTQ Orbitrap Elite", "LTQ Orbitrap XL"],
           "qe": ["Q Exactive"]}
PAGES = {"astral": 8, "ion_trap": 4, "qe": 5}
INSTR = {"astral": re.compile(r"^orbitrap astral( zoom)?$"),
         "ion_trap": re.compile(r"^ltq orbitrap( xl| velos| velos pro| elite)?$"),
         "qe": re.compile(r"^q exactive( plus| hf| hf-x)?$")}
PANEL = {"homo sapiens (human)": "Homo_sapiens", "mus musculus (mouse)": "Mus_musculus",
         "saccharomyces cerevisiae (baker's yeast)": "Saccharomyces_cerevisiae",
         "escherichia coli": "Escherichia_coli", "rattus norvegicus (rat)": "Rattus_norvegicus",
         "arabidopsis thaliana (mouse-ear cress)": "Arabidopsis_thaliana", "bos taurus (bovine)": "Bos_taurus",
         "sus scrofa domesticus (domestic pig)": "Sus_scrofa", "sus scrofa (pig)": "Sus_scrofa",
         "danio rerio (zebrafish) (brachydanio rerio)": "Danio_rerio",
         "drosophila melanogaster (fruit fly)": "Drosophila_melanogaster",
         "caenorhabditis elegans": "Caenorhabditis_elegans", "bacillus subtilis": "Bacillus_subtilis"}
STOP = re.compile(r"tmt|itraq|silac|dimethyl|isobaric|label(l)?ed|heavy|15n|13c|phospho|glyc|acetyl|ubiquit|enrich|"
                  r"cross-?link|\bdia\b|data-independent|swath|\bprm\b|\bsrm\b|targeted|top-down|intact|immunopeptid|"
                  r"\bhla\b|\bmhc\b|peptidom|chymotrypsin|glu-?c|asp-?n|lys-?n|elastase|pepsin|metaproteom|microbiom|"
                  r"single[- ]cell|\betd\b|ethcd|\buvpd\b|faims|adp-rib|sumo|citrullin|palmitoy|degradom|terminom|n-termin|"
                  r"limited proteolysis|lip-ms|hdx|native|ancient|paleo", re.I)


def get(url):
    for a in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r)
        except Exception as e:
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
    with ThreadPoolExecutor(8) as ex:
        for st, d in ex.map(one, jobs):
            for p in d:
                out.setdefault(p["accession"], {"p": p, "strata": []})["strata"].append(st)
    Path(cache).mkdir(parents=True, exist_ok=True)
    (Path(cache) / "search.json").write_text(json.dumps(out))


def h(s):
    return hashlib.sha256(s.encode()).hexdigest()


def draw(cache, excl, out, n):
    excl = set(Path(excl).read_text().split())
    S = json.loads((Path(cache) / "search.json").read_text())
    rows, log = [], []
    for st in QUERIES:
        cand = []
        for acc, e in S.items():
            p = e["p"]
            ins = [i.lower() for i in p.get("instruments", [])]
            if st not in e["strata"] or not ins or not all(INSTR[st].match(i) for i in ins):
                continue
            if acc in excl:
                continue
            org = [o.lower() for o in p.get("organisms", [])]
            t = text(p)
            if len(org) != 1 or org[0] not in PANEL:
                continue
            if not re.search(r"trypsin", t, re.I) or not re.search(r"iodoacetamide|chloroacetamide", t, re.I):
                continue
            if STOP.search(t):
                continue
            if st == "astral" and not re.search(r"\bdda\b|data[- ]dependent", t, re.I):
                continue
            cand.append((h(acc), acc, PANEL[org[0]], ins))
        cand.sort()
        log.append(f"{st}: {len(cand)} projects pass the metadata rule")
        got = 0
        for hh, acc, fasta, ins in cand:
            if got >= (2 * n if st == "ion_trap" else n):
                break
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
            files = json.loads(fp.read_text())
            hi = 10e9 if st == "astral" else 1.6e9
            raws = [f for f in files if f["fileName"].lower().endswith(".raw")
                    and 150e6 <= f.get("fileSizeBytes", 0) <= hi
                    and (st != "astral" or "dda" in f["fileName"].lower())]
            if not raws:
                log.append(f"{st}: {acc} skipped, no eligible .raw ({len(files)} files)")
                continue
            # astral: the two smallest DDA files (the files are 7 to 9 GB); else the first by sha256(file name)
            pick = (sorted(raws, key=lambda f: (f["fileSizeBytes"], f["fileName"]))[:2] if st == "astral"
                    else sorted(raws, key=lambda f: h(f["fileName"]))[:1])
            got += 1
            for f in pick:
                url = [l["value"] for l in f["publicFileLocations"] if l["name"].startswith("FTP")][0]
                url = url.replace("ftp://ftp.pride.ebi.ac.uk", "https://ftp.pride.ebi.ac.uk")
                rows.append([st, str(got), acc, f["fileName"], str(f["fileSizeBytes"]), f.get("checksum", "-") or "-",
                             url, fasta, ";".join(ins), hh[:12]])
    with open(out, "w") as o:
        o.write("stratum\tdraw_rank\tpxd\tfile\tbytes\tsha1\turl\tfasta\tinstruments\tsha256_accession_prefix\n")
        for r in rows:
            o.write("\t".join(r) + "\n")
    Path(out + ".log").write_text("\n".join(log) + "\n")
    print("\n".join(log))


if __name__ == "__main__":
    if sys.argv[1] == "search":
        search(sys.argv[2])
    else:
        draw(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 4)
