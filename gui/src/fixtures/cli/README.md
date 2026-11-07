# Real CLI output on the public gate PXDs

The calls.ts parser fixtures (GUI-DESIGN 9 layer 1, 10 P2b) and the e2e
Overview scenarios (`src/testing/cliFixtures.ts`, `?fixture=gate*`). Every
file is what FASTag wrote, on node `data`, on the public gate inputs of
`/ceph/ibmi/abi/oliver/fastag-gate/inputs.tsv` (staged in
`/scratch/kohlbach/gate-in`), with "Characterize a run" (species with
extension 2 against the gate's `tax_k7.taxdb`, digest, label and glyco
reports, a tenth of the spectra). `cmd.txt` holds each command line. The
tags tables, glyco reports and census rows are left out (only their log
lines are read); `run.log` is the run's stdout and stderr without the
`/usr/bin/time` lines.

Binaries:
- FASTag 1.11.0: `/ceph/ibmi/abi/oliver/opt/fastag-1.11.0/FASTag/FASTag.bin`,
  sha256 61d09c41...bfd2e5. The case where the 1.12 output is absent.
- integration/1.12 at 0e4b0c5 (wave 1 merged; it still says Version 1.11.0):
  `/scratch/kohlbach/fastag112-integ/m17-f4/opt/FASTag.bin`, sha256
  3c80e324...bd53157, with `FASTAG_DIGEST_DIR` set to that tree's
  `data/digest`. The case where it is present: `label_call` rows (D3a), the
  acquisition check line (E7), the species call columns (D1, with
  `-species_call decoy`), the census summary (F11A, with `-census`), the
  electron-activation warning (E15A).

| Directory | Binary | Input | Extra arguments |
|---|---|---|---|
| v111-pxd003531 | 1.11.0 | PXD003531 QE3 ...T_NO_03_01_01.mzML | |
| v111-pxd004541-tmt | 1.11.0 | PXD004541 ...TMT10_hpHRP_DMSO1...fr02.mzML | |
| v112-pxd003531 | 1.12 | PXD003531 | |
| v112-pxd003531-call | 1.12 | PXD003531 | -species_call decoy -census |
| v112-pxd004541-tmt | 1.12 | PXD004541 (TMT10) | |
| v112-pxd010783-da | 1.12 | PXD010783 KristenJeff_p53_mod_AspN_03_02_07.mzML | -fragment_tolerance 0.5 -fragment_tolerance_unit Da |
| v112-pxd014764-fasta | 1.12 | PXD014764 ..._CNOT_R1_f008.mzML | -extension 3 -fasta Homo_sapiens.fasta -recon_out -delta_out -massgap_out |
| v112-pxd014764-recon-ext2 | 1.12 | PXD014764 | -recon_fasta Homo_sapiens.fasta -recon_out -massgap_out (Characterize's extension 2) |
| v112-pxd014764-recon-ext3 | 1.12 | PXD014764 | -extension 3 -recon_fasta Homo_sapiens.fasta -recon_out -massgap_out |

PXD014764 needs extension 3 with a FASTA, as the gate's fasta_recon case
uses: the recon index derives a minimum tag length of 8 for the human
proteome ("min tag length 8 (derived)" in the log), and extension 2 with tag
length 3 reaches 7. The two recon cases are the exact commands "Add FASTA
and run again" sends: before the review fix (Characterize's extension 2,
v112-pxd014764-recon-ext2: exit 0, 0 placed spectra in the mass-gap report)
and after it (extension 3, v112-pxd014764-recon-ext3: 475 placed spectra).
They were run with `/scratch/kohlbach/p2b_fixtures2.sh` on node data; their
tags, recon and glyco outputs are left out like the others'. No AGXT or other non-public sample is used. A release
`dist/` must not contain these files (`scripts/check-dist-clean.mjs`).

