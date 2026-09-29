// appendNum (NumFormat.h) against printf: every value goes through appendNum
// and through snprintf with the conversion it replaced in the row writers, and
// the two must agree byte for byte -- on whatever C library and C++ runtime
// this is built with. The standard says they do; this checks the runtime
// actually shipped: exact decimal expansion of huge values, round-half-even
// on exact binary ties, %g's switch to exponent form after rounding, the sign
// of zero, denormals and non-finite values.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#include "NumFormat.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <random>
#include <string>

using FASTag::appendNum;

namespace
{
  int failures = 0;
  long checks = 0;

  void mismatch(const char* conv, const char* value, const char* want, const std::string& got)
  {
    if (failures++ < 25)
      std::cerr << "FAIL: " << conv << " of " << value << ": printf '" << want
                << "', appendNum '" << got << "'\n";
  }

  void checkDouble(double v, const char* conv, std::chars_format fmt, int prec)
  {
    char want[400];
    std::snprintf(want, sizeof want, conv, v);
#ifdef __APPLE__
    // Apple's libc keeps the trailing zeros of an exponent-form "%g" when an
    // exact tie rounds down onto a 0 ("1.00000e+06" for 1000005); C removes
    // them ("1e+06"), and so do glibc and to_chars. Only an integer >= 1e6
    // can be such a tie, and E-values are written up to -max_evalue (default
    // 20) -- compare against the C result, which is also Linux's.
    if (fmt == std::chars_format::general)
      if (char* e = std::strchr(want, 'e'); e && std::strchr(want, '.'))
      {
        char* end = e;
        while (end[-1] == '0') --end;
        if (end[-1] == '.') --end;
        std::memmove(end, e, std::strlen(e) + 1);
      }
#endif
    std::string got;
    appendNum(got, v, fmt, prec);
    ++checks;
    if (got != want)
    {
      char hex[48];
      std::snprintf(hex, sizeof hex, "%a", v);
      mismatch(conv, hex, want, got);
    }
  }

  /// Every floating-point conversion the row writers use.
  void checkAll(double v)
  {
    checkDouble(v, "%.4f", std::chars_format::fixed, 4);   // flanking masses, recon delta
    checkDouble(v, "%.3f", std::chars_format::fixed, 3);   // min/mean conf, glyco fraction
    checkDouble(v, "%g", std::chars_format::general, 6);   // E-value
  }

  /// @p v, its neighbours one ULP either side, and the negatives of all three.
  void checkAround(double v)
  {
    for (double s : {1.0, -1.0})
    {
      checkAll(s * v);
      checkAll(s * std::nextafter(v, 0.0));
      checkAll(s * std::nextafter(v, std::numeric_limits<double>::infinity()));
    }
  }

  void checkSize(size_t v)
  {
    char want[32];
    std::snprintf(want, sizeof want, "%zu", v);
    std::string got;
    appendNum(got, v);
    ++checks;
    if (got != want) mismatch("%zu", want, want, got);
  }

  void checkInt(int v)
  {
    char want[32];
    std::snprintf(want, sizeof want, "%d", v);
    std::string got;
    appendNum(got, v);
    ++checks;
    if (got != want) mismatch("%d", want, want, got);
  }
}

