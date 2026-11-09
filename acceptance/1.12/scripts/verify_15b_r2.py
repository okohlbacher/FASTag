#!/usr/bin/env python3
"""#15B round 2 replacement sets (user decision 2026-11-09, before any c/z run): set6 PXD071331 (all hybrid EThcD,
ion-trap MS2) and H2 set8 PXD014719 (ion-trap MS2) are dropped; set7 PXD024621 stays H1. One more set is added to H1
(set9) and one to H2 (set10), taken in the existing candidate order (cand_15b.tsv from select_15b.py, its header
rule and seeds unchanged) after the last screened candidate (order 8); rejected candidates are not re-opened.
Rule per project, in order (no FASTag or MSFragger output is read):
  (a) public PRIDE project; accession not used by any DEV set or any other item's manifest (<used_pxd.txt>);
  (b) tryptic DDA: the select_15b.py pool text rule, and the title/description do not name non-tryptic,
      middle-down or top-down work, and the sample protocol is a tryptic digest (REVIEW below, reason recorded);
  (c) every PRIDE organism of the project has a reviewed (Swiss-Prot) proteome in the prose-auto panel
      (/ceph/ibmi/abi/oliver/prose-auto-20261029/panel/<Genus_species>.fasta, all entries 'sp|');
  (d) the first drawn file (TRFP 2.0.0 -f 2, as the staged sets) has >= 500 electron-activated MS2
      (ETD/ECD without supplemental or second activation; hybrid EThcD/ETciD does not count) whose filter string
      is FTMS, and every MS2 of the file is FTMS (Orbitrap) by its filter string (ms2scan_15b_r2.py);
  the project's other drawn files (up to 3 per set) are kept when they pass (d), otherwise dropped (recorded).
First accepted = H1 set9, second = H2 set10; stop there. PRIDE SHA-1 checked where given (stage_pride.sh),
sha256 of raw and mzML recorded. A file whose download cannot be verified after 4 staging attempts stops
the run (no decision is taken on it, so the order is kept). Usage: verify_15b_r2.py <cand_15b.tsv> <meta.tsv> <pride cache> <used_pxd.txt>
<scripts dir> <out.tsv>"""
import csv, json, os, re, subprocess, sys

CAND, META, CACHE, USED, SD, OUT = sys.argv[1:7]
ROOT = "/scratch/kohlbach/fastag-heldout-1.12"
PANEL = "/ceph/ibmi/abi/oliver/prose-auto-20261029/panel"
PY = "/ceph/ibmi/abi/oliver/envs/prepdda/bin/python"
FROM = 9
# (b) REVIEW of the PRIDE sample protocol where the regexes miss a criterion (reason recorded; decided from metadata):
REVIEW = {"PXD057394": "not a tryptic proteome digest: synthetic S-palmitoylated peptide standards for a fragmentation "
                       "and stability study (PRIDE sample protocol)"}
NONTRYP = re.compile(r"non[- ]tryptic|middle[- ]down|top[- ]down", re.I)
used = {l.strip() for l in open(USED) if l.strip()}
meta = {r["pxd"]: r for r in csv.DictReader(open(META), delimiter="\t")}
rows = [r for r in csv.DictReader(open(CAND), delimiter="\t") if r["order"] != "-" and int(r["order"]) >= FROM]
by = {}
for r in rows: by.setdefault(int(r["order"]), []).append(r)

def organisms_ok(acc):
    import time
    for _ in range(360):   # the metadata fetch may still be running; wait for this project's row
        meta.update({r["pxd"]: r for r in csv.DictReader(open(META), delimiter="\t")})
        if acc in meta: break
        time.sleep(20)
    orgs = [o for o in (meta.get(acc, {}).get("organisms") or "").split(";") if o]
    if not orgs or orgs == ["FETCH_FAILED"]: return False, "no PRIDE organism"
    miss = []
    for o in orgs:
        g = "_".join(re.sub(r"\(.*?\)", "", o).split()[:2])
        if not os.path.exists(f"{PANEL}/{g}.fasta"): miss.append(o)
    return (not miss), ("organisms " + ";".join(orgs) + (" (no reviewed panel proteome: " + ";".join(miss) + ")" if miss else ""))

def text(acc):
    p = f"{CACHE}/{acc}.project.json"
    if not os.path.exists(p): return ""
    d = json.load(open(p))
    return " ".join(str(d.get(k) or "") for k in ("title", "projectDescription"))

