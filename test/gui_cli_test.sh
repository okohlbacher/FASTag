#!/usr/bin/env bash
# The two GUI interfaces of FASTag 1.12 G1 (-probe_input, -dump_spectrum)
# and the shipped digest data in the installed layouts, against the real
# binary:
#   (a) --helphelp lists both flags (the GUI's capability probe), and a run
#       with both at their default ("") is byte-identical to a run without
#   (b) -probe_input: exit 0, stdout is JSON lines only (format 1, the
#       probe record first and the end record last, the GUI's records and
#       types), no file written; the values for the Ecoli mzML and MGF,
#       profile MS2 under legacy and auto, raw DIA (refuse, still exit 0;
#       warn does not refuse), the index states ok, absent and stale,
#       -fasta counts, and a FASTA alone (probe, fasta and end records)
#   (c) -probe_input refusals: a missing file, an unsupported or compressed
#       one, a corrupt mzML, with -dump_spectrum, under -stream; nothing on
#       stdout for any of them
#   (d) -dump_spectrum: the schema {mz, int, precursor, charge, native_id,
#       tolerance, tolerance_unit, ...}; the peaks are the peaks the tagger
#       tags, checked against the run's own -census row of every dumped
#       spectrum (n_peaks_kept, precursor_mz, charge_used) at the CLI
#       default and at 0.3 Da, with -pick_profile auto on profile MS2 (the
#       picked peaks), and against the tag ladders of the run's tag TSV
#       (every unmodified tag's b or y ladder lies on dumped peaks within
#       the tolerance; both ends of it for a gapped tag); the MGF twin and the mzPeak export
#       give the same peaks; threads 1/3/8 give the same bytes; no file is
#       written, -out included; with the 1.12 #6 options in the binary,
#       -unknown_charge or -isotope_error away from the default exits 6
#   (e) -dump_spectrum refusals: an unknown native ID (exit 6, the ID on
#       stderr, nothing on stdout), no -in, under -stream; an MS1 is
#       dumped with tagged false and no peaks
#   (f) the shipped digest data is found without FASTAG_DIGEST_DIR in the
#       three installed layouts (cmake --install's bin/ + share/FASTag/digest
#       as CMakeLists.txt installs it, the flat release tarball and Homebrew
#       cask's FASTag.bin + share-FASTag-digest, the GUI bundle's
#       resources/fastag/bin + share/FASTag/digest), and not in a bare copy
# Exits 77 (ctest SKIP) when the binary cannot start or Python 3 is missing.
set -u
BIN="$1"
FIX="$2"        # test/fixtures
DIGEST="$3"     # data/digest
CMAKELISTS="$4" # CMakeLists.txt (install destination of the digest data)

if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi
PY=${FASTAG_PYTHON:-python3}
if ! "$PY" -c 'import json' >/dev/null 2>&1; then
  echo "SKIP: no Python 3 for the JSON checks" >&2
  exit 77
fi
TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-gui-cli.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
IN="$FIX/Ecoli_MS2_small.mzML"
MGF="$FIX/Ecoli_MS2_small.mgf"
DB="$FIX/Ecoli_MS2_small.fasta"

# The JSON checks: gui_json.py <mode> <file> [args]; prints what a shell
# check compares, exits 1 with the reason on a schema violation.
cat > "$TMP/gui_json.py" <<'PYEOF'
import json, math, sys

def load(path):
    recs = []
    with open(path, "rb") as f:
        data = f.read()
    if not data.endswith(b"\n"):
        sys.exit("stream does not end with a newline")
    for n, line in enumerate(data.decode("utf-8").split("\n")[:-1], 1):
        try:
            o = json.loads(line)
        except ValueError as e:
            sys.exit("line %d is not JSON: %s: %r" % (n, e, line[:120]))
        if not isinstance(o, dict) or not isinstance(o.get("record"), str):
            sys.exit("line %d is not an object with a record key" % n)
        recs.append(o)
    if not recs:
        sys.exit("empty stream")
    if recs[-1] != {"record": "end"}:
        sys.exit("the last record is not {\"record\":\"end\"}")
    return recs

def by(recs, name):
    hits = [r for r in recs if r["record"] == name]
    if len(hits) != 1:
        sys.exit("%d %s records" % (len(hits), name))
    return hits[0]

def typed(rec, key, types, nullable=False):
    if key not in rec:
        sys.exit("%s.%s missing" % (rec["record"], key))
    v = rec[key]
    if v is None and nullable:
        return v
    if isinstance(v, bool) and bool not in types:
        sys.exit("%s.%s is a bool" % (rec["record"], key))
    if not isinstance(v, types):
        sys.exit("%s.%s has type %s" % (rec["record"], key, type(v).__name__))
    return v

