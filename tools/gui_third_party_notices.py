#!/usr/bin/env python3
"""Write GUI-THIRD-PARTY-NOTICES.txt for a desktop-app bundle.

    gui_third_party_notices.py --gui <gui dir> --target <rust triple> --out <file>
                               [--platform macos|linux|windows]
                               [--appimage-listing <unsquashfs -lls output>]

The desktop app (gui/) redistributes, besides the command-line closure that
THIRD-PARTY-NOTICES.txt (tools/third_party_notices.py) covers:

  1. the Rust crates compiled into the app: the normal (not build-only, not
     dev-only) dependency closure of gui/src-tauri for --target, taken from
     `cargo metadata --locked --filter-platform` over Cargo.lock;
  2. the npm production dependencies built into the frontend (the entries of
     gui/package-lock.json that are not "dev"), read from gui/node_modules;
  3. the fonts and images in gui/src/assets;
  4. on Linux with --appimage-listing (the AppImage's file list, from
     `unsquashfs -o $(app --appimage-offset) -lls app`; nothing is
     extracted), the system libraries linuxdeploy copied
     into the AppImage (WebKitGTK, GTK, GStreamer, ...): each mapped to the
     Debian/Ubuntu package that installed it on the build machine, with that
     package's copyright file, the licence texts it refers to, and for every
     (L)GPL package a pointer to its Ubuntu source package and version.

Every component is listed with its licence AND its licence text. A crate or
npm package that ships no licence file gets the canonical SPDX text of its
licence from tools/licenses/spdx/ (with the crate's authors as copyright
holders); if that is missing too, or an AppImage library belongs to no
package, nothing is written and the exit code is 1. A notice without the
licence text is not a notice.

Needs cargo (with the crates fetched, which `cargo metadata` does), the gui's
node_modules (npm ci), and on Linux dpkg.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPDX_DIR = HERE / "licenses" / "spdx"
LICENCE_FILE = re.compile(r"^(licen[cs]e|copying|notice|copyright|unlicense|authors)([-_.].*)?$", re.I)
# Not licence texts, although their names match.
NOT_LICENCE = re.compile(r"\.(rs|toml|json|js|ts|mjs|cjs|py|sh|html|yml|yaml)$", re.I)
WIDTH = 78


class Missing(Exception):
    pass


def spdx_ids(expr: str) -> list[str]:
    """The licence ids of an SPDX expression ("MIT OR Apache-2.0", "(A AND B)",
    "Apache-2.0 WITH LLVM-exception"; also the old "MIT/Apache-2.0")."""
    expr = expr.replace("/", " OR ")
    toks = re.findall(r"[A-Za-z0-9.+-]+", expr)
    out, skip = [], False
    for t in toks:
        if t in ("AND", "OR"):
            continue
        if t == "WITH":
            skip = True  # the exception id follows; looked up as <id>.txt too
            continue
        if skip:
            out.append(t)
            skip = False
            continue
        out.append(t)
    return list(dict.fromkeys(out))


def spdx_text(lid: str) -> str | None:
    p = SPDX_DIR / f"{lid}.txt"
    if p.is_file():
        return p.read_text(encoding="utf-8")
    if lid.endswith("+"):
        return spdx_text(lid[:-1])
    return None


def licence_files(d: Path, depth: int = 1) -> list[Path]:
    """Licence-like files at the top of a package (and one level below in a
    licenses/ or LICENSES/ folder)."""
    out = []
    if not d.is_dir():
        return out
    for p in sorted(d.iterdir()):
        if p.is_file() and LICENCE_FILE.match(p.name) and not NOT_LICENCE.search(p.name):
            out.append(p)
        elif depth and p.is_dir() and p.name.lower() in ("license", "licenses", "licence", "licences"):
            out.extend(q for q in sorted(p.rglob("*")) if q.is_file())
    return out


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace").rstrip()


def banner(title: str) -> list[str]:
    return ["", "=" * WIDTH, title, "=" * WIDTH]


class Texts:
    """Licence texts, each printed once, with every component that uses it."""

    def __init__(self) -> None:
        self.order: list[str] = []
        self.text: dict[str, str] = {}
        self.users: dict[str, list[str]] = {}

    def add(self, component: str, label: str, text: str) -> None:
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if h not in self.text:
            self.order.append(h)
            self.text[h] = f"--- {label} ---\n{text}"
            self.users[h] = []
        if component not in self.users[h]:
            self.users[h].append(component)

    def render(self) -> list[str]:
        lines = []
        for i, h in enumerate(self.order, 1):
            lines += ["", "-" * WIDTH, f"[T{i}] used by: " + ", ".join(self.users[h]), "-" * WIDTH, self.text[h]]
        return lines


# --------------------------------------------------------------- Rust crates
def rust_crates(src_tauri: Path, target: str) -> list[dict]:
    meta = json.loads(subprocess.run(
        ["cargo", "metadata", "--locked", "--format-version", "1", "--filter-platform", target],
        cwd=src_tauri, check=True, capture_output=True, encoding="utf-8").stdout)
    pkgs = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]
    seen, todo = set(), [root]
    while todo:
        pid = todo.pop()
        if pid in seen:
            continue
        seen.add(pid)
        for dep in nodes[pid]["deps"]:
            # Normal dependencies only: a build-dependency (build scripts,
            # their helpers) or dev-dependency is not compiled into the app.
            if any(k.get("kind") is None for k in dep["dep_kinds"]):
                todo.append(dep["pkg"])
    seen.discard(root)
    return sorted((pkgs[i] for i in seen), key=lambda p: (p["name"], p["version"]))


def rust_section(src_tauri: Path, target: str, texts: Texts, missing: list[str]) -> list[str]:
    crates = rust_crates(src_tauri, target)
    lines = banner(f"Rust crates compiled into the app ({len(crates)}, target {target}, from gui/src-tauri/Cargo.lock)")
    lines.append(f"{'crate':36} {'version':14} licence")
    for c in crates:
        name = f"{c['name']} {c['version']}"
        lic = c.get("license") or ""
        lines.append(f"{c['name']:36} {c['version']:14} {lic or '(licence file only)'}")
        d = Path(c["manifest_path"]).parent
        files = licence_files(d)
        if c.get("license_file"):
            lf = (d / c["license_file"]).resolve()
            if lf.is_file() and lf not in files:
                files.append(lf)
        got = False
        for f in files:
            t = read(f)
            if t:
                texts.add(name, f"{c['name']}: {f.relative_to(d) if f.is_relative_to(d) else f.name}", t)
                got = True
        if got:
            continue
        # No licence file in the published crate: the canonical text of every
        # licence the expression names, with the crate's authors as holders.
        ids = spdx_ids(lic)
        if not ids:
            missing.append(f"Rust crate {name}: no licence field and no licence file")
            continue
        holders = ", ".join(a.split("<")[0].strip() for a in c.get("authors") or []) or f"the {c['name']} authors"
        for lid in ids:
            t = spdx_text(lid)
            if t is None:
                missing.append(f"Rust crate {name}: no licence file, and no SPDX text for {lid} in {SPDX_DIR}")
                continue
            texts.add(name, f"{lid} (canonical SPDX text; the crate ships no licence file; "
                            f"copyright holders: {holders})", t.rstrip())
    return lines


# ---------------------------------------------------------------- npm deps
def npm_section(gui: Path, texts: Texts, missing: list[str]) -> list[str]:
    lock = json.loads((gui / "package-lock.json").read_text(encoding="utf-8"))
    rows = []
    for key, rec in sorted(lock.get("packages", {}).items()):
        if not key.startswith("node_modules/") or rec.get("dev") or rec.get("devOptional"):
            continue
        if rec.get("optional") and not (gui / key).is_dir():
            continue  # an optional package for another platform
        rows.append((key, rec))
    lines = banner(f"npm packages built into the frontend ({len(rows)}, production dependencies of gui/package-lock.json)")
    lines.append(f"{'package':36} {'version':14} licence")
    for key, rec in rows:
        name = key[len("node_modules/"):].replace("/node_modules/", " > ")
        ver = rec.get("version", "?")
        d = gui / key
        lic = rec.get("license") or ""
        if not lic and (d / "package.json").is_file():
            lic = json.loads((d / "package.json").read_text(encoding="utf-8")).get("license", "")
        lines.append(f"{name:36} {ver:14} {lic}")
        if not d.is_dir():
            missing.append(f"npm package {name} {ver}: not installed in {gui}/node_modules (run npm ci first)")
            continue
        files = licence_files(d, depth=0)
        got = False
        for f in files:
            t = read(f)
            if t:
                texts.add(f"{name} {ver}", f"{name}: {f.name}", t)
                got = True
        if not got:
            for lid in spdx_ids(lic) or [""]:
                t = spdx_text(lid) if lid else None
                if t is None:
                    missing.append(f"npm package {name} {ver}: no licence file and no SPDX text for '{lid}'")
                    continue
                texts.add(f"{name} {ver}", f"{lid} (canonical SPDX text; the package ships no licence file)", t.rstrip())
    return lines


# ------------------------------------------------------------------ assets
def assets_section(gui: Path, texts: Texts, missing: list[str]) -> list[str]:
    fonts = gui / "src" / "assets" / "fonts"
    lines = banner("Fonts and images built into the frontend (gui/src/assets)")
    ofl = sorted(fonts.glob("OFL-*.txt"))
    woff = sorted(p.name for p in fonts.glob("*.woff2"))
    lines += [
        "IBM Plex Sans and IBM Plex Mono (IBM Corp., https://github.com/IBM/plex),",
        "latin and latin-ext subsets, WOFF2: " + ", ".join(woff),
        "Licence: SIL Open Font License 1.1 (texts below).",
        "",
        "OpenMS logo (gui/src/assets/openms-logo.png): the OpenMS project's logo,",
        "https://www.openms.de, shown only to credit OpenMS; not covered by FASTag's",
        "MIT licence.",
        "FASTag logo (gui/src/assets/logo.svg): part of FASTag, MIT.",
    ]
    if not ofl:
        missing.append(f"fonts: no OFL-*.txt in {fonts}")
    for f in ofl:
        texts.add(f.stem.replace("OFL-", "IBM Plex ").replace("IBMPlex", ""), f"{f.name}", read(f))
    return lines


# --------------------------------------------------------------- platforms
# The bzip2 licence as NSIS ships it (section "BZIP2 LICENSE" of NSIS's COPYING,
# https://github.com/kichik/nsis/blob/master/COPYING).
NSIS_LZMA_EXCEPTION = """\
SPECIAL EXCEPTION FOR LZMA COMPRESSION MODULE