int main()
{
  std::mt19937_64 rng(20260929);
  const double inf = std::numeric_limits<double>::infinity();

  // It appends; it does not overwrite.
  {
    std::string row = "id\t";
    appendNum(row, size_t{4});
    row += '\t';
    appendNum(row, 1.5, std::chars_format::fixed, 4);
    if (row != "id\t4\t1.5000") { std::cerr << "FAIL: append gave '" << row << "'\n"; ++failures; }
  }

  // Integers: zero, every power of ten and its neighbours, the extremes, and
  // random values across the whole range.
  checkSize(0);
  checkSize(std::numeric_limits<size_t>::max());
  for (size_t p = 1; p <= std::numeric_limits<size_t>::max() / 10; p *= 10)
  {
    checkSize(p - 1); checkSize(p); checkSize(p + 1);
  }
  for (int v : {0, 1, -1, 9, -9, 10, -10, 100, 255, std::numeric_limits<int>::max(),
                std::numeric_limits<int>::min(), std::numeric_limits<int>::min() + 1})
    checkInt(v);
  for (int i = 0; i < 100000; ++i)
  {
    checkSize(static_cast<size_t>(rng() >> (rng() % 64)));
    checkInt(static_cast<int>(static_cast<int64_t>(rng() % 4294967296u) - 2147483648));
  }

  // Specials. Zero keeps its sign ("-0.0000", "-0"), as printf does.
  // Negative NaN is deliberately absent: glibc prints "-nan", Apple's libc
  // "nan", and the C++ runtimes follow the sign bit. No written field is NaN
  // in practice: fisher() hands a NaN to Boost, which throws; the flanks and
  // the edge fits pass through std::max(0.0, x), which returns 0 for a NaN;
  // the glyco fraction would need an infinite peak intensity.
  for (double v : {0.0, -0.0, inf, -inf, std::numeric_limits<double>::quiet_NaN(),
                   std::numeric_limits<double>::denorm_min(), -std::numeric_limits<double>::denorm_min(),
                   std::numeric_limits<double>::min(), -std::numeric_limits<double>::min(),
                   std::numeric_limits<double>::max(), std::numeric_limits<double>::lowest()})
    checkAll(v);

  // Every power of ten in range: where %g switches between fixed and exponent
  // form (1e-5 vs 1e-4, 1e5 vs 1e6), and the exact expansions of the huge ones.
  for (int e = -323; e <= 308; ++e)
  {
    char s[16];
    std::snprintf(s, sizeof s, "1e%d", e);
    checkAround(std::strtod(s, nullptr));
  }

  // Values that round across a decade: 9.9999995e-5 -> "0.0001", 999999.5 ->
  // "1e+06", 0.99995 -> "1.0000", 9.9995 -> "10.000".
  for (double v : {9.9999995e-5, 9.99999949e-5, 999999.5, 999999.4999, 9999995.0, 0.99995,
                   0.999995, 9.9995, 99.9995, 0.0005, 0.00005, 0.5, 1.5, 2.5, 0.125, 0.375})
    checkAround(v);

  // Exact binary ties -- where round-half-even decides. n / 2^s with n odd has
  // exactly s decimals, the last a 5: s = 5 ties "%.4f", s = 4 ties "%.3f",
  // and n * 5^s with seven digits ties "%g"'s six.
  for (int i = 0; i < 20000; ++i)
  {
    const double n = static_cast<double>((rng() % (1u << 30)) | 1u);
    checkAround(n / 32.0);
    checkAround(n / 16.0);
    checkAround(n / 8.0);
    const int s = 1 + static_cast<int>(rng() % 9);
    const double p5 = std::pow(5.0, s);
    const double lo = std::ceil(1e6 / p5), hi = std::floor(9999999.0 / p5);
    if (lo > hi) continue;
    double m = lo + static_cast<double>(rng() % static_cast<uint64_t>(hi - lo + 1));
    if (std::fmod(m, 2.0) == 0.0) m += (m + 1 <= hi) ? 1 : -1;
    if (m < lo) continue;
    checkAround(std::ldexp(m, -s));                  // 7 significant digits, last one 5
    checkAround(std::ldexp(m, -s) * 1e6);            // the same digits in exponent form
  }
  for (int i = 0; i < 2000; ++i)
  {
    const float f = static_cast<float>((rng() % 1024) | 1u) / 16.0f;  // float conf ties
    checkAll(static_cast<double>(f));
  }

  // Realistic fields: masses and deltas (0..10000 Da, either sign), conf
  // floats in [0, 1] promoted to double, E-values log-uniform down to the
  // denormals.
  std::uniform_real_distribution<double> mass(-10000.0, 10000.0), unit(0.0, 1.0),
      expo(-320.0, 5.0);
  for (int i = 0; i < 200000; ++i)
  {
    checkAll(mass(rng));
    checkAll(static_cast<double>(static_cast<float>(unit(rng))));
    checkAll(std::pow(10.0, expo(rng)));
  }

  // Any finite double at all: random bit patterns, denormals and huge
  // magnitudes included (fixed then prints all ~300 integer digits).
  for (int i = 0; i < 100000; ++i)
  {
    const uint64_t bits = rng();
    double v;
    std::memcpy(&v, &bits, sizeof v);
    if (std::isfinite(v)) checkAll(v);
  }

  if (failures == 0) std::cout << "numformat_test: all " << checks << " checks passed\n";
  else std::cerr << failures << " of " << checks << " checks failed\n";
  return failures == 0 ? 0 : 1;
}
