#!/usr/bin/env python3
"""Supporting Information tables of the FASTag article, built from the result tables of this archive.

Writes into --out:
  Table_S2.xlsx  parameter sets and command lines (FASTag, DirecTag, Sage, Comet, Unipept)
  Table_S3.xlsx  species benchmark: 48 runs with composition, source and ranks
  Table_S4.xlsx  the 254 runs of the report evaluation, baselines, Wilson intervals, subsets
  Table_S6.xlsx  tag accuracy per data set, tool, truth, tag length and top-k; sweeps; paired tests;
                 de novo comparison (FASTag 1.10.0 and four de novo tools on the same MGF files)
  Table_S7.xlsx  speed and memory per data set, format and thread count; runtime analysis of PXD047793
  FASTag-JPR-SI-figures-tables.md/.pdf  Figures S1-S4 with legends and Tables S1 (byte-identity gate)
                 and S5 (hardware and load protocols); the PDF needs pandoc and xelatex on PATH
  Figure_S1..S4.{pdf,png}  copies of the rendered figures (fastag-bench figures)

Every workbook starts with a README sheet: title, legend, one line per sheet with its source table, and the
provenance lines of every source table. Peak memory in Table S7 is the sampled /proc VmRSS maximum where the
cell was re-measured (results/memory_sampled_v190.tsv) and otherwise ru_maxrss (/usr/bin/time -v), marked as a
lower bound (Linux >= 6.2 under-reports multithreaded peaks).

    python3 scripts/si_tables.py --out ../si              # needs openpyxl (pip install -e ".[si]")
    python3 scripts/si_tables.py --out ../si --no-pdf     # Markdown only
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "src"))

import pandas as pd  # noqa: E402

from fastag_bench.tsv import read_tsv  # noqa: E402

FIGURES = {  # SI figure -> (rendered figure, legend)
    "S1": ("fig_s1_thread_identity_v190",
           "**Figure S1.** Thread-count independence of the FASTag 1.9.0 tag table on the thread ladder "
           "(2 × AMD EPYC 9654, 384 logical CPUs). Rows: data set, settings profile (default; matched speed "
           "settings) and input format; columns: thread count. A filled cell gives the number of runs of the "
           "cell; its color identifies the SHA-256 digest of the tag table within a data set. At right: the "
           "letter of that digest (A = default settings on mzML), its first eight hexadecimal digits and the "
           "number of tags. Empty cells were not run. Each row has one "
           "digest at all thread counts. mzML, point mzPeak and chunked mzPeak input gave the same digest on "
           "PXD003531, PXD047793 and PXD076528; on PXD028735 and PXD054073 each format gave its own digest."),
    "S2": ("fig_s2_species_ranks_v190",
           "**Figure S2.** Ranked genus lists of FASTag 1.9.0 `-species` per run, with and without "
           "deconvolution, on 48 public runs from 37 data sets: high-resolution single-organism runs (20), "
           "high-resolution runs with two or more genera (17) and ion-trap MS2 runs (11). Center: rank of each "
           "true genus that is in the 50-genus index in the default report (open circles), after "
           "`-species_deconvolve` (filled circles) and for Unipept 4.2.2 `pept2lca` on the Sage peptides of the "
           "same run (crosses; at the right edge when Unipept assigned no peptide to the genus or ranked it "
           "below 50). The number in parentheses after a run name counts true genera outside the index. Right: "
           "the three top-ranked genera of each FASTag list; true genera are in capitals."),
    "S3": ("fig_s3_report_flow_v190",
           "**Figure S3.** Flow of the 254 public runs through the evaluation of the protease, label and "
           "alkylation reports of FASTag 1.9.0 against SDRF annotations. Exclusions apply from top to bottom. "
           "The protease and label reports were not computed for 42 runs with an SDRF file for which "
           "prose-auto's validation record defines only a mass-gap test at a fragment tolerance of 0.3 Da "
           "(40 and 41 of them remain after the preceding exclusions). Cysteine alkylation is taken from the "
           "modification columns of the SDRF file; for 65 runs the SDRF file has no such columns. The alkylation report comes from the "
           "mass-gap pass, which repeats prose-auto's stored mass-gap test of the run; prose-auto stored no such "
           "test for 40 runs: for 32 it ran none (its search of 2,000 spectra against its organism databases "
           "gave at most 19 PSMs at 1% FDR, against 21 or more in every run with a test), and for 8 (PXD000900, "
           "PXD006939) it tested another run of the same data set. The final boxes give the evaluable runs "
           "of Table 6 and the runs with a call (protease: shipped models; alkylation: a reagent other than "
           "'unknown')."),
    "S4": ("fig_digest_overhead_v190",
           "**Figure S4.** Run time with and without the protease (`-digest_out`), label (`-label_out`) and "
           "mass-shift (`-massgap_out`) reports of FASTag 1.9.0: paired differences of wall time (with minus "
           "without the option) on three public runs, 8 threads, two repetitions in alternating order "
           "(1 × AMD EPYC 7763)."),
}


# ----------------------------------------------------------------- helpers

def load(res: Path, name: str) -> tuple[pd.DataFrame, list[str]]:
    return read_tsv(res / name)


def prov_line(prov: list[str], startswith: str) -> str:
    for p in prov:
        if p.startswith(startswith):
            return p
    raise KeyError(f"no provenance line starting with {startswith!r}")


def write_book(path: Path, title: str, legend: str, sheets: list[tuple[str, pd.DataFrame, str, list[str]]],
               provenance: dict[str, list[str]]) -> None:
    """sheets: (sheet name, table, description, source tables)."""
    from openpyxl.styles import Alignment, Font

    rows = [[title], [legend], [], ["Sheet", "Content", "Source (results/)", "Rows"]]
    rows += [[n, d, ", ".join(s), len(df)] for n, df, d, s in sheets]
    rows += [[], ["Provenance of the source tables (first lines of each file)"]]
    for src, lines in provenance.items():
        rows.append([src])
        rows += [["", ln] for ln in lines]
    path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        rows = [r + [""] * (4 - len(r)) for r in rows]
        pd.DataFrame(rows).to_excel(xw, sheet_name="README", index=False, header=False)
        for n, df, _, _ in sheets:
            assert len(n) <= 31, n
            df.to_excel(xw, sheet_name=n, index=False)
        wb = xw.book
        ws = wb["README"]
        ws["A1"].font = Font(bold=True, size=12)
        ws["A2"].alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells("A2:D2")
        ws.row_dimensions[2].height = max(30, 15 * (len(legend) // 120 + 1))
        for c in ws[4]:
            c.font = Font(bold=True)
        ws.column_dimensions["A"].width = 26
        ws.column_dimensions["B"].width = 110
        ws.column_dimensions["C"].width = 48
        ws.column_dimensions["D"].width = 8
        for n, df, _, _ in sheets:
            s = wb[n]
            s.freeze_panes = "A2"
            for c in s[1]:
                c.font = Font(bold=True)
            for i, col in enumerate(df.columns, start=1):
                vals = [str(col)] + [str(v) for v in df[col].head(200).tolist()]
                w = min(max(len(v) for v in vals) + 2, 60)
                s.column_dimensions[s.cell(row=1, column=i).column_letter].width = max(w, 8)
    print(path)


def provmap(res: Path, names: list[str]) -> dict[str, list[str]]:
    return {n: load(res, n)[1] for n in names}


# ----------------------------------------------------------------- Table S2

def table_s2(res: Path, out: Path) -> None:
    acc, pacc = load(res, "tag_accuracy_runs_v190.tsv")
    lad, plad = load(res, "ladder_summary_v190.tsv")
    _, prt = load(res, "runtime_pxd047793_v190.tsv")
    sp, psp = load(res, "species_v190_commands.tsv")
    _, pspr = load(res, "species_runs_v190.tsv")
    _, pdc = load(res, "digest_calls_v190.tsv")
    _, pnt = load(res, "digest_calls_nontryptic_v190.tsv")
    rtc, prtc = load(res, "digest_runtime_v190_commands.tsv")
    cfg, pcfg = load(res, "search_configs.tsv")

    def ex(tool, label):
        r = acc[(acc["tool"] == tool) & (acc["label"] == label) & (acc["pxd"] == "PXD003531")]
        return r["command"].iloc[0] if len(r) else ""

    fa_prof = prov_line(plad, "FASTag 'default' =")
    prof = [
        ("Tag accuracy", "FASTag 1.9.0", "default", "-threads 32 (plus the data set's fixed modifications; "
         "PXD000001: -fixed_modifications Methylthio (C) TMT6plex (K) TMT6plex (N-term))", ex("fastag", "fastag_default"),
         "tag_accuracy_runs_v190.tsv"),
        ("Tag accuracy", "FASTag 1.9.0", "matched, tag length k = 3 to 8 on all five data sets",
         "-tag_length k -max_tags 50 -max_peaks 100 -peaks_per_window 0 -gaps 0 -no_deisotope "
         "-fragment_tolerance 0.02 -fragment_tolerance_unit Da (-threads 32)", ex("fastag", "fastag_matched"),
         "tag_accuracy_runs_v190.tsv"),
        ("Tag accuracy", "DirecTag 1.4.21142", "default; matched, tag length k = 3 to 5 on all five data sets, "
         "k = 6 on PXD000001, PXD003531 and PXD054073 only",
         "see the DirecTag rows of sheet comparator_configs; the single k = 7 run (PXD000001) was stopped by "
         "signal 15 after 103 s when its job was replaced and is not scored (returncode -15 in sheet "
         "accuracy_commands)", ex("directag", "directag_matched"),
         "tag_accuracy_runs_v190.tsv"),
        ("Tag accuracy (truth)", "Sage 0.14.7", "1% spectrum-level FDR",
         "sage.json per data set in sheet comparator_configs", ex("sage", "default"), "search_configs.tsv"),
        ("Tag accuracy (truth cross-check)", "Comet 2026.03.0", "PXD003531, PXD001819",
         "comet.params per data set in sheet comparator_configs", ex("comet", "default"), "search_configs.tsv"),
        ("Speed (runtime analysis, thread ladder, sampled memory)", "FASTag 1.9.0 and DirecTag 1.4.21142",
         "default; matched speed settings", fa_prof, "", "ladder_summary_v190.tsv, runtime_pxd047793_v190.tsv"),
        ("Speed", "DirecTag 1.4.21142", "complement and isotope tolerances",
         "DirecTag defaults kept: complement tolerance 0.5 Da, isotope tolerance 0.25 Da; FASTag's complement "
         "tolerance is fixed at 0.02 Da", "", "article, Methods"),
        ("Species", "FASTag 1.9.0", "default; deconvolved; gapped",
         prov_line(psp, "FASTag ") + "; " + [p for p in pspr if p.startswith("FASTag 1.9.0 release bundle")][0],
         sp["command"].iloc[0], "species_v190_commands.tsv"),
        ("Species (Unipept input)", "Sage 0.14.7", "reference proteomes of the 50 index taxa",
         [p for p in pspr if p.startswith("Sage and Unipept")][0], "", "species_runs_v190.tsv, search_configs.tsv"),
        ("Species", "Unipept CLI 4.2.2", "pept2lca -e -a", [p for p in pspr if p.startswith("Unipept")][0], "",
         "species_runs_v190.tsv, search_configs.tsv"),
        ("Protease, label and alkylation reports (244 validation runs)", "FASTag 1.9.0", "passes A, B, C",
         prov_line(pdc, "A: "), "", "digest_calls_v190.tsv"),
        ("Protease, label and alkylation reports (10 added non-tryptic runs)", "FASTag 1.9.0", "passes A/B, C",
         prov_line(pnt, "A/B: "), "", "digest_calls_nontryptic_v190.tsv"),
        ("Report run time (Figure S4)", "FASTag 1.9.0", "paired, with and without the option",
         prov_line(prtc, "protocol: ") + "; " + prov_line(prtc, "termini pass: "), rtc["new_cmd"].iloc[0],
         "digest_runtime_v190_commands.tsv"),
        ("Byte-identity gate", "FASTag 1.9.0", "nine cases", "see Table S1 (SI PDF)", "", "gate_refs_v190.tsv"),
    ]
    profiles = pd.DataFrame(prof, columns=["experiment", "tool", "profile", "parameters", "example command",
                                           "source"])
    sheets = [
        ("profiles", profiles, "parameter sets per experiment and tool, with one example command line", []),
        ("accuracy_commands", acc[["dataset", "pxd", "tool", "label", "threads", "returncode", "version", "input", "command"]],
         "every command line of the tag-accuracy runs (FASTag 1.9.0; DirecTag, Sage and Comet reused from the "
         "1.8.0 pass)", ["tag_accuracy_runs_v190.tsv"]),
        ("comparator_configs", cfg, "Sage and Comet configuration files, DirecTag and Unipept command lines",
         ["search_configs.tsv"]),
        ("species_commands", sp, "FASTag 1.9.0 species commands per run and arm", ["species_v190_commands.tsv"]),
        ("report_runtime_commands", rtc, "paired commands of the report run-time measurement (Figure S4)",
         ["digest_runtime_v190_commands.tsv"]),
    ]
    write_book(out / "Table_S2.xlsx", "Table S2. Parameter sets and command lines of FASTag, DirecTag, Sage, "
               "Comet and Unipept",
               "Parameter sets of every experiment and the command lines as run. Paths are those of the "
               "benchmark nodes; the inputs are identified by file name and checksum in datasets.yaml and "
               "config/public_runs.tsv of the harness.", sheets,
               provmap(res, ["tag_accuracy_runs_v190.tsv", "search_configs.tsv", "species_v190_commands.tsv",
                             "digest_runtime_v190_commands.tsv", "digest_calls_v190.tsv",
                             "digest_calls_nontryptic_v190.tsv", "ladder_summary_v190.tsv"]))


# ----------------------------------------------------------------- Table S3

def per_accession(ds: pd.DataFrame, runs: pd.DataFrame) -> pd.DataFrame:
    """species_datasets.tsv has group rows (several accessions in one row); expand to one row per accession of
    the runs, in run order. Grouped accessions take truth genera and run notes from the run manifest."""
    single = {p: row for _, row in ds.iterrows() for p in [str(row["pxd"])] if ";" not in p and " " not in p}
    group = {}
    for _, row in ds.iterrows():
        for tok in str(row["pxd"]).replace(";", " ").split():
            if tok.startswith("PXD") and tok not in single:
                group[tok] = row
    out = []
    for pxd, rr in runs.groupby("pxd", sort=False):
        genera = sorted({g.split("=")[0].strip() for t in rr["truth"].dropna() for g in str(t).split(";") if g.strip()})
        ids = ", ".join(rr["run_id"])
        if pxd in single:
            row = single[pxd].to_dict()
            row["runs_used"] = row.get("runs_used") or ids
        else:
            g = group.get(pxd)
            notes = "; ".join(dict.fromkeys(str(n) for n in rr["note"].dropna() if str(n).strip()))
            row = {"pxd": pxd, "reference": f"PRIDE {pxd}", "doi": "",
                   "composition": (str(g["composition"]) if g is not None and len(genera) > 1
                                   else "single organism (" + ", ".join(genera) + ")"),
                   "ratios": "", "in_index_genera": ";".join(genera), "out_of_index_genera": "",
                   "runs_used": ids, "note": notes}
        row["runs"] = len(rr)
        row["truth_genera"] = ";".join(genera)
        out.append(row)
    df = pd.DataFrame(out)
    assert df["pxd"].is_unique and len(df) == runs["pxd"].nunique()
    return df


def table_s3(res: Path, out: Path) -> None:
    runs, _ = load(res, "species_runs_v190.tsv")
    man, _ = read_tsv(HERE.parent / "config" / "species_runs.tsv")
    ds, _ = load(res, "species_datasets.tsv")
    tr, _ = load(res, "species_truth_ranks_v190.tsv")
    gc, _ = load(res, "species_genus_calls_v190.tsv")
    top1, _ = load(res, "species_top1_v190.tsv")
    met, _ = load(res, "species_metrics_v190.tsv")
    idx, _ = load(res, "species_index_v190.tsv")
    r = runs.merge(man[["run_id", "note"]], on="run_id", how="left").merge(
        ds[["pxd", "reference", "doi", "composition", "ratios"]], on="pxd", how="left")
    r["n_true_genera"] = r["truth"].map(lambda t: len([x for x in str(t).split(";") if x.strip()]))
    r["class"] = [("ion trap" if a == "ITMS" else "high resolution") + (", single" if n == 1 else ", mixture")
                  for a, n in zip(r["analyzer"], r["n_true_genera"])]
    lead = ["run_id", "pxd", "class", "analyzer", "label", "truth", "composition", "ratios", "note", "reference",
            "doi"]
    r = r[lead + [c for c in r.columns if c not in lead]]
    sheets = [
        ("runs", r, "48 runs: composition and its source, MS2 spectra, tags, FASTag and Unipept top genus, rank "
         "of each true genus in the default FASTag report", ["species_runs_v190.tsv", "config/species_runs.tsv",
                                                             "species_datasets.tsv"]),
        ("true_genus_ranks", tr, "rank of every true genus in the index: FASTag default, deconvolved, gapped "
         "tags admitted; Unipept", ["species_truth_ranks_v190.tsv"]),
        ("genus_calls", gc, "every genus of the index per run: evidence, q-value, ranks, deconvolved share, "
         "Unipept peptides; status positive/negative/excluded (contaminant genera; Homo where not in the sample)",
         ["species_genus_calls_v190.tsv"]),
        ("top_genus", top1, "most frequent genus correct, per class, analyzer and method",
         ["species_top1_v190.tsv"]),
        ("presence_rules", met, "sensitivity and specificity of the two presence rules fixed before scoring",
         ["species_metrics_v190.tsv"]),
        ("data_sets", per_accession(ds, r), "one row per data set: publication and composition "
         "(species_datasets.tsv; for accessions listed there only in a group row, the truth genera and run "
         "notes of config/species_runs.tsv)", ["species_datasets.tsv", "config/species_runs.tsv"]),
        ("index", idx, "the 50 taxa of the bundled k = 7 index and their shared 7-mers", ["species_index_v190.tsv"]),
    ]
    write_book(out / "Table_S3.xlsx", "Table S3. Species benchmark: 48 runs with composition, source and ranks",
               "FASTag 1.9.0 -species (bundled 50-genus index, -extension 2) and Unipept 4.2.2 pept2lca on the "
               "Sage 0.14.7 peptides (q <= 0.01) of 48 public runs from 37 ProteomeXchange data sets. Ranks are "
               "1-based; an empty rank means no evidence.", sheets,
               provmap(res, ["species_runs_v190.tsv", "species_truth_ranks_v190.tsv", "species_genus_calls_v190.tsv",
                             "species_top1_v190.tsv", "species_metrics_v190.tsv", "species_datasets.tsv",
                             "species_index_v190.tsv"]))


# ----------------------------------------------------------------- Table S4

def table_s4(res: Path, out: Path) -> None:
    t, _ = load(res, "table_s3_digest_truth_v190.tsv")
    st, _ = load(res, "stats_runlevel_v190.tsv")
    sm, _ = load(res, "fig7_digest_summary_v190.tsv")
    cf, _ = load(res, "fig7_confusion_v190.tsv")
    ch, _ = load(res, "digest_calls_v180_vs_v190.tsv")
    src, _ = read_tsv(res / "sdrf" / "sources.tsv")
    gap, _ = load(res, "massgap_absent_v190.tsv")
    lead = ["subset", "set", "acc", "run", "instrument", "sdrf_kind", "match", "enzyme_truth", "shipped_status",
            "shipped_call", "shipped_runner_up", "shipped_margin", "shipped_nocall_reasons", "shipped_correct",
            "prose_status", "prose_call", "prose_runner_up", "prose_margin", "prose_nocall_reasons", "prose_correct",
            "enzyme_evaluable", "label_truth", "label_truth_class", "label_call", "label_call_combined",
            "label_evaluable", "label_correct", "alk_truth", "alk_basis", "alk_call", "alk_evaluable", "alk_correct"]
    t = t[lead + [c for c in t.columns if c not in lead]]
    sheets = [
        ("runs", t, "one row per run: accession, run, instrument, SDRF source and annotations, calls with "
         "runner-up, margin and no-call reasons (shipped models and prose-auto 0.1.3 model table), correctness "
         "and evaluability per task; subset = validation (244) or new non-tryptic (10)",
         ["table_s3_digest_truth_v190.tsv"]),
        ("accuracy_baselines", st, "per task, subset (all, validation, independent_nontryptic, submitter_sdrf) "
         "and class: runs, calls, accuracy over evaluable runs (no-call = wrong) with 95% Wilson interval, "
         "accuracy over called runs, coverage, balanced accuracy, majority-class baseline",
         ["stats_runlevel_v190.tsv"]),
        ("accuracy_by_class", sm, "evaluable, called and correct runs per model set and class",
         ["fig7_digest_summary_v190.tsv"]),
        ("confusion", cf, "confusion matrices (truth x call, long format) of Figure 7", ["fig7_confusion_v190.tsv"]),
        ("changed_v180_v190", ch, "calls of FASTag 1.8.0 and 1.9.0 side by side for all 254 runs; call_changed marks a changed "
         "protease, label, alkylation or mass-gap SILAC call",
         ["digest_calls_v180_vs_v190.tsv"]),
        ("sdrf_sources", src, "URL of every SDRF file used as truth", ["sdrf/sources.tsv"]),
        ("no_alkylation_report", gap, "the 58 runs without an alkylation report: no mass-gap test of the run in "
         "prose-auto 0.1.3's record (best organism mini-search, 2,000 spectra) or a test of another run of the "
         "data set (Figure S3)", ["massgap_absent_v190.tsv"]),
    ]
    write_book(out / "Table_S4.xlsx", "Table S4. The 254 runs of the report evaluation",
               "Protease, label and alkylation reports of FASTag 1.9.0 on 254 public runs (244 from prose-auto's "
               "validation sets, 10 added non-tryptic runs) against SDRF-Proteomics annotations (community files "
               "of bigbio/sdrf-annotated-datasets or submitter files from PRIDE). Rules in "
               "scripts/score_digest_truth.py; the flow of runs is Figure S3.", sheets,
               provmap(res, ["table_s3_digest_truth_v190.tsv", "stats_runlevel_v190.tsv",
                             "fig7_digest_summary_v190.tsv", "fig7_confusion_v190.tsv",
                             "digest_calls_v180_vs_v190.tsv", "massgap_absent_v190.tsv"]))


# ----------------------------------------------------------------- Table S6

def table_s6(res: Path, out: Path) -> None:
    names = [("summary", "tag_accuracy_summary_v190.tsv", "per data set, truth, profile and control: PSM "
              "spectra, tagged spectra, rank-1 and top-k rates and recall; control 'shuffled peptides' = chance"),
             ("top_k", "tag_accuracy_topk_v190.tsv", "rate and recall of a correct tag among the top k, k = 1 to 50"),
             ("by_length", "tag_accuracy_by_length_v190.tsv", "precision of all tags by tag length"),
             ("by_evalue", "tag_accuracy_by_evalue_v190.tsv", "precision by FASTag E-value bin"),
             ("paired_tests", "stats_accuracy_paired_v190.tsv", "FASTag vs DirecTag at matched settings on the "
              "same spectra: rates, difference with 95% peptide-bootstrap CI, exact McNemar p, Holm-adjusted p"),
             ("truth_overlap", "tag_accuracy_overlap_v190.tsv", "agreement of the Sage and Comet truths"),
             ("gap_penalty_sweep", "gap_penalty_pxd000001_v190.tsv", "gap-penalty sweep on PXD000001"),
             ("peak_budget_sweep", "peak_budget_pxd000001_v190.tsv", "peak-budget sweep on PXD000001"),
             ("directag_pxd000001", "directag_accuracy_pxd000001_v190.tsv", "top-k against the Mascot truth "
              "of PXD000001"),
             ("runs", "tag_accuracy_runs_v190.tsv", "wall time, CPU time and memory of every accuracy run"),
             ("denovo_tag_accuracy", "denovo_tag_accuracy_v1100_mgf.tsv", "de novo comparison: FASTag 1.10.0 "
              "tags and tags derived from the top peptide of Casanovo, InstaNovo, Novor and PepNovo+ (and PepNovo+'s "
              "own tags) on the same MGF files, k = 3 to 5, rules flank and sequence, chance control"),
             ("denovo_peptide_accuracy", "denovo_peptide_accuracy_v1100_mgf.tsv", "de novo comparison: exact "
              "peptides of the de novo tools against the Sage truth"),
             ("denovo_runtime", "denovo_runtime_v1100_mgf.tsv", "de novo comparison: wall time and peak memory "
              "per tool and data set on a shared node (indicative only); tool settings in the provenance lines")]
    sheets = []
    for sheet, f, d in names:
        df, _ = load(res, f)
        sheets.append((sheet, df.drop(columns=["command"]) if sheet == "runs" else df, d, [f]))
    write_book(out / "Table_S6.xlsx", "Table S6. Tag accuracy per data set, tool, truth, tag length and top-k; "
               "gap-penalty and peak-budget sweeps; paired tests; de novo comparison",
               "FASTag 1.9.0 and DirecTag 1.4.21142 on five public DDA runs. A tag is correct if it or its "
               "reverse occurs in the PSM peptide (I = L) and one flanking mass agrees within 0.05 Da (rule "
               "'flank'); truth = Sage 0.14.7 PSMs at 1% FDR, Comet 2026.03.0 and the deposited Mascot search of "
               "PXD000001 as cross-checks. Profiles: see Table S2. Per-spectrum pairs: "
               "results/accuracy_pairs_v190.tsv.gz of the harness. Sheets denovo_*: FASTag 1.10.0 at its defaults "
               "and Casanovo 5.2.1, InstaNovo 1.2.2, Novor 1.05.0573 and PepNovo+ (build 20101117) on the same MGF "
               "files of PXD003531, PXD000001 and a 20,000-spectrum subsample of PXD076528, scored against a "
               "separate Sage 0.14.7 search (spectrum q <= 0.01); tool settings and hardware are in the provenance "
               "lines below.", sheets,
               provmap(res, [f for _, f, _ in names]))


# ----------------------------------------------------------------- Table S7

def table_s7(res: Path, out: Path) -> pd.DataFrame:
    s, _ = load(res, "ladder_summary_v190.tsv")
    m, _ = load(res, "memory_sampled_v190.tsv")
    raw, _ = load(res, "ladder_raw_v190.tsv")
    dst, _ = load(res, "ladder_directag_status_v190.tsv")
    inp, _ = load(res, "ladder_inputs_v180.tsv")
    rt, _ = load(res, "runtime_pxd047793_v190.tsv")
    key = ["tool", "profile", "dataset", "format", "threads"]
    main = m[m["kind"] == "main"]
    agg = main.groupby(key).agg(sampled_runs=("sampled_vmrss_max_mb", "size"),
                                sampled_peak_mb=("sampled_vmrss_max_mb", "max"),
                                sampled_ru_maxrss_mb=("ru_maxrss_mb", "max")).reset_index()
    cells = s.merge(agg, on=key, how="left")
    missing = agg.merge(s[key], on=key, how="left", indicator=True)
    missing = missing[missing["_merge"] == "left_only"]
    assert missing.empty, f"sampled cells without a ladder cell:\n{missing}"
    cells = cells.rename(columns={"rss_mb_min": "ru_maxrss_mb_min", "rss_mb_max": "ru_maxrss_mb_max"})
    sampled = cells["sampled_peak_mb"].notna()
    cells["peak_memory_mb"] = cells["sampled_peak_mb"].where(sampled, cells["ru_maxrss_mb_max"])
    cells["peak_memory_basis"] = ["sampled VmRSS (50 ms)" if x else "ru_maxrss, lower bound" for x in sampled]
    cells["sampled_over_ru_maxrss"] = (cells["sampled_peak_mb"] / cells["sampled_ru_maxrss_mb"]).round(3)
    lead = key + ["n", "wall_min_s", "wall_median_s", "wall_max_s", "speedup", "efficiency", "spectra_per_s",
                  "peak_memory_mb", "peak_memory_basis", "ru_maxrss_mb_min", "ru_maxrss_mb_max", "sampled_runs",
                  "sampled_peak_mb", "sampled_over_ru_maxrss"]
    cells = cells[lead + [c for c in cells.columns if c not in lead and c != "sampled_ru_maxrss_mb"]]
    rsum = rt[rt["table"] == "summary"].copy()
    rsum["value"] = pd.to_numeric(rsum["value"], errors="coerce")
    rwide = rsum.pivot_table(index=["tool", "version", "profile", "dataset", "threads", "tag"], columns="metric",
                             values="value", aggfunc="first").reset_index()
    rwide.columns.name = None
    for c in ("maxrss_mb_median",):
        if c in rwide:
            rwide = rwide.rename(columns={c: "ru_maxrss_mb_median (lower bound)"})
    rlead = ["tool", "version", "profile", "dataset", "threads", "tag", "n_reps", "wall_s_median",
             "rss_status_max_mb_median", "ru_maxrss_mb_median (lower bound)"]
    rwide = rwide[[c for c in rlead if c in rwide] + [c for c in rwide.columns if c not in rlead]]
    sheets = [
        ("ladder_cells", cells, "one row per tool, profile, data set, input format and thread count of the "
         "thread ladder (FASTag 1.9.0; DirecTag 1.4.21142 runs reused from the 1.8.0 ladder): wall time "
         "min/median/max over gated repetitions, speed-up over the lowest thread count, spectra per second, "
         "phase times; peak_memory_mb = sampled VmRSS maximum where re-measured, otherwise ru_maxrss "
         "(a lower bound)", ["ladder_summary_v190.tsv", "memory_sampled_v190.tsv"]),
        ("sampled_memory_runs", m, "every run of the sampled-memory re-measurement (kind main, smaps cross-check, "
         "5 ms interval check): ru_maxrss, sampled VmRSS maximum, ratio, hidden MB, sample intervals, tag-table "
         "digest", ["memory_sampled_v190.tsv"]),
        ("ladder_runs", raw, "every ladder run: exit code, wall, user and system time, ru_maxrss (kB, lower "
         "bound), load before and after, tag-table digest, phase times", ["ladder_raw_v190.tsv"]),
        ("directag_status", dst, "DirecTag status per data set on the ladder", ["ladder_directag_status_v190.tsv"]),
        ("ladder_inputs", inp, "ladder input files with size and SHA-256", ["ladder_inputs_v180.tsv"]),
        ("runtime_PXD047793_summary", rwide, "runtime analysis on one node (1 × AMD EPYC 7763): medians of the "
         "main repetitions per tool, version, profile, data set and thread count; rss_status_max = sampled "
         "VmRSS, ru_maxrss = lower bound; d_* DirecTag phases from its log, f_* FASTag phases",
         ["runtime_pxd047793_v190.tsv"]),
        ("runtime_PXD047793_all", rt, "all rows of the runtime analysis (runs, baselines, offset rescan, stack "
         "profiles, system calls, kernel RSS accounting check), long format", ["runtime_pxd047793_v190.tsv"]),
    ]
    write_book(out / "Table_S7.xlsx", "Table S7. Speed and memory per data set, format and thread count",
               "FASTag 1.9.0 thread ladder and DirecTag 1.4.21142 runs on 2 × AMD EPYC 9654 (384 logical CPUs, "
               "Linux 6.8), with ru_maxrss and, for the re-measured cells, the sampled peak memory; runtime "
               "analysis of PXD047793 and PXD003531 on 1 × AMD EPYC 7763. ru_maxrss (/usr/bin/time -v) "
               "under-reports multithreaded peaks on Linux 6.2 and later and is a lower bound. Memory in MB = "
               "2^20 bytes. Protocols: Table S5.", sheets,
               provmap(res, ["ladder_summary_v190.tsv", "memory_sampled_v190.tsv", "ladder_raw_v190.tsv",
                             "ladder_directag_status_v190.tsv", "ladder_inputs_v180.tsv",
                             "runtime_pxd047793_v190.tsv"]))
    return cells


# ----------------------------------------------------------------- SI PDF (Figures S1-S4, Tables S1, S5)

def md_escape(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\\ ", " ").replace("$", "\\$").replace("_", "\\_")


def tex(s: str, brk: bool = True) -> str:
    s = str(s)
    for a, b in (("\\", ""), ("&", "\\&"), ("%", "\\%"), ("$", "\\$"), ("#", "\\#"), ("_", "\\_"),
                 ("{", "\\{"), ("}", "\\}")):
        s = s.replace(a, b)
    if brk:  # long file names: allow breaks after '_', '.' and '/'
        for c in ("\\_", ".", "/"):
            s = s.replace(c, c + "\\allowbreak{}")
    return s


def summary(s: str) -> str:
    """'30280 MS2 spectra, 1067383 tags -> 33720 after filtering' -> thousands separators, no arrow."""
    import re
    s = s.replace(" -> ", ", ")
    return re.sub(r"\d{4,}", lambda m: f"{int(m.group()):,}", s)


def table_s1_tex(res: Path) -> str:
    """Table S1 as a raw LaTeX longtable (64-digit digests on two lines)."""
    g, _ = load(res, "gate_refs_v190.tsv")
    cols = "".join(">{\\raggedright\\arraybackslash}p{%s}" % w
                   for w in ("2.3cm", "4.3cm", "4.3cm", "2.4cm", "3.6cm", "5.0cm", "0.9cm"))
    head = ("Case & Data set and input & Options & MS2 spectra, tags & Output & Reference SHA-256 & 1.9.0 "
            "\\\\ \\hline")
    lines = ["{\\setlength{\\tabcolsep}{3pt}", f"\\begin{{longtable}}{{{cols}}}", "\\hline", head,
             "\\endhead", "\\hline", "\\endfoot"]
    for case, sub in g.groupby("case", sort=False):
        first = True
        for _, r in sub.iterrows():
            args = r["args"].replace("\\", "").replace("$GATE_IN/", "")
            d = r["reference_sha256"]
            cells = ([tex(case), f"{r['pxd']}: {tex(r['input'].split('/', 1)[1])}", tex(args, brk=False),
                      tex(summary(r["summary"]), brk=False)] if first else ["", "", "", ""])
            cells += [tex(r["output"]), f"\\texttt{{{d[:32]}}}\\newline\\texttt{{{d[32:]}}}", r["status_v190"]]
            lines.append(" & ".join(cells) + " \\\\")
            first = False
        lines.append("\\hline")
    lines += ["\\end{longtable}}"]
    return "\n".join(lines)


def table_s5_md(res: Path) -> str:
    _, prt = load(res, "runtime_pxd047793_v190.tsv")
    lad, plad = load(res, "ladder_summary_v190.tsv")
    _, pm = load(res, "memory_sampled_v190.tsv")
    raw, _ = load(res, "ladder_raw_v190.tsv")
    ft = raw[raw["tool"] == "fastag"]
    dt = raw[raw["tool"] == "directag"]
    rows = [
        ("Hardware",
         "1 × AMD EPYC 7763 (64 cores, 128 logical CPUs, 1 NUMA node), 995 GB RAM",
         "2 × AMD EPYC 9654 (192 cores, 384 logical CPUs, 2 NUMA nodes), 2.27 TB RAM",
         "as thread ladder (same node)"),
        ("Operating system, storage",
         "Linux 6.8.0 (Ubuntu 24.04); inputs on node-local NVMe SSD; temporary files in /dev/shm",
         "Linux 6.8.0; inputs on node-local NVMe SSD; temporary files in /dev/shm; no CPU pinning",
         "as thread ladder"),
        ("Programs",
         "FASTag 1.9.0 and 1.8.0 release bundles; DirecTag 1.4.21142 (bioconda bumbershoot, LC_ALL=C)",
         f"FASTag 1.9.0 release bundle ({len(ft)} runs); DirecTag 1.4.21142 ({len(dt)} runs reused from the "
         "FASTag 1.8.0 ladder on the same node and inputs)",
         "FASTag 1.9.0; DirecTag 1.4.21142"),
        ("Data sets and inputs",
         "PXD047793 (diaTracer 2.2.1 pseudo-MS2 mzML, 24.7 GB, 3,086,644 MS2 spectra); PXD003531 (Q Exactive "
         "mzML, 27,345 MS2 spectra)",
         "PXD003531, PXD028735, PXD047793, PXD054073, PXD076528; mzML, point and chunked mzPeak "
         "(mzpeak-convert 0.18.0); patched-input controls",
         "PXD003531, PXD076528, PXD047793 (FASTag at defaults: mzML, point and chunked mzPeak; FASTag at matched "
         "settings: PXD047793 mzML); DirecTag: PXD003531, PXD076528 (header-patched copy)"),
        ("Settings profiles", "FASTag at matched speed settings and at defaults; DirecTag at matched settings "
         "(Table S2)", "as runtime analysis", "as runtime analysis"),
        ("Thread counts and repetitions",
         "1 and 32 threads; 3 repetitions per cell (medians); warm-up run first; cold-cache and diagnostic runs separate",
         "1, 2, 4, …, 256, 384 threads (matched profile: 1, 8, 32, 64, 384); 3 repetitions per cell, 1 or 2 in "
         "the slowest cells and the controls; minimum wall time reported",
         "FASTag at defaults 1, 4, 16, 64, 384; FASTag at matched settings 1, 8, 32, 64, 384; DirecTag 1, 32, "
         "64, 384; 1 or 2 runs per cell"),
        ("Load gate",
         "serial runs; each started when the 1-min load average was below 0.25 per logical CPU",
         "serial runs; FASTag 1.9.0 runs waited for a 1-min load below 0.05 per logical CPU; the summary keeps "
         "runs with load below 0.25 per CPU before the run and fewer than 0.25 × 384 running threads of other "
         "processes before and after (DirecTag runs: gate 0.25)",
         "serial runs; 1-min load average and running threads below 0.05 per logical CPU before each run"),
        ("Wall time and phases",
         "/usr/bin/time -v; FASTag phase timer (FASTAG_TIMING=1); DirecTag phases from its time-stamped, "
         "line-buffered log; stack sampling with gdb",
         "/usr/bin/time -v; FASTag phase timer (FASTAG_TIMING=1)",
         "/usr/bin/time -v (wall times not used)"),
        ("Peak memory",
         "maximum of /proc VmRSS sampled every 0.5 s (FASTag, with smaps_rollup) or 2 s (DirecTag); ru_maxrss "
         "recorded as a lower bound",
         "ru_maxrss from /usr/bin/time -v (a lower bound on Linux 6.2 and later)",
         "maximum of /proc/[pid]/status VmRSS sampled every 50 ms; cross-checks: smaps_rollup page-table walk "
         "(3 runs), 5 ms sampling (5 runs); ru_maxrss recorded"),
        ("Output check", "SHA-256 of the tag table per run",
         "SHA-256 of the tag table per run (Figure S1)",
         "every FASTag run gave the tag-table digest of its ladder cell"),
        ("Dates (UTC)", "2026-11-04 06:31 to 11:28",
         "FASTag 1.9.0: 2026-11-04 04:34 to 13:14; DirecTag: 2026-11-03 19:51 to 2026-11-04 04:29",
         "2026-11-04 16:27 to 19:36"),
        ("Result tables (harness)", "results/runtime\\_pxd047793\\_v190.tsv",
         "results/ladder\\_raw\\_v190.tsv, ladder\\_summary\\_v190.tsv", "results/memory\\_sampled\\_v190.tsv"),
    ]
    out = ["| | Runtime analysis | Thread ladder | Sampled-memory re-measurement |",
           "|:-------------|:---------------------------|:---------------------------|:---------------------------|"]
    out += ["| " + " | ".join([f"**{a}**", b, c, d]) + " |" for a, b, c, d in rows]
    return "\n".join(out)


def si_pdf(res: Path, figs: Path, out: Path, pdf: bool) -> None:
    for k, (name, _) in FIGURES.items():
        for ext in ("pdf", "png"):
            src = figs / f"{name}.{ext}"
            if not src.exists():
                raise FileNotFoundError(f"{src}: render it first (fastag-bench figures)")
            shutil.copyfile(src, out / f"Figure_{k}.{ext}")
    parts = ["---", "title: 'Supporting Information: Figures S1–S4, Tables S1 and S5'",
             "subtitle: 'FASTag: Scalable, Deterministic Sequence Tagging of Current MS/MS Data, with a Public-Data Test of Run-Level Inference'",
             "geometry: margin=2cm", "mainfont: Arial", "monofont: Menlo", "fontsize: 10pt",
             "header-includes:", "  - \\usepackage{pdflscape}", "  - \\usepackage{float}",
             "  - \\floatplacement{figure}{H}", "  - \\renewcommand{\\arraystretch}{1.25}", "---", ""]
    for k, (name, legend) in FIGURES.items():
        size = {"S4": "width=10cm", "S1": "width=100% height=15cm keepaspectratio=true"}.get(
            k, "width=100% height=17cm keepaspectratio=true")
        parts += [f"![](Figure_{k}.pdf){{{size}}}", "",
                  legend, "", "\\newpage", ""]
    raw = lambda *t: ["```{=latex}", *t, "```", ""]  # noqa: E731  (raw blocks keep the tables Markdown)
    parts += raw("\\begin{landscape}", "\\scriptsize")
    parts += [
              "**Table S1.** Byte-identity gate: cases, options, reference digests and status on FASTag 1.9.0. Each "
              "case runs FASTag 1.9.0 at 32 threads on a public input (SHA-256-checked) and compares the log "
              "summary, the exit code and the SHA-256 digest of every output with the stored reference (mzML "
              "output: digest after masking the completion time and the software version; mzPeak output: "
              "content digest of each member, i.e., the decoded Parquet table or the parsed JSON index). "
              "Status = result of the verification run of the release binary against the 1.9.0 references.",
              ""]
    parts += raw(table_s1_tex(res))
    parts += raw("\\normalsize", "\\end{landscape}", "\\newpage", "\\begin{landscape}", "\\footnotesize")
    parts += [
              "**Table S5.** Benchmark hardware and load protocols: runtime node; thread-ladder node with FASTag "
              "1.9.0 runs and reused DirecTag 1.4.21142 runs; sampled-memory re-measurement on the thread-ladder "
              "node.", "", table_s5_md(res), ""]
    parts += raw("\\normalsize", "\\end{landscape}")
    md = out / "FASTag-JPR-SI-figures-tables.md"
    md.write_text("\n".join(parts))
    print(md)
    if not pdf:
        return
    if not (shutil.which("pandoc") and shutil.which("xelatex")):
        print("pandoc or xelatex not found: PDF not written", file=sys.stderr)
        return
    pdfp = md.with_suffix(".pdf")
    tmp = pdfp.with_suffix(".tmp.pdf")
    p = subprocess.run(["pandoc", md.name, "-o", tmp.name, "--pdf-engine=xelatex"], capture_output=True, text=True,
                       cwd=out)
    if p.returncode or "Missing character" in p.stderr:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"pandoc failed:\n{p.stderr}")
    tmp.replace(pdfp)
    print(pdfp)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", default=str(HERE.parent / "results"))
    ap.add_argument("--figures", default=str(HERE.parent / "figures"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-pdf", action="store_true", help="write the Markdown of the SI PDF, not the PDF")
    ap.add_argument("--only", help="comma list of S2,S3,S4,S6,S7,PDF")
    a = ap.parse_args()
    res, out = Path(a.results), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    only = set(a.only.split(",")) if a.only else {"S2", "S3", "S4", "S6", "S7", "PDF"}
    for k, fn in (("S2", table_s2), ("S3", table_s3), ("S4", table_s4), ("S6", table_s6), ("S7", table_s7)):
        if k in only:
            fn(res, out)
    if "PDF" in only:
        si_pdf(res, Path(a.figures), out, not a.no_pdf)


if __name__ == "__main__":
    main()
