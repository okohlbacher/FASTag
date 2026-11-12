// The Help pages, as data: one entry per page, one per section.
//
// Reader: a lab scientist who has measured MS2 spectra but has not used a
// tagger. Define every term at its first use on a page and link it to the
// glossary (<G>). Use the app's own words (tab names, button labels); give
// a CLI option name once, in <C>. One idea per sentence. At least one worked
// example per concept. No version history and no process narrative.
//
// Every number and rule must match src/FASTag.cpp, README.md,
// doc/DESIGN-digest.md or doc/SPECIES-DETECTOR.md. Must not claim: that a
// tag, a database match, a species call, a mass gap or a glyco flag is an
// identification; that the E-value or the species q-value is an error rate;
// that "no warning" means the data are right. Digest counts use ungapped tags
// with an E-value of at most 1; species detection uses ungapped tags unless
// asked otherwise.
//
// Section ids are link targets (HelpLink to=…); help.test.tsx checks that
// every target used anywhere in src/ exists.
import type { JSX, ReactNode } from 'react'
import { HelpLink } from './HelpLink'
import { WORKFLOWS } from './workflows'

export interface HelpSection {
  id: string
  title: string
  body: ReactNode
}
export interface HelpPage {
  id: string
  title: string
  /// One line under the page title.
  lead: ReactNode
  sections: HelpSection[]
}

/// A link to another section.
const L = HelpLink
/// A link to a glossary entry.
const G = HelpLink
/// A CLI option name, as the form shows it.
const C = ({ children }: { children: string }): JSX.Element => <code className="cli">{children}</code>

export const START: HelpPage = {
  id: 'start',
  title: 'Getting started',
  lead: <>What FASTag does, a first run, and where its answers end.</>,
  sections: [
    {
      id: 'start-what',
      title: 'What FASTag does',
      body: (
        <>
          <p>
            In a tandem mass spectrometer, a peptide is selected in a first scan and broken into pieces; the masses of
            the pieces form its <G to="gloss-ms2">MS2 spectrum</G>. FASTag reads short stretches of amino-acid sequence,
            called <G to="gloss-tag">sequence tags</G>, straight from those spectra. It needs no protein database to do
            so.
          </p>
          <p>
            FASTag gives a fast first look: which organisms are in a run (Species tab), which spectra carry a piece of
            your protein, and how the sample was digested and labelled (Digest tab).
          </p>
          <p>
            New to tags? Read <L to="tags-spectrum">What an MS2 spectrum shows</L> and{' '}
            <L to="tags-tag">What a sequence tag is</L> first.
          </p>
        </>
      )
    },
    {
      id: 'start-first',
      title: 'A first run',
      body: (
        <>
          <p>
            Start in <strong>Setup</strong> with <strong>Characterize a run</strong>. This quick survey samples
            10% of the input spectra and enables species, digest, label and glyco reports. It does not need a FASTA
            file. To tag the full input, set <L to="param-subsample_fraction">Subsample fraction</L> to 1 and{' '}
            <L to="param-subsample_spectra">Subsample spectra</L> to 0 under Spectra.
          </p>
          <ol>
            <li>
              Under Input, click <strong>Choose file…</strong> and pick a spectra file: mzML, mzPeak or MGF (see{' '}
              <L to="files-inputs">Input files</L>).
            </li>
            <li>
              Under Output, the tags file is already named <code>&lt;name&gt;.tags.tsv</code>, next to the input.
            </li>
            <li>
              Check the instrument suggestion and the checks below the input. Under Tagging, confirm the{' '}
              <L to="param-fragment_tolerance">fragment tolerance</L>, or use <strong>Fragment tolerance preset</strong>
              beside Run: 20 <G to="gloss-ppm">ppm</G> is a starting
              point for high-resolution MS2; 0.3 Da is a starting point for ion-trap MS2. Use the analyser that
              measured the fragments, not just the instrument name. Apply a suggested preset only when it fits
              your acquisition.
            </li>
            <li>
              Click <strong>Run on &lt;file&gt;</strong>. The bar shows how many spectra are done; the Log at the bottom
              shows FASTag&apos;s messages.
            </li>
            <li>
              Results opens on <L to="workflow-overview">Overview</L> for Characterize a run. Read the evidence and caveats,
              then open <strong>Tags</strong> for the sequences, <strong>Species</strong> for the taxon ranking,
              <strong>Digest</strong> for digestion and labels, or <strong>Glyco</strong> for oxonium-ion flags.
              A report that says “not assessed” or “no call” is not evidence that a feature is absent.
            </li>
          </ol>
          <p>
            &quot;FASTag ready&quot; in the title bar means the FASTag program that comes with the app can be run; the
            number beside it is its version. A field marked <em>changed</em> differs from the CLI default; the
            selected task can set that value for you. The plan above Run lists the enabled analyses and what
            differs from your task or preset.
          </p>
          <p>
            While a run goes, <strong>Changed from defaults</strong> lists the settings it was given that differ from
            the defaults. Afterwards, <strong>Last run</strong> shows whether it finished, was cancelled or failed, and
            the same list (&quot;all defaults&quot; when there is none), even if the form was edited since. Cancel
            stops a run at once, and the files at its output paths are removed, so no half-written table is
            later read as a result. If an output file already exists, the app asks before the run whether to
            overwrite it; a run that is then cancelled or fails removes it too. Closing the window or quitting while a run goes asks first: Cancel run and quit,
            or Keep running. More in{' '}
            <L to="faq-incomplete">The Tags tab says Outdated, Removed or Incomplete</L>.
          </p>
        </>
      )
    },
    {
      id: 'start-uses',
      title: 'Three typical questions',
      body: (
        <dl className="recipes">
          <dt>What is in this run?</dt>
          <dd>
            Choose <strong>Characterize a run</strong>. It enables <L to="param-species">Species</L> with tag
            length 3 and extension 2, so tags can reach the reference&apos;s required 7 residues, and samples
            10% of the spectra. Read the evidence count in the <L to="species">Species tab</L>; a ranking alone
            is not a presence call.
          </dd>
          <dt>Does my protein occur?</dt>
          <dd>
            Under Sequence matching, choose a <L to="param-fasta">FASTA file</L> with your protein. Under Tagging, set{' '}
            <L to="param-extension">extension</L> so that tag length + 2 × extension reaches the length the database
            needs: about 4 residues for one protein, 7 or 8 for a proteome. With the default tag length 3, extension 1
            suffices for one protein and 2 or 3 for a proteome. The run is refused if no tag can reach that length. Under Reports › Output, set a file for
            &quot;<L to="param-out_spectra">Spectra with tags (file)</L>&quot; to collect the spectra whose tags match. Read the chance table in the
            log before trusting a count (see <L to="results-fasta">Matching a sequence database</L>). To collect matches
            from the full input, set Subsample fraction to 1 and Subsample spectra to 0; Characterize a run otherwise
            keeps its 10% sample.
          </dd>
          <dt>How was the sample digested and labelled?</dt>
          <dd>
            <strong>Characterize a run</strong> already enables the <L to="param-digest_out">digest report</L> and{' '}
            <L to="param-label_out">label report</L>. Their paths are under Reports › Digest and labels. Leave Sequence matching
            empty, so the database does not narrow down the tags that are counted. Run, then read the Digest tab (see{' '}
            <L to="digest-ends">Reading the peptide ends</L>).
          </dd>
        </dl>
      )
    },
    {
      id: 'start-batch',
      title: 'Batch runs: several files',
      body: (
        <>
          <p>
            Click <strong>Add files for a batch…</strong> under Input and pick several spectra files. The same
            parameters are used for each file, one after the other.
          </p>
          <ul>
            <li>
              By default, each file writes its own <code>&lt;name&gt;.tags.tsv</code> beside the input. Each report is
              renamed after that file, for example <code>sample1.digest.tsv</code>. Use <strong>Choose output folder…</strong>
              in Batch to change the destination for pending or retried jobs; completed jobs keep their existing paths.
            </li>
            <li>
              <strong>Run N remaining files</strong> runs the files not run yet. <strong>Retry failed</strong> runs
              the failed ones again. Cancel stops the whole queue.
            </li>
            <li>
              Each file keeps its own log: <strong>Log</strong> beside a file in the list shows it, and Show full log
              in the red box of a failed batch shows the failed file&apos;s log, also after later files have run.
            </li>
            <li>
              When a file is done, click it in the batch list to see its tags and reports. The results of the last
              file are shown at the end.
            </li>
            <li>
              The <L to="workflow-batch">Summary</L> compares results across files. Use{' '}
              <L to="workflow-sdrf">Load SDRF…</L> to compare them with sample annotations. You can export the
              summary and proposed SDRF corrections; the original SDRF stays unchanged.
            </li>
          </ul>
          <p>
            If a file fails, see <L to="faq-batch-failed">Some files of a batch failed</L>.
          </p>
        </>
      )
    },
    {
      id: 'start-navigation',
      title: 'Find your way around',
      body: (
        <>
          <p>
            <strong>Setup</strong> prepares a run. <strong>Results</strong> shows its tags and reports.{' '}
            <L to="workflow-batch">Batch</L> manages several files. <L to="workflow-history">History</L> reopens
            earlier outputs or loads their settings. Switch views with Cmd+1–4 on macOS or Ctrl+1–4 elsewhere.
          </p>
          <p>
            Use <strong>Search parameters</strong> (Cmd/Ctrl+K, or / outside a text field) to find an editable
            setting and jump to it. Use <strong>Search Help</strong> here for explanations, troubleshooting and
            command-line options. Entries marked <em>Not in the settings form</em> explain whether the app uses
            a dedicated control, manages the option itself, or leaves it to the command line.
          </p>
          <p>
            F1 opens Help; Esc closes it. In Search Help, the first Esc clears a query, and a second closes Help.
            Cmd/Ctrl+Enter starts a ready run; Cmd/Ctrl+. cancels an active run. Closing Help returns focus to the
            control that opened it. Your setup and results remain in place while you read.
          </p>
        </>
      )
    },
    {
      id: 'start-presets',
      title: 'Tasks, presets and remembered settings',
      body: (
        <>
          <p>
            Setup starts from a task: <strong>Characterize a run</strong> (species with extension 2, the digest, label
            and glyco reports, a tenth of the spectra), <strong>Batch QC vs SDRF</strong> (the same reports, and the input
            asks for the files of a batch first), <strong>Export tags</strong> (adds the per-residue confidence column; see <L to="results-export">read export settings</L>){' '}
            or <strong>Open results / inspect spectra</strong>. <strong>Starting from</strong> also offers FASTag&apos;s
            own defaults and your presets. Choosing one replaces the form; <strong>Undo</strong> brings back what it
            replaced. The footer above Run counts what differs from where the form started, and its{' '}
            <strong>Reset</strong> takes that back.
          </p>
          <p>
            <strong>Save…</strong> stores what differs from the task or defaults the form started from, under a name.
            No paths are stored: input files such as a FASTA are left out, and a report is stored by its name and
            written next to the current tags file. The app also remembers the parameters of the last run, but they
            are never used on their own: <strong>Apply last-used (n)</strong> offers the n settings of the last run,
            and nothing of them is used until you click it. <strong>Reset…</strong> beside Run sets every parameter
            back to FASTag&apos;s default.
          </p>
          <p>
            <strong>Export INI…</strong> writes the parameters a run would use as an INI file;{' '}
            <code>FASTag -ini file.ini</code> runs the command line with the same parameters.
          </p>
        </>
      )
    },
    {
      id: 'start-limits',
      title: 'Where FASTag ends',
      body: (
        <>
          <p>
            FASTag does not identify peptides. Tags are short and many are wrong readings, and FASTag gives no false
            discovery rate for them (see <L to="results-nofdr">Why there is no error rate per tag</L>). A database
            match, a species call, a mass gap and a glyco flag are all candidates to follow up, not results to report.
          </p>
          <p>
            To identify peptides, use a database search engine with a controlled false discovery rate. To find
            unexpected modifications, use an open search; for full peptide sequences, a de novo sequencing tool.
            FASTag&apos;s answers tell you where these slower methods are worth running.
          </p>
        </>
      )
    }
  ]
}

