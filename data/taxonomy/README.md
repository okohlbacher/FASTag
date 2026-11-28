# Bundled taxonomy for `-species`

FASTag looks for this directory at `<bin>/../share/FASTag/taxonomy` (a normal
install) or `<bin>/share-FASTag-taxonomy` (the flat release tarball), or wherever
`FASTAG_TAXONOMY_DIR` points. With the index in place, `-species` needs no paths:

```
FASTag -in run.mzML -out run.tags.tsv -species -tag_length 7
```

`-tag_length` must be **at least the index k** (7 for the shipped index) — a
shorter tag cannot be looked up, and FASTag refuses the run up front rather than
producing an empty report.

## What ships where

The same table is in the README ("Species detection"). Release bundles are
built by `.github/workflows/ci.yml` and `windows.yml` on a `v*` tag, which
embed the pinned index (`TAXDB_TAG`, sha256-checked) before packing:

| bundle | NCBI dumps (`nodes.dmp`, `names.dmp`) | k-mer index `tax_k7.taxdb` (~1.06 GB), or packed `tax_k7.ftz` (207 MB, below) | `MANIFEST.json` |
|---|---|---|---|
| CLI: Linux x64/arm64 `.tar.gz`, macOS arm64/x64 `.dmg`, Windows x64 `.zip` (`share-FASTag-taxonomy/`) | yes | **yes** | yes |
| Desktop app: macOS `.dmg`, Linux `.deb`, `.tar.gz` and `.AppImage` (x64, arm64), Windows installer (`resources/fastag/share/FASTag/taxonomy/`) | yes | **yes** | yes |
| Homebrew casks `fastag`, `fastag-cli` (the two macOS `.dmg`) | yes | **yes** | yes |
| Index-only asset `FASTag-<version>-taxonomy-k7.tar.gz` / `.tar.xz` (+ `.sha256`) on every release | yes | **yes** | yes |
| Source tree / source archive (`data/taxonomy/`) | yes | no: download the index-only asset | `manifests/<data tag>.json` |
| CI artifacts of pull requests and pushes to main | yes | no | no |

The index-only asset is for source builds, upgrades of an older install, and
`FASTAG_TAXONOMY_DIR` setups; extract it into the FASTag directory (next to the
executable):

```
tar xzf FASTag-<version>-taxonomy-k7.tar.gz -C /path/to/FASTag/   # -> share-FASTag-taxonomy/
# verify: shasum -a256 -c FASTag-<version>-taxonomy-k7.tar.gz.sha256
```

(Up to 1.14.0 the asset was `FASTag-taxonomy-k7.tar.gz`; up to 1.15.0 it held
no `MANIFEST.json`.) Without an index, `-species` fails with a message naming
the directory it searched and pointing at this asset — never silently.

The two `.dmp` files are an NCBI taxdump **pruned to the lineages the index can
reach** (406 taxa instead of ~2.9 million). Produced by `tools/prune_taxdump.py`;
identical results to the full ~500 MB dump, and faster to load.

The **index** is the reduced-set k=7 image over the reference proteomes listed in
`reference-set.tsv` (50 taxa: model organisms, MS contaminants, common
pathogens, gut microbiome, archaea).

## Provenance: `MANIFEST.json`

Every index tarball carries `share-FASTag-taxonomy/MANIFEST.json`: the UniProt
release, each proteome with its URL, sha256 and entry count, the NCBI taxdump
(URL, sha256, date), the buildtaxdb binary and FASTag commit, the commands, and
the sha256 of every file. `tools/fetch_reference_set.py` records the fetch,
`tools/package_taxonomy.py` builds, prunes and packs.

The index in use since 2026-09-01 (`taxonomy-k7-20260901`) predates the
manifest. Its manifest, `manifests/taxonomy-k7-20260901.json`, was
reconstructed on 2026-11-18 from the shipped files and the kept build inputs;
CI adds it to the bundles as `MANIFEST.json` and checks the index's sha256
against it. Recovered: the index (sha256, size, k, taxa, k-mers, per-taxon
postings), the pruned dumps, and the NCBI taxdump they were cut from
(`taxdmp.zip` of 2026-07-24, sha256 `984e3da7…`, which reproduces both dumps
byte for byte). **Not recovered**: the UniProt release (the fetch ran between
2026-07-24 and 2026-09-01), the proteome FASTA files with their sha256 and
entry counts, and the exact buildtaxdb commit. The manifest gives today's
proteome accessions instead, marked as such. A rebuild from today's UniProt
(2026_04) gives a different index, so this one cannot be rebuilt byte for byte;
the next index rebuild will carry a complete manifest.

## Licence and attribution

The index and the reference set are derived from UniProt data: the reference
proteomes listed in `reference-set.tsv` (and, per index, in its
`MANIFEST.json`). UniProt data are published under the Creative Commons
Attribution 4.0 International (CC BY 4.0) licence,
<https://creativecommons.org/licenses/by/4.0/>. Source: UniProt,
<https://www.uniprot.org>. Cite: The UniProt Consortium, UniProt: the Universal
Protein Knowledgebase in 2025, *Nucleic Acids Res.* 2025, 53(D1):D609-D617,
doi:10.1093/nar/gkae1010. Changes made by FASTag: the proteome sequences are
not shipped; `tax_k7.taxdb` holds, for every I/L-folded 7-mer of them, the set
of taxa whose proteins contain it. The index is not covered by FASTag's MIT
licence.

