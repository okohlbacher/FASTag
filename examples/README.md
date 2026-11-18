# Example data

A small run to try FASTag on, shipped in every release bundle: next to the
executable in the command-line archives (`FASTag/examples/`) and as a resource
of the desktop app, which opens it with **File > Open Example Data**.

| file | what | size | sha256 |
|---|---|---|---|
| `Ecoli_MS2_small.mzML` | 139 MS2 spectra of an *E. coli* K-12 digest (ion-trap MS2), OpenMS's own example file | 1.15 MB | `30717211f2a832e281604a4cdc12d13d74f484d9fb51a5d94a62f80713c16f6e` |
| `Ecoli_MS2_small.fasta` | three *E. coli* proteins (prsA, metK, rplF) that tags from the run place in | 1.1 KB | `8f4fac71178db2a0d968ea5a05e5334faf75e22af3392861f9b6526e8446de9e` |

Both are copies of `test/fixtures/Ecoli_MS2_small.mzML` and
`test/fixtures/Ecoli_MS2_small.fasta` (provenance in
[test/fixtures/README.md](https://github.com/okohlbacher/FASTag/blob/main/test/fixtures/README.md)): the mzML is
`share/OpenMS/examples/ID/Ecoli_MS2_small.mzML` of OpenMS `release/3.5.0`, the
FASTA three entries of OpenMS's
`target_decoy_Ecoli_K12_TaxID_83333.proteomes.fasta`. Both are BSD-3-Clause,
as OpenMS is; they are not covered by FASTag's MIT licence.

Check a copy with `sha256sum -c` (or `shasum -a 256 -c` on macOS):

```
30717211f2a832e281604a4cdc12d13d74f484d9fb51a5d94a62f80713c16f6e  Ecoli_MS2_small.mzML
8f4fac71178db2a0d968ea5a05e5334faf75e22af3392861f9b6526e8446de9e  Ecoli_MS2_small.fasta
```

A 10-minute walkthrough with commands, expected counts and output: [doc/TUTORIAL.md](https://github.com/okohlbacher/FASTag/blob/main/doc/TUTORIAL.md).
The desktop app, with screenshots: [doc/MANUAL.md](https://github.com/okohlbacher/FASTag/blob/main/doc/MANUAL.md).
