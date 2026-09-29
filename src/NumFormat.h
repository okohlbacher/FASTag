// Append a number to a TSV row exactly as printf would, without printf.
//
// The row writers format ~9 numbers per tag row, from every OpenMP worker at
// once. snprintf consults the locale on every call, and on macOS that is a
// process-wide lock (localeconv_l inside vfprintf): at 16 threads 18.5% of
// worker CPU sat queued on it. std::to_chars is locale-free, and with an
// explicit precision the standard specifies it as printf in the "C" locale
// with the same conversion and precision -- so the output is byte-identical,
// which test/numformat_test.cpp checks against the platform's own snprintf.
// One libc deviates: Apple's "%g" keeps trailing zeros when an exact tie
// rounds down onto a 0 ("1.00000e+06" for 1000005, where C and glibc print
// "1e+06", as to_chars does) -- an integer >= 1e6, far past any E-value the
// -max_evalue cutoff lets through.
//
// Floating-point to_chars lives in the C++ runtime, not the header: Apple's
// system libc++ has it from macOS 13.3, so a macOS deployment target below
// that rejects the call at compile time.
//
// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
#pragma once

#include <charconv>
#include <string>
#include <type_traits>

namespace FASTag
{
  /// Append @p v as "%d" / "%zu" would.
  template <typename Int>
  inline void appendNum(std::string& buf, Int v)
  {
    static_assert(std::is_integral_v<Int>, "doubles need a format and precision");
    char num[24];  // 20 digits of a 64-bit value, plus a sign
    buf.append(num, std::to_chars(num, num + sizeof num, v).ptr);
  }

  /// Append @p v as "%.<prec>f" (chars_format::fixed) or "%.<prec>g"
  /// (chars_format::general) would; "%g" is general with precision 6. A float
  /// argument is promoted to double first, as printf's varargs promote it.
  /// @p prec <= 16.
  inline void appendNum(std::string& buf, double v, std::chars_format fmt, int prec)
  {
    char num[330];  // fixed DBL_MAX: a sign, 309 digits, '.', prec digits
    buf.append(num, std::to_chars(num, num + sizeof num, v, fmt, prec).ptr);
  }
}
