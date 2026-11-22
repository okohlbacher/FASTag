// Tag merging (src/TagGraph.h): the synthetic PEPTIDE cases of the GUI's
// gui/src/spectrum/graph.test.ts and stepScore.test.ts, with the same
// expectations, so the port resolves and ranks as the Spectrum tab does.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "TagGraph.h"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

using namespace FASTag::TagGraph;

namespace
{
  int failures = 0;
  void check(bool ok, const std::string& what)
  {
    if (!ok) { std::cerr << "FAIL: " << what << "\n"; ++failures; }
  }
  template <typename T>
  std::string str(const std::vector<T>& v)
  {
    std::ostringstream o;
    o << '[';
    for (size_t i = 0; i < v.size(); ++i) o << (i ? "," : "") << v[i];
    o << ']';
    return o.str();
  }

  const Residues RES = residuesFrom({});
  double R(char c) { return RES.base.at(c); }
  double sum(const std::string& t)
  {
    double a = 0;
    for (char c : t) a += R(c);
    return a;
  }
  const double N = 100, C = 200;
  const std::string SEQ = "PEPTIDE";
  const double M = N + sum(SEQ) + C + WATER;
  // The b ions of @p seq after a neutral flank @p start, at 1+.
  std::vector<double> ions(double start, const std::string& seq)
  {
    std::vector<double> out{start + PROTON};
    for (char r : seq) out.push_back(out.back() + R(r));
    return out;
  }
  std::string rev(std::string s) { std::reverse(s.begin(), s.end()); return s; }
  const std::vector<double> b = ions(N, SEQ);
  const std::vector<double> y = ions(C + WATER, rev(SEQ));
  std::vector<double> cat(std::vector<double> a, const std::vector<double>& x) { a.insert(a.end(), x.begin(), x.end()); return a; }

  Peaks spec(const std::vector<double>& mz)
  {
    std::set<double> u;
    for (double x : mz) u.insert(std::round(x * 1e6) / 1e6);
    Peaks s;
    s.mz.assign(u.begin(), u.end());
    s.intensity.assign(s.mz.size(), 100);
    s.precursor = (M + 2 * PROTON) / 2;
    s.charge = 2;
    s.tolerance = 10;
    s.ppm = true;
    return s;
  }
  // A tag @p text whose b ladder starts at the neutral flank @p nterm.
  TagIn at(size_t index, double nterm, const std::string& text, std::optional<double> e, bool gapped = false, double cterm = 5000)
  {
    TagIn t;
    t.seq = text;
    t.charge = 1;
    t.nterm_mass = nterm;
    t.cterm_mass = cterm;
    t.gapped = gapped;
    t.evalue = e;
    t.index = index;
    return t;
  }
  // The tag reading SEQ[from, from+len) (as @p text for another order), b and y flanks right.
  TagIn tag(size_t index, size_t from, size_t len, std::optional<double> e, std::string text = "", bool gapped = false)
  {
    if (text.empty()) text = SEQ.substr(from, len);
    return at(index, N + sum(SEQ.substr(0, from)), text, e, gapped, C + sum(SEQ.substr(from + len)));
  }
  Options ev(bool join = false)
  {
    Options o;
    o.scheme = Scheme::EVIDENCE;  // the GUI buildGraph default
    o.join = join;
    return o;
  }
  std::vector<std::string> seqs(const Graph& g)
  {
    std::vector<std::string> out;
    for (const Path& p : g.paths) out.push_back(sequenceOf(p.series, p.steps));
    return out;
  }
  std::vector<std::string> sorted(std::vector<std::string> v) { std::sort(v.begin(), v.end()); return v; }
  using SV = std::vector<std::string>;

