#!/usr/bin/env python3
"""Which AppImage files tools/gui_third_party_notices.py attributes to Debian packages.

    gui_notices_appimage_test.py <tools/gui_third_party_notices.py>
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

TOOL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "tools", "gui_third_party_notices.py")
spec = importlib.util.spec_from_file_location("gtpn", TOOL)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

LISTING = """\
drwxr-xr-x root/root 0 2026-11-18 09:00 squashfs-root/usr/lib
-rw-r--r-- root/root 1 2026-11-18 09:00 squashfs-root/usr/lib/libwebkit2gtk-4.1.so.0
-rw-r--r-- root/root 1 2026-11-18 09:00 squashfs-root/usr/lib/libthrift.so.0.25.0
-rwxr-xr-x root/root 1 2026-11-18 09:00 squashfs-root/usr/lib/webkit2gtk-4.1/WebKitNetworkProcess
-rw-r--r-- root/root 1 2026-11-18 09:00 squashfs-root/usr/lib/FASTag/resources/fastag/lib/libthrift.so.0.25.0
-rwxr-xr-x root/root 1 2026-11-18 09:00 squashfs-root/usr/lib/FASTag/resources/fastag/bin/FASTag
lrwxrwxrwx root/root 1 2026-11-18 09:00 squashfs-root/usr/lib/libwebkit2gtk-4.1.so -> libwebkit2gtk-4.1.so.0
"""

with tempfile.TemporaryDirectory() as d:
    p = Path(d) / "l.lls"
    p.write_text(LISTING)
    got = [f.as_posix() for f in m.bundled_files(m.read_listing(p))]

# The CLI's payload and linuxdeploy's copies of the CLI's own libraries belong to THIRD-PARTY-NOTICES.txt.
want = ["usr/lib/libwebkit2gtk-4.1.so.0", "usr/lib/webkit2gtk-4.1/WebKitNetworkProcess"]
assert got == want, got
print("OK")
