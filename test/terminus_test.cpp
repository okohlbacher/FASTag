// -terminus: FASTag::Terminus::seriesCall on synthetic ladders, b/y and c/z:
// y1 of a C-terminal K, b1 under a fixed TMT N-term, y(n-1) and b(n-1) from
// the precursor, both readings anchored, no precursor, an isotope offset;
// which anchor kinds decide the series (anchorUsed) and the tolerance gate.
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "Terminus.h"

#include "IonSeries.h"

#include <OpenMS/CHEMISTRY/EmpiricalFormula.h>
#include <OpenMS/CONCEPT/Constants.h>

#include <iostream>
#include <stdexcept>
#include <string>

namespace T = FASTag::Terminus;
using FASTag::Tag;

namespace
{
  const double PROTON = OpenMS::Constants::PROTON_MASS_U;
  const double WATER = OpenMS::EmpiricalFormula("H2O").getMonoWeight();
  // Residue masses (OpenMS, monoisotopic).
  constexpr double G = 57.02146372, A = 71.03711379, K = 128.09496301, R = 156.10111102, Q = 128.05858622;
  constexpr double TMT6 = 229.162932;

  void require(bool value, const std::string& message)
  {
    if (!value) throw std::runtime_error(message);
  }
  /// A tag whose low peak is the neutral mass @p low and whose residues reach
  /// @p high (the highest path peak, exact unless @p high_err), at charge 1.
  Tag tag(double low, double high, FASTag::IonSeries::Series sr = FASTag::IonSeries::Series::BY,
          double high_err = 0)
  {
    Tag t;
    t.seq = "PEP";
    t.charge = 1;
    t.low_mz = low + PROTON;
    t.high_mz = high + high_err + PROTON;
    t.res_mass = high - low;
    t.ion_series = sr;
    return t;
  }
  /// 20 ppm (or @p tol in @p ppm); a precursor of neutral mass @p M at charge 2 (none if M <= 0).
  T::Peaks peaks(double M, int isotope = 0, double tol = 20, bool ppm = true)
  {
    T::Peaks s;
    if (M > 0) s.precursor = (M + 2 * PROTON) / 2;
    s.charge = 2;
    s.tolerance = tol;
    s.ppm = ppm;
    s.isotope = isotope;
    return s;
  }
  void expect(const T::Call& c, const std::string& series, const std::string& terminus, const std::string& what)
  {
    require(c.series == series && c.terminus == terminus,
            what + ": got " + c.series + " / " + c.terminus + ", want " + series + " / " + terminus);
  }
}