export const TAGS: HelpPage = {
  id: 'tags',
  title: 'Tags and gapped tags',
  lead: <>How FASTag reads sequence from a spectrum, with a worked example.</>,
  sections: [
    {
      id: 'tags-spectrum',
      title: 'What an MS2 spectrum shows',
      body: (
        <>
          <p>
            A peptide ion selected in the first scan is called the <G to="gloss-precursor">precursor</G>. In the
            second scan (MS2) it is fragmented. In the default b/y interpretation, a piece that keeps the
            peptide&apos;s start (N-terminus) is a <G to="gloss-by-ions">b ion</G>; a piece that keeps its end
            (C-terminus) is a y ion. The spectrum measures their{' '}
            <G to="gloss-mz">mass-to-charge ratios (m/z)</G>, together with other fragments and noise; not every
            peak belongs to a b/y ladder.
          </p>
          <p>
            The y ions of one peptide form a ladder: the next larger y ion has one more residue, so neighbouring peaks
            differ by exactly one <G to="gloss-residue-mass">residue mass</G> (for ions of charge 1; at charge 2 the
            steps are half as large, and the Charge column says which charge a tag was read at). The distance between
            two peaks tells which amino acid lies between them. The b ions form a second ladder, read from the other end.
          </p>
        </>
      )
    },
    {
      id: 'tags-tag',
      title: 'What a sequence tag is',
      body: (
        <>
          <p>
            FASTag links every two peaks whose distance equals the mass of one amino acid, within the{' '}
            <G to="gloss-tolerance">fragment tolerance</G>. A chain of such links, read as letters, is a{' '}
            <G to="gloss-tag">sequence tag</G>: a short piece of the peptide&apos;s sequence.
          </p>
          <figure className="help-figure">
            <svg viewBox="0 0 520 140" role="img" aria-labelledby="fig-ladder-t">
              <title id="fig-ladder-t">
                Four y-ion peaks at m/z 147.113, 260.197, 389.240 and 460.277. The steps between them are 113.084 (L),
                129.043 (E) and 71.037 (A).
              </title>
              <line className="axis" x1="10" y1="116" x2="510" y2="116" />
              {[
                [40, 147.113, 80],
                [170, 260.197, 50],
                [330, 389.24, 65],
                [420, 460.277, 45]
              ].map(([x, mz, top]) => (
                <g key={mz}>
                  <line className="peak" x1={x} y1={116} x2={x} y2={top} />
                  <text className="lbl" x={x} y={132} textAnchor="middle">
                    {mz.toFixed(3)}
                  </text>
                </g>
              ))}
              {[
                [40, 170, 'L 113.084'],
                [170, 330, 'E 129.043'],
                [330, 420, 'A 71.037']
              ].map(([a, b, t]) => (
                <g key={String(t)}>
                  <path className="step" d={`M${a} 40 Q${(Number(a) + Number(b)) / 2} 22 ${b} 40`} />
                  <text className="res" x={(Number(a) + Number(b)) / 2} y={20} textAnchor="middle">
                    {t}
                  </text>
                </g>
              ))}
            </svg>
            <figcaption>Four y ions of a peptide ending …AELK. Each step between peaks is one residue.</figcaption>
          </figure>
          <p>A worked example, with the y ions of a peptide ending in …AELK:</p>
          <table className="help-table">
            <thead>
              <tr>
                <th scope="col">Peak (m/z)</th>
                <th scope="col">Step to the next peak</th>
                <th scope="col">Residue with that mass</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>147.113</td><td>260.197 − 147.113 = 113.084</td><td>L (or I, the same mass)</td></tr>
              <tr><td>260.197</td><td>389.240 − 260.197 = 129.043</td><td>E</td></tr>
              <tr><td>389.240</td><td>460.277 − 389.240 = 71.037</td><td>A</td></tr>
            </tbody>
          </table>
          <p>
            Reading the steps from the largest peak down gives the tag <strong>AEL</strong>, written from N- to
            C-terminus. What lies beyond the tag on each side is reported as a mass, the{' '}
            <G to="gloss-flanking">flanking mass</G>. The smallest peak, 147.113, is the y1 ion: one residue plus water
            (18.011) plus a proton (1.007). Taking those away leaves the C-term mass 128.095, the residue mass of K, so
            the peptide very likely ends in K. The N-term mass is the rest of the peptide on the other side. Reading
            the peptide ends this way is called <G to="gloss-terminal">terminal chemistry</G>; the{' '}
            <L to="digest-ends">Digest tab</L> counts such ends.
          </p>
        </>
      )
    },
    {
      id: 'tags-tolerance',
      title: 'Choosing a fragment tolerance',
      body: (
        <>
          <p>
            The <G to="gloss-tolerance">fragment tolerance</G> is the allowed distance from an expected peak
            position. <G to="gloss-ppm">Da</G> gives a fixed window; ppm gives a window that grows with m/z.
            For example, 20 ppm allows ±0.010 at m/z 500 and ±0.020 at m/z 1000. It is relative to the fragment
            peak position, not the amino acid&apos;s mass.
          </p>
          <p>
            Use the analyser that measured MS2 to choose the setting: 20 ppm is a starting point for high-resolution
            Orbitrap, Astral or TOF spectra; 0.3 Da for ion-trap spectra. Too narrow a window loses real steps;
            too wide a window admits more chance matches. Changing the unit to ppm cannot make low-resolution
            data high-resolution. With a Da tolerance, the default digest and label rules make no call.
          </p>
        </>
      )
    },
    {
      id: 'tags-seed',
      title: 'Seeds and extension',
      body: (
        <p>
          FASTag first collects every chain of <L to="param-tag_length">tag length</L> residues (3 by default), called
          a <G to="gloss-seed">seed</G>, and scores it. With <L to="param-extension">extension</L> set, it then tries
          to read more residues at either end and scores the longer tag again. So tag length is a minimum, and a tag
          in the table can be longer; the Extended column says so.
        </p>
      )
    },
    {
      id: 'tags-gapped',
      title: 'Gapped tags: crossing a missing peak',
      body: (
        <>
          <p>
            Fragmentation is uneven, and a peak in the middle of a ladder is often missing. A{' '}
            <G to="gloss-gapped">gapped tag</G> crosses one such hole: two peaks whose distance is the summed mass of
            two residues are linked, and the two residues are spelled out.
          </p>
          <p>
            In the example above, suppose the peak at 389.240 is missing. The step from 260.197 to 460.277 is 200.080,
            the mass of A + E (71.037 + 129.043). FASTag cannot tell the order of the two, so it writes both spellings as
            separate tags, <strong>AEL</strong> and <strong>EAL</strong>, each with Gapped = 1. A wide tolerance can fit
            other pairs too: at 0.3 Da, V + T (200.116) would also be spelled. At most eight spellings are written for one
            gap.
          </p>
          <p>
            Gaps help because a tag can continue past a fragment that was not measured. But a gapped tag claims a split
            that no peak shows, so it is wrong more often. Without a penalty, a gapped tag was the top-ranked tag in 95%
            of simulated spectra, yet a top-ranked gapped tag was 3.6 times less often correct than an ungapped one.
            By default, FASTag therefore ranks a gapped tag as if its{' '}
            <L to="results-evalue">E-value</L> were 100 times worse (<L to="param-gap_penalty">gap penalty</L>), and
            the E-value printed for it includes that factor. Gaps are on by default; set{' '}
            <L to="param-gaps">gaps</L> to 0 to turn them off.
          </p>
          <p>
            Species detection leaves gapped tags out by default, and the digest report never counts them: the two
            inferred residues could be in the wrong order.
          </p>
        </>
      )
    },
    {
      id: 'tags-direction',
      title: 'Reading direction, and I and L',
      body: (
        <>
          <p>
            With the default b/y ion series, tags are written from N- to C-terminus, as if read from y ions. A tag read from a b-ion ladder comes out
            reversed: the same peptide can give AEL from its y ions and LEA from its b ions. Matching against a
            sequence database therefore tries both directions (<L to="param-orientation">orientation</L>).
          </p>
          <p>
            Leucine (L) and isoleucine (I) have the same mass, so no tag can tell them apart. FASTag writes L for both,
            and ProForma output writes J. Such residues of equal mass are called <G to="gloss-isobaric">isobaric</G>.
          </p>
        </>
      )
    },
    {
      id: 'tags-ions',
      title: 'Ion series and fragmentation methods',
      body: (
        <>
          <p>
            The GUI uses b/y ions, appropriate for <G to="gloss-activation">CID and HCD</G> fragmentation.
            ETD and ECD produce mainly c/z• ions, with different end masses. A run with those spectra needs the
            command-line <L to="param-ion_series">ion-series option</L>: <code>cz</code> reads all spectra as
            c/z•; <code>auto</code> reads ETD/ECD spectra as c/z• and other spectra as b/y. Automatic selection
            uses activation metadata from mzML only; MGF and mzPeak are read as b/y under <code>auto</code>.
          </p>
          <p>
            Hybrid EThcD/ETciD spectra stay b/y under <code>auto</code> unless the experimental{' '}
            <L to="param-ion_series_hybrid">hybrid option</L> is set to both. The a/x option for UVPD is also
            experimental and failed its held-out test. Tags read with a non-default series carry an{' '}
            <code>ion_series</code> column. Species detection uses only b/y tags, so it cannot use the c/z• or
            a/x rows from these runs.
          </p>
        </>
      )
    },
    {
      id: 'tags-mods',
      title: 'Modifications',
      body: (
        <>
          <p>
            A <L to="param-fixed_modifications">fixed modification</L> changes the mass of every residue of its kind
            and is implicit in the ordinary tag text. The default is carbamidomethyl on C, from{' '}
            <G to="gloss-alkylation">alkylation</G> with iodoacetamide. Clear or replace it if the sample used
            different cysteine chemistry. The optional <L to="param-proforma">ProForma column</L> records fixed
            residue modifications explicitly.
          </p>
          <p>
            A <L to="param-variable_modifications">variable modification</L> adds a modified alternative for that
            residue, written as X[Name], for example S[Phospho]. Enter OpenMS/UniMod names,
            one per line, such as <code>Oxidation (M)</code> or <code>Phospho (S)</code>. Each adds candidate masses,
            so choose those relevant to the sample. A modification of the peptide&apos;s ends is not written in
            the tag: it changes the flanking mass instead.
          </p>
        </>
      )
    }
  ]
}

