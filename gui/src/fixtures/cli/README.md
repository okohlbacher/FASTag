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
| v112-pxd014764-delta-ext3 | 1.12 | PXD014764 | -extension 3 -glyco -recon_fasta Homo_sapiens.fasta -recon_out -delta_out -massgap_out (P4c) |
| v1111-ecoli-recon-loc | 1.11.1 | test/fixtures/Ecoli_MS2_small.mzML | -fragment_tolerance 0.3 Da -tag_length 4 -glyco -recon_fasta Ecoli_MS2_small.fasta -recon_out -recon_localize -delta_out -massgap_out -recon_id_out run.recon.mzTab (P4c) |

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

The two P4c directories keep the files the viewers read (GUI-DESIGN S7,
S8): `run.recon.tsv`, `run.delta.tsv`, `run.recon.mzTab` and
`run.tags.glyco.tsv` are what FASTag wrote, unchanged; only the tags table
is left out. v112-pxd014764-delta-ext3 is the recon-ext3 command with
`-delta_out` added and without `-species`, `-digest_out` and `-label_out`
(its massgap report is byte-identical to recon-ext3's), run with
`/scratch/kohlbach/p4c_fx.sh` on node data. v1111-ecoli-recon-loc is the
public OpenMS example of `test/fixtures` (BSD-3-Clause) with the three
proteins of `Ecoli_MS2_small.fasta`, run on macOS arm64 with the FASTag
1.11.1 cask (`/opt/homebrew/Caskroom/fastag-cli/1.11.1/FASTag/FASTag.bin`,
sha256 86b3a18a...b8b081): an ion-trap file, so 0.3 Da, and tag length 4,
the minimum its recon index derives; it is the case with `-recon_localize`
columns and an mzTab of the placements.

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
    55d85648d28ef3baf623029e75b189d4aff2e183915f614269a6bb6b8ba0074b  v112-pxd014764-delta-ext3/cmd.txt
    dbb138b126776b600b8d1a8e52dea2397f6e86e0113f40ba68d6cd46cdd48c2b  v112-pxd014764-delta-ext3/run.delta.tsv
    9b474ab906d11cc707533a2ae676b75fceedb14658f5a2b164ca190170198fea  v112-pxd014764-delta-ext3/run.log
    51d8f6ef6985fd48c8543886a076c27aefc8e0645961a4f1d6de30c4183606db  v112-pxd014764-delta-ext3/run.massgap.tsv
    fd449606c101c7295e964c487d09dd575240e788a38aafcf2270cb68ab6abdba  v112-pxd014764-delta-ext3/run.recon.tsv
    e38501f28bd3b892c3dd162ea10264d05bdf9c30ee9e00af48fab96ca5876101  v112-pxd014764-delta-ext3/run.tags.glyco.tsv
    d4461087697052f3bfe431d8f6ed36075d74fdd44944e8747d9337e886fbb41a  v1111-ecoli-recon-loc/cmd.txt
    6978da75755563d2596eb011c6c559644444a4042da68bbfc59e35950ef9c75a  v1111-ecoli-recon-loc/run.delta.tsv
    cd14c1ad2d91f1c1ef6f2a0b224bd6e8ee9d7586ccd7d54d413ff68da7226677  v1111-ecoli-recon-loc/run.log
    7506a8f84b3e1237e2f1dc42201c686e3ad4288e1a9e6c5d17485c660dea42da  v1111-ecoli-recon-loc/run.massgap.tsv
    75de7aff1726057e2fc320fd5362e4bcf9ed65f04342828e180c9a8d1ca4f15e  v1111-ecoli-recon-loc/run.recon.mzTab
    de18346938836c1b46d8f0212b69dec51de1f8c252b59df352553de1d8c9fa95  v1111-ecoli-recon-loc/run.recon.tsv
    e65e2aeac74c682412201ca2804330161e0af83710ad32eb0c2c79436828ea74  v1111-ecoli-recon-loc/run.tags.glyco.tsv