def count(rec, key):
    v = typed(rec, key, (int,))
    if v < 0:
        sys.exit("%s.%s < 0" % (rec["record"], key))
    return v

def probe(path):
    recs = load(path)
    p = recs[0]
    if p["record"] != "probe" or p.get("format") != 1:
        sys.exit("the first record is not the format-1 probe record")
    typed(p, "version", (str,)); typed(p, "input", (str,))
    if typed(p, "file_format", (str,)) not in ("mzML", "mzPeak", "MGF"):
        sys.exit("file_format " + p["file_format"])
    i = by(recs, "instrument")
    for k in ("name", "model", "ms2_analyzer", "ion_mobility"):
        typed(i, k, (str,), nullable=True)
    s = by(recs, "spectra")
    for k in ("ms1", "ms2", "ms2_probed", "ms2_centroid", "ms2_profile", "ms2_type_unknown"):
        count(s, k)
    if s["ms2_centroid"] + s["ms2_profile"] + s["ms2_type_unknown"] != s["ms2_probed"]:
        sys.exit("spectrum types do not add up to ms2_probed")
    if s["ms2_probed"] > s["ms2"]:
        sys.exit("more MS2 probed than the file holds")
    typed(s, "verdict", (str,)); typed(s, "will_pick", (bool,))
    a = by(recs, "activation")
    if sum(count(a, k) for k in ("collisional", "electron", "hybrid", "unknown")) != count(a, "of"):
        sys.exit("activation classes do not add up")
    if typed(by(recs, "index"), "state", (str,)) not in ("ok", "stale", "absent", "not_applicable"):
        sys.exit("index state")
    q = by(recs, "acquisition")
    typed(q, "mode", (str,)); typed(q, "why", (str,)); typed(q, "warn", (bool,)); typed(q, "refuse", (bool,))
    count(q, "windows"); typed(q, "median_width", (int, float), nullable=True)
    out = {"format": p["file_format"], "name": i["name"], "model": i["model"], "analyzer": i["ms2_analyzer"],
           "ms1": s["ms1"], "ms2": s["ms2"], "verdict": s["verdict"], "will_pick": s["will_pick"],
           "collisional": a["collisional"], "index": by(recs, "index")["state"], "mode": q["mode"],
           "refuse": q["refuse"]}
    f = [r for r in recs if r["record"] == "fasta"]
    if f:
        out["proteins"] = f[0]["proteins"]; out["decoys"] = f[0]["decoys"]
    for k in sorted(out):
        print("%s=%s" % (k, json.dumps(out[k])))

def spectrum(path):
    recs = load(path)
    if len(recs) != 2:
        sys.exit("a dump has %d records, not spectrum + end" % len(recs))
    s = recs[0]
    if s["record"] != "spectrum" or s.get("format") != 1:
        sys.exit("the first record is not the format-1 spectrum record")
    typed(s, "native_id", (str,)); count(s, "index"); count(s, "ms_level")
    typed(s, "precursor", (int, float), nullable=True)
    count(s, "charge"); count(s, "charge_given")
    if typed(s, "tolerance", (int, float)) <= 0:
        sys.exit("tolerance <= 0")
    if typed(s, "tolerance_unit", (str,)) not in ("ppm", "Da"):
        sys.exit("tolerance_unit")
    for k in ("picked", "deisotoped", "tagged"):
        typed(s, k, (bool,))
    mz = typed(s, "mz", (list,)); it = typed(s, "int", (list,))
    if len(mz) != len(it) or len(mz) != count(s, "n"):
        sys.exit("mz, int and n disagree")
    if count(s, "n_read") < s["n"]:
        sys.exit("more peaks kept than read")
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in mz + it):
        sys.exit("a peak is not a finite number")
    if any(b <= a for a, b in zip(mz, mz[1:])):
        sys.exit("m/z not strictly ascending")
    print("native_id=%s" % json.dumps(s["native_id"]))
    print("precursor=%r" % s["precursor"])
    print("charge=%d" % s["charge"])
    print("n=%d" % s["n"])
    print("tagged=%s" % json.dumps(s["tagged"]))
    print("picked=%s" % json.dumps(s["picked"]))
    print("tolerance=%s %s" % (json.dumps(s["tolerance"]), s["tolerance_unit"]))
    print("index=%d" % s["index"])
    print("peaks=%s" % json.dumps([mz, it]))

