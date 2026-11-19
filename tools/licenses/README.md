# Licence texts for the notice generators

- `spdx/<id>.txt`: canonical licence texts from the SPDX License List
  (<https://github.com/spdx/license-list-data>, `text/<id>.txt`, fetched
  2026-11-18). `tools/gui_third_party_notices.py` prints one, with the
  component's authors as copyright holders, for a Rust crate or npm package
  whose published archive carries no licence file of its own.
- `conda/<package>.txt`: the licence text for a conda package whose archive
  carries none, added by `tools/third_party_notices.py` to whatever the package
  installs itself. Each file names its source.
