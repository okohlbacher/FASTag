#!/usr/bin/env python3
"""Canonical text of one FASTag output, for the baseline-identity harness.

    baseline_canon.py <file> <fastag version> [<openms version>]

Prints the file with only the run-specific values masked, so two runs of the
same FASTag on the same input compare equal byte for byte (cmp), and so a
candidate binary compares equal to the baseline binary exactly when its output
differs in nothing but the masked values. What is masked, by format:

  every text output   the FASTag version string (as a whole token) -> @FASTAG_VERSION@;
                      the OpenMS version string, if given, -> @OPENMS_VERSION@
  .mzid               creationDate, activityDate; the random OpenMS element ids
                      (PEP_123..., SII_123..., ...) are replaced by a hash of the
                      element's content, references follow them, and sibling
                      elements are sorted, because the writer orders elements by
                      those random ids (two runs of one binary differ otherwise)
  .idXML              the IdentificationRun date
  .mzML               the completion time and the data-processing software
                      version (exactly what gate.sh masks), plus the index
                      offsets and the file checksum, which move with them
  anything else       compared raw, apart from the version strings

Nothing else is normalised: numbers, column order, row order, line endings and
every other byte must match. Standard library only (Python >= 3.9).
"""
import hashlib
import re
import sys
import xml.etree.ElementTree as ET

RANDOM_ID = re.compile(r"^[A-Za-z]+_[0-9]{6,}(_[0-9]+)*$")
VOLATILE_ATTRS = {"creationDate", "activityDate"}


def token_sub(text, value, mask):
    """Replace @p value as a whole token (not inside a longer version or number)."""
    if not value:
        return text
    return re.sub(r"(?<![0-9A-Za-z.+-])" + re.escape(value) + r"(?![0-9A-Za-z+-]|\.[0-9])", mask, text)


def mask_versions(text, fastag_version, openms_version):
    text = token_sub(text, fastag_version, "@FASTAG_VERSION@")
    if openms_version:
        text = text.replace(openms_version, "@OPENMS_VERSION@")
    return text


def canon_mzid(text):
    """mzIdentML with content-derived ids and sorted siblings (versions already masked,
    so a masked value never leaks into an id hash)."""
    ET.register_namespace("", "http://psidev.info/psi/pi/mzIdentML/1.3")
    ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
    root = ET.fromstring(text.encode("utf-8", errors="surrogateescape"))
    tree = ET.ElementTree(root)
    by_id = {}
    for el in root.iter():
        i = el.get("id")
        if i is not None:
            by_id.setdefault(i, el)
    memo = {}
    busy = set()

    def key(el):
        k = memo.get(id(el))
        if k is not None:
            return k
        if id(el) in busy:          # a reference cycle: fall back to the tag
            return "<cycle " + el.tag + ">"
        busy.add(id(el))
        attrs = []
        for a, v in sorted(el.attrib.items()):
            if a == "id" and RANDOM_ID.match(v):
                continue
            if a in VOLATILE_ATTRS:
                v = "@MASKED@"
            elif a.endswith("_ref") and v in by_id and RANDOM_ID.match(v):
                v = "#" + digest(key(by_id[v]))
            attrs.append(a + "=" + v)
        kids = sorted(key(c) for c in el)
        k = "<%s %s>%s%s</>" % (el.tag, " ".join(attrs), (el.text or "").strip(), "".join(kids))
        busy.discard(id(el))
        memo[id(el)] = k
        return k

    new_id = {}
    for i, el in by_id.items():
        if RANDOM_ID.match(i):
            new_id[i] = i.split("_", 1)[0] + "_" + digest(key(el))

    def rewrite(el):
        for a, v in list(el.attrib.items()):
            if a == "id" and v in new_id:
                el.set(a, new_id[v])
            elif a in VOLATILE_ATTRS:
                el.set(a, "@MASKED@")
            elif a.endswith("_ref") and v in new_id:
                el.set(a, new_id[v])
        kids = list(el)
        kids.sort(key=key)
        for c in kids:
            el.remove(c)
        for c in kids:
            rewrite(c)
            el.append(c)

    rewrite(root)
    for el in root.iter():          # whitespace-only text and tails are layout, not content
        if el.text is not None and not el.text.strip():
            el.text = None
        el.tail = None
    ET.indent(tree, space=" ")
    return ET.tostring(root, encoding="unicode") + "\n"


def digest(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def main():
    if len(sys.argv) < 3:
        sys.stderr.write(__doc__)
        return 2
    path, fastag_version = sys.argv[1], sys.argv[2]
    openms_version = sys.argv[3] if len(sys.argv) > 3 else ""
    low = path.lower()
    with open(path, "rb") as f:
        text = f.read().decode("utf-8", errors="surrogateescape")
    text = mask_versions(text, fastag_version, openms_version)
    if low.endswith(".mzid") and text.strip():   # an empty mzid (no placements) stays empty
        text = canon_mzid(text)
    else:
        if low.endswith(".idxml"):
            text = re.sub(r'(<IdentificationRun date=")[^"]*"', r'\1@MASKED@"', text)
        elif low.endswith(".mzml"):
            text = re.sub(r'(name="completion time" value=")[^"]*"', r'\1@MASKED@"', text)
            text = re.sub(r'(<software id="so_dp_[^"]*" version=")[^"]*"', r'\1@MASKED@"', text)
            text = re.sub(r"(<offset [^>]*>)[0-9]+(</offset>)", r"\1@OFFSET@\2", text)
            text = re.sub(r"(<indexListOffset>)[0-9]+(</indexListOffset>)", r"\1@OFFSET@\2", text)
            text = re.sub(r"(<fileChecksum>)[0-9a-fA-F]+(</fileChecksum>)", r"\1@CHECKSUM@\2", text)
    sys.stdout.buffer.write(text.encode("utf-8", errors="surrogateescape"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