`nodes.dmp` and `names.dmp` are cut from the NCBI Taxonomy database
(<https://www.ncbi.nlm.nih.gov/taxonomy>; Schoch et al., NCBI Taxonomy: a
comprehensive update on curation, resources and tools, *Database* 2020,
baaa062, doi:10.1093/database/baaa062), a work of the US government in the
public domain (<https://www.ncbi.nlm.nih.gov/home/about/policies/>). Changes
made by FASTag: pruned to the lineages of the index taxa, scientific names
only.

## The index format (v2, `FTX2`)

Memory-mapped and bit-packed, so a ~1 GB index costs **under 1 GB resident** and
loads instantly (nothing is deserialized):

- k-mers packed base-19 (the I/L-folded alphabet is 19 letters) → 4-byte keys;
- postings store a 1-byte taxon **index**, not a 4-byte taxid;
- the file is `mmap`'d and used in place, so its pages are file-backed and
  evictable under memory pressure.

The earlier `FTXI` format (a serialized hash map, ~10× the RAM) still loads for
backward compatibility. `save()` always writes `FTX2`.

## The packed form (`FTZ1`, `tax_k7.ftz`)

The `FTX2` image compresses badly as it is (zstd -19: 1138 → 366 MB; gzip, as in
the release tarball: 450 MB; LZMA, as in the Windows installer and the ULMO dmg:
245 MB), because its sorted keys and its offsets are arithmetic progressions
that LZ matching does not see. The packed form stores the key **deltas** and the
taxon-set **sizes** instead, each escape-coded to one byte (a value of 255 or
more is `0xFF` and the full value), and the postings as they are; each of the
four sections is one zstd frame with a content checksum. The shipped index packs
to **207 MB**, and no general-purpose compressor shrinks that further, so a
packager that compresses its payload (makensis, hdiutil, dpkg-deb, mksquashfs,
tar) passes over it quickly.

FASTag loads it directly: `TaxIndex::load` decodes the sections (in parallel,
streaming the compressed file from a read-only mapping) into the **exact** `FTX2`
image in memory, whose sha256 the header records, and from then on works on it
as on a mapped `.taxdb`. Every report is therefore the same, byte for byte
(checked on PXD000001 for the tag table, `-species`, `-species_call decoy`,
`-census`). The cost, measured on an M4 Max with the shipped index:

| | load (species run, wall) | RSS | phys footprint |
|---|---|---|---|
| `tax_k7.taxdb` (mapped) | 2.6 s | 1.44 GB | 0.29 GB |
| `tax_k7.ftz` (decoded) | 2.9 s | 1.69 GB | 1.45 GB |

The decoded image is anonymous memory, not an evictable file mapping, and each
FASTag process holds its own copy. For many parallel runs on one machine, unpack
it once (`buildtaxdb --unpack`, or extract the release's index-only asset) and
put the `.taxdb` beside it: when both are there, **`tax_k7.taxdb` wins** and is
mapped as before (`TaxIndex::findInDir`; the desktop app looks the same way).

```
buildtaxdb --pack   share-FASTag-taxonomy/tax_k7.taxdb share-FASTag-taxonomy/tax_k7.ftz [level=19]
buildtaxdb --unpack share-FASTag-taxonomy/tax_k7.ftz   share-FASTag-taxonomy/tax_k7.taxdb
buildtaxdb --verify share-FASTag-taxonomy/tax_k7.ftz   [<sha256 of the .taxdb>]
```

`--pack` decodes what it wrote and compares it with its input byte for byte;
packing is deterministic (each section is compressed single-threaded), so the
same index and level give the same `.ftz`. `--unpack` restores the `.taxdb`;
`--verify` decodes, hashes the image and checks it against the recorded and the
given digest (it prints the digest on stdout). `tools/check_taxonomy_manifest.py`
and `tools/windows_installed_check.ps1` accept a `tax_k7.ftz` in place of the
pinned `tax_k7.taxdb` when its header records the pinned size and sha256 and its
sections add up to its length. The index-only release assets keep the `.taxdb`.

## Rebuilding the index

```
python3 tools/fetch_reference_set.py data/taxonomy/reference-set.tsv proteomes   # + proteomes/fetch-manifest.json
curl -LO https://ftp.ncbi.nih.gov/pub/taxonomy/taxdmp.zip
python3 tools/package_taxonomy.py --proteomes proteomes --taxdump taxdmp.zip \
    --buildtaxdb build/buildtaxdb --tarball FASTag-taxonomy-k7.tar.gz       # k = 7; max is 12 (--k)
```

`package_taxonomy.py` prunes the dumps (`tools/prune_taxdump.py`), runs
`buildtaxdb proteomes share-FASTag-taxonomy/tax_k7.taxdb 7`, writes
`MANIFEST.json` and packs the tarball reproducibly. The build is deterministic:
the same proteomes give a byte-identical index, so a release can reproduce it
and a checksum verifies a download. To ship it, follow the `TAXDB_TAG` comment
in `.github/workflows/ci.yml` (a new `taxonomy-k7-YYYYMMDD` pre-release, then
both pins).

## Scope, honestly

A **reduced reference set**, not a metagenomics database. Reference proteomes
(one protein per gene) keep the taxa evenly weighted — the earlier reviewed-only
set had 20,431 human proteins against 35 for a bacterium, which skewed the
background model. Even so, short peptide 7-mers resolve **genus/family at best**:
on a human sample *Homo* ranks first but *Macaca*, *Bos*, *Sus* follow closely,
because primate and mammalian proteomes share most 7-mers. Read the ranking as
"which lineages are present", not "which species", and treat q as a ranking aid,
not a calibrated FDR.
