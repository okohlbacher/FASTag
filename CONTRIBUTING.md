# Contributing to FASTag

Bug reports, questions, documentation fixes and code are welcome. Use the
[issue forms](https://github.com/okohlbacher/FASTag/issues/new/choose) for bugs, feature
requests and questions; security problems go through [SECURITY.md](SECURITY.md). Everyone
taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Development setup

[BUILDING.md](BUILDING.md) has the full setup: the conda environment from
`.github/env/openms.yml`, OpenMS develop at the pinned commit, FASTag itself and the desktop
app. For the app alone (no C++), `cd gui && npm ci`, then `npm test`, `npm run typecheck`,
and `cargo test --lib` in `gui/src-tauri` (with an empty `gui/src-tauri/resources/fastag`).

## Tests

```bash
export OPENMS_DATA_PATH=<openms-install>/share/OpenMS
ctest --test-dir build --output-on-failure
```

Every change keeps ctest green. A fix comes with a test that fails without it; a new option
comes with a test and a row in README's command-line table (`readme_options_test` fails
otherwise). Tests read only the fixtures in `test/fixtures/`, which are small, public and
documented in `test/fixtures/README.md`; never add non-public data. Tests that need an external
tool skip with exit code 77 when it is absent (see BUILDING.md, Tests).

## Behaviour changes need a held-out test

FASTag is used as a measured tool, so a change that can alter results (tags, E-values,
filters, calls, report numbers or a default) is accepted only with evidence from data it was
not developed on. Before the run, write a preregistration: the hypothesis, the held-out public
data sets (PRIDE/ProteomeXchange accessions not used during development), the metric, the
pass/fail criteria and the decision each outcome leads to; commit it, then run and score once.
A change that fails, or is inconclusive, stays off by default or is removed, and the result is
documented either way (see README, Validation). Changes that cannot alter results
(performance with byte-identical output, packaging, documentation, the GUI) need tests but no
held-out run; say in the pull request that the output is unchanged and how you checked.

## Pull requests

1. Open an issue first for anything larger than a small fix, so the approach can be agreed.
2. Branch from `main`; keep one topic per pull request.
3. Fill in the pull request template: what changes, why, how it was tested, whether output
   changes, and the held-out result for a behaviour change.
4. Add an entry to `CHANGELOG.md` under the next version, and update README (or the doc under
   `doc/`) when an option, an output or a default changes.
5. CI (Linux and macOS, ctest included) must pass. The maintainer reviews and merges; releases
   are cut by the maintainer.

## Style

- C++23, the style of the surrounding code: 2-space indent, braces on their own line for
  functions and blocks, `snake_case` locals, the existing namespaces (`FASTag::...`).
- OpenMS conventions for the tool itself: options are registered in `src/FASTagOptions.cpp`,
  logging goes through `OPENMS_LOG_*`, and failures return a documented exit code (README,
  Exit codes) rather than aborting.
- Every source file starts with the MIT SPDX header used in the repository.
- Comments say why, not what. Documentation is plain English, concise, without development
  history.
- Commit messages: a short imperative subject line, then the reason for the change.

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
