# Shipped proteomes for `-alkylation_proteome`

FASTag looks for this directory at `<bin>/../share/FASTag/alkylation` (a normal
install) or `<bin>/share-FASTag-alkylation` (the flat release layout), that is,
beside the digest data directory, or wherever `FASTAG_ALKYLATION_DIR` points.
`-alkylation_proteome auto` (the default, = `human`), `human`, `mouse`, `yeast`
and `ecoli` name these files; `-alkylation_out` places its single-Cys peptides
on the named proteome when the run has no `-recon_fasta` and no other placement
reader.

| name | file | UniProt proteome | organism (taxon) | entries |
|---|---|---|---|---|
| `human` (`auto`) | `human.fasta.gz` | UP000005640 | *Homo sapiens* (9606) | 20,414 |
| `mouse` | `mouse.fasta.gz` | UP000000589 | *Mus musculus* (10090) | 17,279 |
| `yeast` | `yeast.fasta.gz` | UP000002311 | *Saccharomyces cerevisiae* S288C (559292) | 6,067 |
| `ecoli` | `ecoli.fasta.gz` | UP000000625 | *Escherichia coli* K-12 MG1655 (83333) | 4,403 |

All four are UniProt release **2026_04** (4 November 2026), downloaded on
2026-11-09 by `tools/fetch_proteomes.sh`: the reviewed (Swiss-Prot) entries of
each reference proteome, canonical sequences only (no isoforms), in UniProt's
FASTA format, sorted by accession and compressed with GNU gzip 1.12
(`gzip -n -9`). The sequences and headers are not changed.

`proteomes.tsv` is the manifest FASTag reads: per name the proteome, taxon,
release, release date, number of entries, the sha256 of the `.fasta.gz` and of
the uncompressed FASTA, and the file name. FASTag writes the release, proteome,
entries and `fasta_sha256` into the `alk_run database_release` row of the
alkylation report. Before the run it checks the FASTA it read (the
decompressed bytes) against `fasta_sha256` and `entries` and refuses a
mismatch (exit code 3: a truncated, edited or replaced file). Another gzip
build compresses the same release to other bytes; `fasta_sha256` stays the
same, so a recompressed file passes. The `.gz` `sha256` is for checking a
download (`sha256sum -c`); FASTag does not check it at run time.

sha256 of the shipped files:

```
4028efebc571478bfe10e58efd369d37f36b46f490347bfebbb5949caf1f0c87  human.fasta.gz
6ebd303155875ff76c245363b9b6f70b809ee81c84aba2a39dc34656da6b6901  mouse.fasta.gz
f4568ef6363b003d91e530410083d4347ae8378ceea96d01ac7b7838845ba719  yeast.fasta.gz
92d3789e52e93812f66f7f0dc254929f8921ca12886d812984ec3473380bd5a9  ecoli.fasta.gz
```

To update, run `tools/fetch_proteomes.sh data/alkylation` on a machine with GNU
gzip, then update the table, the hashes above and the BOM.md row.

## Licence

UniProt data are published under the Creative Commons Attribution 4.0
International (CC BY 4.0) licence, <https://creativecommons.org/licenses/by/4.0/>.
Source: UniProt, <https://www.uniprot.org>. Cite: The UniProt Consortium,
UniProt: the Universal Protein Knowledgebase in 2025, *Nucleic Acids Res.* 2025,
53(D1):D609-D617, doi:10.1093/nar/gkae1010. Changes made by FASTag: the reviewed
entries of each reference proteome were selected and the FASTA was
gzip-compressed; nothing else. These files are not covered by FASTag's MIT
licence.
