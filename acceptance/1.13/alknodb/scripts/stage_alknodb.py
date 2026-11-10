#!/usr/bin/env python3
"""FASTag 1.13 alknodb held-out: run selection and staging of one project. The converter only; FASTag is not run.

Run-selection rule (PREREG-alknodb.md, Runs), applied mechanically:
  1. PRIDE v3 file list of the project. Candidates: files whose name ends in `.raw` (any case) and whose size is at
     most 5e9 bytes, sorted by file name (Python string order = byte order of the UTF-8 name).
  2. The first MAX_TRY (3) candidates are tried in that order. A try = https download from the PRIDE FTP mirror (up
     to 5 attempts, PRIDE SHA-1 checked when PRIDE gives one, else the size), ThermoRawFileParser 2.0.0 `-f 2`
     (indexed mzML, vendor centroiding), then the count below.
  3. A file qualifies when the mzML has at least 5,000 MS2 spectra, every MS2 filter string names the Orbitrap or
     Astral analyzer (`FTMS` or `ASTMS`), and every MS2 filter string carries the data-dependent flag (` d `).
  4. The first file that qualifies is the project's run. If none of the tried files qualifies (or the project has no
     candidate file), the project is out (`no_qualifying_file`) and the next project of the stratum replaces it.
Usage: stage_alknodb.py <PXD> <root dir>     writes <root>/<PXD>/stage.tsv (one row per tried file) and stage.done"""
import hashlib, json, os, re, subprocess, sys, urllib.request

A, ROOT = sys.argv[1], sys.argv[2]
TRFP = "/ceph/ibmi/abi/oliver/prose-auto-20261029/env/bin/thermorawfileparser"
API = f"https://www.ebi.ac.uk/pride/ws/archive/v3/projects/{A}/files?pageSize=1000&page="
MAX_TRY, MAX_BYTES, MIN_MS2 = 3, 5e9, 5000
D = f"{ROOT}/{A}"
os.makedirs(D, exist_ok=True)


def digest(f, algo):
    h = hashlib.new(algo)
    with open(f, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 24), b""):
            h.update(b)
    return h.hexdigest()


def files():
    fj = f"{D}/files.json"
    if os.path.exists(fj):
        return json.load(open(fj))
    out, p = [], 0
    while True:
        for t in range(6):
            try:
                with urllib.request.urlopen(API + str(p), timeout=300) as r:
                    page = json.load(r)
                break
            except Exception as e:  # noqa
                if getattr(e, "code", 0) == 404 or t == 5:
                    page = None
                    break
        if not page:
            break
        out += page
        p += 1
    json.dump(out, open(fj, "w"))
    return out


def url(x):
    for l in x.get("publicFileLocations") or []:
        if "ftp" in (l.get("name") or "").lower() or (l.get("value") or "").startswith("ftp://"):
            return l["value"].replace("ftp://ftp.pride.ebi.ac.uk", "https://ftp.pride.ebi.ac.uk")
    return ""


def count(mz):
    n2 = nhr = ndd = 0
    ms2 = False
    for line in open(mz, errors="replace"):
        if "<spectrum " in line:
            ms2 = False
        elif 'accession="MS:1000511"' in line:
            ms2 = 'value="2"' in line
            n2 += ms2
        elif ms2 and 'accession="MS:1000512"' in line:
            m = re.search(r'value="([^"]*)"', line)
            fs = m.group(1) if m else ""
            nhr += fs.startswith(("FTMS", "ASTMS"))
            ndd += " d " in fs
    return n2, nhr, ndd


cand = sorted((x for x in files() if x["fileName"].lower().endswith(".raw") and x.get("fileSizeBytes", 0) <= MAX_BYTES),
              key=lambda x: x["fileName"])
rows, chosen = [], False
for x in cand[:MAX_TRY]:
    name, size, sha1, u = x["fileName"], x.get("fileSizeBytes", 0), (x.get("checksum") or "-"), url(x)
    f = f"{D}/{name}"
    st = "download_failed"
    for t in range(5):
        if os.path.exists(f) and os.path.getsize(f) == size:
            if sha1 == "-" or len(sha1) != 40:
                st = "size_ok"; break
            if digest(f, "sha1") == sha1:
                st = "sha1_ok"; break
            os.remove(f)
        if not u:
            break
        subprocess.run(["curl", "-sS", "-f", "-L", "--retry", "3", "--connect-timeout", "30", "--speed-time", "180",
                        "--speed-limit", "10000", "-o", f, u], stderr=open(f"{D}/curl.log", "a"))
    stem = name[:-4]
    mz = f"{D}/{stem}.mzML"
    n2 = nhr = ndd = "-"
    rs = ms = "-"
    res = st
    if st != "download_failed":
        rs = digest(f, "sha256")
        if not os.path.exists(mz):
            tmp = f"{D}/tmp.{stem}"
            subprocess.run(["rm", "-rf", tmp]); os.makedirs(tmp)
            try:
                subprocess.run([TRFP, "-i", f, "-o", tmp, "-f", "2"], stdout=open(f"{D}/{stem}.trfp.log", "w"),
                               stderr=subprocess.STDOUT, timeout=14400)
            except subprocess.TimeoutExpired:
                pass
            if os.path.exists(f"{tmp}/{stem}.mzML") and os.path.getsize(f"{tmp}/{stem}.mzML") > 0:
                os.replace(f"{tmp}/{stem}.mzML", mz)
            subprocess.run(["rm", "-rf", tmp])
        if not os.path.exists(mz):
            res = "conversion_failed"
        else:
            n2, nhr, ndd = count(mz)
            ms = digest(mz, "sha256")
            if n2 < MIN_MS2:
                res = "few_ms2"
            elif nhr != n2:
                res = "ms2_not_all_highres"
            elif ndd != n2:
                res = "ms2_not_all_data_dependent"
            else:
                res = "qualifies"
    rows.append([A, name, str(size), sha1, u, st, rs, f"{A}/{stem}.mzML" if ms != "-" else "-", ms, str(n2), str(nhr),
                 str(ndd), res])
    if res == "qualifies":
        chosen = True
        break
with open(f"{D}/stage.tsv", "w") as o:
    o.write("pxd\tfile\tbytes\tpride_sha1\turl\tdownload\traw_sha256\tmzml\tmzml_sha256\tms2\tms2_highres\tms2_dd\t"
            "result\n")
    for r in rows:
        o.write("\t".join(r) + "\n")
    if not cand:
        o.write(f"{A}\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\t-\tno_candidate_file\n")
open(f"{D}/stage.done", "w").write("chosen\n" if chosen else "no_qualifying_file\n")