def census_match(dumps_dir, census):
    # Every dumped spectrum against the run's census row of the same index.
    rows = {}
    with open(census) as f:
        head = f.readline().rstrip("\n").split("\t")
        for line in f:
            v = dict(zip(head, line.rstrip("\n").split("\t")))
            rows[v["spectrum"]] = v
    import glob
    n = 0
    for p in sorted(glob.glob(dumps_dir + "/*.jsonl")):
        s = load(p)[0]
        r = rows.get(s["native_id"])
        if r is None:
            sys.exit("no census row for " + s["native_id"])
        if int(r["index"]) != s["index"]:
            sys.exit("%s: index %s in the census, %d in the dump" % (s["native_id"], r["index"], s["index"]))
        kept = int(r["n_peaks_kept"]) if r["n_peaks_kept"] != "" else 0
        if kept != s["n"]:
            sys.exit("%s: the tagger kept %d peaks, the dump has %d" % (s["native_id"], kept, s["n"]))
        if abs(float(r["precursor_mz"]) - s["precursor"]) > 1e-9 or int(r["charge_used"]) != s["charge"]:
            sys.exit("%s: precursor or charge differ from the census" % s["native_id"])
        n += 1
    print(n)

# C carries the CLI's default fixed Carbamidomethyl (C) (the tag TSV still
# writes it as C), so every run here keeps -fixed_modifications at its default.
MONO = {"G": 57.02146372057, "A": 71.03711378471, "S": 87.03202840427, "P": 97.05276384885,
        "V": 99.06841391299, "T": 101.04767846841, "C": 160.03064850528, "L": 113.08406397713,
        "I": 113.08406397713, "N": 114.04292744114, "D": 115.02694302383, "Q": 128.05857750527,
        "K": 128.09496301399, "E": 129.04259308797, "M": 131.04048491299, "H": 137.05891185845,
        "F": 147.06841391299, "R": 156.10111102359, "Y": 163.06332853255, "W": 186.07931294986}
PROTON, WATER = 1.007276466812, 18.0105646837

def ladders(dumps_dir, tags):
    # Every unmodified tag of a dumped spectrum: its b ladder (nterm_mass +
    # prefix) or its y ladder (cterm_mass + suffix + water) lies on dumped
    # peaks within the dump's tolerance; for a gapped tag (it crossed one
    # missing peak) both ends of the ladder do.
    import glob
    dumps = {}
    for p in glob.glob(dumps_dir + "/*.jsonl"):
        s = load(p)[0]
        dumps[s["native_id"]] = s
    def near(mzs, x, tol, ppm):
        t = x * tol * 1e-6 if ppm else tol
        lo, hi = 0, len(mzs)
        while lo < hi:
            m = (lo + hi) // 2
            if mzs[m] < x - t: lo = m + 1
            else: hi = m
        return lo < len(mzs) and mzs[lo] <= x + t
    checked = 0
    with open(tags) as f:
        head = f.readline().rstrip("\n").split("\t")
        for line in f:
            v = dict(zip(head, line.rstrip("\n").split("\t")))
            s = dumps.get(v["spectrum"])
            seq = v["tag"]
            if s is None or any(c not in MONO for c in seq):
                continue
            z = int(v["charge"]); ppm = s["tolerance_unit"] == "ppm"; tol = s["tolerance"]
            # The printed flanks carry 4 decimals; allow that rounding on top.
            slack = 1e-4
            mzs = s["mz"]
            # Each step matches within the tolerance, so the k-th peak may
            # drift up to k + 1 tolerances from the ladder of the printed flank.
            gapped = v["gapped"] != "0"
            def on(masses):
                for k, m in enumerate(masses):
                    if gapped and 0 < k < len(masses) - 1:
                        continue
                    x = (m + z * PROTON) / z
                    t = (k + 1) * (x * tol * 1e-6 if ppm else tol) + slack / z
                    if not near(mzs, x, t, False):
                        return False
                return True
            b = [float(v["nterm_mass"]) + sum(MONO[c] for c in seq[:k]) for k in range(len(seq) + 1)]
            y = [float(v["cterm_mass"]) + WATER + sum(MONO[c] for c in seq[k:]) for k in range(len(seq) + 1)]
            if not (on(b) or on(y)):
                sys.exit("%s: tag %s (charge %d) has no ladder on the dumped peaks" % (v["spectrum"], seq, z))
            checked += 1
    print(checked)

mode = sys.argv[1]
if mode == "probe": probe(sys.argv[2])
elif mode == "spectrum": spectrum(sys.argv[2])
elif mode == "census": census_match(sys.argv[2], sys.argv[3])
elif mode == "ladders": ladders(sys.argv[2], sys.argv[3])
elif mode == "ms1id":
    import re
    text = open(sys.argv[2]).read()
    for m in re.finditer(r'<spectrum\s[^>]*?\bid="([^"]*)"(.*?)</spectrum>', text, re.S):
        if 'name="ms level" value="1"' in m.group(2):
            print(m.group(1)); break
else: sys.exit("mode " + mode)
PYEOF
J() { "$PY" -I "$TMP/gui_json.py" "$@"; }
val() { grep -m1 "^$2=" "$1" | cut -d= -f2-; }   # val <checked file> <key>

