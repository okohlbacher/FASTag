#!/usr/bin/env python3
"""Put the vendor readers' runtime, licences and notices into a bundle, take
them out again, or check either state.

    vendor_bundle.py add   --root R --exe-dir E --share S --runtime DOTNET_DIR
    vendor_bundle.py strip --root R --exe-dir E --share S
    vendor_bundle.py check --root R --exe-dir E --share S [--absent]
    vendor_bundle.py installer-license OUT [--check]

R holds LICENSE and THIRD-PARTY-NOTICES.txt, E the FASTag executable, S
OpenMS's share directory (share-OpenMS in the CLI bundles, share/OpenMS in the
desktop app's resources). The OpenMS a bundle is built from has the Thermo
bridge (WITH_THERMO_RAW) and opentims (WITH_OPENTIMS); its share directory
already holds the bridge's managed half (S/openms_thermo_bridge/managed, with
Thermo's RawFileReader assemblies) and Thermo's licence
(S/LICENSES/ThermoRawFileReader-License.doc).

add: copies the .NET runtime DOTNET_DIR (a dotnet-install --runtime dotnet
  tree) to E/dotnet without the `dotnet` muxer (FASTag hosts the runtime
  through hostfxr; src/ThermoInput.h, useBundledRuntime); copies Thermo's
  licence (the .doc as distributed and a text rendering of it) to R/LICENSES/;
  appends the notices of the .NET runtime, opentims and the RawFileReader
  terms end users accept (section 3.3) to R/THIRD-PARTY-NOTICES.txt.
strip: removes the Thermo reader (the managed half, the .NET runtime, Thermo's
  licence and its notices) for a bundle that must not carry it (the AppImage).
  The native bridge library stays: libOpenMS links it, and without its managed
  half it reads nothing; FASTag then refuses .raw with the bridge's message.
installer-license: writes the licence page of the Windows installer and the
  macOS disk images (gui/src-tauri/installer-license.txt; UTF-8 with BOM, as
  NSIS reads it): FASTag's MIT licence, then the RawFileReader terms the user
  accepts by installing, then Thermo's licence. With --check, exits 1 when OUT
  differs from what it would write.
check: the state `add` leaves (or, with --absent, the one `strip` leaves);
  exits 1 on the first failure.
"""
import argparse
import re
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
THERMO_COPYRIGHT = "RawFileReader reading tool. Copyright \u00a9 2016 by Thermo Fisher Scientific, Inc. All rights reserved."
BEGIN = "=== vendor readers (vendor_bundle.py) ==="
END = "=== end of vendor readers ==="


def thermo_terms(root: Path, exe_rel: str) -> str:
    return f"""Thermo RawFileReader -- licence terms for end users
  {THERMO_COPYRIGHT}
  This bundle reads Thermo .raw files with Thermo Fisher Scientific's
  RawFileReader (the ThermoFisher.CommonCore.*.dll assemblies in
  {exe_rel}openms_thermo_bridge/managed beside OpenMS's data). They are NOT under
  FASTag's MIT licence but under Thermo's own licence,
  LICENSES/ThermoRawFileReader-License.doc (text rendering:
  LICENSES/ThermoRawFileReader-License.txt). By installing or using this
  bundle you agree to those terms; in particular you may not redistribute the
  RawFileReader assemblies to others (section 3.3), nor exploit them
  commercially without Thermo's written consent (section 4.2). To use FASTag
  without them, delete the managed/ folder: FASTag then refuses .raw input and
  reads every other format as before."""


DOTNET_NOTICE = """.NET runtime (dotnet/, Microsoft.NETCore.App) -- MIT
  Copyright (c) .NET Foundation and Contributors. The runtime that hosts the
  Thermo reader; its licence is dotnet/LICENSE.txt and the notices of the
  components it includes are dotnet/ThirdPartyNotices.txt."""


def opentims_notice() -> str:
    text = (REPO / "LICENSES" / "opentims-LICENCE.txt").read_text(encoding="utf-8")
    return "opentims v1.2.0b4 (Bruker timsTOF .d input, linked into libOpenMS) -- MIT\n" + text.strip()


