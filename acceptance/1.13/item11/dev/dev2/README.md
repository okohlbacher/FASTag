# DEV-2: PXD003109, one 193-nm UVPD run (DEV only)

`OR7_20150805_KLF_Hela_3mJ_50ms_.raw` (PRIDE SHA-1 3badf380...f2, sha256 57d47bb4...2346, 2,190,751,103 bytes), HeLa
digest, Q Exactive with a 193-nm laser coupled into the HCD cell (3 mJ, 50 ms), converted with ThermoRawFileParser
2.0.0 (`-f 2`, prose-auto env) on node data. Script `../../scripts/dev2.sh`.

- Activation in the mzML (`activation_terms.txt`, `filter_strings.txt`): all 28,346 MS2 carry beam-type CID
  (MS:1000422) and the filter `@hcd2.00`: the instrument records UVPD as HCD at NCE 2. FASTag classifies them as
  collisional; `-ion_series auto -ion_series_photo ax` therefore reads them as b/y, tags identical to by
  (`score-ph/`), and `-ion_series ax` warns on all of them (`fastag_runs.txt`; that run used the 6ee8b4b binary,
  whose warning text predates the HCD-retrofit note of 99ec699).
- Truth: MSFragger 4.4.1 on the mzML, human UniProt of the gate inputs (`gate-in/db/Homo_sapiens.fasta`) plus
  reversed decoys, fragment 20 ppm, otherwise the item11 parameters. a,b,x,y: 12,689 PSMs at 1% FDR; a,x only: 541.
- FASTag `-fragment_tolerance 20` (ppm): rank-1 correct on the a,b,x,y PSMs (`score/`): by 63.12%, ax 0.32%,
  ax - by -62.80 points [-63.79, -61.86] (9,362 clusters); union 63.24%.

At 193 nm the a/x share is larger than at 213 nm (541 a,x-only PSMs against 0-104 per PXD018176 run), but the
spectra are still read far better as b/y.
