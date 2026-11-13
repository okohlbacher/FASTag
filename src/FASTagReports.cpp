// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

// TOPPFASTag: tag TSV header and rows, report paths, ProForma prefix.

#include "FASTagTool.h"

using namespace OpenMS;

std::string TOPPFASTag::defaultReportPath_(const std::string& out, const char* suffix)
{
  const size_t slash = out.find_last_of("/\\");
  const size_t dot = out.rfind('.');
  const bool ext = dot != std::string::npos && (slash == std::string::npos || dot > slash);
  return (ext ? out.substr(0, dot) : out) + suffix;
}

void TOPPFASTag::appendField_(std::string& buf, const std::string& text)
{
  if (text.find_first_of("\t\r\n") == std::string::npos) { buf += text; return; }
  for (char c : text) buf += (c == '\t' || c == '\r' || c == '\n') ? ' ' : c;
}

std::string TOPPFASTag::tagHeader_(bool proforma, bool res_conf, bool usi, bool hyp, bool ion_series)
{
  std::string h = "spectrum\ttag\tlength\tcharge\tnterm_mass\tcterm_mass\textended"
                  "\tgapped\tevalue\tmin_conf\tmean_conf\tfasta_hit";
  if (proforma) h += "\tproforma";
  if (res_conf) h += "\tres_conf";
  if (usi) h += "\tusi";
  if (hyp) h += "\tprec_charge\tcharge_src\tiso_offset\tselected";
  if (ion_series) h += "\tion_series";  // 1.12 #15 phase B: after #6's, by or cz
  return h + "\n";
}

void TOPPFASTag::appendTagRow_(std::string& buf, const FASTag::Tag& t,
                         const std::string& native_id, const char* hit,
                         bool want_proforma, const std::string& proforma_fixed,
                         bool want_res_conf, const std::string& usi,
                         const FASTag::Hyp::Hypothesis* hyp,
                         bool want_series)
{
  using FASTag::appendNum;
  constexpr auto fixed = std::chars_format::fixed;
  appendField_(buf, native_id); buf += '\t';
  buf += t.seq;              buf += '\t';
  appendNum(buf, t.n_res);   buf += '\t';
  appendNum(buf, t.charge);  buf += '\t';
  if (g_full_precision)
  {
    FASTag::appendShortest(buf, t.nterm_mass); buf += '\t';
    FASTag::appendShortest(buf, t.cterm_mass); buf += '\t';
  }
  else
  {
    appendNum(buf, t.nterm_mass, fixed, 4); buf += '\t';
    appendNum(buf, t.cterm_mass, fixed, 4); buf += '\t';
  }
  buf += t.extended ? '1' : '0'; buf += '\t';
  buf += t.gapped ? '1' : '0';   buf += '\t';
  if (g_full_precision) FASTag::appendShortest(buf, t.evalue);
  else appendNum(buf, t.evalue, std::chars_format::general, 6);
  buf += '\t';
  appendNum(buf, t.min_conf, fixed, 3);  buf += '\t';
  appendNum(buf, t.mean_conf, fixed, 3); buf += '\t';
  buf += hit;
  if (want_proforma) { buf += '\t'; buf += FASTag::toProforma(t.seq, t.nterm_mass, t.cterm_mass, proforma_fixed); }
  if (want_res_conf)
  {
    buf += '\t';
    for (size_t i = 0; i < t.res_conf.size(); ++i)
    {
      if (i) buf += ' ';
      appendNum(buf, static_cast<int>(t.res_conf[i]));
    }
  }
  if (!usi.empty()) { buf += '\t'; buf += usi; }
  if (hyp)
  {
    // 1.12 #6: the hypothesis the row was tagged under.
    buf += '\t'; appendNum(buf, hyp->charge);
    buf += '\t'; buf += FASTag::Hyp::sourceName(hyp->src);
    buf += '\t'; appendNum(buf, hyp->iso);
    buf += '\t'; buf += hyp->selected ? '1' : '0';
  }
  if (want_series) { buf += '\t'; buf += FASTag::IonSeries::seriesName(t.ion_series); }
  buf += '\n';
}

bool TOPPFASTag::readSpeciesFields_(const std::string& r, size_t start, size_t nl, std::string& id,
                              std::string& tag, bool& gapped, double& evalue)
{
  const size_t t1 = r.find('\t', start);
  if (t1 == std::string::npos || t1 >= nl) return false;
  const size_t t2 = r.find('\t', t1 + 1);
  if (t2 == std::string::npos || t2 > nl) return false;
  id = r.substr(start, t1 - start);
  tag = r.substr(t1 + 1, t2 - t1 - 1);
  gapped = false;
  evalue = std::numeric_limits<double>::quiet_NaN();
  size_t f = t2, col = 2;
  while (col < 7 && f != std::string::npos && f < nl) { f = r.find('\t', f + 1); ++col; }
  if (f != std::string::npos && f + 1 < nl)
  {
    gapped = (r[f + 1] == '1');
    const size_t fe = r.find('\t', f + 1);
    // Written by appendNum (to_chars: '.', no locale) and read back by
    // strtod in the process's C locale -- FASTag never calls setlocale.
    if (fe != std::string::npos && fe + 1 < nl) evalue = std::strtod(r.c_str() + fe + 1, nullptr);
  }
  return true;
}

std::string TOPPFASTag::buildProformaPrefix_(const std::vector<FASTag::ModSpec>& mods)
{
  std::string out;
  for (const FASTag::ModSpec& m : mods)
    if (!m.variable) out += "<[" + m.name + "]@" + m.residue + ">";
  return out;
}
