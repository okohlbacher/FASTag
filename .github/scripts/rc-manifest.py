#!/usr/bin/env python3
"""The release-candidate manifest: which files a full-payload dry run made,
with their sha256, and the run they came from.

A full-payload dry run (ci.yml / windows.yml dispatched with gui_dry_run and
gui_full_payload) is a release CANDIDATE: every job that makes a release
file writes a part (the file's release name, the artifact and path it sits
in, its size and sha256); the job "release candidate" runs only when every
gate of the run passed, merges the parts with the run's identity into
manifest.json and uploads it as the artifact release-candidate-manifest. A
v* tag build of the same git tree then attaches exactly those files instead
of building them again (.github/scripts/release-candidate.sh finds the run;
this script checks every byte).

  rc-manifest.py part --job J --artifact A [--group G] --out F NAME=PATH...
  rc-manifest.py merge --out M [--meta K=V]... [--require NAME]... PART...
  rc-manifest.py verify M --tree T --version V --run-id R --workflow-id W [--meta K=V]...
  rc-manifest.py list M [--group G]            (artifact<TAB>path<TAB>name<TAB>sha256 per file)
  rc-manifest.py check M --dir D --out O [--group G]
        D/<artifact>/<path> must have the manifest's sha256; copied to O/<name>
  rc-manifest.py release M ASSETS.json [--group G]
        the release's assets (gh api .../releases/<id> .assets) carry the
        manifest's sha256 digest for each file of the group
Exit 0 on success; any mismatch prints the reason and exits 1.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

SCHEMA = 1


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def die(msg):
    print("rc-manifest: " + msg, file=sys.stderr)
    sys.exit(1)


def load(path):
    try:
        with open(path) as f:
            m = json.load(f)
    except (OSError, ValueError) as e:
        die("cannot read %s: %s" % (path, e))
    if not isinstance(m, dict) or m.get("schema") != SCHEMA or not isinstance(m.get("files"), list):
        die("%s is not a schema-%d manifest" % (path, SCHEMA))
    return m


def files_of(m, group):
    return [f for f in m["files"] if group is None or f.get("group") == group]


def cmd_part(a):
    files = []
    for spec in a.files:
        if "=" not in spec:
            die("expected NAME=PATH, got %r" % spec)
        name, path = spec.split("=", 1)
        if not os.path.isfile(path):
            die("%s: no file %s" % (name, path))
        files.append({"name": name, "artifact": a.artifact, "path": os.path.basename(path),
                      "group": a.group or a.job, "job": a.job,
                      "size": os.path.getsize(path), "sha256": sha256(path)})
    with open(a.out, "w") as f:
        json.dump({"job": a.job, "files": files}, f, indent=1)
    for x in files:
        print("%s  %s (%d bytes, artifact %s)" % (x["sha256"], x["name"], x["size"], x["artifact"]))


def meta_pairs(pairs):
    out = {}
    for p in pairs or []:
        if "=" not in p:
            die("expected KEY=VALUE, got %r" % p)
        k, v = p.split("=", 1)
        out[k] = v
    return out


def cmd_merge(a):
    files, names = [], set()
    for p in a.parts:
        with open(p) as f:
            part = json.load(f)
        for x in part["files"]:
            if x["name"] in names:
                die("%s is in two parts" % x["name"])
            names.add(x["name"])
            files.append(x)
    missing = [n for n in a.require or [] if n not in names]
    if missing:
        die("the candidate lacks " + ", ".join(missing))
    m = {"schema": SCHEMA}
    m.update(meta_pairs(a.meta))
    for k in ("tree", "version", "run_id", "workflow_id"):
        if not m.get(k):
            die("--meta %s=... is required" % k)
    m["files"] = sorted(files, key=lambda x: x["name"])
    with open(a.out, "w") as f:
        json.dump(m, f, indent=1, sort_keys=True)
    print("manifest: %d files, tree %s, version %s, run %s" % (len(files), m["tree"], m["version"], m["run_id"]))


def cmd_verify(a):
    m = load(a.manifest)
    want = {"tree": a.tree, "version": a.version, "run_id": str(a.run_id), "workflow_id": str(a.workflow_id)}
    want.update(meta_pairs(a.meta))
    for k, v in want.items():
        if str(m.get(k, "")) != v:
            die("%s is %r in the manifest, expected %r" % (k, m.get(k), v))
    if not m["files"]:
        die("the manifest lists no file")
    for x in m["files"]:
        for k in ("name", "artifact", "path", "sha256", "size"):
            if k not in x:
                die("an entry lacks %s: %r" % (k, x))
        if a.version not in x["name"]:
            die("%s does not carry version %s" % (x["name"], a.version))
    print("manifest of run %s: tree, version, workflow and %d files as expected" % (m["run_id"], len(m["files"])))


def cmd_list(a):
    for x in files_of(load(a.manifest), a.group):
        print("\t".join((x["artifact"], x["path"], x["name"], x["sha256"])))


def cmd_check(a):
    m = load(a.manifest)
    fs = files_of(m, a.group)
    if not fs:
        die("no file in group %s" % a.group)
    os.makedirs(a.out, exist_ok=True)
    for x in fs:
        src = os.path.join(a.dir, x["artifact"], x["path"])
        if not os.path.isfile(src):
            die("%s: %s is missing" % (x["name"], src))
        got = sha256(src)
        if got != x["sha256"] or os.path.getsize(src) != x["size"]:
            die("%s: sha256 %s, the manifest has %s" % (x["name"], got, x["sha256"]))
        shutil.copyfile(src, os.path.join(a.out, x["name"]))
        print("%s  %s: as in the candidate" % (got, x["name"]))


def cmd_release(a):
    m = load(a.manifest)
    with open(a.assets) as f:
        assets = json.load(f)
    if isinstance(assets, dict):
        assets = assets.get("assets", [])
    have = {x["name"]: x for x in assets}
    bad = 0
    for x in files_of(m, a.group):
        r = have.get(x["name"])
        if r is None:
            print("MISSING on the release: %s" % x["name"]); bad = 1; continue
        d = (r.get("digest") or "").replace("sha256:", "")
        if d != x["sha256"] or int(r.get("size", -1)) != x["size"]:
            print("DIFFERS on the release: %s (digest %s, size %s; manifest %s, %d)"
                  % (x["name"], d or "none", r.get("size"), x["sha256"], x["size"])); bad = 1; continue
        print("%s  %s: the release asset is the candidate's file" % (d, x["name"]))
    sys.exit(bad)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("part"); p.add_argument("--job", required=True); p.add_argument("--artifact", required=True)
    p.add_argument("--group"); p.add_argument("--out", required=True); p.add_argument("files", nargs="+")
    p = sp.add_parser("merge"); p.add_argument("--out", required=True); p.add_argument("--meta", action="append")
    p.add_argument("--require", action="append"); p.add_argument("parts", nargs="*")
    p = sp.add_parser("verify"); p.add_argument("manifest"); p.add_argument("--tree", required=True)
    p.add_argument("--version", required=True); p.add_argument("--run-id", required=True)
    p.add_argument("--workflow-id", required=True); p.add_argument("--meta", action="append")
    p = sp.add_parser("list"); p.add_argument("manifest"); p.add_argument("--group")
    p = sp.add_parser("check"); p.add_argument("manifest"); p.add_argument("--dir", required=True)
    p.add_argument("--out", required=True); p.add_argument("--group")
    p = sp.add_parser("release"); p.add_argument("manifest"); p.add_argument("assets"); p.add_argument("--group")
    a = ap.parse_args()
    {"part": cmd_part, "merge": cmd_merge, "verify": cmd_verify, "list": cmd_list,
     "check": cmd_check, "release": cmd_release}[a.cmd](a)


if __name__ == "__main__":
    main()