def die(msg: str) -> None:
    print(f"::error::vendor_bundle: {msg}")
    sys.exit(1)


def notices_path(root: Path) -> Path:
    p = root / "THIRD-PARTY-NOTICES.txt"
    if not p.is_file():
        die(f"{p} does not exist")
    return p


def drop_section(text: str) -> str:
    return re.sub(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", "", text, flags=re.S)


def add(a) -> None:
    root, exe, share, rt = Path(a.root), Path(a.exe_dir), Path(a.share), Path(a.runtime)
    managed = share / "openms_thermo_bridge" / "managed"
    if not (managed / "ThermoWrapperManaged.dll").is_file():
        die(f"{managed} has no ThermoWrapperManaged.dll: OpenMS was built without WITH_THERMO_RAW")
    if not list((rt / "host" / "fxr").glob("*/*hostfxr*")):
        die(f"{rt} is not a .NET runtime tree (no host/fxr/<version>/hostfxr)")
    dst = exe / "dotnet"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(rt, dst, symlinks=False)
    for muxer in ("dotnet", "dotnet.exe"):
        (dst / muxer).unlink(missing_ok=True)
    lic = root / "LICENSES"
    lic.mkdir(exist_ok=True)
    shutil.copy2(share / "LICENSES" / "ThermoRawFileReader-License.doc", lic / "ThermoRawFileReader-License.doc")
    shutil.copy2(REPO / "LICENSES" / "ThermoRawFileReader-License.txt", lic / "ThermoRawFileReader-License.txt")
    shutil.copy2(REPO / "LICENSES" / "opentims-LICENCE.txt", lic / "opentims-LICENCE.txt")
    p = notices_path(root)
    exe_rel = ""
    try:
        exe_rel = str(share.relative_to(root)).replace("\\", "/") + "/"
    except ValueError:
        pass
    body = drop_section(p.read_text(encoding="utf-8"))
    body = body.rstrip("\n") + "\n\n" + "\n\n".join(
        [BEGIN, thermo_terms(root, exe_rel), DOTNET_NOTICE, opentims_notice(), END]) + "\n"
    p.write_text(body, encoding="utf-8")
    size = sum(f.stat().st_size for f in dst.rglob("*") if f.is_file())
    print(f"vendor readers added to {root}: .NET runtime {dst} ({size / 1e6:.1f} MB), "
          f"licences in {lic}, notices in {p.name}")


def strip(a) -> None:
    root, exe, share = Path(a.root), Path(a.exe_dir), Path(a.share)
    shutil.rmtree(exe / "dotnet", ignore_errors=True)
    shutil.rmtree(share / "openms_thermo_bridge" / "managed", ignore_errors=True)
    for f in [share / "LICENSES" / "ThermoRawFileReader-License.doc",
              root / "LICENSES" / "ThermoRawFileReader-License.doc",
              root / "LICENSES" / "ThermoRawFileReader-License.txt"]:
        f.unlink(missing_ok=True)
    p = notices_path(root)
    body = drop_section(p.read_text(encoding="utf-8"))
    # third_party_notices.py's own Thermo paragraph (written when the bridge
    # library is in the closure) goes too: this bundle has no Thermo reader.
    body = re.sub(r"\nThermo RawFileReader \(Thermo \.raw input\)\n(?:  .*\n)+", "\n", body)
    body = body.rstrip("\n") + "\n\nThis bundle does not include Thermo's RawFileReader or a .NET runtime: it does not read Thermo .raw files.\n"
    body += "\n" + opentims_notice() + "\n"
    p.write_text(body, encoding="utf-8")
    print(f"Thermo reader removed from {root}")


def check(a) -> None:
    root, exe, share = Path(a.root), Path(a.exe_dir), Path(a.share)
    notices = notices_path(root).read_text(encoding="utf-8")
    managed = share / "openms_thermo_bridge" / "managed"
    found = [str(f) for f in [root, exe, share] for f in f.rglob("ThermoFisher.CommonCore.*.dll")]
    if a.absent:
        if found:
            die(f"Thermo assemblies in a bundle that must not carry them: {found[:3]}")
        if (exe / "dotnet").exists():
            die(f"{exe / 'dotnet'} exists in a bundle without the Thermo reader")
        if "Thermo RawFileReader -- licence terms" in notices:
            die("THIRD-PARTY-NOTICES.txt still states the Thermo terms")
        if "opentims" not in notices:
            die("THIRD-PARTY-NOTICES.txt does not name opentims")
        print(f"{root}: no Thermo reader, no .NET runtime (as intended); opentims notice present")
        return
    for f in ["ThermoWrapperManaged.dll", "ThermoWrapperManaged.runtimeconfig.json",
              "ThermoFisher.CommonCore.RawFileReader.dll", "ThermoFisher.CommonCore.Data.dll"]:
        if not (managed / f).is_file():
            die(f"{managed / f} is missing")
    for f in [root / "LICENSES" / "ThermoRawFileReader-License.doc",
              root / "LICENSES" / "ThermoRawFileReader-License.txt",
              share / "LICENSES" / "ThermoRawFileReader-License.doc"]:
        if not f.is_file() or f.stat().st_size == 0:
            die(f"the Thermo licence {f} is missing or empty")
    for want in [THERMO_COPYRIGHT, "Thermo RawFileReader -- licence terms for end users",
                 "may not redistribute the", ".NET runtime (dotnet/", "opentims v1.2.0b4"]:
        if want not in notices:
            die(f"THIRD-PARTY-NOTICES.txt lacks '{want}'")
    fxr = list((exe / "dotnet" / "host" / "fxr").glob("*/*hostfxr*"))
    core = list((exe / "dotnet" / "shared" / "Microsoft.NETCore.App").glob("*/System.Private.CoreLib.dll"))
    if not fxr or not core:
        die(f"no usable .NET runtime in {exe / 'dotnet'} (hostfxr: {len(fxr)}, CoreLib: {len(core)})")
    if not (exe / "dotnet" / "LICENSE.txt").is_file():
        die(f"{exe / 'dotnet' / 'LICENSE.txt'} is missing")
    print(f"{root}: Thermo reader, its licence and notices, and the .NET runtime "
          f"{core[0].parent.name} present")


def installer_license() -> str:
    mit = (REPO / "LICENSE").read_text(encoding="utf-8").strip()
    thermo = (REPO / "LICENSES" / "ThermoRawFileReader-License.txt").read_text(encoding="utf-8")
    thermo = thermo.split("-" * 78, 1)[1].strip()
    return "\n".join([
        "FASTag is free software under the MIT licence (below). The FASTag",
        "installer also installs Thermo Fisher Scientific's RawFileReader, which",
        "reads Thermo .raw files and is NOT under the MIT licence:",
        "",
        "  " + THERMO_COPYRIGHT,
        "",
        "By installing FASTag you accept the RawFileReader licence below. In",
        "particular, you may not redistribute the RawFileReader assemblies",
        "(ThermoFisher.CommonCore.*.dll) to others, nor exploit them",
        "commercially without Thermo's written consent.",
        "",
        "=" * 72, "FASTag", "=" * 72, "", mit, "",
        "=" * 72, "RawFileReader (Thermo Fisher Scientific)", "=" * 72, "", thermo, ""])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["add", "strip", "check", "installer-license"])
    ap.add_argument("out", nargs="?")
    ap.add_argument("--root")
    ap.add_argument("--exe-dir")
    ap.add_argument("--share")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--runtime")
    ap.add_argument("--absent", action="store_true")
    a = ap.parse_args()
    if a.cmd == "installer-license":
        if not a.out:
            die("installer-license needs OUT")
        want = "\ufeff" + installer_license()
        out = Path(a.out)
        if a.check:
            if not out.is_file() or out.read_text(encoding="utf-8") != want:
                die(f"{out} is not what tools/vendor_bundle.py installer-license writes; regenerate it")
            print(f"{out}: up to date")
            return 0
        out.write_text(want, encoding="utf-8", newline="\r\n")
        return 0
    if not (a.root and a.exe_dir and a.share):
        die("add/strip/check need --root, --exe-dir and --share")
    if a.cmd == "add":
        if not a.runtime:
            die("add needs --runtime")
        add(a)
    elif a.cmd == "strip":
        strip(a)
    else:
        check(a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
