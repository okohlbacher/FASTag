// Copyright (c) 2026 Oliver Kohlbacher and contributors
// SPDX-License-Identifier: MIT
//
// --------------------------------------------------------------------------
// $Maintainer: Oliver Kohlbacher $
// $Authors: Oliver Kohlbacher $
// --------------------------------------------------------------------------

// TOPPFASTag: species detection (-species, -species_call), phase 10 of main_().

#include "FASTagTool.h"

using namespace OpenMS;

std::optional<TOPPFASTag::ExitCodes> TOPPFASTag::detectSpecies_(bool want_species, FASTag::SpeciesOrientation species_orient, bool species_both,
                                                                bool species_call_on, FASTag::SpeciesCall::Params& species_call_params,
                                                                std::string& species_call_params_path, const std::string& in,
                                                                const std::string& out, std::vector<int>& lengths, const char* length_opt,
                                                                std::map<std::string, std::vector<std::pair<std::string, double>>>& by_spec)
{
  std::string taxdb = getStringOption_("taxdb");
  std::string species_out = getStringOption_("species_out");
  std::string nodes = getStringOption_("taxonomy_nodes");
  std::string names = getStringOption_("taxonomy_names");

  if (want_species)
  {
    const std::string tdir = taxonomyDir_();
    // The one-set rule is enforced before tagging; here explicit means all three.
    const bool any_explicit = !taxdb.empty() || !nodes.empty() || !names.empty();
    if (!any_explicit && !tdir.empty())
    {
      taxdb = tdir + "/tax_k7.taxdb";
      nodes = tdir + "/nodes.dmp";
      names = tdir + "/names.dmp";
    }
    if (species_out.empty()) species_out = defaultReportPath_(out, ".species.tsv");

    // Say which file is missing and where it was looked for. "Failed to load"
    // on an empty path is useless when the whole point of the defaults is that
    // the user never typed one.
    for (const auto& need : {std::make_pair("taxdb", taxdb),
                             std::make_pair("taxonomy_nodes", nodes),
                             std::make_pair("taxonomy_names", names)})
    {
      if (need.second.empty() || !File::exists(need.second))
      {
        OPENMS_LOG_ERROR << "-species: no " << need.first << ". ";
        if (tdir.empty())
        {
          OPENMS_LOG_ERROR << "No taxonomy directory was found next to the executable "
                           << "(expected <bin>/../share/FASTag/taxonomy). Set "
                           << "FASTAG_TAXONOMY_DIR, or pass -" << need.first << " explicitly."
                           << std::endl;
        }
        else if (need.second == taxdb)
        {
          // The dumps ship in every release; the ~1 GB index does not (it is a
          // separate asset). Missing index is the common case, so name it.
          OPENMS_LOG_ERROR << "The taxonomy dumps are present in '" << tdir
                           << "' but the k-mer index (tax_k7.taxdb) is not. Download "
                           << "FASTag-taxonomy-k7.tar.gz from the release and extract it "
                           << "there, or set FASTAG_TAXONOMY_DIR / pass -taxdb." << std::endl;
        }
        else
        {
          OPENMS_LOG_ERROR << "Looked in '" << tdir << "'. Pass -" << need.first
                           << " explicitly, or set FASTAG_TAXONOMY_DIR." << std::endl;
        }
        return ILLEGAL_PARAMETERS;
      }
    }
    FASTag::TaxIndex idx;
    std::string ierr;
    if (!idx.load(taxdb, &ierr))
    {
      OPENMS_LOG_ERROR << "Failed to load -taxdb '" << taxdb << "': " << ierr << std::endl;
      return INPUT_FILE_CORRUPT;
    }
    FASTag::Taxonomy tax;
    std::string terr;
    if (!tax.load(nodes, names, &terr))
    {
      OPENMS_LOG_ERROR << "Failed to load taxonomy: " << terr << std::endl;
      return INPUT_FILE_CORRUPT;
    }
    const int index_k = idx.k();
    int min_len = getIntOption_("species_min_len");
    if (min_len < index_k) min_len = index_k;

    // The up-front tag-length check again, against the LOADED k: the header
    // peek rejects legacy headers the loader still accepts, and then a run
    // whose tags are all shorter than k would write a header-only report
    // that reads as "nothing found" rather than "nothing could be found".
    const int reach = lengths.back() + 2 * getIntOption_("extension");
    if (reach < index_k)
    {
      OPENMS_LOG_WARN << "-species: no tag can reach the index k (this run was "
                      << "driven by -taxdb/-species_out rather than -species, which "
                      << "checks up front). tag_length ("
                      << lengths.back() << ") + 2*extension ("
                      << getIntOption_("extension") << ") = " << reach << " < k = " << index_k
                      << ", so every tag is too short to look up and the report WILL be empty. "
                      << "Raise " << length_opt << "to " << index_k << " (or use -extension to reach it)."
                      << std::endl;
    }

    // Per-spectrum taxon support -> per-leaf spectrum counts. by_spec was
    // collected in write_block, in write order.
    // Two filters on what counts as evidence, both identities at their
    // defaults:
    //
    //   share  -- a k-mer carried by most of the reference cannot discriminate
    //             between taxa, so it is not evidence for any of them. It is
    //             SKIPPED rather than deleted: the whole-tag rule below would
    //             otherwise make every tag containing one unmatchable.
    //   margin -- a tag whose best taxa carry no more of it than the field is
    //             too generic to be evidence at all. MARLOWE reports the
    //             absolute form of this failing on a broad database and
    //             replaces it with a top-two comparison; this is that idea
    //             adapted, since one proteome per genus leaves no within-genus
    //             fraction to compare.
    const std::vector<uint32_t> idx_taxa = idx.taxa();
    const double max_share = getDoubleOption_("species_max_kmer_share");
    const double min_margin = getDoubleOption_("species_min_margin");
    const size_t share_cap = max_share >= 1.0
        ? idx_taxa.size()
        : static_cast<size_t>(max_share * static_cast<double>(idx_taxa.size()));

    std::map<uint32_t, uint64_t> hits;       // per NODE, deduplicated per spectrum
    std::map<uint32_t, uint64_t> leaf_hits;  // per INDEX TAXON, deduplicated per spectrum
    size_t n_units = 0;
    FASTag::TagLookupCounters lookup_counters;
    const FASTag::SpeciesEvidence ev_mode = getStringOption_("species_evidence") == "all"
        ? FASTag::SpeciesEvidence::ALL : FASTag::SpeciesEvidence::BEST;
    std::vector<FASTag::TagSupport> support;  // this spectrum's informative tags
    // 1.12 #1 (-species_call decoy): every tag the target lookup evaluates
    // is also looked up as D decoys through the same rule, with the
    // target's E-value; replicate j of a spectrum counts like the spectrum
    // (best/all evidence, once per node, lineage roll-up). A trial is a
    // spectrum with at least one evaluated target tag. Own counters, so the
    // target's log line is unchanged.
    const int n_decoys = species_call_on ? getIntOption_("species_call_decoys") : 0;
    std::map<uint32_t, uint64_t> decoy_hits;  // per NODE, summed over the D replicates
    uint64_t n_trials = 0, n_decoy_less = 0;
    FASTag::TagLookupCounters decoy_counters;
    // 1.12 #10: the reversed lookups count on their own, so the forward
    // counters (and the log line) are a forward run's.
    FASTag::TagLookupCounters rev_counters, decoy_rev_counters;
    FASTag::OrientationCounts orient_counts;
    std::vector<std::vector<FASTag::TagSupport>> decoy_support(static_cast<size_t>(n_decoys));
    // DEV PROTOTYPE (1.13 species redesign): FASTAG_SPECIES_DUMP=<file> writes every evaluated tag with
    // its target taxa, FASTAG_SPECIES_DUMP_DECOYS k-mer-keyed decoy replicates and, with
    // FASTAG_SPECIES_DECOYDB=<taxdb>, its taxa in a decoy index. Diagnostic only; no other output changes.
    std::unique_ptr<std::ofstream> dump;
    FASTag::TaxIndex dump_didx;
    bool dump_didx_ok = false;
    int dump_nkd = 0;
    uint64_t dump_spec = 0;
    if (const char* dp = std::getenv("FASTAG_SPECIES_DUMP"))
    {
      dump.reset(new std::ofstream(dp));
      if (!*dump)
      {
        OPENMS_LOG_ERROR << "FASTAG_SPECIES_DUMP: cannot open '" << dp << "' for writing." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
      dump_nkd = 10;
      if (const char* nk = std::getenv("FASTAG_SPECIES_DUMP_DECOYS"))
      {
        const std::string nks(nk);
        if (nks.empty() || nks.size() > 4 || nks.find_first_not_of("0123456789") != std::string::npos)
        {
          OPENMS_LOG_ERROR << "FASTAG_SPECIES_DUMP_DECOYS: '" << nks << "' is not an integer in 0..9999." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
        dump_nkd = std::stoi(nks);
      }
      if (const char* ddb = std::getenv("FASTAG_SPECIES_DECOYDB"))
      {
        std::string derr;
        if (!dump_didx.load(ddb, &derr))
        {
          OPENMS_LOG_ERROR << "FASTAG_SPECIES_DECOYDB: " << derr << std::endl;
          return INPUT_FILE_CORRUPT;
        }
        if (dump_didx.k() != index_k)
        {
          OPENMS_LOG_ERROR << "FASTAG_SPECIES_DECOYDB: index k " << dump_didx.k() << " differs from the target index k "
                           << index_k << "; every decoy lookup would miss." << std::endl;
          return ILLEGAL_PARAMETERS;
        }
        dump_didx_ok = true;
      }
      *dump << "#k\t" << index_k << "\tkmer_decoys\t" << dump_nkd << "\tdecoydb\t" << (dump_didx_ok ? 1 : 0) << '\n';
      for (uint32_t tx : idx_taxa) *dump << "#taxon\t" << tx << '\t' << idx.postings(tx) << '\n';
    }
    auto dump_list = [](std::ostream& o, const std::vector<uint32_t>& v) {
      if (v.empty()) { o << '-'; return; }
      for (size_t i = 0; i < v.size(); ++i) { if (i) o << ','; o << v[i]; }
    };
    for (const auto& sp : by_spec)
    {
      support.clear();
      for (auto& ds : decoy_support) ds.clear();
      bool trial = false;
      if (dump) ++dump_spec;
      for (const auto& row : sp.second)
      {
        const std::string seq = FASTag::baseSequence(row.first);
        if (static_cast<int>(seq.size()) < min_len) continue;
        trial = true;
        if (dump)
        {
          FASTag::TagLookupCounters dc;
          std::vector<uint32_t> tt;
          FASTag::tagSupport(idx, seq, index_k, share_cap, min_margin, tt, dc);
          *dump << "T\t" << dump_spec << '\t' << row.second << '\t' << FASTag::TaxIndex::fold(seq) << '\t';
          dump_list(*dump, tt);
          *dump << '\t';
          for (int j = 0; j < dump_nkd; ++j)
          {
            bool nd = false;
            FASTag::kmerDecoySupport(idx, seq, index_k, static_cast<uint32_t>(j), share_cap, min_margin, tt, dc, &nd);
            if (j) *dump << '|';
            if (nd) *dump << 'X'; else dump_list(*dump, tt);
          }
          *dump << '\t';
          if (dump_didx_ok)
          {
            FASTag::tagSupport(dump_didx, seq, index_k, share_cap, min_margin, tt, dc);
            dump_list(*dump, tt);
          }
          else *dump << '-';
          *dump << '\n';
        }
        bool decoy_less = false;
        for (int j = 0; j < n_decoys; ++j)
        {
          // A homopolymer (or a periodic tag whose permutation cannot leave
          // both orientations) has no decoy j: it is counted, not looked up.
          const std::string dseq = FASTag::decoyTag(seq, static_cast<uint32_t>(j));
          if (dseq.empty()) { decoy_less = true; continue; }
          FASTag::TagSupport dts;
          // Under both orientations the decoy takes the target's rule.
          if (!FASTag::orientedTagSupport(idx, dseq, index_k, share_cap, min_margin, species_orient, dts.taxa,
                                          decoy_counters, decoy_rev_counters, nullptr))
            continue;
          dts.evalue = row.second;
          decoy_support[static_cast<size_t>(j)].push_back(std::move(dts));
        }
        if (decoy_less) ++n_decoy_less;
        // The per-tag rule (share skip, whole-tag rule, margin, and under
        // -species_orientation both the orientation rule) lives in
        // SpeciesLookup.h. Forward is tagSupport() exactly.
        FASTag::TagSupport ts;
        if (!FASTag::orientedTagSupport(idx, seq, index_k, share_cap, min_margin, species_orient, ts.taxa,
                                        lookup_counters, rev_counters, &orient_counts))
          continue;
        ts.evalue = row.second;
        support.push_back(std::move(ts));
      }
      if (trial) ++n_trials;
      for (const auto& ds : decoy_support)
      {
        const std::set<uint32_t> dtaxa = FASTag::spectrumTaxa(ds, ev_mode);
        std::set<uint32_t> dnodes;
        for (uint32_t tx : dtaxa)
          for (uint32_t a : tax.lineage(tx)) dnodes.insert(a);
        for (uint32_t a : dnodes) ++decoy_hits[a];
      }
      // The taxa this spectrum counts for: by default those of its best
      // informative tag, not the union over all reported tags (see
      // SpeciesEvidence.h).
      const std::set<uint32_t> taxa = FASTag::spectrumTaxa(support, ev_mode);
      if (taxa.empty()) continue;
      ++n_units;
      for (uint32_t tx : taxa) ++leaf_hits[tx];
      // Count each NODE at most once per spectrum. Increment every ancestor of
      // every supported taxon, deduplicated within the spectrum, so `hits` is
      // already a correct spectrum-count at every rank. Summing leaf counts up
      // the tree instead would count one spectrum TWICE at a genus with two
      // supported species.
      std::set<uint32_t> spec_nodes;
      for (uint32_t tx : taxa)
        for (uint32_t a : tax.lineage(tx)) spec_nodes.insert(a);
      for (uint32_t a : spec_nodes) ++hits[a];
    }

    if (dump)
    {
      const std::vector<uint64_t> ov = idx.pairwiseOverlap();
      const size_t nt = idx_taxa.size();
      for (size_t i = 0; i < nt; ++i)
      {
        *dump << "#overlap\t" << idx_taxa[i];
        for (size_t j2 = 0; j2 < nt; ++j2) *dump << '\t' << ov[i * nt + j2];
        *dump << '\n';
      }
      dump->close();
      if (!*dump)
      {
        OPENMS_LOG_ERROR << "FASTAG_SPECIES_DUMP: write failed (disk full?)." << std::endl;
        return CANNOT_WRITE_OUTPUT_FILE;
      }
    }

    // Subtract the evidence a taxon earns only by resembling a stronger one.
    // Counting cannot separate near neighbours -- Macaca trails Homo by a few
    // percent because mammalian proteomes share most 7-mers -- but the index
    // knows exactly how much they share, so the shared part can be removed.
    // See TaxDeconv.h for the model and its limits.
    std::map<uint32_t, double> adjusted_leaf;
    const bool deconvolved = getFlag_("species_deconvolve") && !idx_taxa.empty();
    // The pairwise overlap of the leaves, for the deconvolution only (the
    // homology term of -species_call counts its own group-level overlap).
    std::vector<uint64_t> overlap;
    if (deconvolved) overlap = idx.pairwiseOverlap();
    if (deconvolved)
    {
      const size_t nt = idx_taxa.size();
      std::vector<double> obs(nt, 0.0);
      for (size_t i = 0; i < nt; ++i)
      {
        auto it = leaf_hits.find(idx_taxa[i]);
        if (it != leaf_hits.end()) obs[i] = static_cast<double>(it->second);
      }
      const std::vector<double> est = FASTag::deconvolve(overlap, obs, nt);
      for (size_t i = 0; i < nt; ++i)
        if (est[i] > 0.0) adjusted_leaf[idx_taxa[i]] = est[i];
    }

    // Roll the ADJUSTED leaves up by SUMMING. Spectrum counts had to be
    // deduplicated per node -- one spectrum supporting two species of a genus
    // is still one spectrum -- but these are estimated independent
    // contributions, so a genus really is the sum of its species.
    //
    // Without deconvolution the leaves are raw spectrum counts, NOT
    // independent: a spectrum tied between two sibling leaves would count
    // twice at their parent, and a family of two genera sharing the same
    // spectra would outrank one with more distinct spectra. There the
    // per-node deduplicated count `hits` is the adjusted value; at a leaf it
    // equals leaf_hits.
    std::map<uint32_t, double> adjusted;
    if (deconvolved)
    {
      for (const auto& kv : adjusted_leaf)
        for (uint32_t a : tax.lineage(kv.first)) adjusted[a] += kv.second;
    }
    else
    {
      for (const auto& kv : hits) adjusted[kv.first] = static_cast<double>(kv.second);
    }

    // hits is already rolled up (spectrum-deduped per node), so build the
    // evidence directly -- rolling it again would re-introduce the double count.
    std::vector<FASTag::NodeEvidence> rolled;
    rolled.reserve(hits.size());
    for (const auto& kv : hits) rolled.push_back({kv.first, kv.second, kv.second});

    // The background (index breadth) IS summed up the subtree. This over-counts
    // a k-mer shared by sibling taxa, which inflates the expectation and makes
    // calls more CONSERVATIVE -- the safe direction.
    std::vector<std::pair<uint32_t, uint64_t>> post_pairs;
    for (uint32_t tx : idx_taxa) post_pairs.emplace_back(tx, idx.postings(tx));
    const auto rolled_post = tax.rollUp(post_pairs);
    std::map<uint32_t, double> bg;
    const double nk = static_cast<double>(std::max<uint64_t>(1, idx.nKmers()));
    for (const auto& np : rolled_post) bg[np.taxid] = static_cast<double>(np.subtree_hits) / nk;
    std::vector<std::pair<uint32_t, double>> bg_pairs(bg.begin(), bg.end());

    const double qthr = 1.0;  // rank everything; the report shows q, caller thresholds
    auto calls = tax.call(rolled, bg_pairs, static_cast<uint64_t>(n_units), qthr);

    const std::string want_rank = getStringOption_("species_rank");

    // 1.12 #1: the calibrated call per taxon at the report rank
    // (src/SpeciesCall.h). Groups are the report-rank ancestors of the
    // index taxa; the overlap matrix is rolled up to them for the homology
    // term, and their deconvolved counts are the spill sources.
    std::map<uint32_t, FASTag::SpeciesCall::GenusStat> call_stats;
    FASTag::SpeciesCall::RunInput call_run;
    if (species_call_on)
    {
      std::map<uint32_t, int> group_index;  // report-rank taxid -> group
      std::vector<uint32_t> group_taxid;
      std::vector<int> group_of(idx_taxa.size(), -1);
      for (size_t i = 0; i < idx_taxa.size(); ++i)
        for (uint32_t a : tax.lineage(idx_taxa[i]))
          if (tax.rank(a) == want_rank)
          {
            auto ins = group_index.emplace(a, static_cast<int>(group_taxid.size()));
            if (ins.second) group_taxid.push_back(a);
            group_of[i] = ins.first->second;
            break;
          }
      const size_t ng = group_taxid.size();
      // Distinct k-mers per group pair, not a sum of the members' pairwise
      // overlaps: a k-mer shared by two members of one group counts once,
      // so C[g][h] = P(k-mer in g | k-mer in h) also at family or order
      // rank and for indexes with several strains per genus.
      const std::vector<uint64_t> rolled_overlap = idx.groupOverlap(group_of, ng);
      const std::vector<double> C = FASTag::conditionalMatrix(rolled_overlap, ng);
      std::vector<double> obs(ng, 0.0);
      for (size_t g = 0; g < ng; ++g)
      {
        auto it = hits.find(group_taxid[g]);
        if (it != hits.end()) obs[g] = static_cast<double>(it->second);
      }
      const std::vector<double> est = FASTag::deconvolve(rolled_overlap, obs, ng);
      std::vector<FASTag::SpeciesCall::GenusInput> in_g(ng);
      const double units = static_cast<double>(std::max<size_t>(1, n_units));
      for (size_t g = 0; g < ng; ++g)
      {
        FASTag::SpeciesCall::GenusInput& x = in_g[g];
        x.taxid = group_taxid[g];
        x.observed = static_cast<uint64_t>(obs[g]);
        auto dit = decoy_hits.find(x.taxid);
        x.decoy_spectra = dit == decoy_hits.end() ? 0 : dit->second;
        double cnt = obs[g];
        if (deconvolved)
        {
          auto ait = adjusted.find(x.taxid);
          cnt = ait == adjusted.end() ? 0.0 : ait->second;
        }
        x.share = cnt / units;
        x.deconvolved = g < est.size() ? est[g] : obs[g];
      }
      call_run.n_units = n_units;
      call_run.n_trials = n_trials;
      call_run.decoys = n_decoys;
      call_run.min_units = static_cast<uint64_t>(getIntOption_("species_call_min_units"));
      call_run.low_resolution = getStringOption_("fragment_tolerance_unit") == "Da";
      call_run.pi0 = getDoubleOption_("species_pi0");
      const std::vector<FASTag::SpeciesCall::GenusStat> stats =
          FASTag::SpeciesCall::callGenera(in_g, C, call_run, species_call_params);
      for (const auto& st : stats) call_stats[st.taxid] = st;
    }

    std::ofstream so(species_out.c_str());
    if (!so)
    {
      OPENMS_LOG_ERROR << "Cannot open species report " << species_out << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    so << "rank\ttaxid\tname\tobserved\tadjusted\texpected\tlog_pvalue\tqvalue";
    if (species_call_on) so << "\tcall\tcall_reason\tdecoy_spectra\tdecoy_expected\tdecoy_qvalue\tshare\tlod";
    so << '\n';

    // Order by the corrected count, not by q. Significance ranks a near
    // neighbour highly precisely because its borrowed count IS significant.
    std::vector<const FASTag::TaxonCall*> ranked;
    for (const auto& c : calls) if (c.rank == want_rank) ranked.push_back(&c);
    std::stable_sort(ranked.begin(), ranked.end(),
                     [&](const FASTag::TaxonCall* a, const FASTag::TaxonCall* b) {
                       auto va = adjusted.find(a->taxid), vb = adjusted.find(b->taxid);
                       const double fa = va == adjusted.end() ? 0.0 : va->second;
                       const double fb = vb == adjusted.end() ? 0.0 : vb->second;
                       if (fa != fb) return fa > fb;
                       if (a->observed != b->observed) return a->observed > b->observed;
                       return a->taxid < b->taxid;   // deterministic ties
                     });

    // rank/name come from the taxdump, which can carry arbitrary text: a tab
    // or newline in a name would desync columns. Sanitise the free-text
    // fields, and stream them rather than format them into a fixed buffer
    // (only the bounded numerics go through one).
    auto clean = [](const std::string& in) {
      std::string o; o.reserve(in.size());
      for (char ch : in) o += (ch == '\t' || ch == '\n' || ch == '\r') ? ' ' : ch;
      return o;
    };
    size_t shown = 0;
    size_t n_call[3] = {0, 0, 0};  // present, no_call, not_detected among the rows
    for (const FASTag::TaxonCall* cp : ranked)
    {
      const FASTag::TaxonCall& c = *cp;
      auto ait = adjusted.find(c.taxid);
      const double adj = ait == adjusted.end() ? 0.0 : ait->second;
      char num[128];
      if (species_both)
        // 1.12 #10: uncalibrated under both orientations, also with
        // -species_call decoy (see the warning); its decoy_qvalue is also
        // experimental, not a calibrated error rate.
        std::snprintf(num, sizeof num, "\t%llu\t%.1f\t%.1f\tNA\tNA",
                      static_cast<unsigned long long>(c.observed), adj, c.expected);
      else
        std::snprintf(num, sizeof num, "\t%llu\t%.1f\t%.1f\t%g\t%g",
                      static_cast<unsigned long long>(c.observed), adj, c.expected,
                      c.log_pvalue, c.qvalue);
      so << clean(c.rank) << '\t' << c.taxid << '\t' << clean(c.name) << num;
      if (species_call_on)
      {
        auto sit = call_stats.find(c.taxid);
        if (sit == call_stats.end())
        {
          // Not an ancestor of any index taxon at this rank: cannot happen
          // for a counted taxon, but never leave the columns short.
          so << "\tnot_detected\tnot_significant\t0\tNA\tNA\tNA\tNA";
          ++n_call[2];
        }
        else
        {
          const FASTag::SpeciesCall::GenusStat& st = sit->second;
          char lod[32];
          if (st.lod >= 0.0) std::snprintf(lod, sizeof lod, "%.6g", st.lod);
          else std::snprintf(lod, sizeof lod, "NA");
          char cnum[160];
          std::snprintf(cnum, sizeof cnum, "\t%llu\t%.3f\t%g\t%.6g\t%s",
                        static_cast<unsigned long long>(st.decoy_spectra), st.expected, st.qvalue,
                        st.share, lod);
          so << '\t' << FASTag::SpeciesCall::callName(st.call) << '\t' << st.reason << cnum;
          ++n_call[st.call == FASTag::SpeciesCall::Call::PRESENT ? 0
                   : st.call == FASTag::SpeciesCall::Call::NO_CALL ? 1 : 2];
        }
      }
      so << '\n';
      if (++shown >= 50) break;
    }
    so.flush();
    const bool species_ok = static_cast<bool>(so);
    so.close();
    if (!species_ok || so.fail())
    {
      // A write error fails the run, as for every other report; exiting 0
      // would leave a stale report from an earlier run in place.
      OPENMS_LOG_ERROR << "Failed writing species report to " << species_out << std::endl;
      return CANNOT_WRITE_OUTPUT_FILE;
    }
    OPENMS_LOG_INFO << "Species: " << n_units << " spectra contributed taxon evidence";
    if (lookup_counters.kmer_skipped || lookup_counters.tag_generic)
      OPENMS_LOG_INFO << " (" << lookup_counters.kmer_skipped << " k-mers too widely shared, "
                      << lookup_counters.tag_generic << " tags too generic)";
    OPENMS_LOG_INFO << "; top " << want_rank << " calls -> " << species_out << std::endl;
    if (species_both)
    {
      // 1.12 #10: on stderr only, like every new 1.12 INFO line.
      std::cerr << "Species orientation (both): informative tags " << orient_counts.forward
                << " forward only, " << orient_counts.reverse << " reverse only, "
                << orient_counts.intersection << " both (shared taxa), " << orient_counts.palindrome
                << " palindromes; " << orient_counts.ambiguous
                << " orientation-ambiguous tags skipped" << std::endl;
    }
    if (species_call_on)
    {
      OPENMS_LOG_INFO << "Species call (-species_call decoy): " << n_call[0] << " present, " << n_call[1]
                      << " no_call, " << n_call[2] << " not_detected among the reported " << want_rank
                      << " rows";
      if (call_run.low_resolution) OPENMS_LOG_INFO << " (run-level no_call: low_resolution, Da tolerance)";
      else if (call_run.n_units < call_run.min_units)
        OPENMS_LOG_INFO << " (run-level no_call: few_spectra, " << call_run.n_units << " < "
                        << call_run.min_units << ")";
      OPENMS_LOG_INFO << "; " << n_trials << " trials, " << n_decoys << " decoys per tag";
      if (n_decoy_less) OPENMS_LOG_INFO << ", " << n_decoy_less << " tags without a decoy";
      OPENMS_LOG_INFO << "; parameters " << species_call_params_path
                      << (species_call_params.version.empty() ? std::string()
                                                              : " (" + species_call_params.version + ")")
                      << std::endl;
    }
  }
  return std::nullopt;
}