# Runs FASTag in an empty directory of its own: run_in <dir> <stdout> <stderr> args...; sets RC.
run_in() {
  local d="$1" o="$2" e="$3"; shift 3
  mkdir -p "$d"
  (cd "$d" && "$BIN" "$@" > "$o" 2> "$e" < /dev/null); RC=$?
}
only_files() { # only_files <dir> <expected listing, space separated>
  local got; got=$(ls -A "$1" | tr '\n' ' ' | sed 's/ $//')
  [ "$got" = "$2" ] || fail "$1 holds '$got', expected '$2'"
}

# ---- (a) capability probe and default identity --------------------------------
"$BIN" --helphelp > "$TMP/helphelp.txt" 2>&1
grep -qE '^ +-probe_input <file>' "$TMP/helphelp.txt" || fail "(a) --helphelp does not list -probe_input <file>"
grep -qE '^ +-dump_spectrum <nativeId>' "$TMP/helphelp.txt" || fail "(a) --helphelp does not list -dump_spectrum <nativeId>"
ARGS=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da -threads 2)
run_in "$TMP/a0" "$TMP/a0.out" "$TMP/a0.err" -in "$IN" -out tags.tsv "${ARGS[@]}"
[ $RC = 0 ] || { cat "$TMP/a0.err" >&2; fail "(a) the plain run failed"; }
run_in "$TMP/a1" "$TMP/a1.out" "$TMP/a1.err" -in "$IN" -out tags.tsv "${ARGS[@]}" -probe_input "" -dump_spectrum ""
[ $RC = 0 ] || { cat "$TMP/a1.err" >&2; fail "(a) the run with both flags at '' failed"; }
cmp -s "$TMP/a0/tags.tsv" "$TMP/a1/tags.tsv" || fail "(a) -probe_input '' -dump_spectrum '' changes the tag TSV"
# stdout but for TOPPBase's timing line ("FASTag took ... (wall), ...").
untimed() { grep -vE '^FASTag took .* \(wall\)' "$1"; }
cmp -s <(untimed "$TMP/a0.out") <(untimed "$TMP/a1.out") || fail "(a) -probe_input '' -dump_spectrum '' changes stdout"

# ---- (b) -probe_input ---------------------------------------------------------
probe() { # probe <name> <file> [args]: runs, requires exit 0 and no file, checks the schema
  local n="$1" f="$2"; shift 2
  run_in "$TMP/p_$n" "$TMP/p_$n.jsonl" "$TMP/p_$n.err" -probe_input "$f" "$@"
  [ $RC = 0 ] || { cat "$TMP/p_$n.err" >&2; fail "(b) -probe_input $n exited $RC"; }
  only_files "$TMP/p_$n" ""
  J probe "$TMP/p_$n.jsonl" > "$TMP/p_$n.v" || fail "(b) -probe_input $n: schema"
}
probe ecoli "$IN"
V="$TMP/p_ecoli.v"
[ "$(val "$V" format)" = '"mzML"' ] || fail "(b) Ecoli format $(val "$V" format)"
[ "$(val "$V" ms2)" = 139 ] && [ "$(val "$V" ms1)" = 0 ] || fail "(b) Ecoli counts ms2=$(val "$V" ms2) ms1=$(val "$V" ms1)"
[ "$(val "$V" ms2)" = "$(grep -c 'name="ms level" value="2"' "$IN")" ] || fail "(b) ms2 is not the file's MS2 count"
[ "$(val "$V" verdict)" = '"centroid"' ] && [ "$(val "$V" will_pick)" = false ] || fail "(b) Ecoli centroid verdict"
[ "$(val "$V" analyzer)" = '"orbitrap"' ] || fail "(b) Ecoli MS2 analyser $(val "$V" analyzer)"
[ "$(val "$V" index)" = '"ok"' ] || fail "(b) Ecoli index $(val "$V" index)"
[ "$(val "$V" refuse)" = false ] || fail "(b) Ecoli refused"
[ "$(val "$V" collisional)" = 139 ] || fail "(b) Ecoli activation: $(val "$V" collisional) collisional of 139"
grep -q '"name":' "$TMP/p_ecoli.jsonl" || fail "(b) no instrument name key"

probe mgf "$MGF"
V="$TMP/p_mgf.v"
[ "$(val "$V" format)" = '"MGF"' ] && [ "$(val "$V" ms2)" = 139 ] || fail "(b) MGF format/count"
[ "$(val "$V" index)" = '"not_applicable"' ] || fail "(b) MGF index $(val "$V" index)"

probe prof "$FIX/profile_ms2_small.mzML"
[ "$(val "$TMP/p_prof.v" verdict)" = '"profile"' ] && [ "$(val "$TMP/p_prof.v" will_pick)" = false ] \
  || fail "(b) profile MS2 under legacy: $(cat "$TMP/p_prof.v" | tr '\n' ' ')"
