# Digest data for `-digest_out` and `-massgap_out`

FASTag looks for this directory at `<bin>/../share/FASTag/digest` (a normal
install) or `<bin>/share-FASTag-digest` (the flat release tarball), or wherever
`FASTAG_DIGEST_DIR` points.

| file | used by | content |
|---|---|---|
| `digest_models.tsv` | `-digest_out` | protease models: cleavage rules over a proteome background |
| `massgap_mods.tsv` | `-massgap_out` | the modifications combined to explain mass gaps |

`digest_models.tsv` has the format of `-digest_models` (columns `model`,
`class`, `end`, `residue`, `freq`; `#` lines are its header). Each model is
uniform over its cleaving residues at P1 (C) or P1' (N), and the background at
the other end (`*`). The residues follow ExPASy PeptideCutter and OpenMS
`ProteaseDB`; Glu-C cuts after E only. The `background` rows are the residue
composition of the UniProt human reference proteome (UP000005640), I counted
as L; written by `tools/digest_models.py`. Source: UniProt (The UniProt
Consortium, *Nucleic Acids Res.* 2025), CC BY 4.0.

Without `-digest_models`, a `-recon_fasta` or `-fasta` replaces this background
with its own composition. HLA ligand or proteasome models are not shipped; give
them in a `-digest_models` table.

`massgap_mods.tsv` lists a Unimod name, an OpenMS modification id (whose
monoisotopic mass is used) and a prior per modification.
