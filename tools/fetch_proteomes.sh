#!/usr/bin/env bash
# Fetch the proteomes FASTag ships for -alkylation_proteome (data/alkylation/).
#
#   tools/fetch_proteomes.sh <outdir>
#
# Each name is the reviewed (Swiss-Prot) part of a UniProt reference proteome,
# canonical sequences only, sorted by accession, gzip-compressed without a
# name or time stamp (gzip -n -9), so one UniProt release and one gzip build give the same bytes
# on every run. Writes <outdir>/<name>.fasta.gz and <outdir>/proteomes.tsv
# (name, proteome, taxon, release, release date, entries, sha256 of the .gz,
# sha256 of the uncompressed FASTA, file). Different gzip builds (GNU, Apple)
# compress to different bytes; fasta_sha256 is the same for one release.
# The release is the one the UniProt REST server reports (X-UniProt-Release);
# the script stops when the four files do not come from one release or a
# download is short.
set -euo pipefail
out=${1:?usage: fetch_proteomes.sh <outdir>}
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
sha() { if command -v sha256sum > /dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
hdr() { tr -d '\r' < "$1" | awk -v k="$2" 'BEGIN { k = tolower(k) } { split($0, a, ": "); if (tolower(a[1]) == k) { print a[2]; exit } }'; }

printf 'name\tproteome\ttaxon\trelease\trelease_date\tentries\tsha256\tfasta_sha256\tfile\n' > "$tmp/proteomes.tsv"
release=""
for row in human:UP000005640:9606 mouse:UP000000589:10090 yeast:UP000002311:559292 ecoli:UP000000625:83333; do
  IFS=: read -r name up taxon <<< "$row"
  url="https://rest.uniprot.org/uniprotkb/stream?format=fasta&query=%28proteome%3A${up}%29%20AND%20%28reviewed%3Atrue%29&sort=accession%20asc"
  ok=""
  for attempt in 1 2 3; do
    if curl -fsS -D "$tmp/$name.hdr" -o "$tmp/$name.fasta" "$url"; then ok=1; break; fi
    echo "fetch_proteomes: $name attempt $attempt failed" >&2
  done
  [ -n "$ok" ] || { echo "fetch_proteomes: cannot download $name ($up)" >&2; exit 1; }
  r=$(hdr "$tmp/$name.hdr" x-uniprot-release)
  d=$(hdr "$tmp/$name.hdr" x-uniprot-release-date)
  total=$(hdr "$tmp/$name.hdr" x-total-results)
  n=$(grep -c '^>' "$tmp/$name.fasta")
  [ -n "$r" ] || { echo "fetch_proteomes: no X-UniProt-Release for $name" >&2; exit 1; }
  [ -z "$release" ] || [ "$release" = "$r" ] || { echo "fetch_proteomes: $name is release $r, the others $release" >&2; exit 1; }
  release=$r
  [ -z "$total" ] || [ "$total" = "$n" ] || { echo "fetch_proteomes: $name has $n entries, the server reports $total" >&2; exit 1; }
  [ "$n" -gt 1000 ] || { echo "fetch_proteomes: $name has only $n entries" >&2; exit 1; }
  gzip -n -9 -c "$tmp/$name.fasta" > "$tmp/$name.fasta.gz"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$up" "$taxon" "$r" "$d" "$n" "$(sha "$tmp/$name.fasta.gz")" \
    "$(sha "$tmp/$name.fasta")" "$name.fasta.gz" \
    >> "$tmp/proteomes.tsv"
done
for name in human mouse yeast ecoli; do mv "$tmp/$name.fasta.gz" "$out/"; done
mv "$tmp/proteomes.tsv" "$out/"
cat "$out/proteomes.tsv"
