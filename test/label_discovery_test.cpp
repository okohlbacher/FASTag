// Unit tests of FASTag::LabelDiscovery (-label_discovery_out): the internal
// functions of doc/DESIGN-label-discovery.md section 12 (tests 1-15), on
// synthetic flanks of simulated tryptic peptides; test 2 runs a synthetic
// spectrum through FASTag::tagSpectrum.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "CliParam.h"
#include "Digest.h"
#include "FASTagger.h"
#include "LabelDiscovery.h"
#include "complement_synth.h"

#include <OpenMS/CHEMISTRY/AASequence.h>
#include <OpenMS/CONCEPT/Constants.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <functional>
#include <map>
#include <random>
#include <string>
#include <vector>

namespace LD = FASTag::LabelDiscovery;
namespace FD = FASTag::Digest;

static int failures = 0;
#define CHECK(c, ...) do { if (!(c)) { ++failures; std::printf("FAIL %d: ", __LINE__); \
  std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

namespace
{
  constexpr double kTMT = 229.162932, kTMTpro = 304.207146, kiTRAQ4 = 144.102063, kiTRAQ8 = 304.205360;
  constexpr double kDimethyl = 28.0313, kUnknown = 123.4567;
  constexpr double H2O = LD::kH2O, C13 = LD::kC13;

  double u01(std::mt19937& g) { return (g() >> 8) * (1.0 / 16777216.0); }
  double gauss(std::mt19937& g)
  {
    const double a = std::max(1e-12, u01(g));
    const double b = u01(g);
    return std::sqrt(-2.0 * std::log(a)) * std::cos(6.283185307179586 * b);
  }

  std::vector<LD::Residue> alphabet() { return LD::runAlphabet({{'C', 57.021464, "Carbamidomethyl", false}}); }
  std::map<char, double> massOf()
  {
    std::map<char, double> m;
    for (const LD::Residue& r : alphabet()) m[r.letter] = r.mass;
    return m;
  }

  /// Simulated tryptic peptides and their b/y tags, with the flank rules of
  /// section 3 (forward: n = N side + L_N, c = C side; reversed: c = N side
  /// + L_N - H2O, n = C side + H2O; labelled K in the flanks; a labelled K
  /// read as the tag's last residue leaves its label in the flank, K0f/K0r).
  struct Gen
  {
    double L_N = 0, L_K = 0, c_C = 0;
    double sigma_c = 0.0004, sigma_ppm_n = 2.0, ppm_c = 0.0;
    int tags = 4;
    double iso1 = 0, iso2 = 0;  ///< share of spectra with a +1 / +2 13C precursor pick
    unsigned seed = 1;
    /// keep(reversed, residues before the tag, residues after it)
    std::function<bool(bool, int, int)> keep = [](bool, int, int) { return true; };
    std::uint32_t first_spectrum = 0;
    int spectra = 2000;
    bool refs_only = false;  ///< only tags one residue before the C-terminus (calibration references)
    /// neutral losses (test 16): share of tags whose low peak lost NH3 (c -
    /// NH3: y - NH3, b - NH3) or whose high peak lost NH3 (n + NH3), and share
    /// of the forward tags from residue 0 whose high peak is the precursor
    /// less NH3 or H2O (n = NH3, n = H2O) instead of the clamped whole peptide
    double nh3_low = 0, nh3_high = 0, prec_loss = 0;
  };

  void generate(const Gen& g, LD::Collector& col)
  {
    std::mt19937 rng(g.seed);
    const std::map<char, double> M = massOf();
    const std::string body = "GASPVTCLNDQEMHFYW";
    for (int s = 0; s < g.spectra; ++s)
    {
      const int len = 8 + static_cast<int>(u01(rng) * 9);
      std::string pep;
      for (int i = 0; i < len - 1; ++i) pep += body[static_cast<std::size_t>(u01(rng) * body.size()) % body.size()];
      pep += u01(rng) < 0.5 ? 'K' : 'R';
      std::vector<double> m(pep.size());
      for (std::size_t i = 0; i < pep.size(); ++i) m[i] = M.at(pep[i]) + (pep[i] == 'K' ? g.L_K : 0.0);
      double mass = H2O + g.L_N + g.c_C;
      for (double x : m) mass += x;
      const double r = u01(rng);
      const double shift = r < g.iso1 ? C13 : (r < g.iso1 + g.iso2 ? 2 * C13 : 0.0);
      const double Mobs = mass + shift;
      std::uint16_t order = 0;
      for (int t = 0; t < g.tags; ++t)
      {
        const bool rev = g.refs_only ? false : u01(rng) < 0.5;
        const int nt = 4;
        int i = static_cast<int>(u01(rng) * (len - nt + 1));
        if (g.refs_only) i = len - nt - 1;
        const int after = len - i - nt;
        if (!g.keep(rev, i, after)) continue;
        // a tag whose high peak is the whole peptide (forward from residue 0,
        // reversed up to the C-terminus) only with a label in that flank, or
        // (prec_loss) with the precursor less NH3 / H2O as its high peak
        double prec = -1;
        if (!rev && i == 0 && g.L_N == 0 && !g.refs_only)
        {
          if (!(g.prec_loss > 0 && u01(rng) < g.prec_loss)) continue;
          prec = u01(rng) < 0.5 ? LD::kNH3 : H2O;
        }
        if (after == 0 && !(pep.back() == 'K' && g.L_K != 0) && g.c_C == 0) continue;
        double pre = 0, suf = 0;
        for (int k = 0; k < i; ++k) pre += m[static_cast<std::size_t>(k)];
        for (int k = i + nt; k < len; ++k) suf += m[static_cast<std::size_t>(k)];
        if (pep[static_cast<std::size_t>(i + nt - 1)] == 'K') suf += g.L_K;  // K0f / K0r
        std::string seq = pep.substr(static_cast<std::size_t>(i), nt);
        double n, c;
        if (!rev)
        {
          n = pre + g.L_N + shift;
          c = suf + g.c_C;
        }
        else
        {
          c = pre + g.L_N - H2O;
          n = suf + g.c_C + H2O + shift;
          std::reverse(seq.begin(), seq.end());
        }
        if (g.nh3_low > 0 && u01(rng) < g.nh3_low) c -= LD::kNH3;
        if (g.nh3_high > 0 && u01(rng) < g.nh3_high) n += LD::kNH3;
        if (prec >= 0) n = prec + shift;
        c = c * (1.0 + g.ppm_c * 1e-6) + g.sigma_c * gauss(rng);
        n = n + g.sigma_ppm_n * Mobs * 1e-6 * gauss(rng);
        if (prec < 0 && !rev && pre == 0 && g.L_N == 0 && shift == 0) n = 0;  // FASTagger's clamp
        if (g.refs_only) n = 0;
        col.add(std::max(0.0, n), std::max(0.0, c), Mobs, g.first_spectrum + static_cast<std::uint32_t>(s), order++, seq,
                false);
      }
    }
  }

