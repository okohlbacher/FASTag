// Troubleshooting entries: what the user sees, the likely causes (most
// likely first), and what to do in the app.
//
// Write from what the user sees to what to change. Expand every abbreviation
// here again: readers land on this page first. Every fact must match the
// CLI (src/FASTag.cpp) and the docs; help.test.tsx checks that every digest
// no-call reason and every failure class below has an entry.
//
// Must not claim: that "no warning" means the data or settings are right;
// that a tag, a match or a call is an identification.
import type { JSX, ReactNode } from 'react'
import { HelpLink as L } from './HelpLink'

export interface FaqEntry {
  id: string
  group: string
  question: string
  /// What the user sees.
  symptoms: ReactNode
  causes: ReactNode[]
  fixes: ReactNode[]
}

export const FAQ_GROUPS = ['Running', 'Few or no tags', 'Species tab', 'Digest tab', 'Files', 'Batch runs']

const C = ({ children }: { children: string }): JSX.Element => <code className="cli">{children}</code>

// One entry per digest no-call reason, keyed as the report writes it.
const DIGEST: Record<string, Omit<FaqEntry, 'id' | 'group'>> = {
  low_resolution: {
    question: 'No protease call: "the fragment tolerance is in Da"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>The run used a fragment tolerance in Da (daltons), as for ion-trap data. The mass windows at the tag ends (0.008 Da) then cannot be trusted, so FASTag makes no call. The report is still written.</>
    ],
    fixes: [
      <>If the MS2 spectra are high resolution (Orbitrap, Astral, TOF), run again with a tolerance in <L to="gloss-ppm">ppm</L> (parts per million), for example 20 ppm. See <L to="param-fragment_tolerance">Fragment tolerance</L>.</>,
      <>If they really are ion-trap spectra, the digest cannot be judged from the tag ends.</>
    ]
  },
  timstof: {
    question: 'No protease call: "the run is from a timsTOF"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>The file names a timsTOF instrument, the Bruker data format or ion mobility as timsTOF instruments measure it. On timsTOF data a C-terminal R is nearly invisible in the tag ends, so the counts cannot show the protease fairly.</>
    ],
    fixes: [<>None in FASTag: this rule protects the call. Use the label and mass-gap reports, which still apply.</>]
  },
  ms2_scan_window: {
    question: 'No protease call: "the MS2 scan range starts above m/z 147.21"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>In most MS2 spectra (the median) the scan range starts above <L to="gloss-mz">m/z</L> 147.21, which is the y1 ion of a C-terminal K (the last residue alone) plus 0.1. The smallest y ions, which show the residue before the cut, were never measured.</>
    ],
    fixes: [<>None in FASTag. A protease call needs MS2 spectra that start low enough, so set a lower first mass in the instrument method of future runs.</>]
  },
  ms2_first_peak: {
    question: 'No protease call: "the first MS2 peaks lie above m/z 147.21"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>In most MS2 spectra the lowest peak lies above m/z 147.21, so the y1 ion of a C-terminal K cannot be seen. This rule reads the peaks themselves, so it also works when the file has no instrument information (an MGF file, for example).</>
    ],
    fixes: [<>None in FASTag, as for the scan range above.</>]
  },
  ion_counts: {
    question: 'No protease call: "no instrument is named and the intensities are ion counts"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>The file names no instrument, and at least half of its peak intensities are whole numbers. timsTOF data look like this, so FASTag treats the run as timsTOF data (see the timsTOF entry above).</>,
      <>Rarely, an Orbitrap MGF file whose writer rounded the intensities to whole numbers.</>
    ],
    fixes: [<>If the run is from an Orbitrap, tag the mzML file it came from instead: it names its instrument.</>]
  },
  few_tags: {
    question: 'No protease call: "too few terminal tags"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>Fewer than 100 tag ends (the minimum, <C>digest_tag_min</C>) fit a residue. Only tags without a gap and with an <L to="gloss-e-value">E-value</L> of at most 1 are counted.</>,
      <>A sequence database was set: then only the tags written to the Tags tab are counted.</>,
      <>Only a small part of the run was tagged (subsampling).</>
    ],
    fixes: [
      <>Run without a sequence database and without subsampling.</>,
      <>Check the fragment tolerance (see <L to="faq-no-tags">Few or no tags</L>).</>
    ]
  },
  nonfinite_score: {
    question: 'No protease call: "a residue has probability 0 under a model"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>A residue seen at the tag ends is impossible under the best model or its runner-up. This happens with a protease table of your own (<C>digest_models</C>) that leaves out residues, or when the background share is 0.</>
    ],
    fixes: [<>Give every residue a frequency in your table, or keep the background share above 0 (the default is 0.05).</>]
  },
  tie: {
    question: 'No protease call: "two models of different classes fit equally well"',
    symptoms: <>The Digest tab shows <em>No call</em> with this reason.</>,
    causes: [
      <>Two proteases of different kinds explain the counts exactly equally well. This happens, for example, for Asp-N, Lys-N and unspecific cleavage when there are too few N-terminal tag ends to use: those models differ only at that end.</>
    ],
    fixes: [<>None needed: FASTag reports a tie instead of a call with a lead of 0.</>]
  }
}

