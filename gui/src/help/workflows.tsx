import type { HelpPage } from './content'
import { HelpLink as L } from './HelpLink'

// Guides for the result and batch workflows. Keep thresholds and action
// descriptions aligned with overview.ts, batchSummary.ts and ReconView.tsx.
export const WORKFLOWS: HelpPage = {
  id: 'workflows',
  title: 'Results and workflows',
  lead: <>Read a completed run, compare several files, and return to earlier work.</>,
  sections: [
    {
      id: 'workflow-overview',
      title: 'Overview: read the evidence first',
      body: (
        <>
          <p>
            <strong>Characterize a run</strong> opens Results on <strong>Overview</strong>. Start with the file
            name and counts, then read each result with the explanation beneath it. With the initial 10% sample,
            the figures describe the processed subset, not the whole input.
          </p>
          <ul>
            <li><strong>MS2 spectra</strong> counts spectra processed by the tagger. <strong>With tags</strong> counts spectra with a reported tag, when the run recorded that count.</li>
            <li><strong>Tags</strong> is the tag count from FASTag&apos;s final log summary; one spectrum can contribute several tags. <strong>Tags E ≤ 1</strong> counts the ungapped tags used by the digest report.</li>
            <li><strong>No call</strong> means the report did not support a classification; read its reason. <strong>Not assessed</strong> means the necessary analysis or report is missing. <strong>Not checked</strong> means the relevant check was unavailable. None establishes absence.</li>
            <li><strong>Too little evidence</strong> replaces protease, genus or label results when fewer than 1,000 tagged spectra were counted. If the run did not count tagged spectra, this extra GUI cutoff cannot be applied; the warning says so. Alkylation uses separate mass-gap counts.</li>
          </ul>
          <p>
            <strong>Suggested search settings</strong> labels the source of every value: <em>call</em>,{' '}
            <em>ranking</em>, <em>default</em>, <em>preset</em> or <em>as run</em>. For example, a suggested fixed
            Carbamidomethyl modification can be a default even when alkylation was not assessed. A ranking does
            not establish presence. <strong>Copy</strong> copies these suggestions and their caveats; it does not
            configure a search engine or change Setup. Check them before using them elsewhere.
          </p>
          <p>
            A <strong>Turn on and run again</strong> button starts a new analysis with the missing report enabled.
            Adding a FASTA for mass gaps can also raise the extension so tags can reach the database&apos;s required
            length. Review overwrite questions. For detail, open <L to="species">Species</L>,{' '}
            <L to="digest">Digest</L> or <L to="results">Tags</L>.
          </p>
        </>
      )
    },
    {
      id: 'workflow-batch',
      title: 'Batch: run and compare several files',
      body: (
        <>
          <ol>
            <li>Choose <strong>Batch QC vs SDRF</strong> for the Characterize survey of several files, or add files to a batch from Setup. An SDRF is optional.</li>
            <li>Use <strong>Add…</strong> to select files or <strong>Add folder…</strong> for the spectra files directly inside a folder. Check the common settings in Setup; each file runs in turn with those settings.</li>
            <li>Use <strong>Choose output folder…</strong> if results should go elsewhere, for example when the inputs are read-only. <strong>Beside inputs</strong> restores the usual location. Changing the folder affects pending or retried jobs; completed jobs keep their existing output paths.</li>
            <li><strong>Run N remaining files</strong> continues the queue. <strong>Retry failed</strong> retries failed jobs. Cancel stops the active job and the queue; it does not remove results of completed jobs.</li>
            <li>After processing stops, click a completed file to open its results. Each file&apos;s <strong>Log</strong> opens its own messages.</li>
          </ol>
          <p>
            The <strong>Summary</strong> compares each file&apos;s results. Choose <strong>Show cutoffs and caveats</strong>{' '}
            to read the qualifications beneath the values. A ≠ mark means a call differs from its column&apos;s
            majority, not that the sample is wrong. A majority needs at least three jobs with calls and more than
            half of those calls agreeing. No calls, rankings without a presence call, insufficient evidence and
            jobs without reports do not vote. For example, two trypsin calls and one Lys-C call give a trypsin
            majority; one of each gives none.
          </p>
          <p>
            <strong>Export summary TSV…</strong> writes the table and its difference flags. To compare sample
            annotations instead, see <L to="workflow-sdrf">SDRF comparison</L>. For a failed job, see{' '}
            <L to="faq-batch-failed">batch troubleshooting</L>.
          </p>
        </>
      )
    },
    {
      id: 'workflow-sdrf',
      title: 'SDRF: compare sample annotations',
      body: (
        <>
          <p>
            An <L to="gloss-sdrf">SDRF</L> (sample and data relationship format) is a table describing the samples and data files in an
            experiment. In <strong>Batch</strong>, choose <strong>Load SDRF…</strong> or drop an{' '}
            <code>.sdrf.tsv</code> file onto the window. The app matches inputs to <code>comment[data file]</code>{' '}
            and compares organism, cleavage agent, label, modifications, instrument and fragment tolerance.
            Missing columns or unmatched files are reported; they are not evidence of disagreement.
          </p>
          <table className="help-table">
            <thead><tr><th scope="col">Result</th><th scope="col">Meaning</th></tr></thead>
            <tbody>
              <tr><td>✓ consistent</td><td>The comparable values agree. “Consistent at genus” can match a Homo call to a Homo sapiens annotation; it does not establish the species.</td></tr>
              <tr><td>✗ differs</td><td>A reported result disagrees with an annotation. Inspect the file&apos;s results before proposing a correction.</td></tr>
              <tr><td>≠ run setting differs</td><td>A tolerance or fixed-modification setting differs. These are settings, not measurements, and produce no correction.</td></tr>
              <tr><td>~ present, not called</td><td>In a mixed-sample annotation, the organism appears below the top called genus. It is not treated as a correction.</td></tr>
              <tr><td>– no call / not in the SDRF</td><td>FASTag has no usable call, or the SDRF supplies no value to compare.</td></tr>
              <tr><td>? not checkable</td><td>The value cannot be interpreted or compared by this app.</td></tr>
            </tbody>
          </table>
          <p>
            A row marked <strong>consistent</strong> can have other fields that were not checked: it means the
            available comparisons agree. A row with <strong>nothing to compare</strong> has no such agreement to
            assess. For organisms, the comparison uses NCBI taxonomy and the top called genus; a lower-ranked
            relative is not interchangeable with that call.
          </p>
          <p>
            <strong>Export SDRF corrections TSV…</strong> writes proposed differences with their evidence for a
            curator to review. It leaves the original SDRF unchanged, and neither this export nor the batch
            summary can overwrite the loaded SDRF. <strong>Close SDRF</strong> removes it from the comparison;
            it does not delete the file.
          </p>
        </>
      )
    },
    {
      id: 'workflow-history',
      title: 'History: reopen or repeat a run',
      body: (
        <>
          <p>
            <strong>History</strong> lists runs started by this app, with their input, status, duration, tag count
            and output paths. It is a record of work, not a backup of the result files.
          </p>
          <ul>
            <li><strong>Open</strong> reads a completed run&apos;s output. <strong>Reveal</strong> locates it in the file manager. If it was moved or deleted, the recorded path cannot restore it.</li>
            <li><strong>Copy command</strong> copies the command recorded for that run, including its output paths.</li>
            <li><strong>Settings into form</strong> loads the recorded input, output and parameters into Setup without starting a run. Use <strong>Undo</strong> to restore the previous form. For a changed experiment, review these settings and choose new output paths before running.</li>
            <li><strong>Re-run</strong> starts the recorded setup, rather than your current Setup edits. It asks before overwriting existing output.</li>
            <li><strong>Delete record</strong> removes the history entry after confirmation and keeps its files. A record may be retained when it is the only warning that a surviving output is incomplete; the message explains what needs attention.</li>
          </ul>
          <p>
            Failed, cancelled and interrupted runs are marked <strong>incomplete</strong> and do not offer the
            normal Open action. Run again to obtain complete results. Older records without saved parameters
            cannot offer Settings into form or Re-run. See <L to="faq-incomplete">incomplete output</L> for
            details of cleanup and inspection.
          </p>
        </>
      )
    },
    {
      id: 'workflow-reconciliation',
      title: 'Mass gaps & recon: inspect database placements',
      body: (
        <>
          <p>
            <L to="gloss-reconciliation">Reconciliation</L> places tags in database peptides and reports the mass
            left over. In <strong>Mass gaps & recon</strong>, choose <strong>Choose a FASTA and run again</strong>,
            or enable the reports with <strong>Write these reports and run again</strong>. These actions enable
            the reconciliation table, mass-shift histogram and mass-gap report, and raise extension to 3 if it
            was lower. You can instead open a recon, delta or mass-gap report from an earlier run.
          </p>
          <p>
            <strong>Placements</strong> counts table rows; one spectrum can have several placements.{' '}
            <strong>Spectra with a placement</strong> counts the distinct spectra in that table. The view warns
            below 100 placed spectra: too few for a conclusion about modifications. If none placed, check the
            minimum tag length in the log; <strong>Run again with extension 3</strong> may help, but does not
            guarantee a match.
          </p>
          <ul>
            <li>Switch the gap plot between <strong>Chart</strong> and <strong>Table</strong>. Change the gap range to inspect outlying peaks; the chart reports peaks outside the shown range and any clipped zero peak. Arrow keys step through peaks when the chart is focused.</li>
            <li><strong>Unimod marks</strong> show known mass changes near a peak. A nearby mark or a CLI explanation is a hypothesis, not an identified modification. Opening a delta table without its mass-gap report uses an explicitly labelled, assumed 0.5 Da matching window.</li>
            <li>In the placement table, <strong>Contains</strong> searches spectrum, tag, protein or peptide. <strong>|Δ| at least (Da)</strong> filters by the size of the gap in either direction. <strong>Interpretation</strong> selects modification, substitution or unexplained rows; <strong>One flank off</strong> keeps placements with a gap localized to one side of the tag.</li>
          </ul>
          <p>
            Table filters and sort order are kept when switching tabs. Reconciliation identifications can be
            viewed here as mzTab; idXML and mzIdentML need an external viewer. These report tables have a
            128 MiB size limit (shown as 128 MB in the app); larger reports need an external tool. This limit is
            separate from the large-file Tags browser. Placements are not FDR-controlled identifications;
            read <L to="digest-gaps">how mass gaps are interpreted</L> before drawing a conclusion.
          </p>
        </>
      )
    }
  ]
}