sha256 of each file:

    4964a4758c6283e01fd7641db1a2313fe65d2df69fb3c118709006551aa71be1  v111-pxd003531/cmd.txt
    4e77fcbe4ec5fa030b64cb8a890383434163926f6f2589e243dec43fc28c1d4d  v111-pxd003531/run.digest.tsv
    ab586689063aa5c9ed79014d95e73167b03b606fc125202ad0bfec9f2cb41e26  v111-pxd003531/run.label.tsv
    4d3ee30cee83167e3b4db9f9ac460b5b5e3aad8f0536c1a2261394e9b69ef584  v111-pxd003531/run.log
    e7e34368b7ad66725ad15d1e589c5fc75f91917643e5843853c5b3fd475cf279  v111-pxd003531/run.tags.species.tsv
    85770b5d61a399550300a607d44e9c691daa160e55f9f5e30996e598da638501  v111-pxd004541-tmt/cmd.txt
    e5c1834976dfd34f9ed6899d0d48a83a8bacc8596150aac8ea3c9869ed6a6daf  v111-pxd004541-tmt/run.digest.tsv
    45c730ddfe2701052c49fb09d3b504cf28ab5357e77e241bcb80fa637de6d5c4  v111-pxd004541-tmt/run.label.tsv
    fb96d32513733bf0e07a19f031643a0ba423dd155a89eed59620e133a6a0a944  v111-pxd004541-tmt/run.log
    15e986e27006e8a21edacb87886e30cfad392d3c3beed048b14e05e96d468974  v111-pxd004541-tmt/run.tags.species.tsv
    31eda137a9768aee56036654f78b7c765a583ea2353c61320517e9900f84d507  v112-pxd003531-call/cmd.txt
    4e77fcbe4ec5fa030b64cb8a890383434163926f6f2589e243dec43fc28c1d4d  v112-pxd003531-call/run.digest.tsv
    d1034ca032345f404358f2e4121b499f843544d7a3e1c59fd445a21a344b49d6  v112-pxd003531-call/run.label.tsv
    124cd8f282679a31141ab2ce58b37d2afcc2a08018aad382b8271dbad4588442  v112-pxd003531-call/run.log
    73c14129a90fc1cb968386fefa57dcbc417f0d20dce0282543ae214f3f1ce9b6  v112-pxd003531-call/run.tags.census_summary.tsv
    b483dfb706ae043ba344ce986a188643921ca4cd0ff16015f46e9fca8ef1d75e  v112-pxd003531-call/run.tags.species.tsv
    9f6e7ac89dbb819ae2fa7ea01d0c7fb4bb0b158bc5a9f20f7d0bc78d48275503  v112-pxd003531/cmd.txt
    4e77fcbe4ec5fa030b64cb8a890383434163926f6f2589e243dec43fc28c1d4d  v112-pxd003531/run.digest.tsv
    d1034ca032345f404358f2e4121b499f843544d7a3e1c59fd445a21a344b49d6  v112-pxd003531/run.label.tsv
    1217b27c6c5009f7b61bc4caa5020a5add98ce500fe172359f5a62220cb6d5a4  v112-pxd003531/run.log
    e7e34368b7ad66725ad15d1e589c5fc75f91917643e5843853c5b3fd475cf279  v112-pxd003531/run.tags.species.tsv
    04c10563eda44cd7568b677958d31e9fc658806f3714838b06cbd229da67f9e1  v112-pxd004541-tmt/cmd.txt
    e5c1834976dfd34f9ed6899d0d48a83a8bacc8596150aac8ea3c9869ed6a6daf  v112-pxd004541-tmt/run.digest.tsv
    081ec58d0f324ffff2e22fbbbad2dde0503249f04cbe4aecc5c7aebe91ee2d34  v112-pxd004541-tmt/run.label.tsv
    d46a28aebd181f42ad43d6e856ba9f34d1b6b4fae56a19aa87bf47ad382bea32  v112-pxd004541-tmt/run.log
    15e986e27006e8a21edacb87886e30cfad392d3c3beed048b14e05e96d468974  v112-pxd004541-tmt/run.tags.species.tsv
    37651c32f7f25ed3cb2e7072fa8eae7eec85f9415df67f9fc07546797c494103  v112-pxd010783-da/cmd.txt
    9a427a37de95f0b0f445ee1d974dbe7d3971941039ebf8c81e515663ad08343a  v112-pxd010783-da/run.digest.tsv
    b51a3b37e1156e8ac3d275b9fa0d316c4f019ee12cd896d5d2c4a7a55e4e4ba5  v112-pxd010783-da/run.label.tsv
    b3ec446ab7018abaae6df851aaa0297a5a9c88619a46fadf71f79ea28438acbe  v112-pxd010783-da/run.log
    717775960a95e9920b76294b62e82542b3fae219ddd8218ab3e6952dfe72715f  v112-pxd010783-da/run.tags.species.tsv
    8eb35dc2ad160e423aaa1f4e8ba5c049d522d234ac185daf9d86d36f796f314c  v112-pxd014764-fasta/cmd.txt
    74c2f13e13f4c43635fa0f27bbe9c382251d181fd9a29b658c6f9148359ee5d9  v112-pxd014764-fasta/run.digest.tsv
    0c8d439cc9704a0b684bfb5acd5ef4cfef447cf82a7e26ec581cb931a9d148c7  v112-pxd014764-fasta/run.label.tsv
    5a268cf64bb54aea01c3a789b4de60e90cff8c3549f380de333713e905a4752d  v112-pxd014764-fasta/run.log
    51d8f6ef6985fd48c8543886a076c27aefc8e0645961a4f1d6de30c4183606db  v112-pxd014764-fasta/run.massgap.tsv
    f89c2ed6b0d7856d2ca24994cbcc13428349b842fbe2b515394cd5a00e339115  v112-pxd014764-fasta/run.tags.species.tsv
    1fdada5d37f4e89be282ab370597b71cefd1ef012dfce67c207355d0396fea96  v112-pxd014764-recon-ext2/cmd.txt
    d90ea84cdce2ae72085bd4a63d358e9f36a6d40c9bbd4289ee36a1fa92139c88  v112-pxd014764-recon-ext2/run.digest.tsv
    c4e9c2a1e659443ba7c0bb5347b2ac17775fe9ae6863d0a4557884160508a497  v112-pxd014764-recon-ext2/run.label.tsv
    f2459268ca1c955d4bce668e2619139a2131ce17ab688512254ba0bddbcf858a  v112-pxd014764-recon-ext2/run.log
    85cab455ba38e0e51bf6b851f4ca719be2b9ef30864e5c827d21f6c592446d91  v112-pxd014764-recon-ext2/run.massgap.tsv
    c44792bbeda95584c6cdc8a03c65645368d6f162aee15ce2a9c9f600206d783b  v112-pxd014764-recon-ext2/run.tags.species.tsv
    1c65778ed54a2cbc545ce65319c61542cf4173a7a1fd98f94015e90fc28868fc  v112-pxd014764-recon-ext3/cmd.txt
    56583212439bfcef4d7cda01e677fd3709cde7178a41843d66856ad06ff7cdc0  v112-pxd014764-recon-ext3/run.digest.tsv
    e68f29e43d88eef3b7143e099fe6ff0cf6823cfb7881040e67728bf2d415fbda  v112-pxd014764-recon-ext3/run.label.tsv
    97e3f0418fafd8e4cc9d30aedf38fa4fe1cc72660800f73ab516d339bc4b48bd  v112-pxd014764-recon-ext3/run.log
    51d8f6ef6985fd48c8543886a076c27aefc8e0645961a4f1d6de30c4183606db  v112-pxd014764-recon-ext3/run.massgap.tsv
    9211b7d265e1b886632f307e02f7e3b1868417c3b00f4fefcc8820fa931b1e2c  v112-pxd014764-recon-ext3/run.tags.species.tsv

