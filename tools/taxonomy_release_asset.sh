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
# mtime 0; gzip -n), and every file of the pinned tarball is checked to come
# out of both new archives byte for byte.
set -euo pipefail
pinned=$1 manifest=$2 version=$3
here=$(cd "$(dirname "$0")" && pwd)
py=$(command -v python3 || command -v python)
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
mkdir -p "$w/in" "$w/gz" "$w/xz"
tar -xzf "$pinned" -C "$w/in"
d="$w/in/share-FASTag-taxonomy"
[ -d "$d" ] || { echo "::error::$pinned has no share-FASTag-taxonomy/"; exit 1; }
"$py" "$here/check_taxonomy_manifest.py" "$d" "$manifest"
n="FASTag-${version}-taxonomy-k7"
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='@0' --format=gnu \
  -C "$w/in" -cf "$w/$n.tar" share-FASTag-taxonomy
gzip -n -9 -c "$w/$n.tar" > "$n.tar.gz"
xz -9 -T0 -c "$w/$n.tar" > "$n.tar.xz"
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
