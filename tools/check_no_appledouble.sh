#!/usr/bin/env bash
# No package may carry macOS AppleDouble files (._*, linux-1 of 1.16.1: the
# species index of the three Linux x64 assets held them, unpacked by GNU tar
# from the Mac-made pinned taxonomy tarball).
#
#   check_no_appledouble.sh <package>...
#
# Lists every entry of each package (.tar.gz/.tgz, .tar.xz, .tar, .zip, .deb,
# .AppImage, or a directory) and fails, naming the entries, if one is called
# ._<anything> or is a __MACOSX folder. An AppImage is unpacked with its own
# --appimage-extract (no FUSE needed). Exits 2 on a package it cannot read.
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: $0 <package>..." >&2; exit 2; }
bad=0
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
for p in "$@"; do
  [ -e "$p" ] || { echo "::error::$p: no such package"; exit 2; }
  case "$p" in
    *.tar.gz|*.tgz) list=$(tar -tzf "$p") ;;
    *.tar.xz) list=$(tar -tJf "$p") ;;
    *.tar) list=$(tar -tf "$p") ;;
    *.zip) list=$(unzip -Z1 "$p") ;;
    *.deb) list=$(dpkg-deb -c "$p" | awk '{ $1=$2=$3=$4=$5=""; sub(/^ +/, ""); sub(/ -> .*/, ""); print }') ;;
    *.AppImage)
      a=$(cd "$(dirname "$p")" && pwd)/$(basename "$p")
      chmod +x "$a"
      rm -rf "$w/squashfs-root"
      (cd "$w" && "$a" --appimage-extract > /dev/null) || { echo "::error::$p: --appimage-extract failed"; exit 2; }
      list=$(cd "$w" && find squashfs-root)
      ;;
    *) if [ -d "$p" ]; then list=$(cd "$p" && find .); else echo "::error::$p: not a package this check reads"; exit 2; fi ;;
  esac
  hits=$(printf '%s\n' "$list" | grep -E '(^|/)(\._[^/]*|__MACOSX)/?$' || true)
  if [ -n "$hits" ]; then
    echo "::error::$p carries macOS AppleDouble files:"
    printf '%s\n' "$hits" | sed 's/^/  /'
    bad=1
  else
    echo "$p: no AppleDouble files ($(printf '%s\n' "$list" | wc -l | tr -d ' ') entries)"
  fi
done
exit $bad