probe profauto "$FIX/profile_ms2_small.mzML" -pick_profile auto
[ "$(val "$TMP/p_profauto.v" will_pick)" = true ] || fail "(b) -pick_profile auto does not pick profile MS2"
probe mgfauto "$MGF" -pick_profile auto
[ "$(val "$TMP/p_mgfauto.v" will_pick)" = false ] || fail "(b) MGF is never picked"

probe dia "$FIX/dia_like.mzML"
[ "$(val "$TMP/p_dia.v" mode)" = '"DIA"' ] && [ "$(val "$TMP/p_dia.v" refuse)" = true ] \
  || fail "(b) raw DIA: mode $(val "$TMP/p_dia.v" mode) refuse $(val "$TMP/p_dia.v" refuse)"
probe diawarn "$FIX/dia_like.mzML" -acquisition_check warn
[ "$(val "$TMP/p_diawarn.v" refuse)" = false ] || fail "(b) -acquisition_check warn refuses"
probe pseudo "$FIX/diatracer_like.mzML"
[ "$(val "$TMP/p_pseudo.v" refuse)" = false ] || fail "(b) diatracer_like is refused"

# The index states: no index, and an index the file no longer matches.
grep -v -e '<indexList' -e '<index ' -e '<offset' -e '</index' -e '<indexListOffset' -e '<fileChecksum' \
  -e '<indexedmzML' -e '</indexedmzML' -e '<?xml-stylesheet' "$IN" > "$TMP/noindex.mzML"
grep -q '<offset' "$TMP/noindex.mzML" && fail "(b) could not strip the index"
probe noidx "$TMP/noindex.mzML"
[ "$(val "$TMP/p_noidx.v" index)" = '"absent"' ] && [ "$(val "$TMP/p_noidx.v" ms2)" = 139 ] \
  || fail "(b) unindexed mzML: index $(val "$TMP/p_noidx.v" index) ms2 $(val "$TMP/p_noidx.v" ms2)"
# 64 bytes of comment before the run shift every offset the index gives.
awk 'BEGIN { done = 0 } { print } /<\/instrumentConfigurationList>/ && !done { print "<!-- 0123456789012345678901234567890123456789012345678901 -->"; done = 1 }' \
  "$IN" > "$TMP/stale.mzML"
probe stale "$TMP/stale.mzML"
[ "$(val "$TMP/p_stale.v" index)" = '"stale"' ] && [ "$(val "$TMP/p_stale.v" ms2)" = 139 ] \
  || fail "(b) stale index: index $(val "$TMP/p_stale.v" index) ms2 $(val "$TMP/p_stale.v" ms2)"

probe fasta "$IN" -fasta "$DB"
[ "$(val "$TMP/p_fasta.v" proteins)" = "$(grep -c '^>' "$DB")" ] && [ "$(val "$TMP/p_fasta.v" decoys)" = 0 ] \
  || fail "(b) -fasta counts: $(val "$TMP/p_fasta.v" proteins) proteins, $(val "$TMP/p_fasta.v" decoys) decoys"
sed 's/^>/>DECOY_/' "$DB" > "$TMP/decoys.fasta"; cat "$DB" >> "$TMP/decoys.fasta"
probe decoys "$IN" -fasta "$TMP/decoys.fasta"
[ "$(val "$TMP/p_decoys.v" decoys)" = "$(grep -c '^>' "$DB")" ] || fail "(b) decoy count $(val "$TMP/p_decoys.v" decoys)"

# A FASTA alone: probe, fasta and end records only, the same counts.
run_in "$TMP/p_fa" "$TMP/p_fa.jsonl" "$TMP/p_fa.err" -probe_input "$TMP/decoys.fasta"
[ $RC = 0 ] || { cat "$TMP/p_fa.err" >&2; fail "(b) -probe_input <FASTA> exited $RC"; }
only_files "$TMP/p_fa" ""
"$PY" -I - "$TMP/p_fa.jsonl" "$(grep -c '^>' "$TMP/decoys.fasta")" "$(grep -c '^>' "$DB")" <<'PYEOF' || fail "(b) -probe_input <FASTA>: $(cat "$TMP/p_fa.jsonl")"
import json, sys
recs = [json.loads(l) for l in open(sys.argv[1])]
assert [r["record"] for r in recs] == ["probe", "fasta", "end"], [r["record"] for r in recs]
assert recs[0]["format"] == 1 and recs[0]["file_format"] == "FASTA"
assert recs[1]["proteins"] == int(sys.argv[2]) and recs[1]["decoys"] == int(sys.argv[3]), recs[1]
assert recs[1]["decoy_affix"] == "DECOY_", recs[1]
PYEOF

