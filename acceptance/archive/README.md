# Held-out test records

Preregistrations (`PREREG-*`), freezes (`FREEZE*`), results (`RESULT*.md`, `RESULTS.md`) and verdict files
(`verdict.txt`, `.json`, `.tsv`, `.md`, `.log`) of FASTag's held-out acceptance tests, plus the tables the
documentation cites (`acceptance/1.13/disjointness/item12-realchimera-reuse.tsv` and the digest-quality
evaluation `acceptance/1.13/item23/`), copied as text from the test branches (`acceptance/1.12`,
`acceptance/1.13`, `acc113r/*`, `post1131/*-heldout*`, `acc114/*`, `acc115/*`) by
[tools/archive_acceptance.py](../../tools/archive_acceptance.py). Data and the other scripts stay on those
branches.

Layout: `<branch>/<path on the branch, without the leading acceptance/>`. A file that is unchanged on several
branches is stored once, under the first branch in that order. `MANIFEST.tsv` lists every archived file on
every branch with the branch head commit, the git blob id and where it is stored here.
