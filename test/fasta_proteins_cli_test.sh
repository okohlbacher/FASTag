#!/usr/bin/env bash
# -fasta_proteins (1.16): the -fasta proteins, positions and genes of each
# written database hit, on Ecoli_MS2_small.{mzML,fasta} against the real binary:
#   a. without the option (and at 0) -out is unchanged: no db_* columns, and
#      the run with the option is that file plus three columns per row;
#   b. every fwd/rev row names at most n proteins, no more than its
#      db_protein_count (>= 1); the database at start..end, I/L folded, is the
#      tag (fwd) or the reversed tag (rev) -- exactly at -isobaric_tolerance 0,
#      and for an equal-length match at the default tolerance (a longer one is
#      a collapse respelling, at most two residues per tag residue); db_genes
#      are the GN= of the listed entries;
#   c. with -entrapment_fasta, efwd/erev rows name only entrapment proteins,
#      fwd/rev rows only target proteins;
#   d. a -fasta with rev_ decoys listed before their targets names the targets
#      first, and counts both;
#   e. -fasta_proteins without -fasta is refused;
#   f. the -recon_out index (same -fasta) gives the same columns, and
#      -threads 1 and 4 agree;
#   g. two entries of one identifier, the hits in the second only: the
#      column names the identifier with the second entry's positions (it
#      cannot tell the entries apart), and the run warns once that the
#      identifier repeats.
# Exits 77 (ctest SKIP) when the binary cannot start or without python3.
set -u
BIN="$1"
IN="$2"      # Ecoli_MS2_small.mzML
DB="$3"      # Ecoli_MS2_small.fasta
DATA="$4"    # data/digest
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
PY="${FASTAG_PYTHON:-python3}"
"$PY" -c 'import sys; sys.exit(sys.version_info < (3, 6))' 2>/dev/null || { echo "SKIP: no python3" >&2; exit 77; }
export FASTAG_DIGEST_DIR="$DATA"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-dbprot-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ARGS=(-in "$IN" -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
run() { # out log args...
  local out=$1 log=$2; shift 2
  "$BIN" "${ARGS[@]}" -out "$out" "$@" > "$log" 2>&1 || { cat "$log" >&2; fail "run $(basename "$out"): exit non-zero"; }
}

# Fixture FASTAs: the target with a GN= per entry (its gene, the second
# header word); the target split into two proteins and an entrapment third;
# decoy copies (identical sequences, rev_ identifiers) ahead of the targets.
"$PY" - "$DB" "$TMP" <<'EOF' || fail "fixture FASTAs"
import sys
db, tmp = sys.argv[1], sys.argv[2]
entries = []
for line in open(db):
    line = line.rstrip("\n")
    if line.startswith(">"):
        entries.append([line[1:], ""])
    elif entries:
        entries[-1][1] += line.strip()
assert len(entries) == 3, len(entries)
def write(path, es):
    with open(path, "w") as f:
        for h, s in es:
            f.write(">" + h + "\n" + s + "\n")
gn = [[h + " GN=" + h.split()[1], s] for h, s in entries]
write(tmp + "/gn.fasta", gn)
write(tmp + "/tgt.fasta", gn[:2])
write(tmp + "/ent.fasta", [["ENT_" + h, s] for h, s in gn[2:]])
write(tmp + "/decoy.fasta", [["rev_" + h, s] for h, s in gn] + gn)
# The first protein's identifier also on an entry ahead of it that no tag hits.
first = gn[0][0].split()[0]
write(tmp + "/dup.fasta", [[first + " a decoy copy", "W" * 40]] + gn)
EOF

# a. unchanged without the option
run "$TMP/plain.tsv" "$TMP/plain.log" -fasta "$TMP/gn.fasta"
run "$TMP/zero.tsv" "$TMP/zero.log" -fasta "$TMP/gn.fasta" -fasta_proteins 0
cmp -s "$TMP/plain.tsv" "$TMP/zero.tsv" || fail "-fasta_proteins 0 changed -out"
head -1 "$TMP/plain.tsv" | grep -q 'db_' && fail "db_* columns without -fasta_proteins"
run "$TMP/p3.tsv" "$TMP/p3.log" -fasta "$TMP/gn.fasta" -fasta_proteins 3
awk -F'\t' -v OFS='\t' '{ NF -= 3; print }' "$TMP/p3.tsv" > "$TMP/p3_cut.tsv"
cmp -s "$TMP/plain.tsv" "$TMP/p3_cut.tsv" || fail "-fasta_proteins changed more than its three last columns"
head -1 "$TMP/p3.tsv" | grep -q $'\tdb_proteins\tdb_genes\tdb_protein_count$' || fail "header lacks the db_* columns"

# b. positions, orientation, counts, genes
check() { # tsv fasta n strict [entrapment_fasta]
  "$PY" - "$@" <<'EOF'
import sys
tsv, fasta, n, strict = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4] == "1"
ent = sys.argv[5] if len(sys.argv) > 5 else None
def load(path):
    seqs, genes, order, cur = {}, {}, [], None
    for line in open(path):
        line = line.rstrip("\n")
        if line.startswith(">"):
            cur = line[1:].split()[0]
            order.append(cur)
            seqs[cur] = ""
            g = [w[3:] for w in line[1:].split() if w.startswith("GN=")]
            genes[cur] = g[0] if g else "-"
        else:
            seqs[cur] += line.strip()
    return seqs, genes, order
tgt = load(fasta)
entd = load(ent) if ent else ({}, {}, [])
rows = [l.rstrip("\n").split("\t") for l in open(tsv)]
head = rows[0]
c = {k: i for i, k in enumerate(head)}
fold = lambda s: s.upper().replace("I", "L")
nrows = 0
errs = []
for r in rows[1:]:
    hit, tag = r[c["fasta_hit"]], fold(r[c["tag"]])
    prots, genes, count = r[c["db_proteins"]], r[c["db_genes"]], int(r[c["db_protein_count"]])
    if hit not in ("fwd", "rev", "efwd", "erev"):
        errs.append("row without a hit: %s" % r); continue
    nrows += 1
    seqs, gmap, _ = entd if hit.startswith("e") else tgt
    want = tag if hit in ("fwd", "efwd") else tag[::-1]
    if count < 1 or prots == "-":
        errs.append("hit without a protein: %s %s" % (tag, hit)); continue
    ps, gs = prots.split(";"), genes.split(";")
    if len(ps) > n or len(ps) > count or len(ps) != len(gs) or (count > len(ps) and len(ps) < n):
        errs.append("list/count mismatch: %s %s %d" % (tag, prots, count)); continue
    for p, g in zip(ps, gs):
        acc, rng = p.rsplit("@", 1)
        s, e = map(int, rng.split("-"))
        if acc not in seqs:
            errs.append("%s (%s) names %s, not in its database" % (tag, hit, acc)); continue
        seg = fold(seqs[acc][s - 1:e])
        if len(seg) != e - s + 1 or len(seg) < len(want) or len(seg) > 2 * len(want):
            errs.append("bad range %s for %s" % (p, tag))
        elif (strict or len(seg) == len(want)) and seg != want:
            errs.append("%s at %s reads %s, want %s (%s)" % (tag, p, seg, want, hit))
        if g != gmap[acc]:
            errs.append("gene %s for %s, want %s" % (g, acc, gmap[acc]))
if nrows == 0:
    errs.append("no rows with a database hit")
for e in errs[:20]:
    print(e, file=sys.stderr)
sys.exit(1 if errs else 0)
EOF
}
check "$TMP/p3.tsv" "$TMP/gn.fasta" 3 0 || fail "b: default isobaric tolerance"
awk -F'\t' 'NR > 1 && $14 != "-"' "$TMP/p3.tsv" | grep -q . || fail "b: no gene name written"
run "$TMP/iso0.tsv" "$TMP/iso0.log" -fasta "$TMP/gn.fasta" -fasta_proteins 3 -isobaric_tolerance 0
check "$TMP/iso0.tsv" "$TMP/gn.fasta" 3 1 || fail "b: -isobaric_tolerance 0"
awk -F'\t' 'NR > 1 && $12 == "rev"' "$TMP/iso0.tsv" | grep -q . || fail "b: no rev row to check the orientation on"

