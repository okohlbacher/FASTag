#!/usr/bin/env python3
"""Fetch UniProt reference proteomes for the FASTag species reference set.

  fetch_reference_set.py data/taxonomy/reference-set.tsv <out_dir>
  fetch_reference_set.py --resolve-only data/taxonomy/reference-set.tsv <out.json>

Writes <out_dir>/<taxid>.fasta, which is what buildtaxdb expects, and
<out_dir>/fetch-manifest.json: the UniProt release and its date (from the
X-UniProt-Release headers of the REST API, checked against the FTP release
notes), and per taxon the requested and fetched taxid, the reference proteome
(UP...), the URL, the sha256 of the downloaded .fasta.gz and of the FASTA, the
number of entries and the time of the download. tools/package_taxonomy.py
puts that record, with the taxdump and the buildtaxdb run, into the index
tarball as MANIFEST.json, so a shipped index names exactly what it was built
from. The URLs point at current_release, which moves; the manifest also names
UniProt's archive of the release (previous_releases/release-<release>/), from
which the same FASTA files can be taken again once the release is superseded.

--resolve-only writes only the taxon -> proteome resolution (no FASTA), as of
today, to <out.json>.

REFERENCE PROTEOMES, not `reviewed:true`. Curation effort tracks how
well-studied an organism is, so a reviewed-only fetch gave 20,431 proteins for
human and 35 for S. pneumoniae -- and that lands directly in the background
model, where a taxon with 35 proteins has an artificially tiny expectation and
anything matching it looks enriched.

Resolution is two-step because UniProt has no single query for "the reference
proteome of taxid X": list the proteomes for the organism, then take the one
whose proteomeType is "Reference proteome" (an organism can also carry
"Excluded" or redundant entries).

Skips files that already exist, so an interrupted run resumes; a resumed file
keeps the manifest entry of the run that downloaded it. A fetch that spans two
UniProt releases fails.
"""
import datetime
import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://rest.uniprot.org"
FTP_ROOT = "https://ftp.uniprot.org/pub/databases/uniprot"
FTP = f"{FTP_ROOT}/current_release/knowledgebase/reference_proteomes"
MANIFEST = "fetch-manifest.json"

release = {"release": None, "release_date": None}


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                rel = r.headers.get("X-UniProt-Release")
                if rel:
                    if release["release"] and release["release"] != rel:
                        raise RuntimeError(f"UniProt release changed during the fetch: {release['release']} -> {rel}")
                    release["release"] = rel
                    release["release_date"] = r.headers.get("X-UniProt-Release-Date")
                return r.read()
        except RuntimeError:
            raise
        except Exception as e:  # transient 5xx / reset
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))
            print(f"    retry {i+1}: {e}", file=sys.stderr)


def ftp_release():
    """The release named in current_release/relnotes.txt ("UniProt Release 2026_04")."""
    try:
        txt = get(f"{FTP_ROOT}/current_release/relnotes.txt", tries=2).decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"Release\s+(\d{4}_\d{2})", txt)
    return m.group(1) if m else None


def reference_proteome(taxid):
    """(UP accession, superkingdom, taxid_actually_fetched) or (None,None,None).

    Two-stage on purpose. `organism_id:` matches the taxid EXACTLY, and most
    bacterial SPECIES carry no reference proteome of their own -- the reference
    sits on a strain (S. aureus 1280 -> USA300 367830), so an exact match alone
    misses them (11 of the 50 reference taxa). Falling back to the taxonomy
    SUBTREE finds the strain, and we then key the file by the
    strain's taxid, which is what the sequences actually are; roll-up to genus
    is the classifier's job and is unaffected.
    """
    def pick(query):
        q = urllib.parse.quote(query)
        data = get(f"{API}/proteomes/search?query={q}&format=json&size=50")
        rs = json.loads(data).get("results", [])
        for r in rs:
            if r.get("proteomeType") == "Reference proteome":
                return r
        return None

    def kingdom(r):
        lin = [x.get("scientificName", "") if isinstance(x, dict) else str(x)
               for x in r.get("taxonomy", {}).get("lineage", [])]
        for k in ("Bacteria", "Archaea", "Viruses"):
            if k in lin:
                return k
        return "Eukaryota"

    r = pick(f"organism_id:{taxid}") or pick(f"taxonomy_id:{taxid}")
    if not r:
        return None, None, None
    got = r.get("taxonomy", {}).get("taxonId", taxid)
    return r.get("id"), kingdom(r), got


