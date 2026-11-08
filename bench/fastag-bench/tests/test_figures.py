import re
from pathlib import Path

from fastag_bench.figures import VARIANTS, default_scripts_dir

ROOT = Path(__file__).resolve().parents[1]
ARGS = re.compile(r'^a = args\("([^"]+)"(, versioned=True)?\)', re.M)


def _scripts():
    out = {}
    for s in default_scripts_dir().glob("fig_*.py"):
        m = ARGS.search(s.read_text())
        assert m, s.name
        out[s.stem] = (m.group(1), bool(m.group(2)))
    return out


def test_variants_match_versioned_scripts():
    sc = _scripts()
    assert set(VARIANTS) == {k for k, (_, v) in sc.items() if v}
    assert all(s in ("v180", "v190") for v in VARIANTS.values() for s in v)


def test_every_shipped_figure_is_rendered_by_fastag_bench_figures():
    names = set()
    for stem, (base, _) in _scripts().items():
        names.add(base)
        names.update(f"{base}_{x}" for x in VARIANTS.get(stem, []))
    shipped = {p.stem for p in (ROOT / "figures").glob("*.pdf")}
    assert shipped <= names, sorted(shipped - names)


def test_readme_lists_every_result_and_figure():
    text = (ROOT / "README.md").read_text()
    for p in (ROOT / "results").iterdir():
        if not p.name.startswith("."):
            assert f"`{p.name}" in text, p.name
    for p in (ROOT / "figures").glob("*.pdf"):
        assert f"`{p.stem}`" in text, p.stem