Igor Pavlov and Amir Szekely, the authors of the LZMA compression module for NSIS, expressly permit you to statically or dynamically link your code (or bind by name) to the files from the LZMA compression module for NSIS without subjecting your linked code to the terms of the Common Public license version 1.0. Any modifications or additions to files from the LZMA compression module for NSIS, however, are subject to the terms of the Common Public License version 1.0."""

NSIS_BZIP2 = """\
This program, "bzip2" and associated library "libbzip2", are copyright (C) 1996-2000 Julian R Seward. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

      1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

      2. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.

      3. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.

      4. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Julian Seward, Cambridge, UK.

jseward@acm.org"""


def platform_section(platform: str, texts: Texts, missing: list[str]) -> list[str]:
    if platform == "macos":
        return banner("System components (not redistributed)") + [
            "The app draws its window with the WebKit framework of macOS (WKWebView).",
            "It is part of the operating system and not included in this bundle.",
        ]
    if platform == "windows":
        lines = banner("System components and the installer") + [
            "The app draws its window with Microsoft Edge WebView2, which is part of",
            "Windows 10 and 11. It is not included in this installer; where it is",
            "missing, the installer downloads Microsoft's WebView2 bootstrapper, under",
            "Microsoft's own terms.",
            "",
            "The installer is built with NSIS (Nullsoft Scriptable Install System,",
            "https://nsis.sourceforge.io), whose installer stub is under the zlib/libpng",
            "licence; its LZMA compression module is under the Common Public License 1.0",
            "with the authors' linking exception (source: https://github.com/kichik/nsis)",
            "and its bzip2 code is under the bzip2 licence. Licence texts below.",
        ]
        t = spdx_text("Zlib")
        if t is None:
            missing.append("NSIS: no SPDX text for Zlib")
        else:
            texts.add("NSIS installer stub", "Zlib (zlib/libpng licence)", t.rstrip())
        t = spdx_text("CPL-1.0")
        if t is None:
            missing.append("NSIS: no SPDX text for CPL-1.0")
        else:
            texts.add("NSIS LZMA compression module", "CPL-1.0 with linking exception (as in NSIS's COPYING)",
                      t.rstrip() + "\n\n" + NSIS_LZMA_EXCEPTION)
        texts.add("NSIS bzip2 compression module", "bzip2 licence (bzip2 1.0, as in NSIS's COPYING)", NSIS_BZIP2)
        return lines
    if platform == "linux":
        return banner("System components") + [
            "The .deb and the tarball redistribute no system library: they depend on",
            "the distribution's WebKitGTK 4.1 and GTK 3 (libwebkit2gtk-4.1-0, libgtk-3-0).",
            "The AppImage bundles its libraries; they are listed in the AppImage's own",
            "copy of this file.",
        ]
    return []


# ---------------------------------------------------------------- AppImage
COPYLEFT = re.compile(r"\bL?GPL|GNU (Lesser |Library )?General Public", re.I)


def dpkg_owner(path: str) -> str | None:
    r = subprocess.run(["dpkg", "-S", path], capture_output=True, text=True)
    if r.returncode != 0:
        return None
    for line in r.stdout.splitlines():
        pkg, _, p = line.partition(": ")
        if p.strip() == path:
            return pkg.split(",")[0].strip()
    return None


def find_origin(rel: Path) -> tuple[str | None, str | None]:
    """The Debian package that installed the file linuxdeploy copied to
    usr/<rel>, and the original path. Tried at the same path under / and
    /usr, then by its basename anywhere dpkg knows it."""
    name = rel.name
    for cand in (Path("/usr") / rel, Path("/") / rel):
        for p in {str(cand), os.path.realpath(cand)}:
            if os.path.exists(p):
                pkg = dpkg_owner(p)
                if pkg:
                    return pkg, p
    # dpkg treats a pattern containing '/' as a whole-path glob, so the
    # basename needs the leading '*/' to match any directory.
    r = subprocess.run(["dpkg", "-S", "*/" + name], capture_output=True, text=True)
    hits = []
    for line in r.stdout.splitlines():
        pkg, _, p = line.partition(": ")
        p = p.strip()
        if os.path.basename(p) == name and os.path.exists(p):
            hits.append((pkg.split(",")[0].strip(), p))
    # Prefer a runtime package over its -dev package (which owns the symlink).
    hits.sort(key=lambda h: (h[0].endswith("-dev"), h[0]))
    return (hits[0] if hits else (None, None))


def deb_query(pkg: str, fmt: str) -> str:
    return subprocess.run(["dpkg-query", "-W", "-f", fmt, pkg], capture_output=True, text=True).stdout.strip()


def read_listing(path: Path) -> list[tuple[Path, bool]]:
    """(path inside the AppImage, executable) of every regular file in an
    `unsquashfs -lls` listing ("-rwxr-xr-x root/root 123 2026-11-18 09:00
    squashfs-root/usr/lib/libx.so.1"); directories and symlinks are skipped."""
    out = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        f = line.split(None, 5)
        if len(f) < 6 or not f[0].startswith("-"):
            continue
        name = f[5]
        if name.startswith("squashfs-root/"):
            name = name[len("squashfs-root/"):]
        out.append((Path(name), "x" in f[0][1:4]))
    return out


def bundled_files(listing: list[tuple[Path, bool]]) -> list[Path]:
    """The files linuxdeploy brought in: shared objects anywhere and
    executables under usr/lib and usr/libexec (WebKitGTK's helper processes),
    except the app's own payload under resources/fastag (the CLI and its
    closure, covered by THIRD-PARTY-NOTICES.txt)."""
    # linuxdeploy also copies the CLI's own libraries (resources/fastag/lib)
    # into usr/lib; those are the CLI's closure too.
    cli_libs = {rel.name for rel, _ in listing
                if "resources" in rel.parts and "fastag" in rel.parts and "lib" in rel.parts}
    files = []
    for rel, exe in listing:
        parts = rel.parts
        if "resources" in parts and "fastag" in parts:
            continue
        if rel.name in cli_libs:
            continue
        if ".so" in rel.name or (exe and len(parts) > 2 and parts[0] == "usr" and parts[1] in ("lib", "libexec")):
            files.append(rel)
    return sorted(files)


def appimage_section(listing: list[tuple[Path, bool]], texts: Texts, missing: list[str]) -> list[str]:
    files = bundled_files(listing)
    by_pkg: dict[str, list[str]] = {}
    for rel in files:
        # linuxdeploy flattens most libraries into usr/lib; WebKitGTK's helper
        # processes and injected bundle keep their multiarch subpath.
        sub = Path(*rel.parts[1:]) if rel.parts and rel.parts[0] == "usr" else rel
        pkg, orig = find_origin(sub)
        if pkg is None and rel.parts[:2] == ("usr", "lib"):
            pkg, orig = find_origin(Path("lib") / rel.name)
        if pkg is None:
            missing.append(f"AppImage file {rel}: no Debian package owns a file of that name on this machine")
            continue
        by_pkg.setdefault(pkg, []).append(str(rel))
    dist = ""
    try:
        osr = dict(l.split("=", 1) for l in Path("/etc/os-release").read_text().splitlines() if "=" in l)
        dist = f"{osr.get('NAME', '').strip(chr(34))} {osr.get('VERSION_ID', '').strip(chr(34))}".strip()
        codename = osr.get("VERSION_CODENAME", "").strip('"')
    except OSError:
        codename = ""
    lines = banner(f"System libraries bundled in the AppImage ({len(files)} files from {len(by_pkg)} packages of {dist or 'the build system'})")
    lines += [
        "linuxdeploy copied these files, unmodified, from the build machine's",
        "packages into the AppImage. Per package: version, source package, the",
        "files, and below the package's copyright file and the licence texts it",
        "refers to.",
        "",
    ]
    copyleft = []
    for pkg in sorted(by_pkg):
        ver = deb_query(pkg, "${Version}")
        src = deb_query(pkg, "${source:Package}") or pkg
        srcver = deb_query(pkg, "${source:Version}") or ver
        lines.append(f"{pkg} {ver} (source package {src} {srcver})")
        lines += [f"    {f}" for f in sorted(by_pkg[pkg])]
        base = pkg.split(":")[0]
        cp = Path("/usr/share/doc") / base / "copyright"
        if not cp.is_file():
            missing.append(f"AppImage package {pkg}: no /usr/share/doc/{base}/copyright")
            continue
        text = read(cp)
        texts.add(f"{pkg} {ver}", f"/usr/share/doc/{base}/copyright", text)
        for lic in sorted(set(re.findall(r"/usr/share/common-licenses/([A-Za-z0-9.+_-]+)", text))):
            lp = Path("/usr/share/common-licenses") / lic.rstrip(".")
            if lp.is_file():
                texts.add(f"{pkg} {ver}", f"/usr/share/common-licenses/{lp.name}", read(lp))
            else:
                missing.append(f"AppImage package {pkg}: refers to /usr/share/common-licenses/{lic}, which is absent")
        if COPYLEFT.search(text):
            copyleft.append((pkg, src, srcver))
    if copyleft:
        lines += banner("Source code of the (L)GPL libraries in the AppImage") + [
            "Some of the libraries above are licensed under the GNU Lesser General Public",
            "License or the GNU General Public License (see their copyright files below).",
            "They are redistributed unmodified, as built by the distribution. Their",
            "complete corresponding source code is the distribution's source package",
            f"of the version named, from the {dist or 'distribution'} archive",
            "(`apt-get source <package>=<version>`; also at",
            "https://launchpad.net/ubuntu/+source/<package>/<version>):",
            "",
        ]
        for pkg, src, srcver in sorted(set(copyleft)):
            lines.append(f"  {src} {srcver}" + (f"   (https://launchpad.net/ubuntu/+source/{src}/{srcver})" if src else ""))
        lines += [
            "",
            "The source packages are kept in the Ubuntu archive for every published",
            "version (Launchpad, links above). The FASTag project makes no separate",
            "offer of these sources.",
            "",
            "You may replace any of these libraries in the AppImage with a modified",
            "version (extract it with --appimage-extract, replace the file, and run",
            "AppRun), as the LGPL permits.",
        ]
    return lines


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gui", type=Path)
    ap.add_argument("--target")
    ap.add_argument("--out", type=Path)
    ap.add_argument("--platform", choices=["macos", "linux", "windows"])
    ap.add_argument("--appimage-listing", type=Path)
    ap.add_argument("--check-appimage", type=Path, metavar="NOTICES",
                    help="with --appimage-listing: only check that NOTICES names every library the listing bundles")
    a = ap.parse_args()

    if a.check_appimage:
        text = a.check_appimage.read_text(encoding="utf-8", errors="replace")
        files = bundled_files(read_listing(a.appimage_listing))
        absent = [str(f) for f in files if str(f) not in text]
        if absent or not files:
            print(f"{a.check_appimage}: {len(absent)} of {len(files)} bundled libraries not listed: {absent[:20]}",
                  file=sys.stderr)
            return 1
        print(f"{a.check_appimage}: lists all {len(files)} libraries the AppImage bundles", file=sys.stderr)
        return 0

    if not (a.gui and a.target and a.out):
        ap.error("--gui, --target and --out are required (except with --check-appimage)")
    gui = a.gui.resolve()
    version = json.loads((gui / "package.json").read_text(encoding="utf-8")).get("version", "?")
    texts, missing = Texts(), []
    lines = [
        f"FASTag desktop app {version}: third-party notices",
        "",
        "FASTag itself is MIT-licensed (LICENSE). The desktop app contains the",
        "third-party components below. The command-line program it runs, and the",
        "libraries that program loads, are covered by THIRD-PARTY-NOTICES.txt in",
        "the same folder as this file. Each licence text is printed once, at the",
        "end, with the components that use it ([T1], [T2], ...).",
    ]
    lines += rust_section(gui / "src-tauri", a.target, texts, missing)
    lines += npm_section(gui, texts, missing)
    lines += assets_section(gui, texts, missing)
    if a.platform:
        lines += platform_section(a.platform, texts, missing)
    if a.appimage_listing:
        lines += appimage_section(read_listing(a.appimage_listing), texts, missing)
    lines += banner("Licence texts") + texts.render()

    if missing:
        print(f"{len(missing)} component(s) without a licence text; nothing written:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)
        return 1
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{a.out}: {len(texts.order)} distinct licence texts, {a.out.stat().st_size} bytes", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