  void graphCases()
  {
    {
      const Graph g = buildGraph({tag(0, 0, 3, 0.01), tag(1, 2, 3, 0.5), tag(2, 1, 2, 0.1), tag(3, 3, 3, 0.02)}, spec(b), RES, ev());
      check(seqs(g) == SV{"PEPTID"}, "nested: " + str(seqs(g)));
      std::vector<size_t> rows;
      for (size_t i : g.paths[0].chain) for (size_t r : g.placements[i].rows) rows.push_back(r);
      for (size_t i : g.paths[0].inside) for (size_t r : g.placements[i].rows) rows.push_back(r);
      std::sort(rows.begin(), rows.end());
      check(rows == std::vector<size_t>{0, 1, 2, 3}, "nested rows " + str(rows));
      check(g.paths[0].best == 0.01, "nested best");
      check(g.paths[0].weakest == 0.5, "nested weakest");
    }
    {
      const Graph g = buildGraph({tag(0, 0, 3, 0.001), tag(1, 3, 3, 0.001), tag(2, 2, 2, 999)}, spec(b), RES, ev());
      check(seqs(g) == SV{"PEPTID"}, "bridge: " + str(seqs(g)));
      check(g.paths[0].weakest == 999, "bridge weakest");
      check(g.paths[0].joined.empty(), "bridge joined");
    }
    {
      const std::vector<TagIn> tags{tag(0, 0, 2, 0.01), tag(1, 2, 3, 0.02)};
      const Graph apart = buildGraph(tags, spec(b), RES, ev());
      check(sorted(seqs(apart)) == SV{"PE", "PTI"}, "touch apart: " + str(seqs(apart)));
      check(apart.paths[0].relations.size() == 1 && apart.paths[0].relations[0].path == 1 && !apart.paths[0].relations[0].fork
                && apart.paths[0].relations[0].shared == 0,
            "touch relation");
      const Graph g = buildGraph(tags, spec(b), RES, ev(true));
      check(seqs(g) == SV{"PEPTI"}, "touch joined: " + str(seqs(g)));
      check(g.paths[0].joined.size() == 1, "touch junction");
      check(g.arcs.size() == 1 && g.arcs[0].touch && g.arcs[0].used, "touch arc");
    }
    {
      const auto one = ions(N, "PPPAG");
      const double start2 = N + sum("PPP") - R('V');
      const auto two = ions(start2, "VASSS");
      const Graph g = buildGraph({at(0, N, "PPPAG", 0.01), at(1, start2, "VASSS", 0.02)}, spec(cat(one, two)), RES, ev());
      check(seqs(g) == SV{"PPPAG", "VASSS"}, "cross: " + str(seqs(g)));
      check(g.paths[0].relations.size() == 1 && g.paths[0].relations[0].fork && g.paths[0].relations[0].shared == 1, "cross fork");
      check(std::all_of(g.paths.begin(), g.paths.end(), [](const Path& p) { return p.chain.size() == 1; }), "cross chains");
    }
    {
      const Graph g = buildGraph({at(0, N, "PAGP", 0.001, true), at(1, N, "PGAP", 0.001, true), at(2, N, "PQP", 300)},
                                 spec(ions(N, "PQP")), RES, ev());
      check(g.placements.size() == 1, "isobaric placements");
      check(seqs(g) == SV{"P{[AG]|Q}P"}, "isobaric: " + str(seqs(g)));
      const auto& r = g.paths[0].steps[1].readings;
      check(r.size() == 2 && r[0].label == "[AG]" && r[0].evalue == 0.001 && r[1].label == "Q" && r[1].evalue == 300, "isobaric readings");
    }
    {
      const Graph g = buildGraph({tag(0, 2, 3, 0.3, "PTI", true), tag(1, 2, 3, 0.3, "PIT", true)}, spec(b), RES, ev());
      check(seqs(g) == SV{"P[IT]"}, "gap stays: " + str(seqs(g)));
      check(!g.placements.empty() && g.placements[0].rows == std::vector<size_t>{0, 1}, "gap rows");
    }
    {
      const auto peaks = ions(N, "PPQPPP");
      const double n1 = N + R('P'), n2 = n1 + R('P');
      const Graph g = buildGraph({at(0, N, "PPQP", 0.01), at(1, n1, "PQPP", 0.02), at(2, n1, "PAGPP", 0.02, true),
                                  at(3, n1, "PGAPP", 0.02, true), at(4, n2, "AGPPP", 0.03, true), at(5, n2, "GAPPP", 0.03, true)},
                                 spec(peaks), RES, ev());
      for (const Path& p : g.paths)
      {
        std::vector<size_t> mem = p.chain;
        mem.insert(mem.end(), p.inside.begin(), p.inside.end());
        for (size_t i : mem)
        {
          const Placement& pl = g.placements[i];
          const long k0 = std::find(p.peaks.begin(), p.peaks.end(), pl.peaks[0]) - p.peaks.begin();
          for (size_t k = 0; k < pl.steps.size(); ++k)
          {
            bool ok = false;
            for (const Reading& r : pl.steps[k].readings)
              for (const Reading& x : p.steps[k0 + k].readings) ok = ok || x.label == r.label;
            check(ok, "contradiction: a member reading the path no longer shows");
          }
        }
      }
      const auto s = seqs(g);
      check(!s.empty() && s[0] == "PPQPP", "contradiction first: " + str(s));
      check(std::find(s.begin(), s.end(), "[AG]PPP") != s.end(), "contradiction alternative: " + str(s));
    }
    {
      const Graph g = buildGraph({at(0, N, "PAGP", 0.001, true), at(1, N, "PGAP", 0.001, true), at(2, N, "PQP", 300),
                                  at(3, N + R('P'), "QPP", 300)},
                                 spec(ions(N, "PQPP")), RES, ev());
      check(seqs(g)[0] == "PQPP", "reading evidence: " + str(seqs(g)));
      check(g.paths[0].steps[1].readings.size() == 1 && g.paths[0].steps[1].readings[0].label == "Q", "reading evidence Q");
      check(g.paths[0].weakest == 300, "reading evidence weakest");
    }
    {
      const Peaks s = spec(cat(b, {b[0] + R('E')}));
      const Graph g = buildGraph({tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, "EPP")}, s, RES, ev());
      check(seqs(g) == SV{"PEP", "EPP"}, "bubble: " + str(seqs(g)));
      check(g.paths.size() == 2 && g.paths[1].relations.size() == 1 && g.paths[1].relations[0].path == 0
                && g.paths[1].relations[0].fork && g.paths[1].relations[0].shared == 1,
            "bubble fork");
    }
    {
      const Peaks s = spec(cat(cat(b, {b[0] + R('E')}), ions(3000, "SSS")));
      const std::vector<TagIn> strong{tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, "EPP")};
      const std::vector<TagIn> weak{tag(0, 0, 3, 0.5), tag(1, 0, 3, 0.01, "EPP")};
      check(seqs(buildGraph(strong, s, RES, ev()))[0] == "PEP", "Astra 5 strong");
      check(seqs(buildGraph(weak, s, RES, ev()))[0] == "EPP", "Astra 5 weak");
      std::vector<TagIn> more = strong;
      more.push_back(at(2, 3000, "SSS", 1000));
      check(seqs(buildGraph(more, s, RES, ev())) == SV{"PEP", "EPP", "SSS"}, "Astra 5 unrelated");
    }
    {
      const Peaks s = spec(cat(b, {b[0] + R('E')}));
      const std::vector<TagIn> tags{tag(0, 0, 3, 0.01), tag(1, 0, 3, 0.5, "EPP"), tag(2, 2, 3, 0.5), tag(3, 4, 3, 0.2), tag(4, 1, 2, 0.5)};
      const Graph a = buildGraph(tags, s, RES, ev());
      std::vector<TagIn> r(tags.rbegin(), tags.rend());
      for (size_t i = 0; i < r.size(); ++i) r[i].index = i;
      const Graph gr = buildGraph(r, s, RES, ev());
      check(seqs(gr) == seqs(a), "order: " + str(seqs(gr)) + " vs " + str(seqs(a)));
      bool same = gr.paths.size() == a.paths.size();
      for (size_t i = 0; same && i < a.paths.size(); ++i) same = gr.paths[i].peaks == a.paths[i].peaks;
      check(same, "order peaks");
    }
    {
      const Graph g = buildGraph({tag(0, 1, 3, 0.01)}, spec(cat(b, y)), RES, ev());
      std::vector<std::string> series;
      for (const Path& p : g.paths) series.push_back(std::string(1, p.series));
      check(sorted(series) == SV{"b", "y"}, "b and y: " + str(series));
      check(seqs(g) == SV{"EPT", "EPT"}, "b and y seqs: " + str(seqs(g)));
      check(g.paths[0].same_as.size() == 1 && g.paths[0].same_as[0].first == 1 && g.paths[0].same_as[0].second == 3, "b and y sameAs");
      const Peaks s2 = spec({b[0], b[1], b[2], y[5], y[5] + R('P'), y[7]});
      const Graph g2 = buildGraph({tag(0, 0, 2, 0.01), tag(1, 0, 2, 0.01, "EP")}, s2, RES, ev());
      check(g2.paths.size() > 1, "opposite orders: several");
      check(std::all_of(g2.paths.begin(), g2.paths.end(), [](const Path& p) { return p.same_as.empty(); }), "opposite orders sameAs");
    }
    {
      TagIn offt = tag(0, 0, 3, 0.01);
      offt.nterm_mass += 3;
      offt.cterm_mass += 3;
      const Graph g = buildGraph({offt, tag(1, 0, 3, std::nullopt), tag(2, 3, 3, 0.5)}, spec(b), RES, ev());
      check(g.off_peaks == std::vector<size_t>{0}, "off peaks");
      check(seqs(g) == SV{"TID", "PEP"}, "unscored: " + str(seqs(g)));
      check(g.paths.size() == 2 && !g.paths[1].best, "unscored best null");
      check(seqs(buildGraph({tag(0, 0, 3, std::nan("")), tag(1, 3, 3, 0.5)}, spec(b), RES, ev()))[0] == "TID", "NaN E");
      check(buildGraph({}, spec(b), RES, ev()).paths.empty(), "no tags");
    }
  }

  Step step(int u, int v, double ppm, double e, bool gap = false)
  {
    Step st;
    st.u = u;
    st.v = v;
    st.readings.push_back({gap ? "[AG]" : "G", gap, e, 0, ppm, 0});
    return st;
  }

  void stepCases()
  {
    Peaks s;
    s.mz = {200, 257.02, 314.04, 400, 500};
    s.intensity = {1000, 900, 800, 10, 5};
    s.precursor = 600;
    s.charge = 2;
    s.tolerance = 20;
    const StepModel m(s);
    check(m.fullModel(), "20 ppm: the full model");
    check(m.logit(step(0, 1, 1, 0.001), 1) > m.logit(step(3, 4, 15, 0.001), 1), "intense accurate step beats a weak off one");
    check(m.logit(step(0, 1, 1, 0.001), 1) > m.logit(step(0, 1, 1, 0.001, true), 1), "a gap step is worth less");
    Peaks da = s;
    da.ppm = false;
    da.tolerance = 0.5;
    check(!StepModel(da).fullModel(), "Da: the model without the mass error");

    // A placement adds only the steps it does not share with the one before it.
    Graph g;
    Placement a, bb;
    a.peaks = {0, 1, 2};
    a.steps = {step(0, 1, 1, 0.001), step(1, 2, 1, 0.001)};
    a.charge = 1;
    bb.peaks = {1, 2, 3};
    bb.steps = {a.steps[1], step(2, 3, 1, 0.001)};
    bb.charge = 1;
    g.placements = {a, bb};
    Options o;
    const Weight w = weightOf(g, s, o);
    check(std::fabs(w(g, 1, 0) - (m.logit(bb.steps[1], 1) - STEP_THRESHOLD)) < 1e-9, "continuing weight");
    check(std::fabs(w(g, 0, -1) - (m.logit(a.steps[0], 1) + m.logit(a.steps[1], 1) - 2 * STEP_THRESHOLD)) < 1e-9, "fresh weight");
    o.scheme = Scheme::ANCHOR;
    g.placements[1].evalue = 1e-5;
    g.placements[0].evalue = 1e-3;
    const Weight wa = weightOf(g, s, o);
    check(std::fabs(wa(g, 1, 0) - w(g, 1, 0) - 1e6) < 1e-6 && wa(g, 0, -1) == w(g, 0, -1), "anchor weight");
    check(evidence(1e-3) == 6000 && evidence(std::nullopt) == 0 && evidence(1e9) == 1, "evidence");
  }

  void ranking()
  {
    // The default scheme (steplogodds, t = 3) on the nested case still
    // resolves one tag; its rows carry every member.
    const Peaks s = spec(b);
    const Graph g = buildGraph({tag(0, 0, 3, 0.01), tag(1, 2, 3, 0.5), tag(2, 1, 2, 0.1), tag(3, 3, 3, 0.02)}, s, RES);
    check(!g.paths.empty(), "steplogodds: a path");
    std::string rows;
    appendResolvedRows(rows, g, s, "scan=1");
    check(!rows.empty() && rows.back() == '\n', "resolved rows");
    const std::string first = rows.substr(0, rows.find('\n'));
    std::vector<std::string> f;
    size_t at = 0;
    for (;;)
    {
      const size_t tab = first.find('\t', at);
      f.push_back(first.substr(at, tab == std::string::npos ? std::string::npos : tab - at));
      if (tab == std::string::npos) break;
      at = tab + 1;
    }
    size_t cols = 1;
    for (char c : resolvedHeader()) if (c == '\t') ++cols;
    check(f.size() == cols, "resolved row has every column: " + std::to_string(f.size()));
    if (f.size() == cols)
    {
      check(f[0] == "scan=1" && f[1] == "1", "spectrum, rank");
      check(f[13].find(';') != std::string::npos && f[13].find('.') == f[13].find(';') - 7, "peaks with 6 decimals: " + f[13]);
      // nterm + residues + cterm + H2O = M.
      const double nterm = std::stod(f[7]), cterm = std::stod(f[8]);
      double res = 0;
      for (const Step& st : g.paths[0].steps) res += st.readings[0].mass;
      check(std::fabs(nterm + res + cterm + WATER - M) < 0.01, "flanks add up: " + f[7] + " " + f[8]);
    }
    std::string nodes;
    appendGraphRows(nodes, g, s, "scan=1");
    check(std::count(nodes.begin(), nodes.end(), '\n') == static_cast<long>(g.placements.size()), "one node row per placement");
  }
}

int main()
{
  graphCases();
  stepCases();
  ranking();
  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "taggraph_test: all passed\n";
  return 0;
}
