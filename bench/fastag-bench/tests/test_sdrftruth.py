import pytest

from fastag_bench import digestcalls as DC
from fastag_bench import sdrftruth as T

HEAD = ["source name", "comment[label]", "comment[modification parameters]", "comment[modification parameters]",
        "comment[cleavage agent details]", "comment[alkylation reagent]", "comment[data file]"]


def _sdrf(tmp_path, rows, head=HEAD):
    p = tmp_path / "x.sdrf.tsv"
    p.write_text("\n".join("\t".join(r) for r in [head] + rows) + "\n")
    return p


@pytest.mark.parametrize("name,stem", [("a/b/run1.raw", "run1"), ("run1.d.zip", "run1"), ("run1.mzML.gz", "run1"),
                                       ("C:\\x\\run1.RAW", "run1"), ("run.1", "run.1")])
def test_run_stem(name, stem):
    assert T.run_stem(name) == stem


@pytest.mark.parametrize("cells,cls", [
    (["NT=Trypsin;AC=MS:1001251"], "Trypsin"),
    (["NT=Trypsin, Lys-C"], "Trypsin"),
    (["NT=Lys-C", "NT=Trypsin/P"], "Trypsin"),
    (["NT=glutamyl endopeptidase;AC=MS:1001917"], "Glu-C"),
    (["NT=leukocyte elastase"], "unspecific"),
    (["NT=unspecific cleavage"], "unspecific"),
    (["NT=Asp-N", "NT=Glu-C"], "mixed"),
    ([], None),
])
def test_enzyme_truth(cells, cls):
    assert T.enzyme_truth(cells) == cls


@pytest.mark.parametrize("labels,mods,cls", [
    (["NT=label free sample"], [], "label-free"),
    (["NT=TMT126", "NT=TMT131"], [], "TMT"),
    (["NT=TMT126", "NT=TMT134N"], [], "TMTpro"),
    (["NT=TMT126"], ["NT=TMTpro;TA=K;MT=Fixed"], "TMTpro"),
    (["NT=ITRAQ113", "NT=ITRAQ121"], [], "iTRAQ8"),
    (["NT=ITRAQ114", "NT=ITRAQ117"], ["NT=iTRAQ4plex;TA=K"], "iTRAQ4"),
    (["NT=SILAC heavy", "NT=SILAC light"], [], "SILAC"),
    (["NT=label free sample"], ["NT=Label:13C(6)15N(2);TA=K;MT=Variable"], "SILAC"),
    (["NT=isotope labeling"], [], "isotope (unspecified)"),
    ([], [], None),
])
def test_label_truth(labels, mods, cls):
    assert T.label_truth(labels, mods) == cls


@pytest.mark.parametrize("mods,reag,cls,basis", [
    (["NT=Carbamidomethyl;TA=C;MT=Fixed"], [], "Carbamidomethyl", "fixed mod"),
    (["NT=Methylthio;AC=UNIMOD:39;TA=C;MT=Fixed"], [], "Methylthio", "fixed mod"),
    (["NT=Oxidation;TA=M;MT=Variable"], ["NT=iodoacetamide"], "Carbamidomethyl", "reagent"),
    (["NT=Oxidation;TA=M;MT=Variable"], ["NT=chloroacetamide"], "Carbamidomethyl", "reagent"),
    (["NT=Oxidation;TA=M;MT=Variable"], [], "none", "no C mod"),
    ([], [], None, "no mod columns"),
])
def test_alkylation_truth(mods, reag, cls, basis):
    assert T.alkylation_truth(mods, reag) == (cls, basis)