int main()
{
  try
  {
    const T::Residues res = T::residuesFrom({});
    const T::Termini plain = T::terminiFrom(res);
    const double high = 498.0;  // a path peak no one-residue flank lands on with the lows below

    // y1 of a C-terminal K, no precursor: the y reading's C flank is K.
    const double y1K = K + WATER;
    expect(T::seriesCall(tag(y1K, high), peaks(0), plain), "y", "C+K", "y1 = K");
    // b1 under a fixed TMT N-term (the N-term label counts as the terminus).
    const T::Termini tmt = T::terminiFrom(res, {TMT6});
    expect(T::seriesCall(tag(TMT6 + A, high), peaks(0), tmt), "b", "N+A", "b1 = TMT-A");
    expect(T::seriesCall(tag(TMT6 + A, high), peaks(0), plain), "-", "-", "b1 = TMT-A without the label");

    // y(n-1): the highest peak is one G from the precursor (the y reading's N flank).
    const double low = 250.0;
    const double M_y = high + G;
    expect(T::seriesCall(tag(low, high), peaks(M_y), plain), "y", "N+G", "y(n-1)");
    expect(T::seriesCall(tag(low, high), peaks(0), plain), "-", "-", "y(n-1) without a precursor");
    // b(n-1): the highest peak is b(n-1), M - high - H2O = R (the b reading's
    // C flank). A C-terminal K or R alone on the precursor side does not
    // decide the series (measured 87% / 94%): the token is listed, series "-".
    const double M_b = high + WATER + R;
    expect(T::seriesCall(tag(low, high), peaks(M_b), plain), "-", "C+R", "b(n-1)");
    // The b reading reaching the C terminus from the precursor does.
    expect(T::seriesCall(tag(low, high), peaks(high + WATER), plain), "b", "C", "b reaching the C terminus");
    // The precursor one isotope off (-isotope_error 0,1; the row's hypothesis k = 0).
    T::Termini iso = T::terminiFrom(res, {}, {}, {0, 1});
    expect(T::seriesCall(tag(low, high), peaks(M_b + T::C13), iso), "-", "C+R", "b(n-1), isotope 1");
    expect(T::seriesCall(tag(low, high), peaks(high + WATER + T::C13), iso), "b", "C", "b at the C terminus, isotope 1");
    expect(T::seriesCall(tag(low, high), peaks(M_b + T::C13), plain), "-", "-", "b(n-1), isotope 1 not allowed");

    // The far end is low + residues, as the flanks are, not the measured
    // highest peak: a high peak 0.01 Da off and a precursor 0.015 Da off
    // (within the precursor-side 0.0185 Da) still anchor b(n-1); from the
    // high peak the error would be 0.025 Da.
    expect(T::seriesCall(tag(low, high, FASTag::IonSeries::Series::BY, 0.01), peaks(M_b + 0.015), plain), "-", "C+R",
           "b(n-1), high peak off");
    expect(T::seriesCall(tag(low, high), peaks(M_b + 0.025), plain), "-", "-", "b(n-1), precursor beyond the tolerance");

    // Both readings anchored, only y through a used token (y1 = K; b(n-1) =
    // R is not used): y, both token lists.
    expect(T::seriesCall(tag(y1K, high), peaks(M_b), plain), "y", "y:C+K;b:C+R", "both anchored, one used");
    // Both through used tokens (y1 = K; b at the C terminus): no call.
    expect(T::seriesCall(tag(y1K, high), peaks(high + WATER), plain), "-", "y:C+K;b:C", "both used");
    // y1 of another residue (C+A, measured 86% / 23% for C-terminal non-K/R): listed, not used.
    expect(T::seriesCall(tag(A + WATER, high), peaks(0), plain), "-", "C+A", "y1 = A");

    // The tolerance gate: above 25 ppm or 0.02 Da the series is "-", the tokens are still listed.
    expect(T::seriesCall(tag(y1K, high), peaks(0, 0, 25), plain), "y", "C+K", "y1 = K at 25 ppm");
    expect(T::seriesCall(tag(y1K, high), peaks(0, 0, 30), plain), "-", "C+K", "y1 = K at 30 ppm");
    expect(T::seriesCall(tag(y1K, high), peaks(0, 0, 0.02, false), plain), "y", "C+K", "y1 = K at 0.02 Da");
    expect(T::seriesCall(tag(y1K, high), peaks(0, 0, 0.03, false), plain), "-", "C+K", "y1 = K at 0.03 Da");
    expect(T::seriesCall(tag(y1K, high), peaks(0, 0, 0.5, false), plain), "-", "C+[KQ]", "y1 = K at 0.5 Da");
    // At 0.02 Da a C flank midway between K and Q gives the set C+[KQ]: used.
    expect(T::seriesCall(tag((K + Q) / 2 + WATER, high), peaks(0, 0, 0.02, false), plain), "y", "C+[KQ]", "y1 = [KQ]");

    // c/z: z1 of a C-terminal K (z = residues + offC) and c1 of A (c = residues + NH3)
    // are found and listed, but a c/z row is never called (its anchors were not measured).
    const FASTag::IonSeries::IonPair cz = FASTag::IonSeries::ionPair(FASTag::IonSeries::Series::CZ);
    expect(T::seriesCall(tag(K + cz.offC, high, FASTag::IonSeries::Series::CZ), peaks(0), plain), "-", "C+K", "z1 = K");
    expect(T::seriesCall(tag(A + cz.offN, high, FASTag::IonSeries::Series::CZ), peaks(0), plain), "-", "N+A", "c1 = A");
    // c(n-1): M - high = residues C-terminal + H2O - offN (the c reading's C flank: R).
    const double M_c = high + R + WATER - cz.offN;
    expect(T::seriesCall(tag(low, high, FASTag::IonSeries::Series::CZ), peaks(M_c), plain), "-", "C+R", "c(n-1)");

    // anchorUsed, token by token (the GUI's anchorUsed, terminus.ts).
    struct Case { char series; const char* tokens; bool used; };
    const Case cases[] = {
      {'y', "", false},          {'y', "N", true},           {'b', "N+W", true},         {'y', "N+G", true},
      {'b', "C", true},          {'y', "C", true},           {'y', "C+K", true},         {'y', "C+R", true},
      {'b', "C+K", false},       {'b', "C+R", false},        {'z', "C+R", true},         {'c', "C+K", false},
      {'y', "C+W", false},       {'b', "C+W", false},        {'y', "C+[IL]", false},     {'b', "C+[KQ]", true},
      {'y', "C+[KQ]", true},     {'b', "C+[QR]", true},      {'y', "C+K[Acetyl]", false}, {'b', "C+[K[Acetyl]Q]", false},
      {'y', "N,C+W", true},      {'b', "N+[KQ],C+E", true},  {'b', "N,C", true},
    };
    for (const Case& c : cases)
      require(T::anchorUsed(c.series, c.tokens) == c.used,
              std::string("anchorUsed('") + c.series + "', \"" + c.tokens + "\") != " + (c.used ? "true" : "false"));

    // terminus() itself: one residue I/L gives both labels; a flank at a target is the bare side.
    require(T::terminus('y', 1, 200.0, 1000.0, 113.08406, peaks(0), plain) == "C+[IL]", "C+[IL]");
    require(T::terminus('b', 1, 200.0, 0.0, 1000.0, peaks(0), plain) == "N", "N");
  }
  catch (const std::exception& e)
  {
    std::cerr << "FAIL: " << e.what() << std::endl;
    return 1;
  }
  std::cout << "terminus_test: OK" << std::endl;
  return 0;
}
