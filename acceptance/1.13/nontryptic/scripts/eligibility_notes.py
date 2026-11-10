#!/usr/bin/env python3
"""eligibility_notes.py <draw_order.tsv> -> eligibility.tsv (stdout): the manual reading of the PRIDE records
(title, sample processing protocol, file names; no data file was opened), in the seeded order, against rules E1-E3
of PREREG-nontryptic.md. Reading stops per protease once three eligible projects and one reserve are found."""
import csv, sys
P = "E1: purified or recombinant protein, immunoprecipitate, in-vitro assay, antibody or excised gel band of one protein"
D = {
 "Arg-C": {"PXD008965": ("no", "E1: in-vitro assay on purified histone H4"),
           "PXD059514": ("yes", "histone acid extract of MEC-1 cells (biochemical fraction), Arg-C alone; files with TMA derivatisation excluded by name")},
 "Asp-N": {"PXD065426": ("no", "E1: amyloid gel band"), "PXD020128": ("no", P), "PXD065432": ("no", "E1: amyloid gel band"),
           "PXD034420": ("no", P), "PXD040583": ("yes", "HeLa lysate, Asp-N alone; positive-mode files only"),
           "PXD064794": ("yes", "WTC-11 cell proteome, Asp-N alone, high-pH fractions"), "PXD002228": ("no", P), "PXD022784": ("no", P),
           "PXD065431": ("no", "E1: amyloid gel band"), "PXD065428": ("no", "E1: amyloid gel band")},
 "Glu-C": {"PXD018506": ("no", P), "PXD020128": ("no", P), "PXD015759": ("yes", "testis tissue lysate, gel fractions, Glu-C alone"),
           "PXD018418": ("no", "E2: lectin (Jacalin) enrichment"), "PXD001281": ("no", "E1/E2: SUMO affinity purification, Lys-C then Glu-C"),
           "PXD008333": ("yes", "seminal plasma / spermatozoa digest with Glu-C alone; recombinant TEX101 files excluded by name"),
           "PXD051771": ("no", P), "PXD073937": ("no", P), "PXD025078": ("no", P),
           "PXD048926": ("yes", "HeLa lysate, Glu-C alone"), "PXD077483": ("no", P), "PXD009800": ("no", P), "PXD034086": ("no", P),
           "PXD066494": ("no", P), "PXD040583": ("reserve", "HeLa lysate, Glu-C alone; positive-mode files only")},
 "Lys-C": {"PXD042838": ("no", "E3: trypsin/Lys-C mixture; LCQ instrument"), "PXD015759": ("yes", "testis tissue lysate, gel fractions, Lys-C alone"),
           "PXD001281": ("no", "E1/E2: SUMO affinity purification"), "PXD006465": ("yes", "testis tissue lysate, gel fractions, Lys-C alone"),
           "PXD040583": ("yes", "HeLa lysate, Lys-C alone; positive-mode files only"), "PXD048926": ("reserve", "HeLa lysate, Lys-C alone")},
 "Chymotrypsin": {"PXD064794": ("yes", "WTC-11 cell proteome, chymotrypsin alone, high-pH fractions"),
           "PXD012615": ("no", "E3: MED-FASP, consecutive Lys-C, trypsin, chymotrypsin"), "PXD008434": ("no", "E3: MED-FASP, consecutive digestion"),
           "PXD013234": ("no", "E3: MED-FASP, consecutive Lys-C, trypsin, chymotrypsin"), "PXD069405": ("no", "E2: TMT"), "PXD069591": ("no", "E2: TMT"),
           "PXD077924": ("no", "E2: SILAC"), "PXD058868": ("no", "E2: N-terminal peptide enrichment, isotope label"),
           "PXD014526": ("no", "E1/E2: biotin pull-down, SILAC"),
           "PXD012571": ("no", "E1: HPLC fractions of plasma prepared for single peptide hormones (about 0.2 ug protein)"),
           "PXD055345": ("no", "E3: sarkosyl-insoluble brain fraction treated with pronase before chymotrypsin"),
           "PXD040102": ("no", "E3: sarkosyl-insoluble brain fraction treated with pronase before chymotrypsin"),
           "PXD046041": ("no", "E1: excised protamine gel bands"), "PXD034130": ("no", P), "PXD036289": ("no", P)},
}
print("protease\torder\taccession\tpool\teligible\treason")
stop = {}
for r in csv.DictReader(open(sys.argv[1]), delimiter="\t"):
    p, a = r["protease"], r["accession"]
    if p not in D: print(p, r["order"], a, r["pool"], "not_read", "protease without eligible record in the pools", sep="\t"); continue
    if stop.get(p): print(p, r["order"], a, r["pool"], "not_read", "after the third eligible project and the reserve", sep="\t"); continue
    e, why = D[p].get(a, ("no", P) if p == "Chymotrypsin" else ("?", "?"))
    print(p, r["order"], a, r["pool"], e, why, sep="\t")
    if e == "reserve": stop[p] = True