# c. entrapment rows name entrapment proteins
run "$TMP/ent.tsv" "$TMP/ent.log" -fasta "$TMP/tgt.fasta" -entrapment_fasta "$TMP/ent.fasta" -fasta_proteins 3
check "$TMP/ent.tsv" "$TMP/tgt.fasta" 3 0 "$TMP/ent.fasta" || fail "c: entrapment attribution"
awk -F'\t' 'NR > 1 && $12 ~ /^e/' "$TMP/ent.tsv" | grep -q . || fail "c: no entrapment row"
awk -F'\t' 'NR > 1 && $12 !~ /^e/' "$TMP/ent.tsv" | grep -q . || fail "c: no target row"
head -1 "$TMP/ent.tsv" | grep -q $'\tdb_protein_count\tq_db$' || fail "c: q_db is not last"

# d. targets before decoys
run "$TMP/dec.tsv" "$TMP/dec.log" -fasta "$TMP/decoy.fasta" -fasta_proteins 3
check "$TMP/dec.tsv" "$TMP/decoy.fasta" 3 0 || fail "d: decoy database"
"$PY" - "$TMP/dec.tsv" <<'EOF' || fail "d: decoys listed before targets"
import sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1])]
c = {k: i for i, k in enumerate(rows[0])}
both = 0
for r in rows[1:]:
    ps = [p.rsplit("@", 1)[0] for p in r[c["db_proteins"]].split(";")]
    d = [p.startswith("rev_") for p in ps]
    if d != sorted(d):
        sys.exit("decoy before target: %s" % r[c["db_proteins"]])
    if int(r[c["db_protein_count"]]) < 2:
        sys.exit("a tag of a duplicated protein counts %s" % r[c["db_protein_count"]])
    if d and not d[0]:
        both += 1
