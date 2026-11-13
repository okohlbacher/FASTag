// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

// TOPPFASTag: the GUI modes -probe_input and -dump_spectrum.

#include "FASTagTool.h"

using namespace OpenMS;

TOPPFASTag::ExitCodes TOPPFASTag::probeExit_(FASTag::Probe::Status s) const
{
  using S = FASTag::Probe::Status;
  switch (s)
  {
    case S::OK: return EXECUTION_OK;
    case S::UNSUPPORTED: return ILLEGAL_PARAMETERS;
    case S::NOT_READABLE: return INPUT_FILE_NOT_READABLE;
    case S::EMPTY: return INPUT_FILE_EMPTY;
    case S::CORRUPT: break;
  }
  return INPUT_FILE_CORRUPT;
}

bool TOPPFASTag::writeGuiStream_(const std::string& jsonl)
{
  if (!stream_data_) return false;
  const bool ok = std::fwrite(jsonl.data(), 1, jsonl.size(), stream_data_) == jsonl.size();
  return std::fflush(stream_data_) == 0 && ok;
}

TOPPFASTag::ExitCodes TOPPFASTag::probeInputMode_()
{
  namespace P = FASTag::Probe;
  P::ProbeOptions opt;
  opt.probe_spectra = static_cast<std::size_t>(getIntOption_("acquisition_probe_spectra"));
  opt.mzpeak_threads = std::min(std::max(1, omp_get_max_threads()), 8);
  FASTag::Centroid::parseMode(stringOption_("pick_profile"), opt.pick_mode);
  opt.acquisition_check = getStringOption_("acquisition_check");
  opt.fasta = getStringOption_("fasta");
  for (const std::string& a : getStringList_("shortlist_decoy_affix"))
    if (!a.empty()) opt.decoy_affixes.push_back(a);
  opt.version = FASTAG_VERSION;
  const std::string file = getStringOption_("probe_input");
  const P::ProbeOutput r = P::probeInput(file, opt);
  if (r.status != P::Status::OK)
  {
    OPENMS_LOG_ERROR << "-probe_input: " << r.error << std::endl;
    return probeExit_(r.status);
  }
  if (!writeGuiStream_(r.jsonl))
  {
    OPENMS_LOG_ERROR << "-probe_input: cannot write to stdout." << std::endl;
    return CANNOT_WRITE_OUTPUT_FILE;
  }
  return EXECUTION_OK;
}

TOPPFASTag::ExitCodes TOPPFASTag::dumpSpectrumMode_(const std::string& in, const FASTag::Param& p)
{
  namespace P = FASTag::Probe;
  if (!getStringOption_("out").empty())
    OPENMS_LOG_WARN << "-dump_spectrum writes no file; -out and every other output are ignored." << std::endl;
  // The dump prepares the peaks at the 1.11 precursor rule: the header m/z,
  // its charge or else 2. Options that tag a spectrum at other precursor
  // hypotheses (1.12 #6: -unknown_charge, -isotope_error) would make those
  // peaks and that charge not the ones tagged, so the dump refuses them
  // until it follows the selected hypothesis. They are looked up by name:
  // in a build without #6 they are not registered and nothing is refused.
  for (const char* name : {"unknown_charge", "isotope_error"})
  {
    if (!registeredNonDefault_(name)) continue;
    OPENMS_LOG_ERROR << "-dump_spectrum prepares the peaks at the given precursor and its charge (or 2+) "
                        "only and does not follow -" << name << " yet; leave -unknown_charge and "
                        "-isotope_error at their defaults." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  // 1.13: both tags a flagged spectrum at another charge than its header's as well.
  if (registeredNonDefault_("check_header_charge") && getStringOption_("check_header_charge") == "both")
  {
    OPENMS_LOG_ERROR << "-dump_spectrum prepares the peaks at the given precursor and its charge only and does "
                        "not follow -check_header_charge both yet; leave it off or at warn." << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  P::DumpOptions opt;
  FASTag::Centroid::parseMode(stringOption_("pick_profile"), opt.pick_mode);
  opt.mzpeak_threads = std::min(std::max(1, omp_get_max_threads()), 8);
  opt.param = p;
  opt.ion_mode = FASTag::IonSeries::modeFromString(stringOption_("ion_series"));
  const std::string id = getStringOption_("dump_spectrum");
  const P::DumpOutput r = P::dumpSpectrum(in, id, opt);
  if (r.status != P::Status::OK)
  {
    OPENMS_LOG_ERROR << "-dump_spectrum: " << r.error << std::endl;
    return probeExit_(r.status);
  }
  if (!r.found)
  {
    OPENMS_LOG_ERROR << "-dump_spectrum: no spectrum of '" << in << "' has the native ID '" << id << "'."
                     << std::endl;
    return ILLEGAL_PARAMETERS;
  }
  if (!writeGuiStream_(r.jsonl))
  {
    OPENMS_LOG_ERROR << "-dump_spectrum: cannot write to stdout." << std::endl;
    return CANNOT_WRITE_OUTPUT_FILE;
  }
  return EXECUTION_OK;
}