  LD::Settings settings()
  {
    LD::Settings s;
    s.alphabet = alphabet();
    s.max_flank = 700;
    return s;
  }

  std::map<std::string, std::string> rowsOf(const LD::Analysis& a, const LD::Settings& s)
  {
    std::map<std::string, std::string> m;
    for (const FD::Row& r : LD::reportRows(a, s)) m[r.section + "/" + r.key] = r.value;
    return m;
  }

  const LD::SiteCandidate* siteNear(const LD::Analysis& a, char site, double delta, double tol)
  {
    const LD::SiteCandidate* best = nullptr;
    for (const LD::SiteCandidate& c : a.sites)
      if (c.site == site && !c.control && std::fabs(c.delta - delta) <= tol &&
          (best == nullptr || std::fabs(c.delta - delta) < std::fabs(best->delta - delta)))
        best = &c;
    return best;
  }
  int calledCount(const LD::Analysis& a)
  {
    int n = 0;
    for (const LD::SiteCandidate& c : a.sites) n += c.called;
    return n;
  }
  const LD::Peak* peakNear(const std::vector<LD::Peak>& v, double m, double tol)
  {
    const LD::Peak* best = nullptr;
    for (const LD::Peak& p : v)
      if (std::fabs(p.mass - m) <= tol && (best == nullptr || std::fabs(p.mass - m) < std::fabs(best->mass - m))) best = &p;
    return best;
  }
  std::string calledList(const LD::Analysis& a)
  {
    std::string s;
    for (const LD::SiteCandidate& c : a.sites)
      if (c.called)
        s += std::string(1, c.site) + ":" + std::to_string(c.delta) + "(" + c.cls + " ladder " + std::to_string(c.ladder_clean) +
             " zero " + std::to_string(c.zero_clean) + " pars " + std::to_string(c.parsimony) + " " + c.images.substr(0, 300) + ") ";
    return s;
  }

  LD::Analysis run(const std::vector<Gen>& gens, const LD::Settings& s, const LD::UnimodTable& u)
  {
    LD::Collector col;
    col.configure(s.knownSets(), s.known_window);
    for (const Gen& g : gens) generate(g, col);
    col.finish();
    return LD::analyze(col, s, u);
  }

  Gen labelFree(unsigned seed, int spectra = 2500, std::uint32_t first = 0)
  {
    Gen g;
    g.seed = seed;
    g.spectra = spectra;
    g.first_spectrum = first;
    return g;
  }
}