export const RESULTS: HelpPage = {
  id: 'results',
  title: 'The Tags tab and scores',
  lead: <>What each column means, how tags are scored, and what &quot;better&quot; means.</>,
  sections: [
    {
      id: 'results-columns',
      title: 'The columns',
      body: (
        <table className="help-table">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Spectrum</td><td>The spectrum&apos;s ID in the input file; for MGF, index=&lt;k&gt;, the block&apos;s position counted from 0.</td></tr>
            <tr><td>Tag</td><td>The sequence read, N- to C-terminal, L for I or L.</td></tr>
            <tr><td>Length</td><td>Residues in the tag.</td></tr>
            <tr><td>Charge</td><td>The charge of the fragment ions the tag was read from.</td></tr>
            <tr><td>N-term mass, C-term mass</td><td>The <G to="gloss-flanking">flanking masses</G>: the mass of the peptide beyond each end of the tag, in Da.</td></tr>
            <tr><td>Extended</td><td>1 when the tag grew beyond its seed (<L to="tags-seed">extension</L>).</td></tr>
            <tr><td>Gapped</td><td>1 when the tag crosses a missing peak (<L to="tags-gapped">gapped tag</L>).</td></tr>
            <tr><td>E-value</td><td>The score; lower is better (<L to="results-evalue">E-value</L>).</td></tr>
            <tr><td>Min. conf., Mean conf.</td><td>The weakest and the average observed-step score, 0 to 1 (<L to="results-conf">residue confidence</L>).</td></tr>
            <tr><td>Database hit</td><td>Without a sequence database: No match (-). With one: In database (fwd, as written; rev, reversed), or Entrapment (efwd, erev: found only in the entrapment database).</td></tr>
            <tr><td>Database q-value</td><td>q_db, only with an <G to="gloss-entrapment">entrapment database</G> (<L to="results-nofdr">see below</L>).</td></tr>
            <tr><td>ProForma, Residue conf., USI</td><td>Optional columns (<L to="param-proforma">ProForma</L>, <L to="param-res_conf">per-residue confidence</L>, <L to="param-usi_collection">USI collection</L>), under Reports › Output.</td></tr>
          </tbody>
        </table>
      )
    },
    {
      id: 'results-filter',
      title: 'Filtering, sorting and export',
      body: (
        <p>
          Above the table, &quot;Spectrum contains&quot;, &quot;Min. length&quot; and &quot;Max. E-value&quot; filter
          the rows; Database hit picks All, In database, Entrapment or Not in database; &quot;Per spectrum&quot; keeps
          only the best tag (or the best 2, 3 or 5) of each spectrum by E-value, among the rows the other filters
          leave. Click a column header to sort, drag its edge to resize, and use <strong>Columns…</strong> to hide
          columns. <strong>Export shown rows…</strong> writes the rows that pass the filters, in the table&apos;s
          order and in the shown columns, to a new file: TSV, or CSV when the name ends in .csv. A large export shows
          its progress and can be cancelled; nothing is written under the name until it is complete.{' '}
          <strong>Open tags…</strong> shows a tags file from an earlier run.
        </p>
      )
    },
    {
      id: 'results-evalue',
      title: 'The E-value: how tags are ranked',
      body: (
        <>
          <p>Tags are scored using these sources of evidence:</p>
          <ul>
            <li>
              <strong>Intensity:</strong> how unlikely it is that peaks this strong form a tag by chance.
            </li>
            <li>
              <strong>Mass fit:</strong> how closely the peaks fit the exact residue masses.
            </li>
            <li>
              <strong>Complementarity:</strong> how many of the tag&apos;s peaks have a matching ion of the
              other series. For b/y ions, their neutral masses add up to the precursor&apos;s neutral mass.
              This component is omitted when the spectrum has no complementary pairs at the fragment charge being tested.
            </li>
          </ul>
          <p>
            The available components are combined into one model-based probability and multiplied by the number of candidate tags in the
            spectrum. The result is the <G to="gloss-e-value">E-value</G>. <strong>Lower is better</strong>: 0.001
            ranks above 1, and 1 above 20. By default, at most 50 tags are written per spectrum, best first (
            <L to="param-max_tags">max tags</L>). With several <L to="param-tag_lengths">tag lengths</L>, each length
            has its own limit of 50 by default, and the rows come in order of length, so a spectrum can have more rows and its
            best tag need not come first.
          </p>
          <p>
            By default, tags whose E-value is above 20 before the <L to="tags-gapped">gap penalty</L> are not written (
            <L to="param-max_evalue">maximum E-value</L>). A gapped tag&apos;s printed E-value includes the penalty, so
            it can be above 20, up to 2,000 with the defaults; divide it by the gap penalty (100 by default) to compare
            it with the cutoff. A Max. E-value filter of 20 in the Tags tab therefore hides some gapped tags.
          </p>
          <p>
            Example: in one spectrum an ungapped tag scores 0.002 and a gapped tag is printed as 0.1. Its own score was
            0.001, better than 0.002, but the gap penalty of 100 puts it second. This is what the penalty is for: a gap
            claims a peak nobody saw.
          </p>
          <p>
            The E-value ranks tags; it is not an error rate, and its value does not tell how many such tags arise by
            chance.
          </p>
        </>
      )
    },
    {
      id: 'results-conf',
      title: 'Residue confidence: the weakest letter',
      body: (
        <>
          <p>
            Each observed step between two peaks gets a score from 0 to 1: its mass fit multiplied by the intensity
            support of its weaker peak, ranked against the other peaks in the spectrum. Higher is better.
            Min. conf. is the weakest step; Mean conf. averages the observed steps. They help locate weak support
            within a tag, but are not probabilities that a residue is correct.
          </p>
          <p>
            With <L to="param-res_conf">per-residue confidence</L>, the scores are also written on a 0–100 scale.
            The two residues across a missing peak share one score: there is no independent evidence for their
            order. That step counts once in Mean conf., even though its score appears twice in the residue list.
          </p>
        </>
      )
    },
    {
      id: 'results-fasta',
      title: 'Matching a sequence database',
      body: (
        <>
          <p>
            With a <L to="param-fasta">sequence database</L> (a <G to="gloss-fasta">FASTA</G> file of proteins), only tags that occur in it are
            written. I and L count as the same, tags are also tried reversed, and a residue may stand for a pair of
            the same mass (N for GG, for example). With an entrapment database, tags found only there are written too,
            marked Entrapment (efwd, erev); they measure chance and are not matches.
          </p>
          <p>
            A short tag occurs in almost any protein by chance. FASTag therefore sets a minimum length from the size of
            the database: about 4 residues for one protein, 7 for a yeast proteome and 8 for the human one. Tags can be
            at most tag length + 2 × <L to="param-extension">extension</L> long, and when that is below the minimum the
            run is refused (<L to="faq-min-filter">No tag can reach the minimum filter length</L>). FASTag also writes a
            table to the log that compares the matches with the number chance alone would give:
          </p>
          <pre className="help-pre">{`  len         tags      matched    by chance enrichment
    4        17454          316          291       1.1x  <- at chance
    7          212          212            2      86.0x`}</pre>
          <p>
            Here the 316 matches of length 4 are no more than chance (291), while the 212 of length 7 are 86 times
            more than chance. Read the &quot;by chance&quot; column before believing a count.
          </p>
        </>
      )
    },
    {
      id: 'results-nofdr',
      title: 'Why there is no error rate per tag',
      body: (
        <>
          <p>
            A <G to="gloss-q-value">q-value</G> or false discovery rate needs a model of what wrong tags look like.
            Real spectra often hold two peptides at once, and the wrong tags this creates are not reproduced by a <G to="gloss-decoy">decoy</G>{' '}
            (a made-up spectrum used to model wrong answers). FASTag therefore reports the E-value as a score and no error rate per tag.
          </p>
          <p>
            For matches to a sequence database there is a separate chance-match estimate: with an{' '}
            <L to="param-entrapment_fasta">entrapment database</L> (proteins the sample cannot contain), the q_db
            column estimates the chance-match share among database matches at that E-value or better, not the
            probability that an individual tag is wrong. Use it at tight thresholds. On
            one human Astral run with an archaeal entrapment database, q_db at 0.02 or below was higher than the real
            chance rate (on the safe side); at 0.05 to 0.1 the real rate was about 1.6 times higher. How well it holds
            depends on the entrapment database and on how many tags match it. A q_db of 0 means too few entrapment
            matches to measure, not no risk. It says nothing about whether the tag reads its peptide correctly.
          </p>
        </>
      )
    },
    {
      id: 'results-export',
      title: 'Exporting tags and assembly reads',
      body: (
        <>
          <p>
            In <strong>Tags</strong>, <strong>Export as</strong> offers the shown table or assembly reads for
            Stitch and ALPS. A table export keeps the current filters, columns and sort order. The read exports
            use the whole tags file and their own settings, not the table filters; by default they keep the best
            tag per spectrum with at least 8 residues. Reads need the <L to="param-res_conf">per-residue confidence</L>
            column, which the <strong>Export tags</strong> task enables.
          </p>
          <p>
            That task starts with tag length 3 and extension 0, so its tags are too short for the default
            8-residue read export. Before running, choose a suitable <L to="param-tag_length">tag length</L> or{' '}
            <L to="param-extension">extension</L>: for example, length 3 with extension 3 can reach 9 residues,
            although not every tag will grow that far. Alternatively, lower the export&apos;s minimum length
            if shorter reads suit your downstream tool. Check the exported read count before continuing.
          </p>
        </>
      )
    },
    {
      id: 'results-spectrum',
      title: 'The Spectrum tab',
      body: (
        <>
          <p>
            In Tags, choose a row and press Enter (or Open in Spectrum). The Spectrum tab shows that spectrum with the
            peaks FASTag tagged: after centroiding, the precursor cut, deisotoping and the peak budget, as the run
            prepared them (FASTag prints them with -dump_spectrum, under the options of the run that wrote the
            table). The chosen tag&apos;s ladder is drawn on them: its b or y ions one residue apart (the residue
            divided by the fragment charge), each step with its error in ppm. A <L to="tags-gapped">gapped tag</L>{' '}
            crossed a missing peak, shown dashed. Choose another tag of the spectrum below to draw its ladder; ◀ and ▶
            go to the previous and next tagged spectrum. The wheel or + and − zoom, dragging or the arrow keys pan.
          </p>
          <p>
            The tab needs a FASTag that has -dump_spectrum; with an older one it is not there, and the row action says
            &quot;Spectrum view needs FASTag 1.12 or later&quot;. A table no run of this app wrote asks for its input
            (Locate input…) and is shown at FASTag&apos;s default settings, which it says. No other reader is used:
            peaks read another way are not the peaks FASTag tagged.
          </p>
        </>
      )
    }
  ]
}

