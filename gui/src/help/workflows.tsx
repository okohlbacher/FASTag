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
            name and counts, then read each result with the explanation beneath it. Characterize reads all spectra by
            default; when Spectra to read is set to a share, the figures describe the processed subset, not the whole
            input.
          </p>
          <ul>
            <li><strong>MS2 spectra</strong> counts spectra processed by the tagger. <strong>With any tag</strong> counts spectra with any reported tag, when the run recorded that count.</li>
            <li><strong>Tags</strong> is the tag count from FASTag&apos;s final log summary; one spectrum can contribute several tags.</li>
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
            A tile whose figure needs a report the run did not write can offer an <strong>Add … and run
            again</strong> button; it starts a new analysis with that report enabled.
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
            <li>In Setup, choose the task, then switch Inputs (step 2) to <strong>Batch</strong> and add files or a folder. Every workflow runs on a batch; <strong>Characterize a run</strong> is the usual survey. An SDRF file is optional.</li>
            <li>Use <strong>Add files…</strong> (in Inputs; <strong>Add…</strong> in the Batch view) to select files or <strong>Add folder…</strong> for the spectra files directly inside a folder. Check the common settings in Setup; each file runs in turn with those settings.</li>
            <li>Use <strong>Change…</strong> beside Output folder (Inputs) or <strong>Choose output folder…</strong> (Batch view) if results should go elsewhere, for example when the inputs are read-only. <strong>Beside inputs</strong> restores the usual location. Changing the folder affects pending or retried jobs; completed jobs keep their existing output paths.</li>
            <li><strong>Run N files</strong> in the action bar of Setup (filled on Outputs) or <strong>Run N remaining files</strong> in the Batch view continues the queue. <strong>Retry failed</strong> retries failed jobs; once only failed files are left, it takes Run&apos;s place. Cancel, in the run status at the top right, stops the active job and the queue; it does not remove results of completed jobs.</li>
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
          <p>
            Each row has <strong>Open</strong>; the other actions are under <strong>More</strong> (also from the
            keyboard: arrow keys to move, Enter to choose, Escape to close).
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
      id: 'workflow-run-qc',
      title: 'Run QC: describe one run',
      body: (
        <>
          <p>
            <strong>Run QC</strong> writes a QC report of one run and opens it in the <strong>QC</strong> tab: MS/MS
            counts and stated resolution by analyzer (ion trap, Orbitrap, TOF), precursor charges, the isobaric kit (one kit, decided by the label mass on the tags where it
            can be; otherwise the kits the reporter channels leave) with the number of spectra that show each reporter channel,
            tag yield and redundancy, and the instrument model, serial number and start time the file records.
          </p>
          <p>
            <strong>Reading the QC tab.</strong> Tiles at the top give the headline: MS2 spectra, tag yield,
            instrument, isobaric kit and redundancy. Small charts show the spread: spectra per MS level by analyzer,
            precursor charges, resolution by m/z band, and the reporter ions (which MS2 can show them, and how often
            each channel is seen). Hover a mark, or focus a chart and use the arrow keys, for its numbers; Table shows
            them as a table. When the label mass and the reporter channels disagree, the kit tile says Conflict, as a
            warning, and no kit is called; in the channel chart and its table, the channels the report does not call
            seen are dimmed. Every other value of the report is under <strong>All values</strong>, with a filter.
          </p>
          <p>
            <strong>Spectra to read</strong> below 1 reads a random share of the spectra; the counts then describe
            that share only. Raw DIA files are refused by default; choose <strong>warn</strong> under DIA input to
            run them anyway. For many files, switch Inputs (step 2) to Batch.
          </p>
        </>
      )
    },
    {
      id: 'workflow-db-reduction',
      title: 'Database reduction: a shortlist for your search',
      body: (
        <>
          <p>
            <strong>Database reduction</strong> places the tags on a protein FASTA and writes a ranked protein
            shortlist, a reduced FASTA (the shortlisted proteins plus your background proteins) and a configuration
            for Sage, Comet or MSFragger. The shortlist is a search-space reduction, not an identification and not
            FDR-controlled: search the reduced FASTA with your engine. Sage and Comet make their own decoys; for
            MSFragger, FASTag appends reversed <code>rev_</code> decoys to the reduced FASTA.
          </p>
          <p>
            The workflow sets the shortlist recipe of doc/SHORTLIST.md (tag length 4, extension 6, at least 1 spectrum per
            shortlisted protein, gapped placements, E-value 10, shortest placed tag 6 residues, 2 missed cleavages) as its default recipe. It is <strong>not validated</strong>: with
            MSFragger and the tryptic shortlist it passed its second held-out test and failed the third (8 new runs:
            one run kept 53% of the full search, another had an entrapment FDP of 2.1%). From FASTag 1.15.4 the CLI
            applies it by default only with MSFragger and the trypsin shortlist; the GUI also sets it for Sage, Comet
            and other proteases, where it has no held-out test. With a protease other than trypsin only exact
            placements count; gapped placements are ignored. With MSFragger and trypsin, Count gapped placements stays
            on: FASTag cannot be told to leave them out. Change the rest under Advanced. Add the host proteome and
            contaminants as <strong>Background proteins</strong>, so they are always searched. Details: doc/SHORTLIST.md
            in the FASTag sources.
          </p>
        </>
      )
    },
    {
      id: 'workflow-triage',
      title: 'Identifiability triage: which spectra could be identified',
      body: (
        <>
          <p>
            <strong>Identifiability triage</strong> writes one row per MS/MS spectrum, tagged or not, ranks the
            spectra by an identifiability score, and opens the ranking in the <strong>Triage</strong> tab. Give the
            identifications of the same run (idXML or mzIdentML with q-values) to mark which spectra your search
            identified; an unidentified spectrum with a good tag is a triage candidate.
          </p>
          <p>
            The score ranks spectra; it is not a quality call and not an error rate. It is experimental
            (<code>-census_score</code>): not yet validated on held-out data.
          </p>
          <p>
            <strong>Reading the overview.</strong> Above the table, the overview counts every spectrum, whatever
            the filter shows. The headline is the share with a <strong>strong tag</strong>: a best tag at or below
            the Triage E-value. <strong>Tagged</strong> only says a tag passed <code>-max_evalue</code>; it is
            not a quality call. The first chart sets the peptide length the precursor mass implies against the
            length of the tags; if every tag has one length (no <code>-extension</code>), tag length says
            nothing. The second shows how many tags a spectrum gives for its peaks, up to the{' '}
            <code>-max_tags</code> cap (per seed length). The third shows how much of the peptide the tags
            cover; on a census without <code>res_cover</code> it is approximate. Without a <code>-fasta</code>{' '}
            match the app cannot tell a b from a y read, so the cover is folded: a lower bound, marked
            &ldquo;approximate: orientation unresolved&rdquo;.
          </p>
        </>
      )
    },
    {
      id: 'workflow-reconciliation',
      title: 'Mass shifts: inspect database placements',
      body: (
        <>
          <p>
            <L to="gloss-reconciliation">Reconciliation</L> places tags in database peptides and reports the mass
            left over. After a run without a protein database there is no <strong>Mass shifts</strong> tab: add
            a protein FASTA in Inputs and run again. Where the tab is shown without these reports, it offers{' '}
            <strong>Choose a FASTA and run again</strong> or <strong>Write these reports and run again</strong>. These actions enable
            the reconciliation table, mass-shift histogram and mass-gap report, and raise the extension, if it
            was lower, to what the seeds need to reach the shortest tag placed (8 residues unless set: 3 at seed
            length 3). You can instead open a recon, delta or mass-gap report from an earlier run.
          </p>
          <p>
            The database is your FASTA (<strong>Protein database</strong>) or a <strong>Shipped proteome</strong>{' '}
            (human, mouse, yeast or E. coli), both in Inputs. Every shift report needs one, the mass-gap report
            too: its gaps are those of the placements. Without a database the run writes the tags table only, and
            Outputs marks the shift reports &ldquo;needs a protein database&rdquo;. A species report of the same file
            names the organism under the proteome choice.
          </p>
          <p>
            <strong>Placed spectra</strong> counts the spectra placed on the database, unmodified ones (gap near
            0 Da) included; <strong>Shifted</strong> counts those with a gap of 0.5 Da or more.{' '}
            <strong>Placements</strong> counts table rows; one spectrum can have several placements.{' '}
            <strong>Spectra with a placement</strong> counts the distinct spectra in that table. The view warns
            below 100 placed spectra: too few for a conclusion about modifications. If none placed, check the
            minimum tag length in the log; <strong>Run again with extension N</strong> computes the extension the
            seeds need (with a FASTA filter, every seed must reach its floor) and, past the largest extension of
            12, suggests a longer seed instead. It may help, but does not guarantee a match.
          </p>
          <ul>
            <li>Switch the gap plot between <strong>Chart</strong> and <strong>Bins</strong> (a table of the plotted bins; the Mass-shift table below has sites and UniMod names). Change the gap range to inspect outlying peaks; the chart reports peaks outside the shown range and any clipped zero peak. Arrow keys step through peaks when the chart is focused.</li>
            <li>UniMod marks (all of them with <strong>All UniMod marks</strong>) show known mass changes near a peak. A nearby mark or a CLI explanation is a hypothesis, not an identified modification. Opening a delta table without its mass-gap report uses an explicitly labelled, assumed 0.5 Da matching window.</li>
            <li>In the placement table, <strong>Contains</strong> searches spectrum, tag, protein or peptide. <strong>|Δ| at least (Da)</strong> filters by the size of the gap in either direction. <strong>Interpretation</strong> selects modification, substitution or unexplained rows; <strong>One flank off</strong> keeps placements with a gap localized to one side of the tag.</li>
          </ul>
          <p>
            Table filters and sort order are kept when switching tabs. Reconciliation identifications are
            written as mzTab and shown here. An idXML or mzIdentML file (named so on purpose) is listed as a file,
            with buttons to reveal it or open it in another tool. These report tables have a
            128 MiB size limit (shown as 128 MB in the app); larger reports need an external tool. A larger identifications mzTab
            is listed as a file the same way, with buttons to reveal it or open it in another tool. This limit is
            separate from the large-file Tags browser. Placements are not FDR-controlled identifications;
            read <L to="digest-gaps">how mass gaps are interpreted</L> before drawing a conclusion.
          </p>
        </>
      )
    }
  ]
}
