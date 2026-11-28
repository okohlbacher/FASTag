#!/usr/bin/env bash
# The taxonomy index as a release asset, with its MANIFEST.json inside.
#
#   taxonomy_release_asset.sh <pinned FASTag-taxonomy-k7.tar.gz> <manifest.json> <version>
#
# Unpacks the pinned data-release tarball (TAXDB_TAG), adds the manifest as
# share-FASTag-taxonomy/MANIFEST.json if the tarball has none (the index of
# 2026-09-01 predates it; tools/package_taxonomy.py puts one into every new
# tarball), checks every file against it (check_taxonomy_manifest.py), and
# writes FASTag-<version>-taxonomy-k7.tar.gz and .tar.xz with a .sha256 each
# (naming the file beside it, so `sha256sum -c` works on the pair) into the
# current directory. The repack is reproducible (GNU tar: sorted, owner 0,
# mtime 0; gzip/pigz -n; xz in fixed blocks), and every file of the pinned tarball is checked to come
# out of both new archives byte for byte.
set -euo pipefail
pinned=$1 manifest=$2 version=$3
here=$(cd "$(dirname "$0")" && pwd)
py=$(command -v python3 || command -v python)
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
mkdir -p "$w/in" "$w/gz" "$w/xz"
tar -xzf "$pinned" -C "$w/in"
# The pinned tarball was packed on a Mac: drop its AppleDouble metadata (._*),
# which is not part of the index and would make the file lists below differ.
find "$w/in" -name '._*' -type f -delete
d="$w/in/share-FASTag-taxonomy"
[ -d "$d" ] || { echo "::error::$pinned has no share-FASTag-taxonomy/"; exit 1; }
"$py" "$here/check_taxonomy_manifest.py" "$d" "$manifest"
n="FASTag-${version}-taxonomy-k7"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='@0' --format=gnu \
  -C "$w/in" -cf "$w/$n.tar" share-FASTag-taxonomy
# pigz where it is installed (the release job installs it): gzip -9 on all
# cores, 35 s instead of 129 s on the 4-core runner, the same format and
# reproducible (-n). xz in 48 MiB blocks so -T0 keeps every core busy (the
# default block, three times the -9 dictionary, gave a 1.1 GB tar three
# blocks): 154 s instead of 275 s, 0.13% larger. Both at once.
if command -v pigz > /dev/null 2>&1; then gz=(pigz -n -9 -c); else gz=(gzip -n -9 -c); fi
"${gz[@]}" "$w/$n.tar" > "$n.tar.gz" &
gzpid=$!
xz -9 -T0 --block-size=48MiB -c "$w/$n.tar" > "$n.tar.xz"
wait "$gzpid"
rm -f "$w/$n.tar"
# Both archives hold exactly the pinned files plus MANIFEST.json.
tar -xzf "$n.tar.gz" -C "$w/gz"
tar -xJf "$n.tar.xz" -C "$w/xz"
want=$( (cd "$w/in" && find . -type f | sort) )
for x in gz xz; do
  got=$( (cd "$w/$x" && find . -type f | sort) )
  [ "$got" = "$want" ] || { echo "::error::$n.tar.$x holds other files than the pinned tarball plus MANIFEST.json"; diff <(echo "$want") <(echo "$got") || true; exit 1; }
  while IFS= read -r f; do
    cmp -s "$w/in/$f" "$w/$x/$f" || { echo "::error::$f differs in $n.tar.$x"; exit 1; }
  done <<< "$want"
done
sha256sum "$n.tar.gz" > "$n.tar.gz.sha256"
sha256sum "$n.tar.xz" > "$n.tar.xz.sha256"
ls -l "$n".tar.*