export const DIGEST: HelpPage = {
  id: 'digest',
  title: 'The Digest tab',
  lead: <>What the ends of the tags tell about the protease, the labels and the mass gaps.</>,
  sections: [
    {
      id: 'digest-ends',
      title: 'Reading the peptide ends (terminal chemistry)',
      body: (
        <>
          <p>
            The <G to="gloss-flanking">flanking mass</G> at a peptide end shows what sits there. A{' '}
            <G to="gloss-protease">protease</G> cuts proteins after (or before) certain residues: trypsin after K and R.
            When a flanking mass equals one residue, the tag stops one residue before the end of its peptide, so that
            residue is the one at the cut: in the <L to="tags-tag">worked example</L>, the C-term mass 128.095 is K.
            When an N-term mass equals a <L to="digest-labels">label</L>, the tag starts at the peptide&apos;s first
            residue and the label sits on the N-terminus. Heavy SILAC K and R show up the same way, as a heavier residue.
          </p>
          <p>Only tags without a gap and with an E-value of at most 1 are counted. A tag end counts for a residue when:</p>
          <ul>
            <li>its C-term mass equals the residue (a tag read from y ions);</li>
            <li>
              its N-term mass equals the residue plus water (18.011). This is a tag read from b ions. It is written
              reversed, so its N-term side is really the peptide&apos;s C-terminal end, and the mass there still
              includes the peptide&apos;s C-terminal water;
            </li>
            <li>its N-term mass equals the residue (the first residue after a cut).</li>
          </ul>
          <p>
            The first two count the residue before the cut (P1); the third counts the residue after it (P1′, see{' '}
            <L to="digest-positions">Positions around the cut</L>).
          </p>
          <p>
            &quot;Equals&quot; means within 0.008 Da (<L to="param-digest_window">digest window</L>). C counts at its
            carbamidomethyl mass (160.031 Da), whatever the fixed modifications say, so with another cysteine
            modification no end counts as C. K with a TMT, TMTpro, iTRAQ4 or heavy label counts as K; heavy R (Arg10)
            is left out of the protease counts.
          </p>
          <p>
            With a sequence database, only the tags written to the Tags tab are counted, and that includes
            entrapment-only rows. For a fair picture, write these reports in a run without a sequence or entrapment
            database.
          </p>
        </>
      )
    },
    {
      id: 'digest-positions',
      title: 'Positions around the cut: P4 … P1 | P1′ … P4′',
      body: (
        <p>
          The cut falls between <G to="gloss-p1">P1 and P1′</G>. P1 is the last residue before the cut, P2 the one
          before it, and so on; P1′ is the first residue after it. Trypsin, for example, puts K or R at P1. The
          protease call uses P1 and P1′; the other positions come from the tag letters next to the counted end and are
          shown in the logo.
        </p>
      )
    },
    {
      id: 'digest-protease',
      title: 'The protease call',
      body: (
        <>
          <p>
            FASTag compares the counts at P1 (and P1′) with a model of each protease it ships: Trypsin, Lys-C, Arg-C,
            Glu-C, Chymotrypsin, Asp-N, Lys-N, and unspecific cleavage. Each model is mixed with 5% of a background, so
            that a stray residue does not rule it out. The background is the residue composition of the human proteome,
            or of the reconciliation or sequence database when one is set. A protease table of your own can bring its own
            background, which is then used instead. Each model gets a score, its <G to="gloss-log-likelihood">log-likelihood</G>: how well it
            explains the counts.
          </p>
          <p>
            The call is the best model. The runner-up is the best model of a different protease. (If you load{' '}
            <L to="param-digest_models">your own protease table</L>, models with the same class name count as one
            protease.) The lead is the difference of the two scores per tag end; larger means clearer. The N-terminal ends are used only when there are at least 100 of them.
          </p>
          <p>
            Worked example: 3,614 C-terminal tag ends fit a residue; 2,209 have K at P1 and 1,338 have R. Trypsin fits
            best, Lys-C (K only) comes second, and Trypsin leads by 1.48 per tag end. The tab shows: Called Trypsin;
            Runner-up, other enzyme class: Lys-C; Lead over runner-up: 1.4788.
          </p>
          <p>
            &quot;Tag ends used&quot; gives the C- and N-terminal tag ends that fit a residue (&quot;N end not
            used&quot; when there are fewer than 100). A small lead, or a call from barely 100 tag ends, deserves
            caution.
          </p>
        </>
      )
    },
    {
      id: 'digest-logo',
      title: 'The sequence logos',
      body: (
        <p>
          The Observed logo has one column per position, P4 to P4′. The height of a column shows how far that position
            differs from the background: the taller, the more one residue stands out (0 means no difference);
          within a column, each letter&apos;s height is its share, so the
          largest letter is the most common residue. Columns with fewer tag ends than the minimum (100) are grey, and so
          are the P′ columns when the call does not use the N-terminal end. Below it, the logos of the called model and
          the runner-up show what each protease predicts at P1 and P1′.
        </p>
      )
    },
    {
      id: 'digest-nocall',
      title: 'When there is no call',
      body: (
        <>
          <p>
            Sometimes the tag ends cannot show the protease fairly. FASTag then writes <em>No call</em> and the reason.
            The first rule that applies is the reason; others that also apply are listed after it.
          </p>
          <table className="help-table">
            <thead>
              <tr>
                <th scope="col">Reason</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><L to="faq-digest-low_resolution">Tolerance in Da</L></td><td>Low-resolution MS2: the mass windows do not hold.</td></tr>
              <tr><td><L to="faq-digest-timstof">timsTOF</L></td><td>A C-terminal R is nearly invisible on these instruments.</td></tr>
              <tr><td><L to="faq-digest-ms2_scan_window">Scan range</L></td><td>In most MS2 spectra (the median) the scan range starts above m/z 147.21, so the y1 ion of a C-terminal K (the smallest y ion, the last residue alone) is never seen.</td></tr>
              <tr><td><L to="faq-digest-ms2_first_peak">First peaks</L></td><td>The lowest peaks of most spectra lie above m/z 147.21.</td></tr>
              <tr><td><L to="faq-digest-ion_counts">Ion counts</L></td><td>No informative instrument or spectrum-ID metadata, and at least half the positive peak intensities are whole numbers, as on a timsTOF.</td></tr>
              <tr><td><L to="faq-digest-few_tags">Too few tag ends</L></td><td>Fewer than 100 tag ends fit a residue.</td></tr>
              <tr><td><L to="faq-digest-nonfinite_score">Probability 0</L></td><td>A seen residue is impossible under a model.</td></tr>
              <tr><td><L to="faq-digest-tie">Tie</L></td><td>Two kinds of protease fit exactly equally well.</td></tr>
            </tbody>
          </table>
          <p>
            &quot;Could not check&quot; under the call names a rule that had no information to work with, for example
            no instrument in an MGF file. Such a rule does not block the call.
          </p>
        </>
      )
    },
    {
      id: 'digest-labels',
      title: 'Labels: TMT, iTRAQ and SILAC',
      body: (
        <>
          <p>
            An <G to="gloss-label">isobaric label</G> (TMT, TMTpro, iTRAQ4) adds a fixed mass to the peptide&apos;s
            N-terminus and to K. The label report counts tag ends where a bare label mass lies beyond the tag (229.163
            for TMT, 304.207 for TMTpro, 144.102 for iTRAQ4). At the N-terminal end this means the tag starts at the
            peptide&apos;s first residue, so the label is all that lies beyond it. The count adds the N-term and C-term
            flanks, and the report&apos;s description gives the two separately. Both sides count: a tag read from b
            ions is written reversed (see <L to="digest-ends">Reading the peptide ends</L>), so its label shows on the
            C-term side. The Chance column counts tag ends at a mass 0.5 Da above each label, where no label can
            sit. Share of tags is the label count over all counted tags. For example, 5,200 tag ends of 20,000
            counted tags at the TMT mass (a share of 0.26), against 9 at the chance mass, support a TMT hypothesis.
            Read the CLI label call and its reason in Overview; counts alone do not identify a label.
          </p>
          <p>
            <G to="gloss-silac">SILAC</G> labels K and R with heavy isotopes (Lys8, Arg10). The report gives the share of
            C-terminal K and R ends that are heavy, and says whether there are enough ends to judge them: at least 50
            K and 50 R ends (<L to="param-digest_silac_min">heavy-label check</L>). With a tolerance in Da, the label windows do not
            hold.
          </p>
          <p>
            The label call needs at least 175 counted C-terminal ends by default and a ppm tolerance. Otherwise it
            reports <code>no_call</code> with reason <code>few_tags</code> or <code>low_resolution</code>.
            An isobaric-label call needs the label count to reach 1% of filtered tags and 20 times its background.
            SILAC additionally needs both heavy shares to reach 20% and K/R to account for at least 80% of the
            counted C-terminal ends. <code>label-free</code> means no tested label rule fired; it does not rule out
            other labels or weak labelling. TMTpro and iTRAQ8plex have the same mass here; reporter ions are needed
            to distinguish them.
          </p>
          <p>
            These calls belong to <L to="param-label_out">Label report</L>. The separate experimental
            command-line <L to="param-label_discovery_out">label discovery</L> searches for additional offsets
            and does not change this report&apos;s call.
          </p>
        </>
      )
    },
    {
      id: 'digest-gaps',
      title: 'Precursor mass gaps and cysteine alkylation',
      body: (
        <>
          <p>
            This part needs the <L to="param-recon_out">reconciliation table</L> and the{' '}
            <L to="param-massgap_out">mass-gap report</L>. <G to="gloss-reconciliation">Reconciliation</G> places each
            tag in a peptide of a protein database, by its flanking masses. At least one side must fit; the{' '}
            <G to="gloss-mass-gap">mass gap</G> is the mass left over on the side that does not (0 when both fit). Most
            spectra sit at 0. A fixed modification of a residue (such as carbamidomethyl on C) is part of the database
            peptide&apos;s mass, so it gives no gap. A fixed modification of the peptide&apos;s end (such as TMT6plex
            (N-term)) is not, so it shows up as many spectra with the same gap, at its own mass. Any other modification
            shows up the same way. A variable modification already read in the tag gives no gap.
          </p>
          <p>
            Reconciliation uses tryptic peptides (cut after K and R, with up to 1 missed cleavage by default; see{' '}
            <L to="param-recon_missed_cleavages">missed cleavages</L>). It does not follow the protease call, so for
            other proteases the placements and mass gaps are incomplete.
          </p>
          <p>
            The report counts spectra at each common cysteine alkylation mass (carbamidomethyl +57.021, propionamide
            +71.037, N-ethylmaleimide +125.048, methylthio +45.988, carboxymethyl +58.005), and explains frequent gaps
            as combinations of up to 3 of 38 known modifications. To see the alkylation, run without fixed
            modifications: otherwise the cysteine mass already includes it and the gap is 0.
          </p>
          <p>
            The histogram counts the leftover mass of each spectrum; the 40 fullest bins are listed until you click{' '}
            <strong>Show all … bins</strong>. A peak in the mass-gap histogram is a gap shared by many spectra.
            Suppose 300 spectra sit at +15.995 Da: the report explains that peak as Oxidation, the most common
            modification of M. A gap is a measured mass, not an identified modification. &quot;Explained by&quot;
            names the simplest combination that fits, &quot;Alternatives&quot; others that fit as well, and
            &quot;Context&quot; says when an explanation was chosen because its parts also appear as peaks of their
            own. The chip below names the candidate cysteine modification with the most matching placed spectra;
            these are counts, not an alkylation call. The separate command-line{' '}
            <L to="param-alkylation_out">alkylation report</L> can make a call, but is not part of this GUI workflow.
          </p>
        </>
      )
    }
  ]
}

