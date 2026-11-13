#!/bin/bash
# compltol held-out 3: the PXD exclusion list (run once on 2026-11-13 before the freeze-1 commit, from the FASTag clone).
#   build_excl.sh <repo> <backlog output dir> <heldout2 excl_pxd.txt> > excl_pxd.txt
# Union of: every PXD accession named in any file of any origin/* branch (git grep, after git fetch), except the
# PRIDE candidate catalog h2r_pride_candidates.tsv (a pool to draw from, not a use; HELDOUT-COMMON.md); every PXD
# named in any file under the FASTag output folder (reports, results, drafts); held-out 2's list (reserved lists of
# HELDOUT-COMMON.md, DEV, every earlier test). Over-exclusion is accepted.
set -u
cd "$1" || exit 2
{ for r in $(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v HEAD); do
    git grep -oE 'PXD[0-9]{6}' "$r" -- . ':(exclude)*h2r_pride_candidates.tsv' 2>/dev/null | awk -F: '{print $NF}'
  done
  grep -rahoE 'PXD[0-9]{6}' "$2" 2>/dev/null
  cat "$3"; } | grep -E "^PXD[0-9]{6}$" | sort -u