int main()
{
  const LD::UnimodTable unimod = LD::UnimodTable::fromModificationsDB();
  CHECK(unimod.entries.size() > 500, "ModificationsDB entries %zu", unimod.entries.size());
  const std::vector<LD::Residue> A = alphabet();
  const std::map<char, double> M = massOf();
  const LD::Settings S = settings();

  // ---- 1. image table ----
  {
    for (double L : {kTMT, kTMTpro, kiTRAQ4, kDimethyl, kUnknown})
    {
      std::map<std::string, LD::Image> by, bk;
      for (const auto& i : LD::imagesFor('N', L, A, 2, 700)) by[i.name] = i;
      CHECK(by.count("N0f") && std::fabs(by["N0f"].mass - L) < 1e-9 && by["N0f"].ch == 'n', "N0f of %g", L);
      if (L > H2O) CHECK(by.count("N0r") && std::fabs(by["N0r"].mass - (L - H2O)) < 1e-9 && by["N0r"].ch == 'c', "N0r of %g", L);
      CHECK(std::fabs(by["N1fA"].mass - (L + 71.03711)) < 1e-9 && by["N1fA"].ch == 'n', "N1fA of %g", L);
      CHECK(std::fabs(by["N1rA"].mass - (L + 71.03711 - H2O)) < 1e-9 && by["N1rA"].ch == 'c', "N1rA of %g", L);
      CHECK(std::fabs(by["N2fGA"].mass - (L + 57.02146 + 71.03711)) < 1e-9, "N2fGA of %g", L);
      for (const auto& i : LD::imagesFor('K', L, A, 2, 700)) bk[i.name] = i;
      CHECK(std::fabs(bk["K0f"].mass - L) < 1e-9 && bk["K0f"].need == LD::kLastK && bk["K0f"].zero, "K0f of %g", L);
      CHECK(std::fabs(bk["K1f"].mass - (128.09496 + L)) < 1e-9 && bk["K1f"].ch == 'c', "K1f of %g", L);
      CHECK(std::fabs(bk["K1r"].mass - (128.09496 + L + H2O)) < 1e-9 && bk["K1r"].ch == 'n', "K1r of %g", L);
    }
    // TMT by hand: N0r 211.152367, K1f 357.257892, K1r 375.268457
    for (const auto& i : LD::imagesFor('N', kTMT, A, 1, 700))
      if (i.name == "N0r") CHECK(std::fabs(i.mass - 211.152367) < 1e-6, "TMT N0r %f", i.mass);
    for (const auto& i : LD::imagesFor('K', kTMT, A, 1, 700))
    {
      if (i.name == "K1f") CHECK(std::fabs(i.mass - 357.257892) < 1e-6, "TMT K1f %f", i.mass);
      if (i.name == "K1r") CHECK(std::fabs(i.mass - 375.268457) < 1e-6, "TMT K1r %f", i.mass);
    }
    // Dimethyl has no N0r (28.03 - 18.01 > 0 still: kept); a label under 18.01 Da has none
    bool n0r = false;
    for (const auto& i : LD::imagesFor('N', 14.01565, A, 1, 700)) n0r = n0r || i.name == "N0r";
    CHECK(!n0r, "N0r of a label below H2O is dropped");
    for (const auto& i : LD::imagesFor('N', 690.0, A, 2, 700)) CHECK(i.mass <= 700.0, "image %s beyond max_flank", i.name.c_str());
  }

  // ---- 2. convention anchor through FASTag::tagSpectrum ----
  {
    const double P = OpenMS::Constants::PROTON_MASS_U;
    const OpenMS::AASequence aa = OpenMS::AASequence::fromString("PEAGLVSDFTNK");
    const double Mpep = aa.getMonoWeight() + kTMT;  // TMT on the N-terminus only
    OpenMS::MSSpectrum spec;
    double b = kTMT;  // neutral b0 = the label
    ComplementSynth::addFragment(spec, b, 1, 1.0, 0);  // b0 at 230.1702
    for (std::size_t i = 0; i + 1 < aa.size(); ++i)
    {
      b += aa[i].getMonoWeight(OpenMS::Residue::Internal);
      ComplementSynth::addFragment(spec, b, 1, 0.8, 0);
      ComplementSynth::addFragment(spec, Mpep - b, 1, 0.8, 0);  // y = M - b
    }
    spec.sortByPosition();
    const double prec = (Mpep + 2 * P) / 2;
    FASTag::Param p = FASTag::cliDefaultParam();
    p.tag_length = 4;
    const FASTag::Tables tab(p);
    const auto tags = FASTag::tagSpectrum(spec, prec, 2, p, tab);
    bool rev = false, fwd = false;
    for (const auto& t : tags)
    {
      if (std::fabs(t.cterm_mass - (kTMT - H2O)) < 1e-6) rev = true;
      double pre = kTMT;
      for (std::size_t i = 1; i < aa.size() && !fwd; ++i)
      {
        pre += aa[i - 1].getMonoWeight(OpenMS::Residue::Internal);
        if (std::fabs(t.nterm_mass - pre) < 1e-6) fwd = true;
      }
    }
    CHECK(!tags.empty(), "no tags from the synthetic TMT spectrum");
    CHECK(rev, "no reversed tag with cterm_mass = L - H2O");
    CHECK(fwd, "no forward tag with nterm_mass = N side + L");
  }

  // ---- 3. separation ----
  {
    const LD::Analysis a = run({labelFree(11)}, S, unimod);
    CHECK(a.status == "call" && a.labels == "label-free", "label-free set: %s %s %s [%s]", a.status.c_str(), a.labels.c_str(),
          a.reason.c_str(), calledList(a).c_str());
    int bad = 0;
    for (const auto* v : {&a.peaks_n, &a.peaks_c})
      for (const LD::Peak& p : *v) bad += p.cls != "residue_combo";
    CHECK(bad == 0, "label-free set: %d channel peaks not residue_combo", bad);
  }
  {
    // An unknown offset is called on strong, site-consistent evidence only
    // (evaluation 2, tier 2: relative share >= 0.5, clean share >= 0.2,
    // >= 5 clean ladder residues). A run whose peptides mostly carry it:
    // called. (Format 1 called it at 1500 labelled against 2500 unlabelled
    // spectra; that partial set is now below the bar, next block.)
    Gen u = labelFree(12, 3000, 100000);
    u.L_N = kUnknown;
    u.keep = [](bool rev, int pre, int) { return (!rev && pre == 0) || (rev && pre <= 1); };
    const LD::Analysis a = run({labelFree(13, 1000), u}, S, unimod);
    const LD::SiteCandidate* c = siteNear(a, 'N', kUnknown, 0.005);
    CHECK(c != nullptr && c->cls == "unexplained" && c->ladder_clean >= 5 && c->called, "unknown +123.4567: %s ladder %d rel %f",
          c ? c->cls.c_str() : "missing", c ? c->ladder_clean : -1, c ? c->relative_share : 0.0);
    CHECK(a.labels == "unknown:N+123.4567", "unknown call: %s [%s]", a.labels.c_str(), calledList(a).c_str());
  }
  {
    // the same offset on 1500 of 4000 spectra: below the unknown bar, not
    // called (a known label at that share would be)
    Gen u = labelFree(12, 1500, 100000);
    u.L_N = kUnknown;
    u.keep = [](bool rev, int pre, int) { return (!rev && pre == 0) || (rev && pre <= 1); };
    const LD::Analysis a = run({labelFree(13), u}, S, unimod);
    const LD::SiteCandidate* c = siteNear(a, 'N', kUnknown, 0.005);
    CHECK(c != nullptr && c->cls == "unexplained" && !c->called && c->relative_share < 0.5, "partial unknown +123.4567: %s called %d rel %f",
          c ? c->cls.c_str() : "missing", c ? static_cast<int>(c->called) : -1, c ? c->relative_share : 0.0);
    CHECK(a.labels == "label-free", "partial unknown call: %s [%s]", a.labels.c_str(), calledList(a).c_str());
  }
  {
    Gen d = labelFree(14, 2500);
    d.L_N = kDimethyl;
    d.keep = [](bool rev, int pre, int) { return (!rev && pre == 1) || (rev && pre == 2); };
    const LD::Analysis a = run({d, labelFree(15, 1500, 100000)}, S, unimod);
    const LD::SiteCandidate* c = siteNear(a, 'N', kDimethyl, 0.005);
    // Dimethyl is a known label (tier 0) since evaluation 2; it is still
    // found through the N1f/N2r images alone (Unimod names it too)
    CHECK(c != nullptr && c->cls == "known_label" && c->explanation == "Dimethyl" && c->called, "Dimethyl N1f/N2r: %s %s [%s] rel %f",
          c ? c->cls.c_str() : "missing", c ? c->explanation.c_str() : "", calledList(a).c_str(), c ? c->relative_share : 0.0);
  }
  {
    Gen k = labelFree(16, 3000);
    k.L_K = kTMT;
    const LD::Analysis a = run({k}, S, unimod);
    const LD::SiteCandidate* c = siteNear(a, 'K', kTMT, 0.003);
    CHECK(c != nullptr && c->called && c->cls == "known_label", "TMT K-only: K site %s", c ? c->cls.c_str() : "missing");
    for (double x : {kTMT + H2O, 128.09496 + kTMT + H2O})
    {
      const LD::SiteCandidate* n = siteNear(a, 'N', x, 0.005);
      // the accepted K delta is named to 4 decimals (its estimate, here 229.1628 or 229.1629)
      CHECK(n == nullptr || (!n->called && n->cls.rfind("shadow:K+229.16", 0) == 0), "TMT K-only: N candidate at %.4f is %s", x,
            n ? n->cls.c_str() : "");
    }
    CHECK(a.labels == "K:TMT", "TMT K-only call %s [%s]", a.labels.c_str(), calledList(a).c_str());
  }
  {
    Gen o = labelFree(17, 3000);
    o.c_C = 4.0085;
    const LD::Analysis a = run({o}, S, unimod);
    const LD::SiteCandidate* c = siteNear(a, 'C', 4.0085, 0.003);
    CHECK(c != nullptr && c->called, "+4.0085 on K and R: site C %s [%s] (ppm_c %g ppm_n %g w_c %g w_n %g)", c ? c->cls.c_str() : "missing",
          calledList(a).c_str(), a.cal.ppm_c, a.cal.ppm_n, a.win.w_c, a.win.w_n_hist);

  }

  // ---- 4. collisions ----
  {
    const LD::Analysis a = run({labelFree(18, 3000)}, S, unimod);
    const LD::Peak* pn = peakNear(a.peaks_n, 114.04293, 0.01);  // n = N = GG (one or two N-terminal residues)
    CHECK(pn != nullptr && pn->cls == "residue_combo" &&
              (pn->explanation.find("GG") != std::string::npos || pn->alternatives.find("GG") != std::string::npos),
          "N/GG peak: %s alt %s", pn ? pn->explanation.c_str() : "missing", pn ? pn->alternatives.c_str() : "");
    const LD::Peak* pq = peakNear(a.peaks_n, 128.05858, 0.01);  // n = Q = AG
    CHECK(pq != nullptr && pq->cls == "residue_combo" &&
              (pq->explanation.find("GA") != std::string::npos || pq->alternatives.find("GA") != std::string::npos),
          "Q/AG peak: %s alt %s", pq ? pq->explanation.c_str() : "missing", pq ? pq->alternatives.c_str() : "");
    // n = 57.02146: N-terminal G, or N-terminal carbamidomethyl
    const LD::Peak* pg = peakNear(a.peaks_n, 57.02146, 0.01);
    CHECK(pg != nullptr && pg->cls == "residue_combo" && pg->alternatives.find("Carbamidomethyl") != std::string::npos,
          "N-term G / carbamidomethyl: %s alt %s", pg ? pg->cls.c_str() : "missing", pg ? pg->alternatives.c_str() : "");
  }

  // ---- 5. precision: iTRAQ8plex vs TMTpro ----
  {
    auto one = [&](double L, double ppm, bool refs, double wc) {
      LD::Settings s = settings();
      s.window_c = wc;
      Gen g = labelFree(21, 1500);
      g.L_N = L;
      g.ppm_c = ppm;
      g.keep = [](bool rev, int pre, int) { return rev && pre == 0; };  // N0r only
      std::vector<Gen> gens{g};
      if (refs)
      {
        Gen r = labelFree(22, 3000, 100000);
        r.ppm_c = ppm;
        r.refs_only = true;
        gens.push_back(r);
      }
      return run(gens, s, unimod);
    };
    for (double L : {kiTRAQ8, kTMTpro})
    {
      const char* want = L == kiTRAQ8 ? "iTRAQ8plex" : "TMTpro";
      const char* other = L == kiTRAQ8 ? "TMTpro" : "iTRAQ8plex";
      const LD::Analysis a = one(L, 0.0, true, 0.0015);
      const LD::Peak* p = peakNear(a.peaks_c, L - H2O, 0.0015);
      CHECK(p != nullptr && p->explanation == std::string("N0r:") + want, "w 0.0015: %s named %s", want,
            p ? p->explanation.c_str() : "missing");
      const LD::Analysis b = one(L, 0.0, true, 0.008);
      const LD::Peak* q = peakNear(b.peaks_c, L - H2O, 0.004);
      CHECK(q != nullptr && q->explanation == std::string("N0r:") + want && q->alternatives.find(other) != std::string::npos,
            "w 0.008: %s named %s alt %s", want, q ? q->explanation.c_str() : "missing", q ? q->alternatives.c_str() : "");
      const LD::Analysis c = one(L, 3.0, true, 0.0015);
      CHECK(std::fabs(c.cal.ppm_c - 3.0) <= 0.3, "+3 ppm recovered as %f", c.cal.ppm_c);
      const LD::Peak* r = peakNear(c.peaks_c, L - H2O, 0.0015);
      CHECK(r != nullptr && r->explanation == std::string("N0r:") + want, "+3 ppm: %s named %s", want,
            r ? r->explanation.c_str() : "missing");
      const LD::Analysis d = one(L, 3.0, false, 0.0015);
      const LD::Peak* t = peakNear(d.peaks_c, L - H2O, 0.003);
      CHECK(t != nullptr && t->explanation.rfind("ambiguous:", 0) == 0 && t->explanation.find("iTRAQ8plex") != std::string::npos &&
                t->explanation.find("TMTpro") != std::string::npos,
            "no references: %s", t ? t->explanation.c_str() : "missing");
    }
    {
      LD::Settings s = settings();
      s.window_c = 0.008;
      Gen g1 = labelFree(23, 1500), g2 = labelFree(24, 1500, 50000);
      g1.L_N = kiTRAQ8;
      g2.L_N = kTMTpro;
      g1.keep = g2.keep = [](bool rev, int pre, int) { return rev && pre == 0; };
      const LD::Analysis a = run({g1, g2}, s, unimod);
      int n = 0;
      for (const LD::Peak& p : a.peaks_c) n += std::fabs(p.mass - 286.196) < 0.01;
      CHECK(n == 1, "iTRAQ8 + TMTpro at w 0.008: %d peaks", n);
    }
  }

  // ---- 6. background and statistics ----
  {
    CHECK(std::fabs(LD::log10PoissonUpper(5, 1.0) - std::log10(0.0036598468273437)) < 1e-6, "Poisson tail %f",
          LD::log10PoissonUpper(5, 1.0));
    CHECK(std::fabs(LD::log10PoissonUpper(1, 0.5) - std::log10(1 - std::exp(-0.5))) < 1e-9, "Poisson tail at 1|0.5");
    CHECK(std::fabs(LD::log10PoissonUpper(3, 10.0) - std::log10(1 - std::exp(-10.0) * (1 + 10 + 50))) < 1e-9, "Poisson tail at 3|10");
    CHECK(LD::log10PoissonUpper(0, 3.0) == 0.0, "k = 0");
    CHECK(LD::log10PoissonUpper(100000, 1.0) == -300.0, "floor -300");
    CHECK(std::fabs(LD::log10Q(-10.0, 1000.0) - (-7.0)) < 1e-12, "Bonferroni");
    CHECK(LD::log10Q(-1.0, 1000.0) == 0.0, "q capped at 1");
    // peaks whose background offsets fall partly outside (0, max_flank]
    LD::Settings s = settings();
    s.max_flank = 160;
    const LD::Analysis a = run({labelFree(25, 2000)}, s, unimod);
    const LD::Peak* r = peakNear(a.peaks_c, 156.10111, 0.002);
    CHECK(r != nullptr && r->background >= 0 && r->fold > 20, "edge peak R: %s", r ? "fold too low" : "missing");
    for (const auto* v : {&a.peaks_n, &a.peaks_c})
      for (const LD::Peak& q : *v) CHECK(std::isfinite(q.background) && q.background >= 0, "background at %f", q.mass);
  }

  // ---- 7. window estimate ----
  {
    LD::Collector col;
    std::mt19937 rng(7);
    const double sc = 0.002, sppm = 3.0;
    for (int i = 0; i < 5000; ++i)
    {
      const double m = A[static_cast<std::size_t>(i % 19)].mass;
      const double Mp = 1500.0;
      const double dn = sppm * Mp * 1e-6 * gauss(rng);
      const double dc = sc * gauss(rng);
      col.add(m + H2O + dn, m + dc, Mp, static_cast<std::uint32_t>(i), 0, "AAAA", false);
    }
    col.finish();
    const LD::Calibration cal = LD::calibrate(col.records, A);
    const LD::Windows w = LD::estimateWindows(col.records, cal, settings());
    CHECK(std::fabs(w.w_c - 3 * sc) <= 0.1 * 3 * sc, "w_c %f, want %f", w.w_c, 3 * sc);
    CHECK(std::fabs(w.sigma_ppm_n - sppm) <= 0.1 * sppm, "sigma_ppm_n %f, want %f", w.sigma_ppm_n, sppm);
    CHECK(w.source_c == "estimated" && w.source_n == "estimated", "sources %s %s", w.source_c.c_str(), w.source_n.c_str());
    LD::Collector few;
    for (int i = 0; i < 150; ++i) few.add(A[3].mass + H2O, A[3].mass, 1500, static_cast<std::uint32_t>(i), 0, "AAAA", false);
    const LD::Calibration c2 = LD::calibrate(few.records, A);
    const LD::Windows w2 = LD::estimateWindows(few.records, c2, settings());
    CHECK(w2.source_c == "default" && w2.w_c == LD::kDefaultWindowC && w2.n_flat == LD::kDefaultWindowN,
          "fewer than 200 references: defaults");
  }

  // ---- 8. determinism ----
  {
    LD::Collector all;
    all.configure(S.knownSets(), S.known_window);
    Gen g = labelFree(31, 1500);
    g.L_N = kTMT;
    generate(g, all);
    generate(labelFree(32, 800, 50000), all);
    std::string ref;
    for (int parts : {1, 3, 7})
    {
      std::vector<LD::Record> rec = all.records;
      std::mt19937 rng(static_cast<unsigned>(parts));
      std::shuffle(rec.begin(), rec.end(), rng);
      std::vector<LD::Collector> cs(static_cast<std::size_t>(parts));
      for (std::size_t i = 0; i < rec.size(); ++i) cs[i % static_cast<std::size_t>(parts)].records.push_back(rec[i]);
      LD::Collector m;
      m.configure(S.knownSets(), S.known_window);
      for (const auto& c : cs) m.merge(c);
      m.finish();
      const LD::Analysis a = LD::analyze(m, S, unimod);
      std::string out;
      for (const FD::Row& r : LD::reportRows(a, S)) out += r.section + "\t" + r.key + "\t" + r.value + "\n";
      if (ref.empty()) ref = out;
      CHECK(out == ref, "report differs with %d feeders", parts);
    }
  }

  // ---- 9. clamp ----
  {
    LD::Collector col;
    for (int i = 0; i < 300; ++i) col.add(0.0, 0.0, 1500, static_cast<std::uint32_t>(i), 0, "AAAA", false);
    for (int i = 0; i < 50; ++i) col.add(0.0, 156.10111, 1500, static_cast<std::uint32_t>(i), 1, "AAAA", false);
    col.finish();
    const LD::Analysis a = LD::analyze(col, S, unimod);
    CHECK(a.clamped_n == 350 && a.clamped_c == 300, "clamped %llu %llu", static_cast<unsigned long long>(a.clamped_n),
          static_cast<unsigned long long>(a.clamped_c));
    for (const LD::Peak& p : a.peaks_n) CHECK(p.mass > 0.01, "a clamped value was binned (n peak at %f)", p.mass);
    for (const LD::Peak& p : a.peaks_c) CHECK(p.mass > 0.01, "a clamped value was binned (c peak at %f)", p.mass);
  }

  // ---- 10. -label_out parity ----
  {
    LD::Collector tmp;
    Gen g = labelFree(41, 1500);
    g.L_N = kTMT;
    g.L_K = kTMT;
    generate(g, tmp);
    LD::Collector col;
    col.configure(S.knownSets(), 0.008);
    FD::TerminusCounter tc(0.008);
    for (const LD::Record& r : tmp.records)
    {
      col.add(r.n, r.c, r.M, r.spectrum, r.order, "AAAA", false);  // the same doubles to both
      tc.add(r.n, r.c, "AAAA");
    }
    const auto& labs = FD::labelKeys();
    for (std::size_t l = 0; l < labs.size(); ++l)
    {
      CHECK(col.known_tags[l][0] == tc.lab_n[l], "%s N0f %llu vs lab_n %llu", labs[l].name,
            static_cast<unsigned long long>(col.known_tags[l][0]), static_cast<unsigned long long>(tc.lab_n[l]));
      CHECK(col.known_tags[l][2] == tc.lab_c[l], "%s K0f %llu vs lab_c %llu", labs[l].name,
            static_cast<unsigned long long>(col.known_tags[l][2]), static_cast<unsigned long long>(tc.lab_c[l]));
    }
    CHECK(tc.lab_n[0] > 0 && tc.lab_c[0] > 0, "TMT counts present");
  }

  // ---- 11./12. null leak and residue-difference collisions (label-free) ----
  {
    const LD::Analysis a = run({labelFree(51, 4000)}, S, unimod);
    CHECK(calledCount(a) == 0, "label-free: called %s", calledList(a).c_str());
    for (double x : {H2O, 128.09496 + H2O, 156.10111 + H2O, -H2O, 57.02146 - H2O, 71.03711 - H2O})
      for (char site : {'N', 'K', 'R'})
      {
        const LD::SiteCandidate* c = siteNear(a, site, x, 0.003);
        CHECK(c == nullptr || c->cls == "null_shadow" || c->cls.rfind("shadow:", 0) == 0, "leak %c%+.4f is %s ladder %d zero %d images %s",
              site, x, c ? c->cls.c_str() : "", c ? c->ladder_clean : -1, c ? static_cast<int>(c->zero_clean) : -1,
              c ? c->images.c_str() : "");
      }
    // labels equal to residue differences: Dimethyl, Methyl, Oxidation, Carbamyl, Formyl, Acetyl
    for (double L : {kDimethyl, 14.01565, 15.994915, 43.005814, 27.994915, 42.010565})
    {
      const LD::SiteCandidate* c = siteNear(a, 'N', L, 0.003);
      CHECK(c == nullptr || (!c->called && c->ladder_clean < 3), "collision %.4f: %s ladder_clean %d", L,
            c ? c->cls.c_str() : "", c ? c->ladder_clean : -1);
    }
    // clean N0/N1 images per label (CAM + Met-ox alphabet, w_c 0.0015, w_n 0.006)
    const std::vector<LD::Residue> Aox =
        LD::runAlphabet({{'C', 57.021464, "Carbamidomethyl", false}, {'M', 15.994915, "Oxidation", true}});
    const LD::NullImages ni = LD::nullImages(LD::compositions(Aox, 720.0));
    auto clean = [&](double L) {
      int n = 0;
      for (const LD::Image& im : LD::imagesFor('N', L, Aox, 1, 1e9))
      {
        if (im.residue >= 19) continue;  // the 19 residues: 40 images
        n += !ni.near(im.ch, im.mass, im.ch == 'n' ? 0.006 : 0.0015);
      }
      return n;
    };
    struct Pin
    {
      const char* name;
      double L;
      int want;
    };
    // Pinned for this null set: every reading of LD::nullReadings() (y, b and
    // a ions with their NH3 and H2O losses in both channels, the 13C picks,
    // the precursor family). The design's revision-2 check (four readings,
    // 13C picks, n = H2O) gave TMT 24, TMTpro 16, iTRAQ4 24, Dimethyl 25,
    // Acetyl 31, Propionyl 31, Carbamyl 24; with the a-ion and b - NH3
    // readings of format 1 it was TMT 24, TMTpro 14, iTRAQ4 20, Dimethyl 21,
    // Acetyl 13, Propionyl 13, Carbamyl 22 (evaluation 2 added the y - NH3,
    // b - H2O and high-peak losses, section 7).
    const Pin pins[] = {{"TMT", kTMT, 19},        {"TMTpro", kTMTpro, 14},      {"iTRAQ4", kiTRAQ4, 17},
                        {"Dimethyl", kDimethyl, 20}, {"Acetyl", 42.010565, 11}, {"Propionyl", 56.026215, 11},
                        {"Carbamyl", 43.005814, 21}, {"unknown", kUnknown, 40}, {"leak H2O", H2O, 0},
                        {"leak K+H2O", 128.09496 + H2O, 0}};
    for (const Pin& p : pins)
    {
      const int got = clean(p.L);
      CHECK(got == p.want, "clean N0/N1 images of %s: %d, pinned %d", p.name, got, p.want);
    }
    for (const LD::Image& im : LD::imagesFor('N', kTMT, Aox, 0, 1e9))
      CHECK(!ni.near(im.ch, im.mass, im.ch == 'n' ? 0.006 : 0.0015), "TMT %s confounded", im.name.c_str());
    CHECK(!ni.near('c', kTMT, 0.0015), "TMT K0f confounded");
  }

  // ---- 13. isotope picks ----
  {
    Gen g = labelFree(61, 4000);
    g.iso1 = 0.2;
    g.iso2 = 0.05;
    const LD::Analysis a = run({g}, S, unimod);
    CHECK(calledCount(a) == 0, "label-free with 13C picks: called %s", calledList(a).c_str());
    const LD::SiteCandidate* c = siteNear(a, 'N', C13, 0.006);
    CHECK(c == nullptr || c->cls == "isotope_error" || c->cls == "null_shadow", "+1.0034 N candidate is %s", c ? c->cls.c_str() : "");
    Gen t = labelFree(62, 3000);
    t.L_N = kTMT;
    t.iso1 = 0.2;
    t.iso2 = 0.05;
    const LD::Analysis b = run({t}, S, unimod);
    CHECK(b.labels == "TMT", "TMT with 13C picks: %s [%s]", b.labels.c_str(), calledList(b).c_str());
  }

  // ---- 16. neutral-loss null images (label-free) ----
  // y - NH3 / b - NH3 low peaks (c = m(S) - NH3, y1(K) - NH3 = 111.068) and
  // NH3-loss high peaks (n = m(S) + NH3), and the precursor less NH3 / H2O
  // as the high peak (n = 17.03, 18.01). Without these null readings, K -
  // NH3 is read as the clean N0r image of N + 129.079 (and as N1rK of N +
  // 0.984) and n = NH3 as the clean N0f image of N + 17.03: the false calls
  // of the first evaluation (PXD003531 unknown:N+0.9839).
  {
    const LD::NullImages ni = LD::nullImages(LD::compositions(A, LD::compositionLimit(700.0)), 701.0);
    CHECK(ni.near('c', 128.09496 - LD::kNH3, 0.0005), "null: c = K - NH3 (y1(K) - NH3)");
    CHECK(ni.near('c', 156.10111 - LD::kNH3, 0.0005), "null: c = R - NH3");
    CHECK(ni.near('n', LD::kNH3, 0.0005) && ni.near('n', LD::kNH3 - C13, 0.0005), "null: n = NH3 (precursor - NH3), its 13C peak");
    CHECK(ni.near('n', 128.09496 + H2O + LD::kNH3, 0.0005), "null: n = K + H2O + NH3 (b(n-1) - NH3)");
    CHECK(ni.near('c', 128.09496 - 2 * H2O, 0.0005), "null: c = K - 2 H2O (b - H2O)");
    Gen g = labelFree(101, 5000);
    g.nh3_low = 0.4;
    g.nh3_high = 0.3;
    g.prec_loss = 0.6;
    const LD::Analysis a = run({g}, S, unimod);
    CHECK(calledCount(a) == 0 && a.labels == "label-free", "label-free with neutral losses: %s [%s]", a.labels.c_str(),
          calledList(a).c_str());
    for (double x : {129.0790, 0.9840, LD::kNH3, LD::kNH3 - C13})
    {
      const LD::SiteCandidate* c = siteNear(a, 'N', x, 0.004);
      CHECK(c == nullptr || !c->called, "neutral loss N%+.4f called (%s)", x, c ? c->cls.c_str() : "");
    }
    for (const LD::Peak& p : a.peaks_c)
      if (std::fabs(p.mass - (128.09496 - LD::kNH3)) < 0.002)
        CHECK(p.cls == "residue_combo" && p.explanation.find("S-NH3") != std::string::npos, "c 111.068 is %s %s", p.cls.c_str(),
              p.explanation.c_str());
  }

  // ---- 14. same composition ----
  {
    struct Want
    {
      double L;
      const char* name;
      const char* other;
    };
    for (const Want& w : {Want{56.026215, "Propionyl", "Delta:H(4)C(3)O(1)"}, Want{kDimethyl, "Dimethyl", "Ethyl"},
                          Want{42.010565, "Acetyl", ""}})
    {
      Gen g = labelFree(71, 3000);
      g.L_N = w.L;
      const LD::Analysis a = run({g}, S, unimod);
      const LD::SiteCandidate* c = siteNear(a, 'N', w.L, 0.004);
      CHECK(c != nullptr && c->explanation == w.name, "%s named %s (%s)", w.name, c ? c->explanation.c_str() : "missing",
            c ? c->cls.c_str() : "");
      if (c != nullptr && *w.other)
        CHECK(c->alternatives.find(std::string("same_composition:") + w.other) != std::string::npos, "%s alternatives %s", w.name,
              c->alternatives.c_str());
      if (c != nullptr && w.L == kDimethyl)
        CHECK(c->alternatives.find("same_composition:Delta:H(4)C(2)") != std::string::npos, "Dimethyl alternatives %s",
              c->alternatives.c_str());
    }
  }

  // ---- 15. distinct spectra ----
  {
    Gen g = labelFree(81, 1500);
    g.L_N = kTMT;
    LD::Collector base;
    base.configure(S.knownSets(), S.known_window);
    generate(g, base);
    LD::Collector more = base;
    // one more spectrum: a b0, b1, b2 ladder in both channels
    const std::uint32_t sp = 999999;
    const double a = M.at('A'), pp = M.at('P');  // A+P matches no residue or other pair
    more.add(kTMT, kTMT - H2O, 1500, sp, 0, "AAAA", false);
    more.add(kTMT + a, kTMT + a - H2O, 1500, sp, 1, "AAAA", false);
    more.add(kTMT + a + pp, kTMT + a + pp - H2O, 1500, sp, 2, "AAAA", false);
    base.finish();
    more.finish();
    LD::Settings s = S;
    s.window_c = 0.0015;
    s.window_n = 0.006;
    const LD::Analysis x = LD::analyze(base, s, unimod), y = LD::analyze(more, s, unimod);
    const LD::SiteCandidate* cx = siteNear(x, 'N', kTMT, 0.003);
    const LD::SiteCandidate* cy = siteNear(y, 'N', kTMT, 0.003);
    CHECK(cx && cy && cy->spectra == cx->spectra + 1, "spectra %llu -> %llu",
          cx ? static_cast<unsigned long long>(cx->spectra) : 0ULL, cy ? static_cast<unsigned long long>(cy->spectra) : 0ULL);
    CHECK(cx && cy && cy->image_hits == cx->image_hits + 6, "image_hits %llu -> %llu",
          cx ? static_cast<unsigned long long>(cx->image_hits) : 0ULL, cy ? static_cast<unsigned long long>(cy->image_hits) : 0ULL);
  }

  // ---- report format: five non-empty fields, (section, key) unique, order ----
  {
    Gen g = labelFree(91, 1500);
    g.L_N = kTMT;
    const LD::Analysis a = run({g}, S, unimod);
    std::map<std::string, int> seen;
    std::string order;
    for (const FD::Row& r : LD::reportRows(a, S))
    {
      CHECK(!r.section.empty() && !r.key.empty() && !r.value.empty() && !r.description.empty(), "empty field in %s %s",
            r.section.c_str(), r.key.c_str());
      CHECK(++seen[r.section + "\t" + r.key] == 1, "duplicate %s %s", r.section.c_str(), r.key.c_str());
      if (order.empty() || order.substr(order.rfind(',') + 1) != r.section) order += "," + r.section;
    }
    CHECK(order == ",ld_run,ld_count,ld_peak,ld_site,ld_known,ld_reporter,ld_call", "section order %s", order.c_str());
    CHECK(rowsOf(a, S).at("ld_run/format") == "2", "format");
    CHECK(a.labels == "TMT", "TMT set call %s [%s]", a.labels.c_str(), calledList(a).c_str());
    LD::Settings lr = S;
    lr.low_resolution = true;
    const LD::Analysis b = run({g}, lr, unimod);
    const auto mb = rowsOf(b, lr);
    CHECK(mb.at("ld_call/status") == "no_call" && mb.at("ld_call/reason") == "low_resolution", "low resolution call");
    CHECK(b.peaks_n.empty() && b.peaks_c.empty() && b.sites.empty(), "low resolution peaks");
    LD::Collector cz;
    for (int i = 0; i < 400; ++i) cz.add(100.0, 200.0, 1500, static_cast<std::uint32_t>(i), 0, "AAAA", true);
    cz.finish();
    const LD::Analysis c = LD::analyze(cz, S, unimod);
    CHECK(c.reason == "cz_only" && c.tags_excluded_cz == 400, "cz_only");
    const LD::Analysis f = run({labelFree(92, 100)}, S, unimod);
    CHECK(f.status == "no_call" && f.reason == "few_spectra", "few_spectra: %s %s", f.status.c_str(), f.reason.c_str());
  }

  // ---- reporter ions (format 2): the gate and its effect on the call ----
  {
    using Low = std::vector<std::pair<double, double>>;
    auto counter = [](const Low& low, int n) {
      LD::ReporterCounter rc;
      for (int i = 0; i < n; ++i) rc.add(low, 100.0);
      return rc;
    };
    const Low tmt = {{126.1277, 50}, {127.1248, 40}, {120.0, 100}}, none = {{120.0, 100}, {129.1024, 30}};
    const Low decoy = {{126.127726 + 0.017, 50}, {127.124761 + 0.017, 40}}, weak = {{126.1277, 0.5}, {127.1248, 0.5}};
    const Low itraq8 = {{114.1107, 50}, {115.1077, 50}, {113.1073, 50}}, itraq4 = {{114.1107, 50}, {117.1144, 50}};
    CHECK(LD::reporterGate(counter(tmt, 199)) == "unknown", "gate below 200 scans");
    CHECK(LD::reporterGate(counter(tmt, 300)) == "tmt", "gate tmt");
    CHECK(LD::reporterGate(counter(none, 300)) == "none", "gate none");
    CHECK(LD::reporterGate(counter(Low{}, 300)) == "unclear", "no peak in the reporter region is not none");
    CHECK(LD::reporterGate(counter(decoy, 300)) == "none" && counter(decoy, 300).tmt_decoy == 300, "decoy offsets");
    CHECK(LD::reporterGate(counter(weak, 300)) == "none", "below 1 %% of the base peak");
    CHECK(LD::reporterGate(counter(itraq8, 300)) == "itraq8" && LD::reporterGate(counter(itraq4, 300)) == "itraq4", "gate itraq");
    LD::ReporterCounter mixed = counter(tmt, 60);
    mixed.merge(counter(none, 240));
    CHECK(LD::reporterGate(mixed) == "unclear", "gate unclear at 0.2");

    Gen g = labelFree(93, 1500);
    LD::Analysis lf = run({g}, S, unimod);
    CHECK(lf.status == "call" && lf.labels == "label-free", "label-free base %s", lf.labels.c_str());
    LD::Analysis x = lf;
    LD::applyReporters(x, counter(tmt, 300));
    CHECK(x.status == "call" && x.labels == "TMT" && x.call_sites == "-" && x.basis == "reporter_ions", "family call %s %s",
          x.labels.c_str(), x.call_sites.c_str());
    x = lf;
    LD::applyReporters(x, counter(itraq8, 300));
    CHECK(x.labels == "iTRAQ8plex" && x.call_sites == "N", "iTRAQ call %s", x.labels.c_str());
    x = lf;
    LD::applyReporters(x, counter(none, 300));
    CHECK(x.labels == "label-free" && x.basis == "site_scan", "gate none keeps label-free");
    g.L_N = kTMT;
    const LD::Analysis t = run({g}, S, unimod);
    x = t;
    LD::applyReporters(x, counter(tmt, 300));
    CHECK(x.labels == t.labels && x.call_sites == t.call_sites && x.basis == "site_scan", "family already called");
    CHECK(rowsOf(x, S).at("ld_reporter/gate") == "tmt" && rowsOf(x, S).at("ld_reporter/tmt_excess") == "1", "ld_reporter rows");
    x = t;
    LD::applyReporters(x, counter(none, 300));
    CHECK(x.status == "no_call" && x.reason == "no_reporter_ions" && x.labels == "-", "veto %s %s", x.status.c_str(), x.reason.c_str());
    x = t;
    LD::applyReporters(x, counter(tmt, 100));
    CHECK(x.labels == t.labels && x.reporter_gate == "unknown", "unknown gate changes nothing");
    LD::Analysis f = run({labelFree(92, 100)}, S, unimod);
    LD::ReporterCounter trap;
    trap.ms2 = 100;
    trap.ms2_ion_trap = 90;
    LD::applyReporters(f, trap);
    CHECK(f.status == "no_call" && f.reason == "low_resolution_ms2", "ion-trap MS2: %s", f.reason.c_str());
    f = run({labelFree(92, 100)}, S, unimod);
    trap.merge(counter(tmt, 300));  // FT MS3 reporters in an ion-trap MS2 run
    LD::applyReporters(f, trap);
    CHECK(f.status == "call" && f.labels == "TMT" && f.basis == "reporter_ions", "ion-trap MS2 with MS3 reporters: %s", f.labels.c_str());
  }

  if (failures == 0) std::printf("label_discovery_test: all passed\n");
  return failures == 0 ? 0 : 1;
}
