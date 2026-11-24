// QC report rows for the kit-call tests (kitCall.test.tsx, batchSummary.test.ts).

// A synthetic qc_version 3 report in RunQC.cpp's words: the TMT label
// passed, but 134N is seen, which only TMTpro 18-plex holds.
export const CONFLICT_ROWS = [
  'qc\treporter_compatible_kits\ttmt18plex\t-\tKits compatible with the observed reporters.',
  'qc\treporter_kit\tconflict\t500\tConflict: the label mass says TMT (400 tag ends of 1000 filtered tags), but the observed channels fit only tmt18plex; no kit is called.',
  'qc\treporter_kit_candidates\ttmt18plex\t-\tThe kits the observed channels allow; they contradict the label mass, so none is called.',
  'qc\treporter_family_evidence\tlabel_conflict\t400\tThe label mass and the reporter channels disagree: the label mass says TMT (400 tag ends of 1000 filtered tags), the observed channels fit only tmt18plex.',
  'qc\treporter_label_delta\t229.162932\t1000\tThe label mass found on the tag ends (Da; n = filtered tags).'
]

/// The rows as a QC report file.
export const CONFLICT_QC = ['section\tkey\tvalue\tn\tdescription', ...CONFLICT_ROWS].join('\n') + '\n'
