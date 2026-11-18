#!/usr/bin/env python3
# Copyright (c) 2026 Oliver Kohlbacher and contributors
# SPDX-License-Identifier: MIT
"""Every option FASTag registers has a row in README's command-line table.

Usage: readme_options_test.py <src/FASTagOptions.cpp> <README.md>

The registered names are the first string argument of each register*_() call
in FASTagOptions.cpp. The documented names are the -name tokens in the FIRST
cell of each row of the table under "## Command-line reference" (a row may
list several, e.g. "-charge_min <n> / -charge_max <n>"). A name mentioned
only in another row's prose does not count. Fails, listing them, when a
registered option has no row, or when a row names an option that is not
registered (a stale row).
"""
import re
import sys

REGISTER = re.compile(
    r'\bregister(?:InputFile|OutputFile|IntOption|DoubleOption|StringOption|Flag|'
    r'IntList|DoubleList|StringList|InputFileList|OutputFileList)_\(\s*"([^"]+)"')


def registered(path):
    with open(path, encoding="utf-8") as f:
        src = f.read()
    # Drop // comments so a commented-out registration does not count.
    src = re.sub(r'//[^\n]*', '', src)
    return REGISTER.findall(src)


def documented(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    start = text.find("\n## Command-line reference")
    if start < 0:
        sys.exit("README has no '## Command-line reference' section")
    end = text.find("\n## ", start + 1)
    section = text[start:end if end > 0 else len(text)]
    names = set()
    rows = 0
    for line in section.splitlines():
        if not line.startswith("| `-"):
            continue
        rows += 1
        first = re.split(r'(?<!\\)\|', line)[1]
        names.update(re.findall(r'(?<![\w-])-([a-z][a-z0-9_]*)', first))
    if rows == 0:
        sys.exit("no option rows found in README's command-line table")
    return names


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    reg = registered(sys.argv[1])
    if len(reg) < 50:
        sys.exit(f"only {len(reg)} registered options found in {sys.argv[1]}; parser out of date?")
    doc = documented(sys.argv[2])
    missing = [n for n in reg if n not in doc]
    stale = sorted(doc - set(reg))
    if missing:
        print("Registered but not in README's command-line table:")
        for n in missing:
            print(f"  -{n}")
    if stale:
        print("In README's command-line table but not registered:")
        for n in stale:
            print(f"  -{n}")
    if missing or stale:
        return 1
    print(f"OK: {len(set(reg))} registered options, all in README's command-line table")
    return 0


if __name__ == "__main__":
    sys.exit(main())
