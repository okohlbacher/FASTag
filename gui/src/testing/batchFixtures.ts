// One real batch (src/fixtures/cli/batch/README.md): FASTag integration/1.12
// (0e4b0c5) run with the same command on each public gate input, as the
// GUI's batch does: "Characterize a run" plus -species_call decoy and
// -census. The batch summary tests (run/batchSummary.test.ts) and the e2e
// scenario gate-batch (e2eBridge.ts) read them.

import pxd003531Log from '../fixtures/cli/batch/pxd003531/run.log?raw'
import pxd003531Digest from '../fixtures/cli/batch/pxd003531/run.digest.tsv?raw'
import pxd003531Label from '../fixtures/cli/batch/pxd003531/run.label.tsv?raw'
import pxd003531Species from '../fixtures/cli/batch/pxd003531/run.tags.species.tsv?raw'
import pxd003531Census from '../fixtures/cli/batch/pxd003531/run.tags.census_summary.tsv?raw'
import pxd004541Log from '../fixtures/cli/batch/pxd004541-tmt/run.log?raw'
import pxd004541Digest from '../fixtures/cli/batch/pxd004541-tmt/run.digest.tsv?raw'
import pxd004541Label from '../fixtures/cli/batch/pxd004541-tmt/run.label.tsv?raw'
import pxd004541Species from '../fixtures/cli/batch/pxd004541-tmt/run.tags.species.tsv?raw'
import pxd004541Census from '../fixtures/cli/batch/pxd004541-tmt/run.tags.census_summary.tsv?raw'
import pxd014764Log from '../fixtures/cli/batch/pxd014764/run.log?raw'
import pxd014764Digest from '../fixtures/cli/batch/pxd014764/run.digest.tsv?raw'
import pxd014764Label from '../fixtures/cli/batch/pxd014764/run.label.tsv?raw'
import pxd014764Species from '../fixtures/cli/batch/pxd014764/run.tags.species.tsv?raw'
import pxd014764Census from '../fixtures/cli/batch/pxd014764/run.tags.census_summary.tsv?raw'
import pxd010783Log from '../fixtures/cli/batch/pxd010783/run.log?raw'
import pxd010783Digest from '../fixtures/cli/batch/pxd010783/run.digest.tsv?raw'
import pxd010783Label from '../fixtures/cli/batch/pxd010783/run.label.tsv?raw'
import pxd010783Species from '../fixtures/cli/batch/pxd010783/run.tags.species.tsv?raw'
import pxd010783Census from '../fixtures/cli/batch/pxd010783/run.tags.census_summary.tsv?raw'
import pxd040407Log from '../fixtures/cli/batch/pxd040407-chymo/run.log?raw'
import pxd040407Digest from '../fixtures/cli/batch/pxd040407-chymo/run.digest.tsv?raw'
import pxd040407Label from '../fixtures/cli/batch/pxd040407-chymo/run.label.tsv?raw'
import pxd040407Species from '../fixtures/cli/batch/pxd040407-chymo/run.tags.species.tsv?raw'
import pxd040407Census from '../fixtures/cli/batch/pxd040407-chymo/run.tags.census_summary.tsv?raw'
import pxd003531mzpeakLog from '../fixtures/cli/batch/pxd003531-mzpeak/run.log?raw'
import pxd003531mzpeakDigest from '../fixtures/cli/batch/pxd003531-mzpeak/run.digest.tsv?raw'
import pxd003531mzpeakLabel from '../fixtures/cli/batch/pxd003531-mzpeak/run.label.tsv?raw'
import pxd003531mzpeakSpecies from '../fixtures/cli/batch/pxd003531-mzpeak/run.tags.species.tsv?raw'
import pxd003531mzpeakCensus from '../fixtures/cli/batch/pxd003531-mzpeak/run.tags.census_summary.tsv?raw'
import pxd006096pseudoLog from '../fixtures/cli/batch/pxd006096-pseudo/run.log?raw'
import pxd006096pseudoDigest from '../fixtures/cli/batch/pxd006096-pseudo/run.digest.tsv?raw'
import pxd006096pseudoLabel from '../fixtures/cli/batch/pxd006096-pseudo/run.label.tsv?raw'
import pxd006096pseudoSpecies from '../fixtures/cli/batch/pxd006096-pseudo/run.tags.species.tsv?raw'
import pxd006096pseudoCensus from '../fixtures/cli/batch/pxd006096-pseudo/run.tags.census_summary.tsv?raw'
import diaLog from '../fixtures/cli/batch/pxd006096-dia/run.log?raw'

export interface BatchCase {
  /// The directory under src/fixtures/cli/batch.
  name: string
  /// What every job of the batch was given beyond -in and -out (cmd.txt).
  params: Record<string, unknown>
  log: string
  digest: string
  label: string
  species: string
  census: string
}

/// The batch command (cmd.txt), as the GUI's params record names it.
export const BATCH_PARAMS = { species: true, extension: '2', digest_out: 'run.digest.tsv', label_out: 'run.label.tsv', glyco: true, subsample_fraction: '0.1', species_call: 'decoy', census: true }

export const BATCH_CASES = {
  pxd003531: { name: 'pxd003531', params: BATCH_PARAMS, log: pxd003531Log, digest: pxd003531Digest, label: pxd003531Label, species: pxd003531Species, census: pxd003531Census },
  pxd004541: { name: 'pxd004541-tmt', params: BATCH_PARAMS, log: pxd004541Log, digest: pxd004541Digest, label: pxd004541Label, species: pxd004541Species, census: pxd004541Census },
  pxd014764: { name: 'pxd014764', params: BATCH_PARAMS, log: pxd014764Log, digest: pxd014764Digest, label: pxd014764Label, species: pxd014764Species, census: pxd014764Census },
  pxd010783: { name: 'pxd010783', params: BATCH_PARAMS, log: pxd010783Log, digest: pxd010783Digest, label: pxd010783Label, species: pxd010783Species, census: pxd010783Census },
  pxd040407: { name: 'pxd040407-chymo', params: BATCH_PARAMS, log: pxd040407Log, digest: pxd040407Digest, label: pxd040407Label, species: pxd040407Species, census: pxd040407Census },
  pxd003531mzpeak: { name: 'pxd003531-mzpeak', params: BATCH_PARAMS, log: pxd003531mzpeakLog, digest: pxd003531mzpeakDigest, label: pxd003531mzpeakLabel, species: pxd003531mzpeakSpecies, census: pxd003531mzpeakCensus },
  pxd006096pseudo: { name: 'pxd006096-pseudo', params: BATCH_PARAMS, log: pxd006096pseudoLog, digest: pxd006096pseudoDigest, label: pxd006096pseudoLabel, species: pxd006096pseudoSpecies, census: pxd006096pseudoCensus },
} satisfies Record<string, BatchCase>

/// The raw DIA input of PXD006096: the CLI refuses it with exit 11 (E7)
/// and writes no report.
export const DIA_REFUSAL = { name: 'pxd006096-dia', log: diaLog, code: 11 }