def stage(r):
    d = f"item15B/sets/{r['pxd']}"
    line = "\t".join([f"15B:{r['pxd']}:{r['file']}", d, r["file"], r["bytes"], r["pride_sha1"] or "-", r["url"], "trfp", "-"])
    lst = f"{ROOT}/item15B/.r2.one.tsv"
    open(lst, "w").write(line + "\n")
    for attempt in range(4):   # PRIDE's https mirror drops transfers; stage_pride.sh is idempotent
        subprocess.run(["bash", f"{SD}/stage_pride.sh", lst, lst + ".out", "1"], check=False)
        res = open(lst + ".out").read().rstrip("\n").split("\t")
        if res[2] in ("sha1_ok", "no_pride_sha1,size_ok,second_download_same") and res[4] == "0": break
    if res[2] not in ("sha1_ok", "no_pride_sha1,size_ok,second_download_same") or res[4] != "0":
        return res, None
    sc = {}
    if res[5] and res[4] == "0":
        open(lst + ".scan", "w").write(f"x\t{ROOT}/{res[5]}\n")
        subprocess.run([PY, "-I", f"{SD}/ms2scan_15b_r2.py", lst + ".scan", lst + ".scanout"], check=False)
        sc = list(csv.DictReader(open(lst + ".scanout"), delimiter="\t"))[0]
    return res, sc

def passes(sc):
    try:
        e, ms2, ft = int(sc["electron_FTMS"]), int(sc["ms2"]), int(sc["FTMS"])
    except (KeyError, ValueError):
        return False, "scan failed"
    if e < 500: return False, f"< 500 electron-activated (ETD/ECD, not hybrid) FTMS MS2 ({e})"
    if ft != ms2: return False, f"not all MS2 FTMS ({ms2 - ft} of {ms2} ITMS/other)"
    return True, ""

H = ["split", "set", "order", "pxd", "file", "bytes", "pride_sha1", "download", "raw_sha256", "mzml", "mzml_bytes",
     "mzml_sha256", "conversion", "ms2", "ms2_FTMS", "ms2_ITMS", "electron", "electron_FTMS", "hybrid", "collisional",
     "unknown", "activation", "first_ms2_filter", "first_electron_filter", "organisms", "decision", "title"]
out = open(OUT, "w"); out.write("\t".join(H) + "\n")
acc = 0
for k in sorted(by):
    if acc >= 2: break
    rs = by[k]; pxd = rs[0]["pxd"]; title = rs[0]["title"]
    oko, onote = organisms_ok(pxd)
    pre = ""
    if pxd in used: pre = "REJECTED: accession used by a DEV set or another item's manifest"
    elif NONTRYP.search(text(pxd) + " " + title): pre = "REJECTED: not tryptic bottom-up (title/description)"
    elif pxd in REVIEW: pre = "REJECTED: " + REVIEW[pxd]
    elif not oko: pre = "REJECTED: organism without a reviewed panel proteome (" + onote + ")"
    if pre:
        out.write("\t".join(["-", "-", str(k), pxd, rs[0]["file"], rs[0]["bytes"], rs[0]["pride_sha1"]] + ["-"] * 17
                            + [onote, pre + " (metadata; not downloaded)", title]) + "\n"); out.flush(); continue
    split, sname = ("H1", "set9") if acc == 0 else ("H2", "set10")
    ok = False
    for i, r in enumerate(rs):
        if i > 0 and not ok: break
        res, sc = stage(r)
        if sc is None:   # never decide on an unverified download: stop here, the order must be kept
            out.write("\t".join(["-", "-", str(k), pxd, r["file"], r["bytes"], r["pride_sha1"], res[2], res[3]] + ["-"] * 15
                                 + [onote, "UNDECIDED: download/conversion failed after 4 staging attempts; run stopped", title]) + "\n")
            out.close(); print("stopped at", k); sys.exit(2)
        good, why = passes(sc)
        if i == 0:
            ok = good; dec = "accepted" if good else "REJECTED: " + why
        else:
            dec = "kept" if good else "dropped: " + why
        g = lambda key: sc.get(key, "-") or "-"
        out.write("\t".join([split if ok else "-", sname if ok else "-", str(k), pxd, r["file"], r["bytes"], r["pride_sha1"],
                             res[2], res[3], res[5] or "-", res[6] or "-", res[7] or "-", res[8] if len(res) > 8 else "-",
                             g("ms2"), g("FTMS"), g("ITMS"), g("electron"), g("electron_FTMS"), g("hybrid"),
                             g("collisional"), g("unknown"), g("activation"), g("filter"), g("first_electron_filter"),
                             onote, dec, title]) + "\n"); out.flush()
    if ok: acc += 1
out.close()
print("accepted", acc)
