#!/usr/bin/env bash
# Tool description export (-write_ctd / -write_cwl / -write_json) against the
# real binary. FASTag is not in OpenMS's ToolHandler registry; TOPPBase writes
# the descriptor of an unregistered tool all the same.
#
# What this has to prove, beyond "a file appeared":
#   - the CTD carries FASTag's OWN version and FASTag's REAL parameters, list
#     parameters included -- a count of <ITEM> alone would miss the two
#     modification ITEMLISTs entirely;
#   - a descriptor request does not change --help or -write_ini, in the mixed
#     `--help -write_ctd DIR` case too;
#   - the CWL/JSON spellings either work or refuse in FASTag's own words. On an
#     OpenMS built without ENABLE_TDL, ParamCWLFile::store() opens (truncating)
#     the target before throwing an std::runtime_error nothing catches, so
#     "some non-zero exit" is not an acceptable outcome: the tool must refuse
#     before OpenMS touches the file.
# Exits 77 (ctest SKIP) when python3 is unavailable or the binary cannot start.
set -u
BIN="$1"

PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
if [ -z "$PY" ]; then echo "SKIP: no python3/python for XML checks" >&2; exit 77; fi
if ! "$BIN" --help >/dev/null 2>&1; then
  echo "SKIP: binary cannot initialize (OpenMS share data unreachable?)" >&2
  exit 77
fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/fastag-ctd-test.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# ---------------------------------------------------------------- CTD export
mkdir -p "$TMP/out"
"$BIN" -write_ctd "$TMP/out" >"$TMP/ctd.log" 2>&1 || fail "-write_ctd exited $? ($(head -1 "$TMP/ctd.log"))"
[ -s "$TMP/out/FASTag.ctd" ] || fail "-write_ctd produced no FASTag.ctd"

# The INI is the reference parameter contract: it is what the GUI manifest is
# built from and it has always worked, so the CTD must describe the same tool.
"$BIN" -write_ini "$TMP/ref.ini" >/dev/null 2>&1 || fail "-write_ini failed"

"$PY" - "$TMP/out/FASTag.ctd" "$TMP/ref.ini" <<'PYEOF' || exit 1
import sys, xml.etree.ElementTree as ET

ctd_path, ini_path = sys.argv[1], sys.argv[2]

def die(msg):
    print("FAIL: " + msg, file=sys.stderr)
    sys.exit(1)

try:
    ctd = ET.parse(ctd_path).getroot()
except ET.ParseError as e:
    die("CTD is not well-formed XML: %s" % e)

if ctd.tag != "tool":
    die("CTD root is <%s>, expected <tool>" % ctd.tag)
if ctd.get("name") != "FASTag":
    die("CTD name attribute is %r, expected 'FASTag'" % ctd.get("name"))
ver = ctd.get("version") or ""
if not ver or ver.startswith("3."):
    # An empty version_ makes TOPPBase print OpenMS's version instead of the
    # tool's; that regression is why the constructor sets version_ at all.
    die("CTD version is %r -- looks like OpenMS's version, not FASTag's" % ver)
if not ctd.findtext("description"):
    die("CTD has no <description>")
dois = {c.get("doi") for c in ctd.iter("citation")}
if "10.1021/pr800154p" not in dois:
    die("CTD is missing the DirecTag citation (got %r)" % sorted(dois))

def instance_node(root):
    # <PARAMETERS><NODE name="FASTag"><NODE name="1"> ... the tool's options
    for params in root.iter("PARAMETERS"):
        for tool_node in params:
            if tool_node.tag == "NODE" and tool_node.get("name") == "FASTag":
                for inst in tool_node:
                    if inst.tag == "NODE" and inst.get("name") == "1":
                        return inst
    return None

def harvest(node, where):
    if node is None:
        die("no FASTag:1 parameter node in the %s" % where)
    out = {}
    for el in node:
        if el.tag == "ITEM":
            out[el.get("name")] = ("ITEM", el.get("value"))
        elif el.tag == "ITEMLIST":
            out[el.get("name")] = ("ITEMLIST", tuple(li.get("value") for li in el))
    return out

ctd_p = harvest(instance_node(ctd), "CTD")
ini_p = harvest(instance_node(ET.parse(ini_path).getroot()), "INI")

if "type" in ctd_p and "type" not in ini_p:
    # A registered type would also rename the output file to FASTag<TYPE>.ctd.
    die("CTD carries a synthetic 'type' parameter the INI does not have")

missing = sorted(set(ini_p) - set(ctd_p))
extra = sorted(set(ctd_p) - set(ini_p))
if missing or extra:
    die("CTD/INI parameter sets differ; missing from CTD: %r, extra: %r" % (missing, extra))

bad = sorted(k for k in ini_p if ini_p[k] != ctd_p[k])
if bad:
    die("CTD/INI disagree on %r (e.g. %s: INI=%r CTD=%r)"
        % (bad, bad[0], ini_p[bad[0]], ctd_p[bad[0]]))

# Guard the two properties a bare <ITEM> count would not notice.
for name in ("fixed_modifications", "variable_modifications"):
    if ctd_p.get(name, ("", ""))[0] != "ITEMLIST":
        die("%s is not an <ITEMLIST> in the CTD" % name)
for name in ("tag_length", "fragment_tolerance", "max_tags", "out", "in"):
    if name not in ctd_p:
        die("CTD is missing the %r parameter" % name)
if len(ctd_p) < 40:
    die("CTD exposes only %d parameters -- expected the full option set" % len(ctd_p))
print("write_ctd_test: CTD describes %d parameters, version %s" % (len(ctd_p), ver))
PYEOF

# ------------------------------------------------ --help and -write_ini stay
"$BIN" --help >"$TMP/help.txt" 2>&1
"$BIN" --help -write_ctd "$TMP/out" >"$TMP/help_mixed.txt" 2>&1
cmp -s "$TMP/help.txt" "$TMP/help_mixed.txt" || fail "'--help -write_ctd DIR' changed the usage output"
"$BIN" -write_ini "$TMP/again.ini" >/dev/null 2>&1
cmp -s "$TMP/again.ini" "$TMP/ref.ini" || fail "-write_ini output changed"

# ------------------------------------------------------------- CWL and JSON
# Both outcomes are acceptable, neither silently: on an ENABLE_TDL build the
# file must be written, otherwise FASTag must say so in its own words and leave
# no artefact behind. OpenMS's own "does not exist!" message counts as failure.
for opt in -write_cwl -write_nested_cwl -write_json -write_nested_json; do
  rm -rf "$TMP/d"; mkdir -p "$TMP/d"
  out=$("$BIN" "$opt" "$TMP/d" 2>&1); rc=$?
  case $rc in
    134|139|138) fail "$opt crashed (exit $rc): $out" ;;
  esac
  produced=$(find "$TMP/d" -type f | head -1)
  if [ "$rc" -eq 0 ]; then
    [ -s "$produced" ] || fail "$opt exited 0 but wrote no non-empty file"
  else
    printf '%s' "$out" | grep -q "ENABLE_TDL" \
      || fail "$opt failed with an unexpected message (exit $rc): $out"
    [ -z "$produced" ] || fail "$opt refused but still left $(basename "$produced") behind"
  fi
done

echo "write_ctd_test: all checks passed"