# ---- (c) -probe_input refusals ------------------------------------------------
refused() { # refused <name> <min exit> args: nonzero exit, empty stdout, a reason on stderr
  local n="$1"; shift
  run_in "$TMP/r_$n" "$TMP/r_$n.out" "$TMP/r_$n.err" "$@"
  [ $RC != 0 ] || fail "(c/e) $n: exit 0"
  [ ! -s "$TMP/r_$n.out" ] || fail "(c/e) $n: stdout not empty: $(head -c 200 "$TMP/r_$n.out")"
  [ -s "$TMP/r_$n.err" ] || fail "(c/e) $n: no reason on stderr"
  only_files "$TMP/r_$n" ""
}
refused missing -probe_input "$TMP/does_not_exist.mzML"
printf 'x\n' > "$TMP/x.txt"; refused txt -probe_input "$TMP/x.txt"
[ $RC = 6 ] || fail "(c) unsupported file exits $RC, not 6"
gzip -c "$IN" > "$TMP/e.mzML.gz"; refused gz -probe_input "$TMP/e.mzML.gz"
head -c 3000 "$IN" > "$TMP/cut.mzML"; refused corrupt -probe_input "$TMP/cut.mzML"
refused both -probe_input "$IN" -in "$IN" -dump_spectrum "x"
[ $RC = 6 ] || fail "(c) -probe_input with -dump_spectrum exits $RC, not 6"
refused stream -stream -probe_input "$IN"
grep -q 'probe_input' "$TMP/r_stream.err" || fail "(c) the -stream refusal does not name -probe_input"

