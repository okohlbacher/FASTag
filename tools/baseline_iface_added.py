#!/usr/bin/env python3
"""Is a candidate's interface file the baseline's plus whole new options?

    baseline_iface_added.py <kind> <baseline file> <candidate file> \
                            <baseline CTD> <candidate CTD>

<kind> is "help" (--help, --helphelp) or "ctd" (-write_ctd, -write_ini; both
are OpenMS ParamXML). The files are compared after the harness's version
masking (tools/baseline_canon.py).

The binding rule for FASTag 1.12 is "new options may ADD lines, nothing
existing may change". The new options are the parameter names the candidate
CTD declares and the baseline CTD does not (<ITEM name=...> or
<ITEMLIST name=...>). The candidate passes as ADDED when, line by line
(difflib), no baseline line is removed or changed and every inserted run of
lines is a sequence of whole blocks of new options:

  help  a block starts with the option line "  -<new name> ..." and may go on
        with indented continuation lines (OpenMS wraps long help on a
        terminal); a line that starts an existing option, a blank line or a
        section heading is never part of a new block;
  ctd   a block is one <ITEM name="<new name>" .../> line, or an
        <ITEMLIST name="<new name>" ...> line, its <LISTITEM .../> lines and
        </ITEMLIST>.

So an extra help line or attribute line under an existing 1.11 option stays a
DIFF. An insertion that diff could place in several equal positions (a run of
identical lines around it) passes when any of those placements is whole blocks.

Prints one status line and exits 0 for "ADDED (+N lines: a, b)" and 1 for
"DIFF (<why>)". Standard library only (Python >= 3.9).
"""
import difflib
import re
import sys

CTD_NAME = re.compile(r'<ITEM(?:LIST)?\s+name="([^"]+)"')
HELP_OPT = re.compile(r"^\s+-([A-Za-z0-9_:.]+)(?:\s|$)")
CTD_ITEM = re.compile(r'^\s*<ITEM\s+name="([^"]+)".*/>\s*$')
CTD_LIST_OPEN = re.compile(r'^\s*<ITEMLIST\s+name="([^"]+)"[^/]*>\s*$')
CTD_LIST_ITEM = re.compile(r"^\s*<LISTITEM\s.*/>\s*$")
CTD_LIST_CLOSE = re.compile(r"^\s*</ITEMLIST>\s*$")
HELP_CONT = re.compile(r"^\s{4,}\S")


def read_lines(path):
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        return f.read().splitlines()


def ctd_names(path):
    return set(CTD_NAME.findall("\n".join(read_lines(path))))


def whole_help_blocks(lines, new):
    """Names of the new options when @p lines are whole help blocks, else None."""
    names, open_block = [], False
    for ln in lines:
        m = HELP_OPT.match(ln)
        if m:
            if m.group(1) not in new:
                return None
            names.append(m.group(1))
            open_block = True
        elif open_block and HELP_CONT.match(ln):
            continue
        else:
            return None
    return names


def whole_ctd_blocks(lines, new):
    names, in_list = [], False
    for ln in lines:
        if in_list:
            if CTD_LIST_ITEM.match(ln):
                continue
            if CTD_LIST_CLOSE.match(ln):
                in_list = False
                continue
            return None
        m = CTD_ITEM.match(ln)
        if m and m.group(1) in new:
            names.append(m.group(1))
            continue
        m = CTD_LIST_OPEN.match(ln)
        if m and m.group(1) in new:
            names.append(m.group(1))
            in_list = True
            continue
        return None
    return None if in_list else names


def main(argv):
    if len(argv) != 6 or argv[1] not in ("help", "ctd"):
        sys.stderr.write(__doc__)
        return 2
    kind, base_f, cand_f, base_ctd, cand_ctd = argv[1:]
    base, cand = read_lines(base_f), read_lines(cand_f)
    new = ctd_names(cand_ctd) - ctd_names(base_ctd)
    whole = whole_help_blocks if kind == "help" else whole_ctd_blocks
    added, found = 0, []
    sm = difflib.SequenceMatcher(None, base, cand, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag != "insert":
            print("DIFF (baseline line %d %s)" % (i1 + 1, "removed" if tag == "delete" else "changed"))
            return 1
        # Slide the insertion over a run of equal lines (diff may place it
        # anywhere in the run) and accept the first placement of whole blocks.
        n = j2 - j1
        while j1 > 0 and cand[j1 - 1] == cand[j2 - 1]:
            j1, j2 = j1 - 1, j2 - 1
        names = None
        while names is None:
            names = whole(cand[j1:j2], new)
            if names is not None or j2 >= len(cand) or cand[j1] != cand[j2]:
                break
            j1, j2 = j1 + 1, j2 + 1
        if names is None:
            print("DIFF (candidate line %d: %d added line(s) are not whole blocks of new options; new: %s)"
                  % (j1 + 1, n, ", ".join(sorted(new)) or "none"))
            return 1
        added += n
        found += names
    if added == 0:
        print("DIFF (no added line; the files differ in another way)")
        return 1
    print("ADDED (+%d lines: %s)" % (added, ", ".join(found)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
