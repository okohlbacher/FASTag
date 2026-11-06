from fastag_bench import parsers as P

DIRECTAG = """H\tTagsGenerator\tDirecTag
H(S)\tID\tNativeID\tIndex
H(T)\tTag\tLowPeakMz\tnTerminusMass\tcTerminusMass\tWorstPeakRank\tValid\tTotal
S\tcontrollerType=0 controllerNumber=1 scan=981\tcontrollerType=0 controllerNumber=1 scan=981\t1
T\tTSQ\t434.2\t1267.56\t415.18\t20\t0\t0.0014
T\tTTS\t562.2\t1166.52\t543.24\t26\t0\t0.0034
S\tcontrollerType=0 controllerNumber=1 scan=982\tx\t2
T\tAAA\t1\t2\t3\t4\t0\t0.1
"""

FASTAG = """spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit
controllerType=0 controllerNumber=1 scan=981\tTSQ\t3\t1\t1267.5628\t415.1831\t0\t0\t0.045412\t0.579\t0.669\t-
controllerType=0 controllerNumber=1 scan=981\tTTS\t3\t1\t1166.5156\t543.2412\t0\t0\t0.216139\t0.520\t0.642\t-
"""

SAGE = "psm_id\tpeptide\tfilename\tscannr\trank\tlabel\tspectrum_q\n" \
       "1\tPEPTIDEK\tf.mzML\tcontrollerType=0 controllerNumber=1 scan=981\t1\t1\t0.001\n" \
       "2\tDECOYK\tf.mzML\tcontrollerType=0 controllerNumber=1 scan=982\t1\t-1\t0.001\n" \
       "3\tLATEK\tf.mzML\tcontrollerType=0 controllerNumber=1 scan=983\t1\t1\t0.2\n"


def test_directag(tmp_path):
    p = tmp_path / "x.tags"
    p.write_text(DIRECTAG)
    df = P.read_directag_tags(p)
    assert list(df["tag"]) == ["TSQ", "TTS", "AAA"]
    assert list(df["rank"]) == [1, 2, 1]
    assert df["key"].iloc[0] == "scan=981" and df["Total"].iloc[1] == "0.0034"
    assert df["nterm_mass"].iloc[0] == 1267.56 and df["cterm_mass"].iloc[0] == 415.18
    assert list(df["length"]) == [3, 3, 3]


def test_fastag(tmp_path):
    p = tmp_path / "tags.tsv"
    p.write_text(FASTAG)
    df = P.read_fastag_tags(p)
    assert list(df["rank"]) == [1, 2] and set(df["key"]) == {"scan=981"}


def test_sage_filters_decoys_and_q(tmp_path):
    p = tmp_path / "results.sage.tsv"
    p.write_text(SAGE)
    df = P.read_sage_psms(p, 0.01)
    assert list(df["peptide"]) == ["PEPTIDEK"] and list(df["key"]) == ["scan=981"]


def test_long_report(tmp_path):
    p = tmp_path / "digest.tsv"
    p.write_text("section\tkey\tvalue\tn\tdescription\ncall\tstatus\tcall\t7078\tx\ncall\tclass\tTrypsin\t-\ty\n")
    r = P.read_long_report(p)
    assert r[("call", "class")] == "Trypsin"


def test_sdrf_run(tmp_path):
    p = tmp_path / "s.sdrf.tsv"
    p.write_text("source name\tcharacteristics[organism]\tcomment[data file]\tcomment[cleavage agent details]\t"
                 "comment[cleavage agent details]\tcomment[label]\tcomment[modification parameters]\n"
                 "s1\tHomo sapiens\trun1.raw\tNT=Lys-C;AC=MS:1001309\tNT=Trypsin;AC=MS:1001251\t"
                 "NT=label free sample;AC=MS:1002038\tNT=Carbamidomethyl;TA=C;MT=fixed\n")
    m = P.sdrf_run(p, "run1")
    assert m["cleavage"] == ["Lys-C", "Trypsin"] and m["organism"] == ["Homo sapiens"]
    assert m["label"] == ["label free sample"]


def test_casanovo_mgf_index_maps_to_scan(tmp_path):
    mgf = tmp_path / "first.mgf"
    mgf.write_text("BEGIN IONS\nTITLE=controllerType=0 controllerNumber=1 scan=17\nSCANS=17\nPEPMASS=500\n100 1\nEND IONS\n"
                   "BEGIN IONS\nTITLE=controllerType=0 controllerNumber=1 scan=23\nPEPMASS=600\n100 1\nEND IONS\n")
    mz = tmp_path / "c.mztab"
    mz.write_text("MTD\tmzTab-version\t1.0.0\n"
                  "PSH\tsequence\tPSM_ID\tsearch_engine_score[1]\tspectra_ref\n"
                  "PSM\tPEPTLDE\t0\t0.9\tms_run[1]:index=1\n"
                  "PSM\tSAMPLER\t1\t0.8\tms_run[1]:index=0\n")
    df = P.read_casanovo_mztab(mz, mgf)
    assert dict(zip(df["peptide"], df["key"])) == {"PEPTLDE": "scan=23", "SAMPLER": "scan=17"}


COMET = """CometVersion 2026.03 rev. 0 (fa08489)\tx.mzML\t11/03/2026\tdb.fasta
scan\tnum\tcharge\texp_neutral_mass\tcalc_neutral_mass\te-value\txcorr\tdelta_cn\tsp_score\tions_matched\tions_total\tplain_peptide\tmodified_peptide\tprev_aa\tnext_aa\tprotein\tprotein_count\tmodifications\tretention_time_sec\tsp_rank
10\t1\t2\t1\t1\t0.0001\t3.1\t0.5\t1\t1\t1\tPEPMCK\tx\tK\tR\tsp|P1|A\t1\t4_V_15.994915\t1\t1
11\t1\t2\t1\t1\t0.0002\t3.0\t0.5\t1\t1\t1\tAAAK\tx\tK\tR\tDECOY_sp|P2|B\t1\t-\t1\t1
12\t1\t2\t1\t1\t0.0003\t2.9\t0.5\t1\t1\t1\tLLLK\tx\tK\tR\tsp|P3|C\t1\t-\t1\t1
"""


def test_comet_q_and_notation(tmp_path):
    p = tmp_path / "c.txt"
    p.write_text(COMET)
    df = P.read_comet_psms(p, fdr=0.6, static_mods={"C": 57.021464})
    assert list(df["key"]) == ["scan=10", "scan=12"]
    assert df["peptide"].iloc[0] == "PEPM[+15.994915]C[+57.021464]K"
    assert P.read_comet_psms(p, fdr=0.01)["key"].tolist() == ["scan=10"]


def test_mgf_filter(tmp_path):
    from fastag_bench.convert import filter_mgf_precursors
    src = tmp_path / "a.mgf"
    src.write_text("BEGIN IONS\nTITLE=a\nPEPMASS=500.1\nCHARGE=2\n100 1\nEND IONS\n"
                   "BEGIN IONS\nTITLE=b\nPEPMASS=nan\nCHARGE=0\n100 1\nEND IONS\n"
                   "BEGIN IONS\nTITLE=c\nPEPMASS=600.2 1000\nCHARGE=3+\n100 1\nEND IONS\n")
    dst = tmp_path / "b.mgf"
    assert filter_mgf_precursors(src, dst) == (2, 1)
    assert "TITLE=b" not in dst.read_text() and dst.read_text().count("BEGIN IONS") == 2
