# One real batch on the public gate inputs

The batch summary fixtures (GUI-DESIGN 3 S6, 10 P2b; `src/testing/batchFixtures.ts`,
the vitest `run/batchSummary*.test.ts*` and the e2e scenario `?fixture=gate-batch`).
Every file is what FASTag integration/1.12 at 0e4b0c5
(`/scratch/kohlbach/fastag112-integ/m17-f4/opt/FASTag`, as in `../README.md`) wrote
on node `data` with one command for every input, as the GUI's batch runs it:
"Characterize a run" (species with extension 2 against the gate's `tax_k7.taxdb`,
digest, label and glyco reports, a tenth of the spectra) plus `-species_call decoy`
and `-census`, so genus calls and the evidence cutoff apply. `cmd.txt` holds each
command line. They were run with `/scratch/kohlbach/p2b_batch_fx2.sh` and
`p2b_batch_fx3.sh` on 2026-11-07. The tags, census and glyco tables are left out
(only their log lines are read); `run.log` is the run's stdout and stderr without
the `/usr/bin/time` lines.

| Directory | Input (public) | What the CLI said |
|---|---|---|
| pxd003531 | PXD003531 QE3 ...T_NO_03_01_01.mzML | Trypsin, label-free, Homo |
| pxd003531-mzpeak | the same run as point mzPeak | Trypsin, label-free, Homo |
| pxd004541-tmt | PXD004541 ...TMT10...fr02.mzML | Trypsin, TMT, Homo |
| pxd014764 | PXD014764 ..._CNOT_R1_f008.mzML | Trypsin, SILAC, Homo |
| pxd010783 | PXD010783 KristenJeff_p53_mod_AspN_03_02_07.mzML | protease and label no call, species run-level no call (few_spectra); 411 tagged spectra |
| pxd040407-chymo | PXD040407 Hog1p_WT_Rep3_Chymo_5uL.mzML | protease no call (tie), label-free over 916 tagged spectra (below the GUI's 1,000), species run-level no call |
| pxd006096-pseudo | PXD006096 ..._DIA1_new.pseudo.mzML (pseudo-DDA) | Trypsin, label-free, Homo |
| pxd006096-dia | PXD006096 ..._DIA1_new.mzML (raw DIA) | refused, exit 11 (E7): no reports |

The label column has a majority (label-free, 3 of 5 calls), so TMT and SILAC are
flagged; protease and genus are Trypsin and Homo wherever called. No AGXT or other
non-public sample is used. A release `dist/` must not contain these files
(`scripts/check-dist-clean.mjs`).

Wall time and peak RSS per job (`/usr/bin/time -v`, 16 threads):

| Directory | Wall | Max RSS |
|---|---|---|
| pxd003531 | 2.90 s | 1.19 GB |
| pxd003531-mzpeak | 3.16 s | 1.28 GB |
| pxd004541-tmt | 3.04 s | 1.21 GB |
| pxd014764 | 2.74 s | 1.19 GB |
| pxd010783 | 2.70 s | 0.74 GB |
| pxd040407-chymo | 2.44 s | 1.08 GB |
| pxd006096-pseudo | 2.51 s | 1.15 GB |
| pxd006096-dia | 0.18 s | 0.09 GB |

sha256 of each file:

    b7be04e3fb5bed26a90adb9abf49527d742699054491ba9f891872cfc4c0bdea  pxd003531-mzpeak/cmd.txt
    9d6a72df288242a521dfe5404b369850e8e587fb0d5eb7318e707450a903dfa2  pxd003531-mzpeak/run.digest.tsv
    842d073d6719057db6492efff53e459a04c7acb3579ab9b406163fe2861e64af  pxd003531-mzpeak/run.label.tsv
    6d17071fa6c59663de21ab9bb88302b09f0168a5ed50b51bec73b5b256aa1cdb  pxd003531-mzpeak/run.log
    4b09e1c100956f303f27e39dc3cda883be74b2cdbe619621cee594ea9fc7b4d4  pxd003531-mzpeak/run.tags.census_summary.tsv
    b483dfb706ae043ba344ce986a188643921ca4cd0ff16015f46e9fca8ef1d75e  pxd003531-mzpeak/run.tags.species.tsv
    31eda137a9768aee56036654f78b7c765a583ea2353c61320517e9900f84d507  pxd003531/cmd.txt
    4e77fcbe4ec5fa030b64cb8a890383434163926f6f2589e243dec43fc28c1d4d  pxd003531/run.digest.tsv
    d1034ca032345f404358f2e4121b499f843544d7a3e1c59fd445a21a344b49d6  pxd003531/run.label.tsv
    f7b6009dddfbca71dcda29f9a0805396536eb78727ce5217c3125e5655cf2da6  pxd003531/run.log
    73c14129a90fc1cb968386fefa57dcbc417f0d20dce0282543ae214f3f1ce9b6  pxd003531/run.tags.census_summary.tsv
    b483dfb706ae043ba344ce986a188643921ca4cd0ff16015f46e9fca8ef1d75e  pxd003531/run.tags.species.tsv
    e62963ae05813fc6bd0c241141dfd27b2f4bed4752d9157962c500f857ed74f0  pxd004541-tmt/cmd.txt
    e5c1834976dfd34f9ed6899d0d48a83a8bacc8596150aac8ea3c9869ed6a6daf  pxd004541-tmt/run.digest.tsv
    081ec58d0f324ffff2e22fbbbad2dde0503249f04cbe4aecc5c7aebe91ee2d34  pxd004541-tmt/run.label.tsv
    ded80063f88c3a2942669e35d8aacf2e5a6ae15ea762109eb3b1c824340d6fd8  pxd004541-tmt/run.log
    daaf1561d921bf24565608b21b71b17512ab3e0bcc62cecdc46c50797e9ed23d  pxd004541-tmt/run.tags.census_summary.tsv
    5b0bfad2ebb04944085bace9733afddec612084bd392874518ab91ad9218775d  pxd004541-tmt/run.tags.species.tsv
    9b682d7dd258e9d831b08ac715bd868a69062d52b7491ffef31f0eaf295c1091  pxd006096-dia/cmd.txt
    8c98891bb06721812d0369a77351725c343617274f14f840508b2276966e7900  pxd006096-dia/run.log
    4b90079a329e96a30b9146b9ffb5a3965689d544cb231bf7e15095d64d2ffe4f  pxd006096-pseudo/cmd.txt
    99454a64d6c070e622578df05df8c61ec08dcf8284779348893a29c9aec92e05  pxd006096-pseudo/run.digest.tsv
    96ccbc7ae99364b5060d0ff4b33698901ce4a6122b4d9fc74336931f71b84518  pxd006096-pseudo/run.label.tsv
    a8a168e777c48dddf2cb219cf456e58b0c78a6f0562d6e43c134c27804895d4f  pxd006096-pseudo/run.log
    2a65808d05614d5e1c4218662e0f4737dfbc9f8461df1cbe0617a3d720dcc5f9  pxd006096-pseudo/run.tags.census_summary.tsv
    d2cebe5932dda09af49e47473fdd91a508290ec05adaa18575fdef6f13b0da34  pxd006096-pseudo/run.tags.species.tsv
    b8445668738408358521fe08e11aed10d61faddfacc15479386b8a59e134864e  pxd010783/cmd.txt
    80985f06db8d7f0160b9df4b045cd0d87b767b2c7a9c2dd4a0cfb1e31e49ea5e  pxd010783/run.digest.tsv
    28bf179e15c416e0291bd42bdcdba1f0d723807f71e83bd4fe4dfcf283ba559c  pxd010783/run.label.tsv
    f80b5346d4b54a96cad35dbba7ced3207db144192d8283cd117f1e6376182ba4  pxd010783/run.log
    b7f79eb52e8d9c41926989f36deb61292eaffa15707dee9675f8818a17e46fde  pxd010783/run.tags.census_summary.tsv
    335683a9eb3306c132f113365d798908cf3fb1a36f5ffaf9e63e991758788213  pxd010783/run.tags.species.tsv
    819ac4e38cedc74ed3f3a9a0ff1b76ec198aa0c5ac113b674e57a04f7bca3cde  pxd014764/cmd.txt
    46f0690db72aeda9f1699b5787e75b69f39baa54d96c9851ec8706edd6fb70ca  pxd014764/run.digest.tsv
    c4e9c2a1e659443ba7c0bb5347b2ac17775fe9ae6863d0a4557884160508a497  pxd014764/run.label.tsv
    1d078a1ec47d9c61e3577eff41ca350d9e42aeed0900f743a807003604a5d205  pxd014764/run.log
    d3f6fd54534e1cda88b7aa771d220fdea2ac229eaf72bc969bdd7e9664b2026e  pxd014764/run.tags.census_summary.tsv
    fabee7a77fd094dc725b51a25d383c598a07ee029fa15e6848551f4457081aac  pxd014764/run.tags.species.tsv
    1ada3f102c919f2388cb0924b8dfb635d09b579e07879d796e7fbd14af5b9962  pxd040407-chymo/cmd.txt
    69593edcb804259364acd93a9cc2f2d9c686db706b36a46699445048a6ec9614  pxd040407-chymo/run.digest.tsv
    6aa73c2ea5dca9fa899c6c58c58846c065ada086d70271803ae4f77cd62e92ca  pxd040407-chymo/run.label.tsv
    50ec17a980e00640ab68dfb00a9f001e37a9684ab7f1c6b650aec6652e74c36f  pxd040407-chymo/run.log
    e995b1719462345c632d3f26fa71ce48be1d1d6b29f80935acb0ef354f79026c  pxd040407-chymo/run.tags.census_summary.tsv
    c3c1d35bb757b2775884962d5a774d62c8f17867736d4c9baa80331545150cc2  pxd040407-chymo/run.tags.species.tsv