sys.exit(0 if both else "no row lists a target")
EOF
run "$TMP/dec1.tsv" "$TMP/dec1.log" -fasta "$TMP/decoy.fasta" -fasta_proteins 1
awk -F'\t' 'NR > 1 && ($13 ~ /^rev_/ || $13 ~ /;/ || $15 < 2)' "$TMP/dec1.tsv" | grep -q . \
  && fail "d: -fasta_proteins 1 named a decoy, several proteins or a count below 2"

# e. refused without -fasta
"$BIN" "${ARGS[@]}" -out "$TMP/nof.tsv" -fasta_proteins 3 > "$TMP/nof.log" 2>&1; rc=$?
[ $rc = 6 ] || { cat "$TMP/nof.log" >&2; fail "e: -fasta_proteins without -fasta exit $rc, want 6"; }
grep -q "fasta_proteins" "$TMP/nof.log" || fail "e: the refusal does not name -fasta_proteins"

# f. the reconciliation index and threads give the same columns
run "$TMP/rec.tsv" "$TMP/rec.log" -fasta "$TMP/gn.fasta" -fasta_proteins 3 -recon_out "$TMP/rec_recon.tsv"
grep -q "the reconciliation index" "$TMP/rec.log" || fail "f: the -recon_out index was not reused"
cut -f13-15 "$TMP/p3.tsv" > "$TMP/p3_db.txt"; cut -f13-15 "$TMP/rec.tsv" > "$TMP/rec_db.txt"
cmp -s "$TMP/p3_db.txt" "$TMP/rec_db.txt" || fail "f: the reconciliation index gives other proteins"
ARGS=(-in "$IN" -tag_length 4 -extension 1 -fragment_tolerance 0.3 -fragment_tolerance_unit Da)
run "$TMP/t1.tsv" "$TMP/t1.log" -fasta "$TMP/gn.fasta" -fasta_proteins 3 -threads 1
run "$TMP/t4.tsv" "$TMP/t4.log" -fasta "$TMP/gn.fasta" -fasta_proteins 3 -threads 4
cmp -s "$TMP/t1.tsv" "$TMP/t4.tsv" || fail "f: -threads 1 and 4 differ"
# g. a repeated identifier
run "$TMP/dup.tsv" "$TMP/dup.log" -fasta "$TMP/dup.fasta" -fasta_proteins 3
[ "$(grep -c 'repeat an earlier identifier' "$TMP/dup.log")" = 1 ] || { cat "$TMP/dup.log" >&2; fail "g: no single warning of the repeated identifier"; }
grep -q '1 entry of the -fasta repeat an earlier identifier' "$TMP/dup.log" || fail "g: the warning does not count the entry"
grep -q 'repeat an earlier identifier' "$TMP/p3.log" && fail "g: a warning without a repeated identifier"
"$PY" - "$TMP/dup.tsv" "$TMP/gn.fasta" <<'EOF' || fail "g: the repeated identifier's positions"
import sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1])]
c = {k: i for i, k in enumerate(rows[0])}
first, second = None, ""
for line in open(sys.argv[2]):
    line = line.rstrip("\n")
    if line.startswith(">"):
        if first is not None:
            break
        first = line[1:].split()[0]
    else:
        second += line.strip()
fold = lambda s: s.upper().replace("I", "L")
seen = 0
for r in rows[1:]:
    for p in r[c["db_proteins"]].split(";"):
        acc, rng = p.rsplit("@", 1)
        if acc != first:
            continue
        s, e = map(int, rng.split("-"))
        tag = fold(r[c["tag"]])
        want = tag if r[c["fasta_hit"]] == "fwd" else tag[::-1]
        seg = fold(second[s - 1:e])
        # Only the second entry has these residues (the first is all W).
        if len(seg) == len(want):
            if seg != want:
                sys.exit("%s at %s reads %s in the second entry" % (tag, p, seg))
            seen += 1
sys.exit(0 if seen else "no hit on the repeated identifier")
EOF

echo "fasta_proteins_cli_test: passed"