export const DIGEST_REASONS = Object.keys(DIGEST)

export const FAQ: FaqEntry[] = [
  // Running
  {
    id: 'faq-will-not-start',
    group: 'Running',
    question: 'The title bar says "FASTag cannot start"',
    symptoms: <>A red label in the title bar, or a run that ends at once with "FASTag could not start".</>,
    causes: [
      <>The FASTag program that comes with the app is missing or cannot be run on this computer. Hover over the label to see where the app looked for it.</>
    ],
    fixes: [<>Install the app again from the release page. The label turns into "FASTag ready" when the program can be run.</>]
  },
  {
    id: 'faq-run-disabled',
    group: 'Running',
    question: 'The Run button is grey',
    symptoms: <>Run (or Run remaining files) cannot be clicked.</>,
    causes: [
      <>No input file is chosen yet.</>,
      <>A value is marked red: FASTag would refuse it. The reason is written under the field and above the Run button.</>,
      <>Two settings do not go together, for example species detection with tags that are too short. The reason is written above the Run button.</>,
      <>Files are queued for a batch: the batch has its own Run button.</>,
      <>A run is still going.</>
    ],
    fixes: [<>Fix what the message above the Run button names. Reset… sets every parameter back to its default.</>]
  },
  {
    id: 'faq-run-failed',
    group: 'Running',
    question: 'A run failed with an exit code',
    symptoms: <>A red box above the results: "… failed (exit code N)" and FASTag&apos;s reason.</>,
    causes: [
      <>The reason line is FASTag&apos;s own message, and usually says what to change. The exit code says what kind of problem it was: 1, a file was not found (OpenMS checks this before FASTag starts); 2, the input cannot be read; 3, an input cannot be decoded (the spectra, a protease table of your own, or the species reference); 4, an input holds nothing usable; 5, an output cannot be written; 6, settings that do not go together, a value out of range, or an input of a type FASTag does not read; 11, ion-mobility spectra cannot be written as mzPeak; 13, see the entries on the spectra file and the entrapment database below.</>
    ],
    fixes: [
      <>Show full log shows every message of the run. Copy command copies the command line, to run it in a terminal or to send with a question.</>
    ]
  },
  {
    id: 'faq-min-filter',
    group: 'Running',
    question: 'The run is refused: no tag can reach the minimum filter length',
    symptoms: <>The run fails with exit code 6, and the reason says the database needs tags of at least N residues.</>,
    causes: [
      <>A short tag matches almost any database by chance, so FASTag sets a minimum length from the size of the sequence database: about 4 residues for one protein, 7 or 8 for a proteome. Tags are at most tag length + 2 × extension long; with the defaults (3 and 0) that is 3.</>
    ],
    fixes: [
      <>Raise <L to="param-extension">extension</L> or <L to="param-tag_length">tag length</L> so that tag length + 2 × extension reaches the length the reason names.</>,
      <>Or set <L to="param-min_filter_length">minimum filter length</L> yourself, and accept more chance matches: read the chance table in the log (see <L to="results-fasta">Matching a sequence database</L>).</>
    ]
  },
  {
    id: 'faq-incomplete',
    group: 'Running',
    question: 'The Tags tab says Outdated, Removed or Incomplete',
    symptoms: <>A box in the Tags tab: &quot;Outdated&quot; while a run goes, &quot;Removed&quot; after a run stopped part-way, or &quot;Incomplete&quot; with an Open it anyway link.</>,
    causes: [
      <>Outdated: a run is writing the tags file again, in place. Its tags appear when it finishes.</>,
      <>Removed: the run was cancelled or failed, and the app removed every file it had written so far (the tags and each report), so none of them can later be read as a complete result. A file that cannot be removed is renamed to <code>&lt;name&gt;.incomplete</code>; the log names each one. A file from an earlier run that this run never wrote is left alone.</>,
      <>Incomplete: the run was cancelled or failed while it wrote the tags file, and the file is still there. The file may hold only part of the table, or none, and the reports may be missing, partial, or left from an earlier run.</>
    ],
    fixes: [
      <>Run again to get a complete tags file and reports.</>,
      <>Open it anyway shows what the file holds. That is safe for a look, but the rows may stop part-way: do not count or export them as a full result.</>
    ]
  },
  {
    id: 'faq-modification',
    group: 'Running',
    question: 'The run fails with "Unknown modification"',
    symptoms: <>FASTag&apos;s reason names a modification it does not know.</>,
    causes: [<>A modification is not written as OpenMS names it, for example "Carbamidomethyl" without its residue.</>],
    fixes: [
      <>Write the Unimod name with the residue in brackets, one per line: <code>Carbamidomethyl (C)</code>, <code>Oxidation (M)</code>, <code>TMT6plex (N-term)</code>. See <L to="param-fixed_modifications">Fixed modifications</L>.</>
    ]
  },

  // Few or no tags
  {
    id: 'faq-no-tags',
    group: 'Few or no tags',
    question: 'The run wrote no tags, or very few',
    symptoms: <>The Tags tab says "The file has no tags", or shows far fewer tags than spectra.</>,
    causes: [
      <>The <L to="gloss-tolerance">fragment tolerance</L> does not fit the instrument. A <L to="gloss-ppm">ppm</L> tolerance on ion-trap spectra finds almost nothing: on one ion-trap file, 20 ppm gave 3,007 tags and 0.3 Da gave 824,959. The log then warns that no two peaks are closer than the tolerance allows.</>,
      <>The MS2 spectra in an mzML file are profile data (raw curves, not peaks). They are tagged as they are, which finds fewer tags.</>,
      <>A sequence database is set: only tags that occur in it are written.</>,
      <>The <L to="gloss-e-value">E-value</L> cutoff (<C>max_evalue</C>) is low, or the file holds no MS2 spectra.</>
    ],
    fixes: [
      <>Set the tolerance to the instrument: 20 ppm for Orbitrap, Astral and TOF data, 0.3 Da for an ion trap. See <L to="param-fragment_tolerance">Fragment tolerance</L>.</>,
      <>Centroid profile spectra first (for example with OpenMS PeakPickerHiRes or msconvert), or convert the run to mzPeak, which FASTag centroids as it reads.</>,
      <>Run once without a sequence database to see how many tags there are at all.</>
    ]
  },
  {
    id: 'faq-tolerance-warning',
    group: 'Few or no tags',
    question: 'The log warns "No two peaks anywhere in this file are closer than …"',
    symptoms: <>A warning in the log that names a distance between peaks and the fragment tolerance.</>,
    causes: [<>The peaks of this file lie much further apart than the tolerance. That is what low-resolution (ion-trap) spectra look like when read with a high-resolution tolerance.</>],
    fixes: [<>If the MS2 spectra come from an ion trap, set the fragment tolerance to 0.3 Da. FASTag cannot know the instrument, so this setting is yours.</>]
  },
  {
    id: 'faq-stale-index',
    group: 'Few or no tags',
    question: 'The log warns that the mzML file "has no index, or one that no longer matches"',
    symptoms: <>A warning naming the input file; the run still finishes.</>,
    causes: [<>The mzML file has no index (a table of where each spectrum starts), or a tool changed the file without updating it. FASTag rebuilt the index by reading the file once more.</>],
    fixes: [<>Nothing is wrong with the results. To skip the extra pass next time, write the file again with an index, for example with OpenMS FileConverter.</>]
  },

  // Species tab
  {
    id: 'faq-species-off',
    group: 'Species tab',
    question: 'The Species tab says species detection is off',
    symptoms: <>"Species detection is off", or "The last run … did not detect species".</>,
    causes: [<>The run was made without <C>species</C>.</>],
    fixes: [<>Open Species detection in the parameters, tick Species, set tag length 7 and run again. See <L to="species-howto">How species detection works</L>.</>]
  },
  {
    id: 'faq-species-short',
    group: 'Species tab',
    question: 'Tags are too short for the species reference',
    symptoms: <>The Species tab or the message beside Run says the tags cannot reach the index length k = 7.</>,
    causes: [<>The species reference stores protein pieces of 7 residues (<L to="gloss-kmer">k-mers</L>). A tag shorter than that cannot be looked up, so FASTag refuses the run. The longest seed length plus 2 × extension must reach 7.</>],
    fixes: [<>Set tag length to 7. Tag length 3 with extension 2 also passes the check, but only tags that actually grow to 7 residues count, which is usually far fewer; check the Evidence card afterwards.</>]
  },
  {
    id: 'faq-species-none',
    group: 'Species tab',
    question: 'No organism was supported by the tags',
    symptoms: <>The run finished, and the Species tab says no taxon was supported.</>,
    causes: [
      <>Too few tags were found in the reference: an organism (a <L to="gloss-taxon">taxon</L>) needs at least 5 supporting spectra to be listed.</>,
      <>A sequence database was set, so only its matching tags counted.</>,
      <>Too small a subsample, or few tags at all (see <L to="faq-no-tags">Few or no tags</L>).</>
    ],
    fixes: [<>Run without a sequence database and with more spectra. This is a negative result, not an error.</>]
  },
  {
    id: 'faq-species-unexpected',
    group: 'Species tab',
    question: 'The expected organism ranks low, or unexpected relatives rank high',
    symptoms: <>Close relatives of the sample (Macaca next to Homo), or unrelated organisms, appear near the top.</>,
    causes: [
      <>Close relatives share most short protein pieces, so they share evidence. The top organism usually still leads, but only by a few percent.</>,
      <>The organism is not in the reference (about 50 genera), so it cannot be called. It may show up as a related genus that is in the reference, or give little evidence at all.</>,
      <>Common contaminants such as trypsin (Sus), serum albumin (Bos) or keratin (Homo) are often in the sample. See <L to="species-contaminants">Common contaminants</L>.</>,
      <><L to="gloss-gapped">Gapped tags</L> were let in (<C>species_use_gapped</C>), or the spectra are low resolution.</>
    ],
    fixes: [
      <>On high-resolution data with the relatives in the reference, try <L to="species-deconvolve">deconvolution</L>.</>,
      <>Read the call at the genus or family level. See <L to="species-limits">When to trust a call</L>.</>
    ]
  },
  {
    id: 'faq-species-reference',
    group: 'Species tab',
    question: 'The run fails because the species reference is missing',
    symptoms: <>FASTag&apos;s reason says it found no taxonomy, or could not load the index.</>,
    causes: [
      <>The species reference (about 1 GB) is not where FASTag looks for it, next to the program.</>,
      <>An index, nodes or names file of your own was given without the other two.</>
    ],
    fixes: [<>Clear all three reference fields to use the bundled reference, or give all three. If the bundled one is missing, install the app again.</>]
  },

  // Digest tab
  {
    id: 'faq-digest-empty',
    group: 'Digest tab',
    question: 'The Digest tab is empty',
    symptoms: <>The Digest tab offers only to open a report.</>,
    causes: [<>The run wrote none of the digest, label or mass-gap reports; they are off by default.</>],
    fixes: [
      <>Under Digest and labels, set a file for the digest report and the label report. The mass-gap report sits under Reconciliation and needs the reconciliation table. See <L to="digest">The Digest tab</L>.</>
    ]
  },
  ...DIGEST_REASONS.map((k) => ({ id: `faq-digest-${k}`, group: 'Digest tab', ...DIGEST[k] })),

  // Files
  {
    id: 'faq-input',
    group: 'Files',
    question: 'The input file cannot be read',
    symptoms: <>The run fails with exit code 1, 2, 3, 4 or 6, and the reason names the input.</>,
    causes: [
      <>The file was moved, renamed or deleted after it was chosen (&quot;File not found&quot;, exit code 1).</>,
      <>The file is not mzML, mzPeak or MGF. Vendor files (Thermo .raw, Bruker .d) are not read.</>,
      <>The mzML or MGF file is compressed (.gz, .bz2, .zip); FASTag reads both only uncompressed.</>,
      <>The MGF file is cut short, or holds no BEGIN IONS block.</>,
      <>The mzPeak file uses an encoding OpenMS cannot decode.</>
    ],
    fixes: [
      <>Convert vendor files first, for example with msconvert or ThermoRawFileParser (to mzML). Decompress mzML and MGF files. See <L to="files-inputs">Input files</L>.</>
    ]
  },
  {
    id: 'faq-cannot-write',
    group: 'Files',
    question: 'An output cannot be written',
    symptoms: <>The run fails with exit code 5 ("Cannot open output file", "Failed writing") or 6 ("name the same file").</>,
    causes: [
      <>The folder cannot be written to, or the disk is full (exit code 5).</>,
      <>Two outputs name the same file, or an output names the input file (exit code 6).</>
    ],
    fixes: [<>Choose another folder or file name under Output, or free disk space.</>]
  },
  {
    id: 'faq-out-spectra-none',
    group: 'Files',
    question: 'The spectra file was not written (exit code 13)',
    symptoms: <>The reason says no spectrum carried a reported tag.</>,
    causes: [
      <>With an <L to="gloss-entrapment">entrapment database</L>, every tag left matched only the entrapment database (efwd, erev in Database hit); such spectra are not written.</>,
      <>With "Spectra with tags" set, no spectrum had a tag to write, for example because no tag matched the sequence database.</>
    ],
    fixes: [
      <>The tags file and every report are complete. If the Tags tab shows only entrapment matches, no reported tag matched the sequence database, so there was no spectrum to write. This does not show that the protein is absent. Otherwise check the tags (see <L to="faq-no-tags">Few or no tags</L>).</>
    ]
  },
  {
    id: 'faq-entrapment',
    group: 'Files',
    question: 'The entrapment database is refused (exit code 13)',
    symptoms: <>The reason says the entrapment database shares its sequence space with the target database.</>,
    causes: [<>Every tag that could match the <L to="gloss-entrapment">entrapment database</L> could also match the sequence database, so no chance rate can be estimated. The files written while the spectra are read (the tags file, the reconciliation table and the glyco report) are kept; the tags file has no q_db column. The files written at the end of a run are not: the mass-shift histogram, the reconciliation identifications, the digest, label and mass-gap reports, and the spectra file.</>],
    fixes: [<>Choose a more distant organism for the entrapment database, for example archaea for a human sample.</>]
  },

  // Batch runs
  {
    id: 'faq-batch-failed',
    group: 'Batch runs',
    question: 'Some files of a batch failed',
    symptoms: <>A red box "N of M batch jobs failed", and failed files marked in the batch list.</>,
    causes: [<>Each failed file has its own reason, shown in the red box and on the file in the batch list.</>],
    fixes: [<>Fix the cause, then click Retry failed: it runs only the failed files again. See <L to="start-batch">Batch runs</L>.</>]
  }
]

export const FAQ_BY_ID = new Map(FAQ.map((f) => [f.id, f]))

/// The entry for a failure message from FASTag or the app.
export const CLASSES: [RegExp, string][] = [
  [/cannot reach the index k/, 'faq-species-short'],
  [/-species: no |taxonomy directory|Failed to load (-taxdb|taxonomy)/, 'faq-species-reference'],
  [/Unknown modification/, 'faq-modification'],
  [/reach the minimum filter length/, 'faq-min-filter'],
  [/No spectrum carried a reported tag/, 'faq-out-spectra-none'],
  [/entrapment database shares/i, 'faq-entrapment'],
  [/Cannot open output file|Failed writing|Cannot write|disk full|name the same file|is the input file/i, 'faq-cannot-write'],
  [/could not start|cannot start|cannot (run|execute)/i, 'faq-will-not-start'],
  [/^Input '|is neither|BEGIN IONS|File not found|not readable|does not exist|compressed|mzPeak support|cannot be (read|opened|decoded)/i, 'faq-input']
]
export function faqForMessage(text: string): string {
  return CLASSES.find(([re]) => re.test(text))?.[1] ?? 'faq-run-failed'
}