def test_truth_for_run_matches_data_file_not_name(tmp_path):
    p = _sdrf(tmp_path, [
        ["s1", "NT=label free sample", "NT=Carbamidomethyl;TA=C;MT=Fixed", "NT=Oxidation;TA=M;MT=Variable",
         "NT=Trypsin", "not available", "GluC_run_01.raw"],
        ["s2", "NT=label free sample", "NT=Carbamidomethyl;TA=C;MT=Fixed", "NT=Oxidation;TA=M;MT=Variable",
         "NT=Asp-N", "not available", "other.raw"],
    ])
    t = T.truth_for_run(p, "GluC_run_01")
    assert t["enzyme_truth"] == "Trypsin"          # the SDRF, not the 'GluC' in the file name
    assert t["alk_truth"] == "Carbamidomethyl" and t["label_truth"] == "label-free"
    assert T.truth_for_run(p, "missing")["matched_rows"] == 0


def test_resolve_priority_and_project_uniform(tmp_path):
    sub = tmp_path / "sub"
    sub.mkdir()
    com = tmp_path / "com"
    com.mkdir()
    row = lambda enz, f: ["s", "NT=label free sample", "NT=Carbamidomethyl;TA=C;MT=Fixed", "", enz, "", f]
    ps = _sdrf(sub, [row("NT=Lys-C", "a.raw")])
    pc = _sdrf(com, [row("NT=Trypsin", "a.raw"), row("NT=Trypsin", "b.raw")])
    t = T.resolve("a", [("submitter", str(ps), "u1"), ("community", str(pc), "u2")])
    assert (t["sdrf_kind"], t["match"], t["enzyme_truth"]) == ("submitter", "run", "Lys-C")
    t = T.resolve("c", [("community", str(pc), "u2")])
    assert (t["match"], t["enzyme_truth"]) == ("project-uniform", "Trypsin")
    assert T.resolve("c", [])["match"] == "no SDRF"


def _rep(d):
    return {tuple(k.split("|")): v for k, v in d.items()}


def test_digest_call_and_nocall():
    rep = _rep({"call|status": "no_call", "model|Trypsin.loglik": "-2", "model|Trypsin.class": "Trypsin",
                "model|unspecific.loglik": "-3", "model|unspecific.class": "unspecific cleavage",
                "nocall|ms2_first_peak": "yes", "nocall|few_tags": "no"})
    c = DC.digest(rep)
    assert c["call"] is None and c["would"] == "Trypsin" and c["nocall_reasons"] == "ms2_first_peak"
    rep = _rep({"call|status": "call", "call|class": "unspecific cleavage", "call|margin": "0.4"})
    assert DC.digest(rep)["call"] == "unspecific"


def test_label_rule():
    lab = _rep({"count|tags_filtered": "1000", "nlabel|TMT.count": "60", "nlabel|TMT.background": "2",
                "nlabel|TMTpro.count": "9", "nlabel|TMTpro.background": "0",
                "heavy|K8.share": "0.3", "heavy|R10.share": "0.25", "heavy|gate": "yes"})
    assert DC.label(lab, _rep({"share|kr": "0.9"}))["label_call"] == "TMT+SILAC"
    assert DC.label(lab, _rep({"share|kr": "0.5"}))["label_call"] == "TMT"   # not tryptic: no SILAC call
    lab[("nlabel", "TMT.background")] = "4"                                   # 60 < 20 x 4
    lab[("heavy", "gate")] = "no"
    assert DC.label(lab, {})["label_call"] == "label-free"


def test_alkylation_rule():
    mg = _rep({"cys|Carbamidomethyl (C)": "40", "cys|Propionamide (C)": "0", "cys|Nethylmaleimide (C)": "1",
               "cys|Methylthio (C)": "0", "cys|Carboxymethyl (C)": "3", "cys|spectra": "900"})
    a = DC.alkylation(mg)
    assert a["alk_call"] == "Carbamidomethyl" and a["alk_ratio"] == round(41 / 4, 3)
    mg[("cys", "Carbamidomethyl (C)")] = "9"
    assert DC.alkylation(mg)["alk_call"] == "unknown"
    assert DC.alkylation({})["alk_call"] is None
