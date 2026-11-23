// Tag merging (src/TagGraph.h): the synthetic PEPTIDE cases of the GUI's
// gui/src/spectrum/graph.test.ts and stepScore.test.ts, with the same
// expectations, so the port resolves and ranks as the Spectrum tab does.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT

#include "TagGraph.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <tuple>
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
  Options sl()
  {
    Options o;
    o.scheme = Scheme::STEPLOGODDS;  // the 1.15 default, GUI stepWeight(s, 3)
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
    Options o = sl();
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

  std::vector<std::string> fields(const std::string& line)
  {
    std::vector<std::string> f;
    size_t at = 0;
    for (;;)
    {
      const size_t tab = line.find('\t', at);
      f.push_back(line.substr(at, tab == std::string::npos ? std::string::npos : tab - at));
      if (tab == std::string::npos) break;
      at = tab + 1;
    }
    return f;
  }
  std::vector<std::vector<std::string>> resolvedRows(const Graph& g, const Peaks& s)
  {
    std::string buf;
    appendResolvedRows(buf, g, s, "scan=1");
    std::vector<std::vector<std::string>> out;
    std::istringstream in(buf);
    for (std::string line; std::getline(in, line);) out.push_back(fields(line));
    return out;
  }
  std::vector<double> numbers(const std::string& list)
  {
    std::vector<double> out;
    std::istringstream in(list);
    for (std::string x; std::getline(in, x, ';');) out.push_back(std::stod(x));
    return out;
  }
  // A resolved row read as a tag row, the way place() reads one: the b/c
  // ladder walks from nterm (+ C_OFFSET) over the sequence, the y/z ladder
  // from cterm (+ H2O or the z-dot offset) over it reversed. The walk of the
  // row's own series must land on its peaks, in order.
  void landsOnItsPeaks(const std::vector<std::string>& f, const std::string& what)
  {
    const std::string seq = f[2];
    const char series = f[4][0];
    const int z = std::stoi(f[6]);
    const double nterm = std::stod(f[7]), cterm = std::stod(f[8]);
    const std::vector<double> peaks = numbers(f[13]);
    const bool nt = series == 'b' || series == 'c';
    double at = nt ? nterm + (series == 'c' ? C_OFFSET : 0) : cterm + (series == 'z' ? Z_DOT_OFFSET : WATER);
    const std::string walk = nt ? seq : rev(seq);
    bool ok = peaks.size() == walk.size() + 1;
    for (size_t k = 0; ok && k < peaks.size(); ++k)
    {
      ok = std::fabs((at + z * PROTON) / z - peaks[k]) < 0.005;
      if (k < walk.size()) at += R(walk[k]);
    }
    check(ok, what + ": [" + f[7] + "]" + seq + "[" + f[8] + "] (" + series + ") does not land on " + f[13]);
  }

  void ranking()
  {
    // steplogodds (t = 3, the 1.15 default) on the nested case: no step
    // clears the threshold, so nothing chains and each tag is its own
    // resolved tag, shortest (least negative) first. Sequences, members and
    // scores as the GUI's buildGraph(..., {weight: stepWeight(s, 3)}) at
    // 38b5da63 with OpenMS residue masses (tag-merge-cli/parity/gui-openms).
    {
      const Peaks s = spec(b);
      const Graph g = buildGraph({tag(0, 0, 3, 0.01), tag(1, 2, 3, 0.5), tag(2, 1, 2, 0.1), tag(3, 3, 3, 0.02)}, s, RES, sl());
      check(seqs(g) == SV{"EP", "PEP", "PTI", "TID"}, "steplogodds nested: " + str(seqs(g)));
      const std::vector<double> score{-6.8371284389768539, -9.0198907011653819, -12.895701140519153, -13.792873793904240};
      const std::vector<size_t> row{2, 0, 1, 3};
      for (size_t r = 0; r < g.paths.size() && r < score.size(); ++r)
      {
        const Path& p = g.paths[r];
        check(std::fabs(p.score - score[r]) < 1e-9, "steplogodds nested score " + std::to_string(r) + ": " + std::to_string(p.score));
        check(p.chain.size() == 1 && g.placements[p.chain[0]].rows == std::vector<size_t>{row[r]} && p.inside.empty(),
              "steplogodds nested members " + std::to_string(r));
        check(p.series == 'b', "steplogodds nested series");
      }
      const auto rows = resolvedRows(g, s);
      size_t cols = 1;
      for (char c : resolvedHeader()) if (c == '\t') ++cols;
      check(rows.size() == g.paths.size(), "one resolved row per path");
      for (const auto& f : rows)
      {
        check(f.size() == cols, "resolved row has every column: " + std::to_string(f.size()));
        if (f.size() != cols) continue;
        check(f[13].find(';') != std::string::npos && f[13].find('.') == f[13].find(';') - 7, "peaks with 6 decimals: " + f[13]);
        // nterm + residues + cterm + H2O = M.
        double res = 0;
        for (char c : f[2]) res += R(c);
        check(std::fabs(std::stod(f[7]) + res + std::stod(f[8]) + WATER - M) < 0.01, "flanks add up: " + f[7] + " " + f[8]);
        landsOnItsPeaks(f, "nested rank " + f[1]);
      }
      if (!rows.empty() && rows[0].size() == cols) check(rows[0][0] == "scan=1" && rows[0][1] == "1", "spectrum, rank");
      // The ranking on every row: the scheme's name and threshold (none under evidence).
      for (const auto& [o, scheme, thr] : std::vector<std::tuple<Options, std::string, std::string>>{
             {Options{}, "cstar", "3"}, {[] { Options o; o.scheme = Scheme::STEPLOGODDS; o.threshold = 2.5; return o; }(), "steplogodds", "2.5"},
             {[] { Options o; o.scheme = Scheme::EVIDENCE; return o; }(), "evidence", ""},
             {[] { Options o; o.scheme = Scheme::ANCHOR; return o; }(), "anchor", "3"}})
      {
        std::string b;
        appendResolvedRows(b, g, s, "scan=1", false, o);
        std::istringstream in(b);
        size_t n = 0;
        for (std::string line; std::getline(in, line); ++n)
        {
          const auto f = fields(line);
          check(f.size() == cols && f[cols - 2] == scheme && f[cols - 1] == thr,
                "resolved row records its ranking " + scheme + ": " + (f.size() >= 2 ? f[f.size() - 2] + "/" + f.back() : line));
        }
        check(n == g.paths.size(), "ranked rows " + scheme);
      }
      // EP = SEQ[1, 3): the flanks are the tag's own, N + P and C + TIDE.
      if (!rows.empty() && rows[0].size() == cols)
        check(std::fabs(std::stod(rows[0][7]) - (N + R('P'))) < 0.001 && std::fabs(std::stod(rows[0][8]) - (C + sum("TIDE"))) < 0.001,
              "a b row keeps its tag's flanks: " + rows[0][7] + " " + rows[0][8]);
      std::string nodes;
      appendGraphRows(nodes, g, s, "scan=1");
      check(std::count(nodes.begin(), nodes.end(), '\n') == static_cast<long>(g.placements.size()), "one node row per placement");
    }
    // Steps that clear the threshold: b and y ions with complements, the b
    // ions intense. PEP and PTI chain into PEPTI and absorb EP; the y
    // readings of the same tags stay apart. Expected as above (GUI, OpenMS masses).
    {
      Peaks s = spec(cat(b, y));
      std::set<double> bs;
      for (double x : b) bs.insert(std::round(x * 1e6) / 1e6);
      for (size_t k = 0; k < s.mz.size(); ++k) s.intensity[k] = bs.count(s.mz[k]) ? 1000 : 10;
      const Graph g = buildGraph({tag(0, 0, 3, 1e-4), tag(1, 2, 3, 1e-4), tag(2, 1, 2, 1e-4), tag(3, 3, 3, 1e-4), tag(4, 3, 4, 1e-4)}, s, RES, sl());
      check(seqs(g) == SV{"PEPTI", "TID", "TIDE", "EP", "TID", "PTI", "TIDE", "PEP"}, "steplogodds chain: " + str(seqs(g)));
      const std::string series = "bbbyyyyy";
      const std::vector<double> score{1.8576127815131969, -0.32725502458656042, -0.91685039221451703, -4.3019684639441920,
                                      -4.6510570457490745, -5.3720482472967035, -5.7210191736021425, -6.8133620750023827};
      for (size_t r = 0; r < g.paths.size() && r < score.size(); ++r)
      {
        check(g.paths[r].series == series[r], "steplogodds chain series " + std::to_string(r));
        check(std::fabs(g.paths[r].score - score[r]) < 1e-9, "steplogodds chain score " + std::to_string(r) + ": " + std::to_string(g.paths[r].score));
      }
      if (!g.paths.empty())
      {
        const Path& p = g.paths[0];
        std::vector<size_t> chain, inside;
        for (size_t i : p.chain) for (size_t r : g.placements[i].rows) chain.push_back(r);
        for (size_t i : p.inside) for (size_t r : g.placements[i].rows) inside.push_back(r);
        check(chain == std::vector<size_t>{0, 1} && inside == std::vector<size_t>{2}, "steplogodds chain members " + str(chain) + " " + str(inside));
        check(g.arcs.end() != std::find_if(g.arcs.begin(), g.arcs.end(), [&](const Arc& a) { return a.from == p.chain[0] && a.to == p.chain[1] && a.used; }),
              "steplogodds chain arc used");
      }
      const auto rows = resolvedRows(g, s);
      for (const auto& f : rows) if (f.size() > 13) landsOnItsPeaks(f, "chain rank " + f[1]);
      // PEPTI = SEQ[0, 5) read as b: N and C + DE.
      if (!rows.empty() && rows[0].size() > 13)
        check(std::fabs(std::stod(rows[0][7]) - N) < 0.001 && std::fabs(std::stod(rows[0][8]) - (C + sum("DE"))) < 0.001,
              "chained b row flanks: " + rows[0][7] + " " + rows[0][8]);
    }
    // One tag on a b ladder, and on a y ladder: the row keeps the tag's flanks.
    for (const bool yl : {false, true})
    {
      const Peaks s = spec(yl ? y : b);
      const Graph g = buildGraph({tag(0, 0, 4, 0.01)}, s, RES);
      const auto rows = resolvedRows(g, s);
      check(rows.size() == 1 && rows[0].size() > 13 && rows[0][2] == "PEPT" && rows[0][4] == (yl ? "y" : "b"),
            std::string("single ") + (yl ? "y" : "b") + " tag resolved");
      if (rows.size() != 1 || rows[0].size() <= 13) continue;
      check(std::fabs(std::stod(rows[0][7]) - N) < 0.001 && std::fabs(std::stod(rows[0][8]) - (C + sum("IDE"))) < 0.001,
            std::string("single ") + (yl ? "y" : "b") + " tag flanks: " + rows[0][7] + " " + rows[0][8]);
      landsOnItsPeaks(rows[0], std::string("single ") + (yl ? "y" : "b"));
    }
    // c and z-dot: the same tag read as cz ions.
    for (const bool zl : {false, true})
    {
      std::vector<double> mz;
      if (!zl) for (double x : ions(N + C_OFFSET, SEQ)) mz.push_back(x);
      else for (double x : ions(C + Z_DOT_OFFSET, rev(SEQ))) mz.push_back(x);
      const Peaks s = spec(mz);
      TagIn t = tag(0, 0, 4, 0.01);
      t.cz = true;
      const Graph g = buildGraph({t}, s, RES);
      const auto rows = resolvedRows(g, s);
      check(rows.size() == 1 && rows[0].size() > 13 && rows[0][4] == (zl ? "z" : "c"), std::string("single ") + (zl ? "z" : "c") + " tag resolved");
      if (rows.size() != 1 || rows[0].size() <= 13) continue;
      check(std::fabs(std::stod(rows[0][7]) - N) < 0.001 && std::fabs(std::stod(rows[0][8]) - (C + sum("IDE"))) < 0.001,
            std::string("single ") + (zl ? "z" : "c") + " tag flanks: " + rows[0][7] + " " + rows[0][8]);
      landsOnItsPeaks(rows[0], std::string("single ") + (zl ? "z" : "c"));
    }
  }
  // ---- cstar (scheme X1 = CstarNS_t3) ----
  // Synthetic cases with the logits, mass errors, path order and noself pick
  // that the frozen reference (work/tag-score/heldout3/bench3.ts: massErr,
  // cstarLogits, s2weight, noself) computes on them with OpenMS residue
  // masses (tag-merge-cli/parity/x1: cases.json, ref-cases.ts -> ref-cases.om.json).
  struct XPlacement
  {
    std::string layer;
    std::vector<int> peaks;
    std::vector<double> logits, d;
  };
  struct XCase
  {
    std::string name;
    std::vector<double> mz, intensity;
    double precursor;
    int charge;
    double tolerance;
    bool ppm;
    std::vector<TagIn> tags;
    std::vector<XPlacement> placements;
    std::vector<std::string> paths;  // X1 graph order, before noself
    long pick;
  };
  TagIn xtag(size_t i, const std::string& t, int z, double n, double c, bool gap, std::optional<double> e)
  {
    TagIn x;
    x.seq = t; x.charge = z; x.nterm_mass = n; x.cterm_mass = c; x.gapped = gap; x.evalue = e; x.index = i;
    return x;
  }
  std::vector<XCase> xcases()
  {
    std::vector<XCase> v;
    {
      XCase x;
      x.name = "ppm";
      x.mz = {99.533659, 101.007125, 164.054956, 198.060041, 212.581338, 219.017677, 230.049871, 263.105177, 319.64721, 327.102635, 327.103126, 347.113065, 400.0, 424.154763, 476.155042, 525.203078, 591.182786, 638.2881, 704.265879, 753.312957, 805.31469, 882.356681, 902.366174, 1010.45316, 1031.410218, 1128.461363};
      x.intensity = {200.0, 1000.0, 200.0, 2000.0, 200.0, 400.0, 300.0, 200.0, 200.0, 250.0, 1000.0, 800.0, 5000.0, 2000.0, 1200.0, 1000.0, 400.0, 2000.0, 800.0, 1000.0, 1200.0, 2000.0, 400.0, 1000.0, 800.0, 1200.0};
      x.precursor = 410.15892069794535;
      x.charge = 3;
      x.tolerance = 10.0;
      x.ppm = true;
      x.tags.push_back(xtag(0, "PEP", 1, 100.0, 786.2962453398, false, 0.0001));
      x.tags.push_back(xtag(1, "PTI", 1, 326.0953584466, 572.1645017656, false, 0.001));
      x.tags.push_back(xtag(2, "EP", 1, 197.0527642233, 786.2962453398, false, 0.05));
      x.tags.push_back(xtag(3, "TIDE", 1, 423.1481226699, 328.0949633828, false, 0.2));
      x.tags.push_back(xtag(4, "EPP", 1, 100.0, 786.2962453398, false, 0.5));
      x.tags.push_back(xtag(5, "EPTI", 2, 197.0527642233, 572.1645017656, false, 0.01));
      x.tags.push_back(xtag(6, "PIT", 1, 326.0953584466, 572.1645017656, true, 0.3));
      x.tags.push_back(xtag(7, "IDEK", 1, 524.1958018932, 200.0, false, 0.02));
      x.tags.push_back(xtag(8, "TID", 1, 423.1481226699, 457.1375576061, false, std::nullopt));
      x.placements.push_back({"by1", {1, 3, 9, 13}, {5.459119780769466, 4.568005552391727, 3.4595381759029884}, {0.7663172014157376, -0.0006826603267140731, -1.49997689808871}});
      x.placements.push_back({"by1", {1, 6, 9, 13}, {-1.9716488036484716, -3.2173497824868456, 2.907268014943395}, {0.6597560758010098, -0.0006826603267140731, -1.49997689808871}});
      x.placements.push_back({"by1", {3, 9, 13}, {2.6408874534369824, 3.056571783374123}, {-0.0006826603267140731, -1.49997689808871}});
      x.placements.push_back({"by1", {5, 11, 14, 16, 18}, {0.9580363031004409, 3.7101220332018263, 2.9329698376158286, 1.1289401460743425}, {1.223283599031062, -1.2962637071928937, 1.3529514070684747, -1.379237002916143}});
      x.placements.push_back({"by1", {9, 13, 15, 17}, {3.3102344074722607, 2.583329825822929, 3.738873375080238}, {-1.49997689808871, 1.210536449994045, 1.5003421445186391}});
      x.placements.push_back({"by1", {9, 13, 17}, {2.940390869282762, -4.492831721651645}, {-1.49997689808871, 2.4964115385468917}});
      x.placements.push_back({"by1", {11, 14, 16, 18, 20}, {3.5608182647710978, 2.7836660691851, 0.4149203178218085, 1.8154600511380437}, {-1.2962637071928937, 1.3529514070684747, -1.379237002916143, 1.4053863720268431}});
      x.placements.push_back({"by1", {13, 15, 17, 19}, {-1.7007891436922744, -0.5452455944349661, 3.7317668471429846}, {1.210536449994045, 1.5003421445186391, -2.770632972434089}});
      x.placements.push_back({"by1", {13, 15, 17, 19, 21}, {0.940348783515004, 2.095892332772313, 4.284037008102578, 3.948246413561578}, {1.210536449994045, 1.5003421445186391, -2.770632972434089, 1.2804098058746078}});
      x.placements.push_back({"by1", {14, 16, 18, 20}, {2.2313959082255064, -2.2262176093854706, -0.8256778760692345}, {1.3529514070684747, -1.379237002916143, 1.4053863720268431}});
      x.placements.push_back({"by1", {15, 17, 19, 21, 23}, {2.809912161024847, 4.433340776533306, 4.097550181992307, 2.038447693685721}, {1.5003421445186391, -2.770632972434089, 1.2804098058746078, 1.4999403568788}});
      x.placements.push_back({"by1", {16, 18, 20, 22}, {2.0579013601297333, 3.458441093445969, 3.4713017792329994}, {-1.379237002916143, 1.4053863720268431, -1.4187383354845728}});
      x.placements.push_back({"by1", {16, 20, 22}, {-5.568605746592121, 3.1014582410435008}, {0.19920887333650195, -1.4187383354845728}});
      x.placements.push_back({"by1", {20, 22, 24}, {3.2176391551348624, 1.4449720136765312}, {-1.4187383354845728, 1.4056276663478295}});
      x.placements.push_back({"by1", {20, 22, 24, 25}, {3.620605547663727, 1.8479384062053965, 3.0375717857283293}, {-1.4187383354845728, 1.4056276663478295, -1.434892704213751}});
      x.placements.push_back({"by2", {0, 2, 4, 7, 8}, {1.0995651052240492, 1.3053644440840229, 0.5707514174162432, 0.14007711262767594}, {-0.0006805646020184912, -0.0005252107118483108, -0.0023247355745085684, 0.002579562465498741}});
      x.paths = {"PEPTIDE/b/1,3,9,13,15,17,19,21", "IDEK/b/15,17,19,21,23", "PTI/y/16,18,20,22", "PEP/y/20,22,24,25", "IDEK/y/5,11,14,16,18", "TIDE/y/11,14,16,18,20", "P[IT]/b/9,13,17", "P[IT]/y/16,20,22", "EPTI/b/0,2,4,7,8", "EPP/b/1,6,9,13"};
      x.pick = 0;
      v.push_back(x);
    }
    {
      XCase x;
      x.name = "da";
      x.mz = {99.533659, 100.967276, 164.054956, 198.060041, 212.581338, 219.007841, 230.099871, 263.105177, 319.64721, 327.122635, 327.142635, 347.122805, 424.115399, 476.145399, 525.203078, 591.192343, 638.327143, 704.256407, 753.274087, 805.324086, 882.356681, 902.356851, 1010.491644, 1031.419445, 1128.452209};
      x.intensity = {100.0, 800.0, 100.0, 1600.0, 100.0, 500.0, 300.0, 100.0, 100.0, 250.0, 800.0, 1000.0, 1600.0, 1500.0, 800.0, 500.0, 1600.0, 1000.0, 800.0, 1500.0, 1600.0, 500.0, 800.0, 1000.0, 1500.0};
      x.precursor = 614.734742813512;
      x.charge = 2;
      x.tolerance = 0.3;
      x.ppm = false;
      x.tags.push_back(xtag(0, "PEP", 1, 100.0, 786.2962453398, false, 0.0001));
      x.tags.push_back(xtag(1, "PTI", 1, 326.0953584466, 572.1645017656, false, 0.001));
      x.tags.push_back(xtag(2, "EP", 1, 197.0527642233, 786.2962453398, false, 0.05));
      x.tags.push_back(xtag(3, "TIDE", 1, 423.1481226699, 328.0949633828, false, 0.2));
      x.tags.push_back(xtag(4, "EPP", 1, 100.0, 786.2962453398, false, 0.5));
      x.tags.push_back(xtag(5, "EPTI", 2, 197.0527642233, 572.1645017656, false, 0.01));
      x.tags.push_back(xtag(6, "PIT", 1, 326.0953584466, 572.1645017656, true, 0.3));
      x.tags.push_back(xtag(7, "IDEK", 1, 524.1958018932, 200.0, false, 0.02));
      x.tags.push_back(xtag(8, "TID", 1, 423.1481226699, 457.1375576061, false, std::nullopt));
      x.placements.push_back({"by1", {1, 3, 9, 12}, {5.868486334565002, 4.100289709139713, 5.758872238214823}, {2.6667184466684075, 1.3333184466659986, -4.000014886666274}});
      x.placements.push_back({"by1", {1, 6, 10, 12}, {-1.2330464563328254, 0.9250783514862096, 0.7058832965469133}, {6.000051780000604, -0.6666815533321824, -5.333348219998395}});
      x.placements.push_back({"by1", {3, 9, 12}, {3.697323316610847, 3.8317541392600782}, {1.3333184466659986, -4.000014886666274}});
      x.placements.push_back({"by1", {5, 11, 13, 15, 17}, {1.580665350132689, 4.2504184798623035, 3.0047471223540962, 2.4293572276531417}, {1.3333744799979286, -1.3333482200020323, 1.3333227000051315, -1.3333567266727187}});
      x.placements.push_back({"by1", {9, 12, 14, 16}, {5.044852409962289, 3.96622144434004, 3.967918573148565}, {-4.000014886666274, 2.66665177999433, 2.666709939997721}});
      x.placements.push_back({"by1", {9, 12, 16}, {3.2761387171066554, -3.1013203768774265}, {-4.000014886666274, 5.333361719992051}});
      x.placements.push_back({"by1", {11, 13, 15, 17, 19}, {4.101114711431575, 2.8554433539233677, 1.715337399400608, 2.979534026237327}, {-1.3333482200020323, 1.3333227000051315, -1.3333567266727187, 1.3333184466697883}});
      x.placements.push_back({"by1", {12, 14, 16, 18}, {-0.317897525175165, -0.3162003963666387, 3.0497666165803783}, {2.66665177999433, 2.666709939997721, -5.333343966663051}});
      x.placements.push_back({"by1", {12, 14, 16, 18, 20}, {2.3232404020321145, 2.324937530840641, 3.6020367775399724, 3.275391843474064}, {2.66665177999433, 2.666709939997721, -5.333343966663051, 2.66665177999433}});
      x.placements.push_back({"by1", {13, 15, 17, 19}, {2.303173192963775, -0.925800527806671, 0.33839609903004875}, {1.3333227000051315, -1.3333567266727187, 1.3333184466697883}});
      x.placements.push_back({"by1", {14, 16, 18, 20, 22}, {3.038957359093175, 3.7513405459707005, 3.4246956119047915, 1.31446153663092}, {2.666709939997721, -5.333343966663051, 2.66665177999433, 2.6666411466673408}});
      x.placements.push_back({"by1", {15, 17, 19, 21}, {3.3583184417085326, 4.622515068545252, 3.5063168316633337}, {-1.3333567266727187, 1.3333184466697883, -1.333281553327955}});
      x.placements.push_back({"by1", {15, 19, 21}, {-5.5527689682871175, 3.136473293473835}, {-3.8280002930453826e-05, -1.333281553327955}});
      x.placements.push_back({"by1", {19, 21, 23}, {3.2526542075651967, 2.7556776238168084}, {-1.333281553327955, 1.3333184466622092}});
      x.placements.push_back({"by1", {19, 21, 23, 24}, {3.6556206000940614, 3.158644016345674, 4.173133778703032}, {-1.333281553327955, 1.3333184466622092, -1.3333482200020323}});
      x.placements.push_back({"by2", {0, 2, 4, 7, 8}, {1.130313276546694, 1.3334914849960582, 0.5956978744321435, 0.1624680791817666}, {-7.443333061019075e-06, -7.443333061019075e-06, -4.077666441541321e-05, 5.496999619936105e-05}});
      x.paths = {"PEPTIDE/b/1,3,9,12,14,16,18,20", "PEPTI/y/15,17,19,21,23,24", "TIDE/y/11,13,15,17,19", "IDEK/b/14,16,18,20,22", "IDEK/y/5,11,13,15,17", "P[IT]/b/9,12,16", "P[IT]/y/15,19,21", "EPP/b/1,6,10,12", "EPTI/b/0,2,4,7,8"};
      x.pick = 0;
      v.push_back(x);
    }
    {
      XCase x;
      x.name = "noself";
      x.mz = {101.007276, 198.060041, 327.102635, 424.155399, 525.203078, 638.287143, 753.314087, 882.356681, 1501.007276, 1558.028741, 1615.050205, 1672.071669};
      x.intensity = {1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 200.0, 200.0, 200.0, 200.0};
      x.precursor = 361.631559525062;
      x.charge = 2;
      x.tolerance = 10.0;
      x.ppm = true;
      x.tags.push_back(xtag(0, "PEPT", 1, 100.0, 5000.0, false, 1e-06));
      x.tags.push_back(xtag(1, "EPTI", 1, 197.0527642233, 5000.0, false, 1e-06));
      x.tags.push_back(xtag(2, "GGG", 1, 1500.0, 5000.0, false, 0.01));
      x.placements.push_back({"by1", {0, 1, 2, 3, 4}, {4.49219781135326, 4.633338855967391, 3.226605854061652, 4.212605596980548}, {0.003921538159686279, -0.0006826603267140731, -0.0005264581072948525, -0.00042516896403080654}});
      x.placements.push_back({"by1", {1, 2, 3, 4, 5}, {4.633338855967391, 3.226605854061652, 4.212605596980548, 3.290777202009106}, {-0.0006826603267140731, -0.0005264581072948525, -0.00042516896403080654, 0.0010169404318590865}});
      x.placements.push_back({"by1", {8, 9, 10, 11}, {1.388738935805344, 1.243146483618347, 1.0977080167887057}, {0.0005804129920788281, -5.925511669939546e-05, -5.7234381843264725e-05}});
      x.paths = {"PEPTI/b/0,1,2,3,4,5", "GGG/b/8,9,10,11"};
      x.pick = 1;
      v.push_back(x);
    }
    return v;
  }

  std::string pathKey(const Path& p)
  {
    std::string k = sequenceOf(p.series, p.steps) + "/" + std::string(1, p.series) + "/";
    for (size_t i = 0; i < p.peaks.size(); ++i) k += (i ? "," : "") + std::to_string(p.peaks[i]);
    return k;
  }

  void cstarCases()
  {
    for (const XCase& x : xcases())
    {
      Peaks s;
      s.mz = x.mz;
      s.intensity = x.intensity;
      s.precursor = x.precursor;
      s.charge = x.charge;
      s.tolerance = x.tolerance;
      s.ppm = x.ppm;
      const Graph g = buildGraph(x.tags, s, RES);  // the default: cstar, t = 3
      // The C* logits and mass errors of every placement step, as bench3 has them.
      check(g.placements.size() == x.placements.size(), x.name + ": placements " + std::to_string(g.placements.size()));
      const auto logits = cstarLogits(g, s);
      for (size_t i = 0; i < g.placements.size() && i < x.placements.size(); ++i)
      {
        const Placement& p = g.placements[i];
        const XPlacement& want = x.placements[i];
        check(layerOf(p.series, p.charge) == want.layer && p.peaks == want.peaks, x.name + ": placement " + std::to_string(i) + " " + str(p.peaks));
        if (p.steps.size() != want.logits.size()) { check(false, x.name + ": steps of placement " + std::to_string(i)); continue; }
        for (size_t k = 0; k < p.steps.size(); ++k)
        {
          check(std::fabs(logits[i][k] - want.logits[k]) <= 1e-12 * std::max(1.0, std::fabs(want.logits[k])),
                x.name + ": logit " + std::to_string(i) + "/" + std::to_string(k) + " " + std::to_string(logits[i][k]) + " vs " + std::to_string(want.logits[k]));
          check(std::fabs(stepMassError(s, p.steps[k]) - want.d[k]) <= 1e-12 * std::max(1.0, std::fabs(want.d[k])),
                x.name + ": mass error " + std::to_string(i) + "/" + std::to_string(k));
        }
      }
      // The ranking: bench3's X1 graph order, its noself pick moved to rank 1.
      std::vector<std::string> want;
      if (x.pick >= 0) want.push_back(x.paths[static_cast<size_t>(x.pick)]);
      for (size_t r = 0; r < x.paths.size(); ++r) if (static_cast<long>(r) != x.pick) want.push_back(x.paths[r]);
      std::vector<std::string> got;
      for (const Path& p : g.paths) got.push_back(pathKey(p));
      check(got == want, x.name + ": X1 ranking " + str(got) + " vs " + str(want));
      // Relations and same_as name the paths they did before the move.
      Options o;
      o.weight = weightOf(g, s, o);  // the same weight, without noself
      const Graph raw = buildGraph(x.tags, s, RES, o);
      check(noselfPick(raw, s) == x.pick, x.name + ": noself pick " + std::to_string(noselfPick(raw, s)));
      std::vector<std::string> rawKeys;
      for (const Path& p : raw.paths) rawKeys.push_back(pathKey(p));
      check(rawKeys == x.paths, x.name + ": X1 graph order " + str(rawKeys));
      for (size_t r = 0; r < raw.paths.size() && raw.paths.size() == g.paths.size(); ++r)
      {
        const size_t to = static_cast<long>(r) == x.pick ? 0 : static_cast<long>(r) < x.pick ? r + 1 : r;
        const Path& a = raw.paths[r];
        const Path& b = g.paths[to];
        bool same = a.relations.size() == b.relations.size() && a.same_as.size() == b.same_as.size();
        for (size_t k = 0; same && k < a.relations.size(); ++k)
          same = pathKey(raw.paths[a.relations[k].path]) == pathKey(g.paths[b.relations[k].path]) && a.relations[k].fork == b.relations[k].fork;
        for (size_t k = 0; same && k < a.same_as.size(); ++k)
          same = pathKey(raw.paths[a.same_as[k].first]) == pathKey(g.paths[b.same_as[k].first]);
        check(same, x.name + ": relations of " + pathKey(a) + " follow the move");
      }
      if (x.name == "da")
      {
        // ad_n at a Da tolerance: 20 * delta_mz / tol, not the ppm error.
        const Step& st = g.placements[0].steps[0];
        check(std::fabs(stepMassError(s, st) - 20 * st.readings[0].delta_mz / 0.3) < 1e-12, "da: ad_n");
        check(std::fabs(stepMassError(s, st) - st.readings[0].delta_ppm) > 1e-3, "da: not the ppm error");
      }
      if (x.name == "noself")
      {
        check(x.pick == 1 && !g.paths.empty() && sequenceOf(g.paths[0].series, g.paths[0].steps) == "GGG",
              "noself: the tag holding b1 and its complement b4 is not rank 1");
        check(g.paths.size() > 1 && sequenceOf(g.paths[1].series, g.paths[1].steps) == "PEPTI", "noself: the others after it");
      }
    }
    // A threshold reaches the weight: at t = 4 every step is worth one less.
    {
      const XCase x = xcases()[0];
      Peaks s;
      s.mz = x.mz; s.intensity = x.intensity; s.precursor = x.precursor; s.charge = x.charge; s.tolerance = x.tolerance; s.ppm = x.ppm;
      Graph g;
      g.placements = buildGraph(x.tags, s, RES).placements;
      Options o3, o4;
      o4.threshold = 4;
      const Weight w3 = weightOf(g, s, o3), w4 = weightOf(g, s, o4);
      check(std::fabs(w3(g, 0, -1) - w4(g, 0, -1) - static_cast<double>(g.placements[0].steps.size())) < 1e-9, "cstar threshold");
    }
    check(schemeFromString("cstar") == Scheme::CSTAR && Options().scheme == Scheme::CSTAR, "cstar is the default scheme");
  }

  // Every sub-tag of a 74-residue b ladder on one layer: 2775 placements.
  // Under steplogodds nearly every round extracts one placement; rerunning
  // the longest path over all of them each round, and comparing every pair
  // of resolved tags, took 90 s here. The rounds now recompute only what a
  // round can change, and pairs are found through shared peaks.
  void largeLayer()
  {
    const std::string alpha = "ADEFGHKLMNPRSTVWY";
    std::string seq;
    for (size_t i = 0; i < 74; ++i) seq += alpha[(i * 7) % alpha.size()];
    std::vector<double> mz = ions(N, seq);
    Peaks s = spec(mz);
    double tot = 0;
    for (char c : seq) tot += R(c);
    s.precursor = (N + tot + C + WATER + 2 * PROTON) / 2;
    std::vector<TagIn> tags;
    for (size_t from = 0; from < seq.size(); ++from)
      for (size_t len = 1; from + len <= seq.size(); ++len)
      {
        double pre = 0, post = 0;
        for (size_t k = 0; k < from; ++k) pre += R(seq[k]);
        for (size_t k = from + len; k < seq.size(); ++k) post += R(seq[k]);
        tags.push_back(at(tags.size(), N + pre, seq.substr(from, len), 1e-3 * static_cast<double>(1 + tags.size() % 7), false, C + post));
      }
    const auto t0 = std::chrono::steady_clock::now();
    const Graph g = buildGraph(tags, s, RES, sl());
    const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    check(g.placements.size() == 2775, "large layer placements: " + std::to_string(g.placements.size()));
    size_t members = 0;
    for (const Path& p : g.paths) members += p.chain.size() + p.inside.size();
    check(members == g.placements.size(), "large layer: every placement in one resolved tag");
    check(sec < 20, "large layer took " + std::to_string(sec) + " s");
    // cstar: its features look at every placement's steps (rivals, support).
    const auto t1 = std::chrono::steady_clock::now();
    const Graph gc = buildGraph(tags, s, RES);
    const double secc = std::chrono::duration<double>(std::chrono::steady_clock::now() - t1).count();
    size_t membersc = 0;
    for (const Path& p : gc.paths) membersc += p.chain.size() + p.inside.size();
    check(membersc == gc.placements.size(), "large layer cstar: every placement in one resolved tag");
    check(secc < 20, "large layer cstar took " + std::to_string(secc) + " s");
  }
}

int main()
{
  graphCases();
  stepCases();
  ranking();
  largeLayer();
  cstarCases();
  if (failures) { std::cerr << failures << " failure(s)\n"; return 1; }
  std::cout << "taggraph_test: all passed\n";
  return 0;
}