export const SPECIES: HelpPage = {
  id: 'species',
  title: 'The Species tab',
  lead: <>How tags are matched to organisms, how the ranking differs from a call, and how to interpret the evidence.</>,
  sections: [
    {
      id: 'species-howto',
      title: 'How species detection works',
      body: (
        <>
          <ol>
            <li>
              Each tag of at least 7 residues is cut into overlapping pieces of 7, called{' '}
              <G to="gloss-kmer">k-mers</G> (k = 7).
            </li>
            <li>
              Each piece is looked up in the species reference bundled with FASTag: the proteomes (all proteins) of
              about 50 organisms, one per genus. The reference stores, for each piece, which organisms carry it.
            </li>
            <li>A tag supports an organism only if every one of its pieces occurs in that organism.</li>
            <li>
              Each spectrum counts once, for the organisms of its best tag (lowest E-value) that is found in the
              reference (<L to="param-species_evidence">species evidence</L>).
            </li>
            <li>
              The counts are added up the NCBI taxonomy (the tree of organisms kept by the US National Center for
              Biotechnology Information), so a family collects the spectra of its genera, each spectrum
              once. Each <G to="gloss-taxon">taxon</G> is tested against what its share of the reference would collect
              by chance.
            </li>
            <li>
              Taxa at the chosen <L to="param-species_rank">rank</L> (genus by default) with at least 5 spectra are
              listed, at most 50.
            </li>
          </ol>
          <p>
            Worked example: suppose the 7-residue tag VLSPADK is found in the reference for Homo and Macaca. Its
            spectrum then counts once for each genus, and once (not twice) for the order Primates that holds both. A
            tag found only in Homo would count for Homo alone; a tag found in no organism counts for none.
          </p>
          <p>
            Only tags without a gap count by default, because the two residues across a gap are inferred; letting them
            in moved the true genus from rank 1 to rank 20 on a public test run (<L to="param-species_use_gapped">use
            gapped tags</L>). Tags need at least 7 residues. The <strong>Find organisms</strong> and{' '}
            <strong>Characterize sample</strong> tasks use <L to="param-tag_length">tag length</L> 3 with{' '}
            <L to="param-extension">extension</L> 2, which can reach 7; only tags that actually grow that far
            count. You can also request 7-residue seeds directly. Check the Evidence card afterwards: choosing
            a reachable length does not guarantee that the spectra provide enough evidence.
          </p>
        </>
      )
    },
    {
      id: 'species-reading',
      title: 'Reading the Species tab',
      body: (
        <>
          <ul>
            <li>
              <strong>Top-ranked taxon:</strong> the taxon with the most ranked evidence, its rank, and how many
              spectra support it. &quot;Next&quot; names the runner-up and its evidence as a share of the top.
              When two taxa tie exactly, the card says &quot;No single leader&quot;. This is a ranking, not a
              presence call.
            </li>
            <li>
              <strong>Evidence:</strong> how many of the MS2 spectra tagged in this run gave any taxon evidence. With
              subsampling, both numbers cover only the chosen spectra.
            </li>
            <li>
              <strong>Observed:</strong> the spectra that support the taxon. <strong>Adjusted</strong> (only with{' '}
              <L to="species-deconvolve">deconvolution</L>): the same after removing evidence shared with stronger
              taxa.
            </li>
            <li>
              <strong>Relative to top taxon:</strong> the count as a share of the top taxon&apos;s (100%). It is not a
              probability.
            </li>
            <li>
              <strong>CLI call:</strong> shown only when the report includes the optional species call. It shows
              the CLI&apos;s status (present, no call or not detected) separately from the ranking; hover for its
              reason when one was reported.
            </li>
            <li>
              <strong>q-value:</strong> smaller means stronger evidence against the analytic chance model. It helps
              interpret the list but is not an error rate you can rely on (see <L to="species-limits">limits</L>).
              With command-line <L to="param-species_orientation">species orientation</L> set to both, this
              analytic value is NA because that model does not cover both readings.
            </li>
          </ul>
          <p>
            Rows are ranked by count (Adjusted, which equals Observed without deconvolution): a close relative&apos;s
            borrowed count can make it look significant. Read the count with the q-value (see{' '}
            <L to="species-limits">limits</L>). Click a taxon to open it in NCBI
            Taxonomy.
          </p>
        </>
      )
    },
    {
      id: 'species-deconvolve',
      title: 'Close relatives and the Adjusted column',
      body: (
        <>
          <p>
            Close relatives share most short protein pieces, so they share evidence: on a human sample Homo ranks
            first, but Macaca, Bos and Sus follow within a few percent. <L to="param-species_deconvolve">Deconvolution</L>{' '}
            uses how much each pair of organisms shares in the reference to subtract the borrowed part.
          </p>
          <p>
            On a public Pectobacterium run it replaced the implausible runners-up rice and maize with the real
            relatives Dickeya and Yersinia. But on noisy ion-trap spectra it pushed Homo from rank 2 to rank 38. On the
            Pectobacterium run it also removed real minor components: trypsin (Sus) and serum albumin (Bos), which were
            in that sample, fell to almost 0. Use it on high-resolution data when the question is &quot;which of these relatives&quot;; leave it
            off for ion-trap data and when minor components matter.
          </p>
        </>
      )
    },
    {
      id: 'species-contaminants',
      title: 'Common contaminants',
      body: (
        <p>
          The tab marks genera that often come from sample preparation as &quot;common contaminant&quot;: Sus
          (porcine trypsin), Bos (bovine serum, BSA), Homo (keratin from handling), and rabbit, chicken, sheep and horse
          (Oryctolagus, Gallus, Ovis, Equus; reagents and antibodies). The mark is a hint: such a genus can also
          collect counts shared with a close relative. Confirm a suspected contaminant with a database search.
        </p>
      )
    },
    {
      id: 'species-limits',
      title: 'Limits of the ranking and optional calls',
      body: (
        <ul>
          <li>
            <strong>Genus or family, not species.</strong> The reference holds one proteome per genus, and 7-residue
            pieces cannot separate close relatives.
          </li>
          <li>
            <strong>Only what is in the reference.</strong> An organism that is not among the about 50 cannot be
            called. It may show up as a related genus that is in the reference, or give little evidence at all; no call
            does not rule it out.
          </li>
          <li>
            <strong>Read the lead and the q-value together.</strong> A close relative can look significant on
            borrowed evidence, so the list is sorted by count. On a small or low-resolution run, though, a large
            proteome can collect chance hits and lead in count; there the q-value is the better guide. Neither is a
            calibrated false discovery rate.
          </li>
          <li>
            <strong>Optional calls are experimental.</strong> The command-line <L to="param-species_call">species
            call</L> is off by default. Its decoy model and decision settings are provisional; neither its calls
            nor its decoy q-values are calibrated error guarantees. The alternative explain-away method also
            failed its held-out recovery criterion. A <code>no_call</code> means the evidence or checks were
            insufficient; <code>not_detected</code> is a result under that method&apos;s detection limit, never
            proof of biological absence.
          </li>
          <li>
            <strong>With a sequence database, only matching tags count.</strong> Run species detection without one to
            see what the sample contains.
          </li>
          <li>
            <strong>Low-resolution spectra give weaker calls.</strong> On one ion-trap run, Homo ranked second. A
            large proteome that leads only by count, with a weak q-value, is likely collecting chance hits.
          </li>
        </ul>
      )
    }
  ]
}