# ---- (d) -dump_spectrum ---------------------------------------------------------
ids() { grep -o '<spectrum [^>]*' "$1" | grep -o ' id="[^"]*"' | sed -E 's/ id="([^"]*)"/\1/'; }
dump() { # dump <file> <id> <outfile> [args]: exit 0, no file, schema; leaves the checked values in <outfile>.v
  local f="$1" id="$2" o="$3"; shift 3
  rm -rf "$TMP/dd"; run_in "$TMP/dd" "$o" "$o.err" -in "$f" -dump_spectrum "$id" "$@"
  [ $RC = 0 ] || { cat "$o.err" >&2; fail "(d) -dump_spectrum '$id' of $f exited $RC"; }
  only_files "$TMP/dd" ""
  J spectrum "$o" > "$o.v" || fail "(d) -dump_spectrum '$id' of $f: schema"
}
census_run() { # census_run <name> <file> [args]: a real run with -census, in $TMP/c_<name>
  local n="$1" f="$2"; shift 2
  run_in "$TMP/c_$n" "$TMP/c_$n.out" "$TMP/c_$n.err" -in "$f" -out tags.tsv -census "$@"
  [ $RC = 0 ] || { cat "$TMP/c_$n.err" >&2; fail "(d) census run $n"; }
}
# Every 7th MS2 of the Ecoli fixture (20 spectra), at the CLI default
# (20 ppm, deisotoping) and at 0.3 Da.
mapfile -t EIDS < <(ids "$IN" | awk 'NR % 7 == 1')
[ ${#EIDS[@]} -ge 15 ] || fail "(d) found only ${#EIDS[@]} spectrum IDs in the fixture"
for cfg in default da; do
  A=(); [ $cfg = da ] && A=(-fragment_tolerance 0.3 -fragment_tolerance_unit Da)
  census_run $cfg "$IN" -threads 2 "${A[@]}"
  mkdir -p "$TMP/d_$cfg"
  for k in "${!EIDS[@]}"; do dump "$IN" "${EIDS[$k]}" "$TMP/d_$cfg/$k.jsonl" "${A[@]}"; done
  m=$(J census "$TMP/d_$cfg" "$TMP/c_$cfg/tags.census.tsv") || fail "(d) $cfg: dumps differ from the tagger's census rows"
  [ "$m" = ${#EIDS[@]} ] || fail "(d) $cfg: $m of ${#EIDS[@]} dumps matched"
  t=$(J ladders "$TMP/d_$cfg" "$TMP/c_$cfg/tags.tsv") || fail "(d) $cfg: a tag ladder is not on the dumped peaks"
  [ "$t" -gt 20 ] || fail "(d) $cfg: only $t tags had their ladder checked"
done
[ "$(val "$TMP/d_default/0.jsonl.v" tolerance)" = "20 ppm" ] || fail "(d) default tolerance $(val "$TMP/d_default/0.jsonl.v" tolerance)"
[ "$(val "$TMP/d_da/0.jsonl.v" tolerance)" = "0.3 Da" ] || fail "(d) Da tolerance $(val "$TMP/d_da/0.jsonl.v" tolerance)"
# The MGF twin (MGF IDs are index=<i>): the same peaks.
eidx=$(val "$TMP/d_default/3.jsonl.v" index)
dump "$MGF" "index=$eidx" "$TMP/mgf3.jsonl"
cmp -s <(val "$TMP/mgf3.jsonl.v" peaks) <(val "$TMP/d_default/3.jsonl.v" peaks) || fail "(d) the MGF twin dumps other peaks"
# Threads: the same bytes.
for th in 1 3 8; do dump "$IN" "${EIDS[5]}" "$TMP/th$th.jsonl" -threads $th; done
cmp -s "$TMP/th1.jsonl" "$TMP/th3.jsonl" && cmp -s "$TMP/th1.jsonl" "$TMP/th8.jsonl" || fail "(d) threads change the dump"
# -out and other outputs are not written.
rm -rf "$TMP/dout"; run_in "$TMP/dout" "$TMP/dout.jsonl" "$TMP/dout.err" -in "$IN" -dump_spectrum "${EIDS[0]}" -out tags.tsv -digest_out d.tsv
[ $RC = 0 ] || fail "(d) -dump_spectrum with -out exited $RC"
only_files "$TMP/dout" ""
cmp -s "$TMP/dout.jsonl" "$TMP/d_default/0.jsonl" || fail "(d) -out changes the dump"

# Profile MS2: under -pick_profile auto the dump has the picked peaks the
# tagger tags; under legacy the profile points as read.
mapfile -t PIDS < <(ids "$FIX/profile_ms2_small.mzML")
census_run pauto "$FIX/profile_ms2_small.mzML" -pick_profile auto -threads 2
census_run pleg "$FIX/profile_ms2_small.mzML" -threads 2
mkdir -p "$TMP/d_pauto" "$TMP/d_pleg"
for k in "${!PIDS[@]}"; do
  dump "$FIX/profile_ms2_small.mzML" "${PIDS[$k]}" "$TMP/d_pauto/$k.jsonl" -pick_profile auto
  dump "$FIX/profile_ms2_small.mzML" "${PIDS[$k]}" "$TMP/d_pleg/$k.jsonl"
done
J census "$TMP/d_pauto" "$TMP/c_pauto/tags.census.tsv" > /dev/null || fail "(d) auto: dumps differ from the picked spectra the tagger tags"
J census "$TMP/d_pleg" "$TMP/c_pleg/tags.census.tsv" > /dev/null || fail "(d) legacy: dumps differ from the census"
[ "$(val "$TMP/d_pauto/0.jsonl.v" picked)" = true ] && [ "$(val "$TMP/d_pleg/0.jsonl.v" picked)" = false ] \
  || fail "(d) picked flag: auto $(val "$TMP/d_pauto/0.jsonl.v" picked), legacy $(val "$TMP/d_pleg/0.jsonl.v" picked)"
cmp -s <(val "$TMP/d_pauto/0.jsonl.v" peaks) <(val "$TMP/d_pleg/0.jsonl.v" peaks) && fail "(d) auto dumps the unpicked peaks"

# mzPeak: the export of the Ecoli fixture dumps the same peaks.
run_in "$TMP/mzp" "$TMP/mzp.out" "$TMP/mzp.err" -in "$IN" -out tags.tsv -out_spectra e.mzpeak -threads 2
if [ $RC = 0 ] && [ -s "$TMP/mzp/e.mzpeak" ]; then
  dump "$TMP/mzp/e.mzpeak" "${EIDS[3]}" "$TMP/mzp3.jsonl"
  cmp -s <(val "$TMP/mzp3.jsonl.v" peaks) <(val "$TMP/d_default/3.jsonl.v" peaks) || fail "(d) mzPeak dumps other peaks"
  # -out_spectra keeps only the spectra that carry a reported tag.
  ntagged=$(tail -n +2 "$TMP/mzp/tags.tsv" | cut -f1 | sort -u | wc -l | tr -d ' ')
  probe mzpeak "$TMP/mzp/e.mzpeak"
  [ "$(val "$TMP/p_mzpeak.v" format)" = '"mzPeak"' ] && [ "$(val "$TMP/p_mzpeak.v" ms2)" = "$ntagged" ] \
    && [ "$(val "$TMP/p_mzpeak.v" index)" = '"not_applicable"' ] || fail "(b) mzPeak probe: $(tr '\n' ' ' < "$TMP/p_mzpeak.v")"
else
  echo "note: no mzPeak support in this build; the mzPeak dump and probe are not checked" >&2
fi

# Precursor hypotheses (1.12 #6): the dump prepares the given precursor at
# its charge (or 2+) only, so it must refuse -unknown_charge and
# -isotope_error away from their defaults (exit 6, the option on stderr,
# nothing on stdout) rather than print peaks that were not tagged, and
# give the plain dump's bytes with them at their defaults. Checked when
# the binary has them.
if grep -qE '^ +-unknown_charge <mode>' "$TMP/helphelp.txt"; then
  for a in "-unknown_charge infer" "-unknown_charge enumerate" "-isotope_error 0 1"; do
    rm -rf "$TMP/dh"; run_in "$TMP/dh" "$TMP/dh.out" "$TMP/dh.err" -in "$IN" -dump_spectrum "${EIDS[0]}" $a
    [ $RC = 6 ] || fail "(d) -dump_spectrum with $a exited $RC, not 6"
    [ -s "$TMP/dh.out" ] && fail "(d) -dump_spectrum with $a printed to stdout"
    grep -q -- "-dump_spectrum prepares the peaks at the given precursor .* does not follow ${a%% *}" "$TMP/dh.err" \
      || { cat "$TMP/dh.err" >&2; fail "(d) $a is not refused by -dump_spectrum naming ${a%% *}"; }
    only_files "$TMP/dh" ""
  done
  dump "$IN" "${EIDS[0]}" "$TMP/dh_def.jsonl" -unknown_charge assume2 -isotope_error 0
  cmp -s "$TMP/dh_def.jsonl" "$TMP/d_default/0.jsonl" || fail "(d) the #6 defaults given change the dump"
else
  echo "note: no -unknown_charge in this build; the #6 refusal of -dump_spectrum is not checked" >&2
fi

# ---- (e) -dump_spectrum refusals and an MS1 ----------------------------------------
refused unknown -in "$IN" -dump_spectrum "scan=does-not-exist"
[ $RC = 6 ] || fail "(e) unknown native ID exits $RC, not 6"
grep -q 'scan=does-not-exist' "$TMP/r_unknown.err" || fail "(e) the unknown ID is not named on stderr"
refused noin -dump_spectrum "${EIDS[0]}"
refused dstream -stream -dump_spectrum "${EIDS[0]}" -in "$IN"
ms1=$(J ms1id "$FIX/census_edge.mzML")
[ -n "$ms1" ] || fail "(e) census_edge.mzML has no MS1"
dump "$FIX/census_edge.mzML" "$ms1" "$TMP/ms1.jsonl"
[ "$(val "$TMP/ms1.jsonl.v" tagged)" = false ] && [ "$(val "$TMP/ms1.jsonl.v" n)" = 0 ] || fail "(e) the MS1 is dumped as tagged"

# ---- (f) the shipped digest data in the installed layouts -------------------------
dest=$(awk '/install\(FILES .*data\/digest\/digest_models.tsv/ { f = 1 } f && /DESTINATION/ { sub(/.*DESTINATION[ \t]+/, ""); sub(/\).*/, ""); print; exit }' "$CMAKELISTS")
[ -n "$dest" ] || fail "(f) no install DESTINATION for data/digest in CMakeLists.txt"
layout() { # layout <name> <binary path inside> <digest dir inside or ''>: a copy of the binary and data
  local root="$TMP/l_$1"; mkdir -p "$root/$(dirname "$2")"
  cp "$BIN" "$root/$2"; chmod +x "$root/$2"
  if [ -n "$3" ]; then mkdir -p "$root/$3"; cp "$DIGEST"/digest_models.tsv "$DIGEST"/massgap_mods.tsv "$root/$3/"; fi
  echo "$root/$2"
}
digest_in() { # digest_in <binary>: 0 when -digest_out finds the shipped models without FASTAG_DIGEST_DIR
  local b="$1" d; d=$(dirname "$b")/../run.$$; mkdir -p "$d"
  (cd "$d" && env -u FASTAG_DIGEST_DIR "$b" -in "$IN" -out t.tsv -digest_out d.tsv -threads 2 > log 2>&1) || return 1
  grep -q $'^run\tbackground\tshipped_human\t' "$d/d.tsv"
}
B=$(layout cmake bin/FASTag "$dest"); digest_in "$B" || fail "(f) cmake --install layout (bin/ + $dest): digest data not found"
B=$(layout flat FASTag/FASTag.bin FASTag/share-FASTag-digest); digest_in "$B" || fail "(f) flat release / Homebrew cask layout: digest data not found"
B=$(layout gui resources/fastag/bin/FASTag resources/fastag/share/FASTag/digest); digest_in "$B" || fail "(f) GUI bundle layout: digest data not found"
B=$(layout bare bin/FASTag ""); digest_in "$B" && fail "(f) a bare copy found digest data it does not have"
if [ -z "$(env -u FASTAG_DIGEST_DIR "$B" -in "$IN" -out "$TMP/bare.tsv" -digest_out "$TMP/bare.d.tsv" 2>&1 | grep -o 'FASTAG_DIGEST_DIR')" ]; then
  fail "(f) a bare copy's error does not name FASTAG_DIGEST_DIR"
fi

echo "gui_cli_test: all checks passed"
exit 0
