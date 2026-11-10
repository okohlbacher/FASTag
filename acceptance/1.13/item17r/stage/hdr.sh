#!/bin/bash
# mzML header check for #17r (no FASTag): spectra, MS levels, filter-string classes, isolation widths, instrument.
for f in "$@"; do echo "== $f"
grep -o "accession=\"MS:1000511\" value=\"[0-9]\"" "$f" | sed "s/.*value=/mslevel /" | sort | uniq -c
grep -o "accession=\"MS:1000512\" value=\"[^\"]*\"" "$f" | sed "s/.*value=\"//; s/ [0-9.]*@/ @/g; s/ \[.*//" | sort | uniq -c | sort -rn | head -6
grep -o "accession=\"MS:1000828\" value=\"[^\"]*\"" "$f" | sed "s/.*value=/iso_lower /" | sort | uniq -c | sort -rn | head -3
grep -m1 -o "accession=\"MS:100[0-9]*\" value=\"\" name=\"\(Orbitrap\|Q Exactive\|LTQ\)[^\"]*\"" "$f"
done
