#!/usr/bin/env python3
"""Attach a licence agreement to a macOS disk image.

    dmg_license.py <image.dmg> <licence.txt>

Finder (and `hdiutil attach`) then shows the text with Agree / Disagree
before it mounts the image; Disagree leaves it unmounted. This is how the
macOS disk images meet section 3.3 of Thermo's RawFileReader licence (end
users agree to a licence that forbids redistributing RawFileReader); the text
is gui/src-tauri/installer-license.txt (tools/vendor_bundle.py
installer-license), the page the Windows installer shows.

The agreement is the classic UDIF resource set (LPic, STR#, TEXT; English
only), written as the XML `hdiutil udifrez -xml` merges into the image. Run it
on the final image, before signing it: codesign signs the image as it is.
Homebrew mounts such images unattended (it answers the prompt), so casks keep
installing.
"""
import plistlib
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


def pascal(s: str) -> bytes:
    b = s.encode("mac_roman")
    return bytes([len(b)]) + b


def resources(text: str) -> dict:
    # LPic: default language 0, one entry: region 0 (English), STR#/TEXT id
    # offset 0, single-byte text.
    lpic = struct.pack(">HHHHH", 0, 1, 0, 0, 0)
    strs = ["English", "Agree", "Disagree", "Print", "Save...",
            "If you agree with the terms of this licence, click \"Agree\" to open the disk image. "
            "If you do not agree, click \"Disagree\"."]
    str_hash = struct.pack(">H", len(strs)) + b"".join(pascal(s) for s in strs)
    body = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\n", "\r").encode("mac_roman")
    def res(data: bytes, rid: str, name: str) -> list:
        return [{"Attributes": "0x0000", "Data": data, "ID": rid, "Name": name}]
    return {"LPic": res(lpic, "5000", ""), "STR#": res(str_hash, "5000", "English"),
            "TEXT": res(body, "5000", "English")}


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    dmg, lic = Path(sys.argv[1]), Path(sys.argv[2])
    with tempfile.TemporaryDirectory() as d:
        x = Path(d) / "sla.plist"
        with open(x, "wb") as f:
            plistlib.dump(resources(lic.read_text(encoding="utf-8")), f)
        subprocess.run(["hdiutil", "udifrez", "-xml", str(x), "", "-quiet", str(dmg)], check=True)
    info = subprocess.run(["hdiutil", "imageinfo", str(dmg)], check=True, capture_output=True, text=True).stdout
    if "Software License Agreement: true" not in info:
        print(f"::error::{dmg} has no licence agreement after udifrez", file=sys.stderr)
        return 1
    print(f"{dmg}: licence agreement attached ({lic.name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