export const FILES: HelpPage = {
  id: 'files',
  title: 'Input and output files',
  lead: <>What FASTag reads, and the main files used by the GUI.</>,
  sections: [
    {
      id: 'files-inputs',
      title: 'Input files',
      body: (
        <>
          <ul>
            <li>
              <strong>mzML</strong>, uncompressed, with or without an index. A file with no index, or an outdated one, is read once
              more to rebuild it, with a warning in the log (<L to="faq-stale-index">what to do</L>).
            </li>
            <li>
              <strong>mzPeak</strong>, a newer, compact open format for mass spectrometry data. Profile MS2 spectra in it are centroided
              as they are read.
            </li>
            <li>
              <strong>MGF</strong>, uncompressed. Each spectrum gets the ID index=&lt;k&gt;, its position counted from
              0; its TITLE is kept but not used as the ID. An MGF carries no instrument information, so the Digest tab
              uses other rules for it (<L to="digest-nocall">no-call reasons</L>).
            </li>
          </ul>
          <p>
            Vendor files (Thermo .raw, Bruker .d) are not read: convert them first, for example with msconvert or
            ThermoRawFileParser. MS2 spectra should be <G to="gloss-centroid">centroided</G> (one peak per ion); profile
            spectra in an mzML file are tagged as they are, which finds fewer tags.
          </p>
          <p>
            The usual input is <G to="gloss-acquisition">DDA</G>, where a precursor is selected for fragmentation.
            Raw DIA combines many precursors in each isolation window and is refused when detected. Exported
            pseudo-DDA spectra can be used; renaming a raw DIA file does not separate its precursors.
            See <L to="faq-raw-dia">the DIA guidance</L> for preparation and override limitations.
          </p>
        </>
      )
    },
    {
      id: 'files-outputs',
      title: 'Output files',
      body: (
        <>
          <p>
            Every run writes the tags file (<L to="param-out">Tags TSV</L>, <code>&lt;name&gt;.tags.tsv</code>), one row per tag; its columns
            are in <L to="results-columns">The columns</L>. A path without a folder is written next to the input. The
            other files are written only when asked for:
          </p>
          <table className="help-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Set under</th>
                <th scope="col">Holds</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>&lt;name&gt;.tags.species.tsv</td><td><L to="param-species_out">Species detection</L></td><td>Taxa by spectra (<L to="species">Species tab</L>).</td></tr>
              <tr><td>&lt;name&gt;.tags.glyco.tsv</td><td><L to="param-glyco_out">Glycopeptides</L></td><td>Per spectrum: <G to="gloss-oxonium">oxonium ions</G> found and a 0/1 flag (<L to="files-glyco">glyco report</L>).</td></tr>
              <tr><td>Digest report</td><td><L to="param-digest_out">Digest and labels</L></td><td>Tag-end counts and the protease call (<L to="digest-protease">Digest tab</L>).</td></tr>
              <tr><td>Label report</td><td><L to="param-label_out">Digest and labels</L></td><td>Label and SILAC counts and the label call (<L to="digest-labels">Digest tab</L>).</td></tr>
              <tr><td>Reconciliation table</td><td><L to="param-recon_out">Reconciliation</L></td><td>Each tag placed in database peptides, with the leftover mass (<L to="digest-gaps">mass gaps</L>).</td></tr>
              <tr><td>Mass-shift histogram</td><td><L to="param-delta_out">Reconciliation</L></td><td>Leftover masses, one count per spectrum.</td></tr>
              <tr><td>Reconciliation as identifications</td><td><L to="param-recon_id_out">Reconciliation</L></td><td>The placements as idXML, mzIdentML (.mzid) or mzTab, not filtered by a false discovery rate.</td></tr>
              <tr><td>Mass-gap report</td><td><L to="param-massgap_out">Reconciliation</L></td><td>Gap peaks, alkylation and SILAC (<L to="digest-gaps">Digest tab</L>).</td></tr>
              <tr><td>Spectra with tags</td><td><L to="param-out_spectra">Reports › Output</L></td><td>The spectra that carry at least one reported tag that is not an entrapment match, as mzML or mzPeak.</td></tr>
            </tbody>
          </table>
          <p>
            The digest, label and mass-gap reports are tables with the columns section, key, value, n and description;
            the description is one plain sentence with the numbers. The Digest tab shows these descriptions as they are,
            under &quot;FASTag says&quot;, and every row under &quot;All N report rows&quot;.{' '}
            <strong>Open report…</strong> shows a report from an earlier run.
          </p>
        </>
      )
    },
    {
      id: 'files-glyco',
      title: 'The glyco report',
      body: (
        <>
          <p>
            With <L to="param-glyco">Glyco flag</L>, FASTag writes one row per MS2 spectrum: how many different{' '}
            <G to="gloss-oxonium">oxonium ions</G> it holds, their summed intensity as a share of the strongest peak,
            a 0/1 flag and the ion names. By default, the flag is 1 when at least 2 different oxonium ions are found and their
            share reaches the <L to="param-glyco_min_fraction">minimum fraction</L> (0.10). These are raw-spectrum
            signals, measured before the peak budget used for tagging; the fraction is relative to the strongest
            peak, not the sum of all peak intensities, and can exceed 1.
          </p>
          <p>
            A flag supports glycan fragmentation in that spectrum (a glycopeptide, a free glycan or O-GlcNAc); it
            does not identify a peptide, a glycan or a modification site. Such spectra often give few tags, so the report covers spectra without tags too. The
            <strong>Glyco</strong> tab lists these spectra. On TMT data at 0.3 Da a TMT reporter ion
            overlaps a sugar fragment, so flags on labeled ion-trap data are unreliable. Keep the tolerance that
            suits the MS2 analyzer.
          </p>
          <p>
            <strong>Flagged only</strong> is initially on when the report has any flags; clear it to see unflagged
            spectra too. <strong>With ion</strong> keeps spectra containing the selected oxonium ion, and{' '}
            <strong>Spectrum contains</strong> searches their IDs. The initial sort puts the largest{' '}
            <strong>Oxonium / base peak</strong> ratio first. Expand <strong>Oxonium ions among the flagged spectra</strong>{' '}
            to see each ion&apos;s frequency among all flagged spectra and all spectra in the report. Those
            counts, and the headline total, cover the entire report and do not change with the row filters.
          </p>
        </>
      )
    }
  ]
}