def read_set(path):
    entries = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        f = line.split("\t")
        if len(f) >= 2:
            entries.append((f[0], f[1]))
    return entries


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main(argv):
    if len(argv) == 4 and argv[1] == "--resolve-only":
        out = []
        for taxid, label in read_set(argv[2]):
            up, kdom, got = reference_proteome(taxid)
            out.append({"taxid": int(taxid), "label": label, "fetched_taxid": got, "proteome": up,
                        "superkingdom": kdom})
            print(f"{taxid:<8} {label:<34} {up} {got}")
        with open(argv[3], "w", encoding="utf-8") as fh:
            json.dump({"resolved_at": now(), "uniprot_release": release["release"],
                       "uniprot_release_date": release["release_date"], "taxa": out}, fh, indent=1)
            fh.write("\n")
        return 0
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    manifest, out_dir = argv[1], argv[2]
    os.makedirs(out_dir, exist_ok=True)
    mpath = os.path.join(out_dir, MANIFEST)
    old = {}
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as fh:
            prev = json.load(fh)
        old = {str(t["taxid"]): t for t in prev.get("taxa", [])}
        release["release"] = prev.get("uniprot_release")
        release["release_date"] = prev.get("uniprot_release_date")

    entries = read_set(manifest)
    total_prot = 0
    failures = []
    taxa = []
    for i, (taxid, label) in enumerate(entries, 1):
        rec = old.get(taxid)
        if rec and os.path.exists(os.path.join(out_dir, rec["file"])):
            total_prot += rec["entries"]
            taxa.append(rec)
            print(f"[{i}/{len(entries)}] {taxid:<8} {label:<34} cached {rec['entries']} proteins")
            continue
        up, kdom, got = reference_proteome(taxid)
        if not up:
            failures.append((taxid, label, "no proteome"))
            print(f"[{i}/{len(entries)}] {taxid:<8} {label:<34} NO PROTEOME", file=sys.stderr)
            continue

        # The CANONICAL one-protein-per-gene file, not the REST proteome query.
        # Querying (proteome:UP...) returns every isoform and unreviewed entry --
        # 147,506 sequences for human against ~2,000 for a bacterium, which is
        # the same unevenness this set exists to remove. The FTP file is 20,652
        # for human: differences track real proteome size, not curation.
        fasta, blob, url, where = b"", b"", None, None
        for k in (kdom, "Eukaryota", "Bacteria", "Archaea", "Viruses"):
            try:
                u = f"{FTP}/{k}/{up}/{up}_{got}.fasta.gz"
                blob = get(u, tries=2)
                if blob[:2] == b"\x1f\x8b":
                    fasta, url, where = gzip.decompress(blob), u, k
                    break
            except Exception:
                continue
        if not fasta.startswith(b">"):
            failures.append((taxid, label, f"empty fetch ({up})"))
            print(f"[{i}/{len(entries)}] {taxid:<8} {label:<34} EMPTY {up}", file=sys.stderr)
            continue
        # Key the file by the taxid whose sequences these ARE.
        path = os.path.join(out_dir, f"{got}.fasta")
        with open(path, "wb") as fh:
            fh.write(fasta)
        n = fasta.count(b"\n>") + 1
        total_prot += n
        via = "" if str(got) == str(taxid) else f" (via strain {got})"
        print(f"[{i}/{len(entries)}] {taxid:<8} {label:<34} {up} {n} proteins{via}")
        taxa.append({
            "taxid": int(taxid), "label": label, "fetched_taxid": int(got), "proteome": up,
            "superkingdom": where, "url": url, "file": f"{got}.fasta",
            "fasta_gz_sha256": hashlib.sha256(blob).hexdigest(),
            "fasta_sha256": hashlib.sha256(fasta).hexdigest(),
            "entries": n, "downloaded_at": now(),
        })

    ftp_rel = ftp_release()
    if ftp_rel and release["release"] and ftp_rel != release["release"]:
        failures.append(("-", "-", f"REST API says UniProt {release['release']}, FTP current_release says {ftp_rel}"))
    rel = release["release"] or ftp_rel
    with open(mpath, "w", encoding="utf-8") as fh:
        json.dump({
            "reference_set": os.path.basename(manifest),
            "reference_set_sha256": hashlib.sha256(open(manifest, "rb").read()).hexdigest(),
            "uniprot_release": rel,
            "uniprot_release_date": release["release_date"],
            "uniprot_archive": (f"{FTP_ROOT}/previous_releases/release-{rel}/knowledgebase/" if rel else None),
            "source": "UniProt reference proteomes, canonical one-protein-per-gene FASTA "
                      "(knowledgebase/reference_proteomes/<superkingdom>/<UP>/<UP>_<taxid>.fasta.gz)",
            "licence": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); The UniProt Consortium",
            "tool": "tools/fetch_reference_set.py",
            "taxa": taxa,
        }, fh, indent=1)
        fh.write("\n")

    print(f"\n{len(entries)-len(failures)}/{len(entries)} taxa, {total_prot} proteins total, UniProt {rel}")
    print(f"manifest: {mpath}")
    for t, l, why in failures:
        print(f"  FAILED {t} {l}: {why}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