## v112-ecoli-dump: -dump_spectrum (P4 PR a)

The ladder oracle and the dump parser fixtures (`src/spectrum/*.test.ts`),
the e2e `?fixture=spectrum` scenario and the stub CLI's `-dump_spectrum`
(`gui/testing/stub-fastag`). The binary is the G1 build of
`feat/g1-gui-cli-additions` (`-probe_input`, `-dump_spectrum`, with the #6
refusal of c9e321f) on node `data`, `/scratch/kohlbach/fastag112-g1/build6`,
copied to `/scratch/kohlbach/fastag-gui-p4a/bin/FASTag` (sha256
12a99461...cd49b; it still says Version 1.11.0). Input: the repository's
public `test/fixtures/Ecoli_MS2_small.mzML` (sha256 30717211...16f6e).
Script: `/scratch/kohlbach/p4a_fx.sh`.

- `dumps.ppm.jsonl`: `FASTag -in Ecoli_MS2_small.mzML -dump_spectrum <id>
  -threads 1` for each of the 129 spectra of the CLI-default run
  `FASTag -in Ecoli_MS2_small.mzML -out tags.tsv -threads 1`, one dump after
  another in the order of the run's tags. That run's tags are byte-identical
  to `e2e-web/fixtures/ecoli.tags.tsv` (sha256 479a0360...fa3f7), which the
  tests read for them.
- `dumps.da.jsonl` and `da.tags.tsv`: the same with `-fragment_tolerance 0.3
  -fragment_tolerance_unit Da` (139 spectra, 5,937 tags).
- `helphelp.txt`: that binary's `--helphelp` (stderr; the `stty` line its
  OpenMS console probe prints without a terminal removed); `helphelp-1.11.0.txt`:
  the same of FASTag 1.11.0 (`/ceph/ibmi/abi/oliver/opt/fastag-1.11.0`), which
  has no `-dump_spectrum`.
- `unknown.err`: stderr of `-dump_spectrum scan=does-not-exist` (exit 6,
  nothing on stdout), without its timing line.

sha256 of each file:

    2279744ab2d971a7f49fbb56b51455089d311fd2415ef207bac258e6b88be7d4  v112-ecoli-dump/da.tags.tsv
    d84008309aef5e75f708e4975423c3f931304745ff9a6093a42cd15452b93fef  v112-ecoli-dump/dumps.da.jsonl
    60e0f579453df6b85767b2e3e2d394b90533420dea710eb6c8b6a85d8cf8afb3  v112-ecoli-dump/dumps.ppm.jsonl
    575a8cc771bfb6275163bcbb0995d008eec00f2d423b5aee1793bc283dcb7c3d  v112-ecoli-dump/helphelp-1.11.0.txt
    6e898e629a0085b33534d5d37f6c2eb395839db89ca7b2aa794afc2ad3774893  v112-ecoli-dump/helphelp.txt
    4fd1bd9c923921a542d0e9370c30a79cf39442a248473905142acf44702c17ed  v112-ecoli-dump/unknown.err