/// Settings: the intro; the groups and entries are drawn from paramLayout and
/// params.ts by HelpView, so they cannot drift from the form.
export const SETTINGS_INTRO: ReactNode = (
  <>
    <p>
      Settings start from your task or preset. <strong>Characterize a run</strong> enables species, digest,
      label and glyco reports and samples 10% of the input spectra. The reference below shows the CLI defaults,
      which can differ from the task&apos;s values. First check the{' '}
      <L to="param-fragment_tolerance">fragment tolerance</L> for the MS2 analyser. Species detection needs tags
      that reach 7 residues: the task uses <L to="param-tag_length">tag length</L> 3 with extension 2.
      Optional analyses run when their switch or output file is set.
    </p>
    <p>
      A field that is greyed out says what it needs (&quot;Needs …&quot;). The CLI name of each setting is shown in grey,
      as the FASTag command line spells it.
    </p>
  </>
)

export interface GlossEntry {
  id: string
  term: string
  text: ReactNode
}

export const GLOSSARY: GlossEntry[] = [
  { id: 'gloss-acquisition', term: 'DDA, DIA and pseudo-DDA', text: <>Data-dependent acquisition (DDA) selects precursor ions for fragmentation. Data-independent acquisition (DIA) fragments broad windows containing multiple precursors. Pseudo-DDA is reconstructed from DIA, separating signals into precursor-specific spectra before tagging. <L to="faq-raw-dia">Preparing DIA input</L>.</> },
  { id: 'gloss-activation', term: 'Fragmentation: CID, HCD, ETD and ECD', text: <>Collision-induced dissociation (CID) and higher-energy collisional dissociation (HCD) mainly produce b/y ions. Electron-transfer dissociation (ETD) and electron-capture dissociation (ECD) mainly produce c/z• ions. EThcD and ETciD combine electron-transfer and collisional activation; UVPD uses ultraviolet light. <L to="tags-ions">Choosing ion series</L>.</> },
  { id: 'gloss-alkylation', term: 'Alkylation (of cysteine)', text: <>A chemical cap on cysteine (C), added in sample preparation, most often carbamidomethyl (+57.021 Da) from iodoacetamide. <L to="digest-gaps">Mass gaps</L>.</> },
  { id: 'gloss-by-ions', term: 'b and y ions', text: <>The two pieces of a peptide broken between two residues: the b ion keeps the N-terminus, the y ion the C-terminus. <L to="tags-spectrum">MS2 spectrum</L>.</> },
  { id: 'gloss-centroid', term: 'Centroid and profile', text: <>A profile spectrum stores each ion as a curve of many points; a centroided one stores one peak per ion. FASTag works best on centroided MS2: profile mzML is tagged as it is and finds fewer tags; profile mzPeak is centroided as it is read. <L to="files-inputs">Input files</L>.</> },
  { id: 'gloss-decoy', term: 'Target and decoy', text: <>Targets are the real sequences being tested. Decoys are artificial sequences, tags or spectra used to model chance matches. Their usefulness depends on how well they reproduce false results; they are different from an entrapment database of real proteins known to be absent. <L to="results-nofdr">Error-rate limits</L>.</> },
  { id: 'gloss-e-value', term: 'E-value', text: <>FASTag&apos;s score for a tag: a combined model-based probability from peak strength, mass fit and, when available, complementary ions, times the number of candidate tags in the spectrum. A gapped tag also receives a penalty. Lower is better. It ranks tags; it is not a count of chance tags and not an error rate. <L to="results-evalue">E-value</L>.</> },
  { id: 'gloss-entrapment', term: 'Entrapment database', text: <>Proteins of organisms the sample cannot contain. Matches to them show how often tags match by chance. <L to="results-nofdr">q_db</L>.</> },
  { id: 'gloss-fasta', term: 'FASTA', text: <>A text file of sequences, each with a header beginning with &gt;. FASTag uses protein FASTA files to filter tags or place them in candidate peptides. A match to a short sequence alone does not identify a protein. <L to="results-fasta">Matching a sequence database</L>.</> },
  { id: 'gloss-flanking', term: 'Flanking mass', text: <>The mass of the peptide beyond one end of a tag (N-term mass, C-term mass). <L to="tags-tag">Sequence tag</L>.</> },
  { id: 'gloss-gapped', term: 'Gapped tag', text: <>A tag that crosses one missing peak by spelling two residues from their summed mass. <L to="tags-gapped">Gapped tags</L>.</> },
  { id: 'gloss-isobaric', term: 'Isobaric', text: <>Of the same mass: I and L, or N and the pair GG. <L to="tags-direction">I and L</L>.</> },
  { id: 'gloss-label', term: 'Isobaric label (TMT, TMTpro, iTRAQ)', text: <>A chemical tag of known mass on each peptide&apos;s N-terminus and K, used to compare samples in one run. <L to="digest-labels">Labels</L>.</> },
  { id: 'gloss-kmer', term: 'k-mer', text: <>A piece of k consecutive residues; the species reference uses k = 7. <L to="species-howto">Species detection</L>.</> },
  { id: 'gloss-log-likelihood', term: 'Log-likelihood', text: <>How well a model explains counts, as a logarithm; higher (closer to 0) is better. <L to="digest-protease">Protease call</L>.</> },
  { id: 'gloss-mass-gap', term: 'Mass gap', text: <>The mass left over on the one side of a tag that does not fit the database peptide (0 when both sides fit); a candidate for a modification, not an identification. <L to="digest-gaps">Mass gaps</L>.</> },
  { id: 'gloss-ms2', term: 'MS1 and MS2', text: <>MS1 measures intact ions; MS2 measures fragments after precursor selection. An MS2 spectrum can contain fragments from more than one peptide. Tags are read from MS2 spectra. <L to="tags-spectrum">MS2 spectrum</L>.</> },
  { id: 'gloss-mz', term: 'm/z', text: <>Mass divided by charge, what a mass spectrometer measures. For a fragment of charge 1 it is close to its mass plus one proton. <L to="tags-spectrum">MS2 spectrum</L>.</> },
  { id: 'gloss-oxonium', term: 'Oxonium ion', text: <>A small sugar fragment that glycopeptides and glycans give off in MS2. <L to="files-glyco">Glyco report</L>.</> },
  { id: 'gloss-p1', term: 'P1 and P1′', text: <>The residues on either side of a protease cut: P1 before it, P1′ after it. <L to="digest-positions">Positions</L>.</> },
  { id: 'gloss-ppm', term: 'ppm and Da', text: <>Two units of tolerance. Da (dalton) is an absolute mass; ppm (parts per million) is relative: 20 ppm at m/z 500 is 0.01. <L to="param-fragment_tolerance">Fragment tolerance</L>.</> },
  { id: 'gloss-precursor', term: 'Precursor', text: <>The peptide ion selected in MS1 and broken for an MS2 spectrum. <L to="tags-spectrum">MS2 spectrum</L>.</> },
  { id: 'gloss-protease', term: 'Protease', text: <>An enzyme that cuts proteins into peptides at certain residues, such as trypsin after K and R. <L to="digest-ends">Digest</L>.</> },
  { id: 'gloss-q-value', term: 'q-value and false discovery rate (FDR)', text: <>The expected share of wrong results among those accepted at a threshold. FASTag gives none per tag; the species q-value only ranks. <L to="results-nofdr">No error rate per tag</L>.</> },
  { id: 'gloss-reconciliation', term: 'Reconciliation', text: <>Placing a tag in the tryptic peptides of a protein database by its flanking masses. <L to="digest-gaps">Mass gaps</L>.</> },
  { id: 'gloss-residue-mass', term: 'Residue mass', text: <>The mass an amino acid adds to a peptide chain, for example 128.095 Da for K and 113.084 Da for L. <L to="tags-tag">Sequence tag</L>.</> },
  { id: 'gloss-sdrf', term: 'SDRF', text: <>Sample and Data Relationship Format: a tab-separated metadata file connecting samples, preparation and instrument information to data files. The GUI compares these annotations with batch results and run settings, and can export proposed corrections for review. Loading an SDRF does not configure the run. <L to="workflow-sdrf">SDRF comparison</L>.</> },
  { id: 'gloss-seed', term: 'Seed', text: <>A first tag of exactly tag length residues, before extension. <L to="tags-seed">Seeds</L>.</> },
  { id: 'gloss-silac', term: 'SILAC', text: <>Labelling by growing cells with heavy K and R (for example Lys8, Arg10). <L to="digest-labels">Labels</L>.</> },
  { id: 'gloss-tag', term: 'Sequence tag', text: <>A short piece of peptide sequence read from the distances between peaks of an MS2 spectrum. <L to="tags-tag">Sequence tag</L>.</> },
  { id: 'gloss-taxon', term: 'Taxon and rank', text: <>A group of organisms in the NCBI taxonomy, such as the genus Homo; its rank is its level (species, genus, family …). <L to="species-howto">Species detection</L>.</> },
  { id: 'gloss-terminal', term: 'Terminal chemistry (tag ends)', text: <>What sits at a peptide&apos;s ends (the residue at the protease cut, an N-terminal label, a heavy K or R), read from the flanking mass beyond a tag. <L to="digest-ends">Reading the peptide ends</L>.</> },
  { id: 'gloss-tolerance', term: 'Fragment tolerance', text: <>How far a peak may lie from the expected mass and still count. Set it to the instrument. <L to="param-fragment_tolerance">Fragment tolerance</L>.</> }
]

export const GLOSSARY_PAGE: HelpPage = {
  id: 'glossary',
  title: 'Glossary',
  lead: <>Short definitions, each with a link to where it is explained.</>,
  sections: []
}

export const SETTINGS_PAGE: HelpPage = {
  id: 'settings',
  title: 'Settings reference',
  lead: <>Every parameter: what it does, when to change it, and its default.</>,
  sections: []
}

export const TROUBLE_PAGE: HelpPage = {
  id: 'troubleshooting',
  title: 'Troubleshooting',
  lead: <>Start from what you see; the usual causes come first.</>,
  sections: []
}

/// Navigation order.
export const PAGES: HelpPage[] = [START, WORKFLOWS, TROUBLE_PAGE, TAGS, RESULTS, DIGEST, SPECIES, FILES, SETTINGS_PAGE, GLOSSARY_PAGE]
