// Real CLI output on the public gate PXDs (src/fixtures/cli/README.md): the
// calls.ts parser fixtures (GUI-DESIGN 9 layer 1) and the e2e Overview
// scenarios (e2eBridge.ts ?fixture=gate*). FASTag 1.11.0 is the case where
// the 1.12 output is absent, integration/1.12 (0e4b0c5) the one where it is
// present.

import v111Log from '../fixtures/cli/v111-pxd003531/run.log?raw'
import v111Digest from '../fixtures/cli/v111-pxd003531/run.digest.tsv?raw'
import v111Label from '../fixtures/cli/v111-pxd003531/run.label.tsv?raw'
import v111Species from '../fixtures/cli/v111-pxd003531/run.tags.species.tsv?raw'
import v111TmtLog from '../fixtures/cli/v111-pxd004541-tmt/run.log?raw'
import v111TmtDigest from '../fixtures/cli/v111-pxd004541-tmt/run.digest.tsv?raw'
import v111TmtLabel from '../fixtures/cli/v111-pxd004541-tmt/run.label.tsv?raw'
import v111TmtSpecies from '../fixtures/cli/v111-pxd004541-tmt/run.tags.species.tsv?raw'
import v112Log from '../fixtures/cli/v112-pxd003531/run.log?raw'
import v112Digest from '../fixtures/cli/v112-pxd003531/run.digest.tsv?raw'
import v112Label from '../fixtures/cli/v112-pxd003531/run.label.tsv?raw'
import v112Species from '../fixtures/cli/v112-pxd003531/run.tags.species.tsv?raw'
import callLog from '../fixtures/cli/v112-pxd003531-call/run.log?raw'
import callDigest from '../fixtures/cli/v112-pxd003531-call/run.digest.tsv?raw'
import callLabel from '../fixtures/cli/v112-pxd003531-call/run.label.tsv?raw'
import callSpecies from '../fixtures/cli/v112-pxd003531-call/run.tags.species.tsv?raw'
import callCensus from '../fixtures/cli/v112-pxd003531-call/run.tags.census_summary.tsv?raw'
import tmtLog from '../fixtures/cli/v112-pxd004541-tmt/run.log?raw'
import tmtDigest from '../fixtures/cli/v112-pxd004541-tmt/run.digest.tsv?raw'
import tmtLabel from '../fixtures/cli/v112-pxd004541-tmt/run.label.tsv?raw'
import tmtSpecies from '../fixtures/cli/v112-pxd004541-tmt/run.tags.species.tsv?raw'
import daLog from '../fixtures/cli/v112-pxd010783-da/run.log?raw'
import daDigest from '../fixtures/cli/v112-pxd010783-da/run.digest.tsv?raw'
import daLabel from '../fixtures/cli/v112-pxd010783-da/run.label.tsv?raw'
import daSpecies from '../fixtures/cli/v112-pxd010783-da/run.tags.species.tsv?raw'
import fastaLog from '../fixtures/cli/v112-pxd014764-fasta/run.log?raw'
import fastaDigest from '../fixtures/cli/v112-pxd014764-fasta/run.digest.tsv?raw'
import fastaLabel from '../fixtures/cli/v112-pxd014764-fasta/run.label.tsv?raw'
import fastaMassgap from '../fixtures/cli/v112-pxd014764-fasta/run.massgap.tsv?raw'
import fastaSpecies from '../fixtures/cli/v112-pxd014764-fasta/run.tags.species.tsv?raw'
import recon2Log from '../fixtures/cli/v112-pxd014764-recon-ext2/run.log?raw'
import recon2Digest from '../fixtures/cli/v112-pxd014764-recon-ext2/run.digest.tsv?raw'
import recon2Label from '../fixtures/cli/v112-pxd014764-recon-ext2/run.label.tsv?raw'
import recon2Massgap from '../fixtures/cli/v112-pxd014764-recon-ext2/run.massgap.tsv?raw'
import recon2Species from '../fixtures/cli/v112-pxd014764-recon-ext2/run.tags.species.tsv?raw'
import recon3Log from '../fixtures/cli/v112-pxd014764-recon-ext3/run.log?raw'
import recon3Digest from '../fixtures/cli/v112-pxd014764-recon-ext3/run.digest.tsv?raw'
import recon3Label from '../fixtures/cli/v112-pxd014764-recon-ext3/run.label.tsv?raw'
import recon3Massgap from '../fixtures/cli/v112-pxd014764-recon-ext3/run.massgap.tsv?raw'
import recon3Species from '../fixtures/cli/v112-pxd014764-recon-ext3/run.tags.species.tsv?raw'

export interface CliCase {
  /// The directory under src/fixtures/cli.
  name: string
  /// What the run was given beyond -in and -out (cmd.txt), as the GUI's
  /// params record names it.
  params: Record<string, unknown>
  /// The run's stdout and stderr, in order.
  log: string
  digest: string
  label: string
  massgap?: string
  species: string
  census?: string
}

// "Characterize a run" (setup/tasks.ts) with the gate's taxonomy.
const CHARACTERIZE = { species: true, extension: '2', digest_out: 'run.digest.tsv', label_out: 'run.label.tsv', glyco: true, subsample_fraction: '0.1' }

export const CLI_CASES = {
  v111: { name: 'v111-pxd003531', params: CHARACTERIZE, log: v111Log, digest: v111Digest, label: v111Label, species: v111Species },
  v111Tmt: { name: 'v111-pxd004541-tmt', params: CHARACTERIZE, log: v111TmtLog, digest: v111TmtDigest, label: v111TmtLabel, species: v111TmtSpecies },
  v112: { name: 'v112-pxd003531', params: CHARACTERIZE, log: v112Log, digest: v112Digest, label: v112Label, species: v112Species },
  v112Call: {
    name: 'v112-pxd003531-call',
    params: { ...CHARACTERIZE, species_call: 'decoy', census: true },
    log: callLog,
    digest: callDigest,
    label: callLabel,
    species: callSpecies,
    census: callCensus
  },
  v112Tmt: { name: 'v112-pxd004541-tmt', params: CHARACTERIZE, log: tmtLog, digest: tmtDigest, label: tmtLabel, species: tmtSpecies },
  v112Da: {
    name: 'v112-pxd010783-da',
    params: { ...CHARACTERIZE, fragment_tolerance: '0.5', fragment_tolerance_unit: 'Da' },
    log: daLog,
    digest: daDigest,
    label: daLabel,
    species: daSpecies
  },
  v112Fasta: {
    name: 'v112-pxd014764-fasta',
    params: { ...CHARACTERIZE, extension: '3', fasta: 'Homo_sapiens.fasta', recon_out: 'run.recon.tsv', delta_out: 'run.delta.tsv', massgap_out: 'run.massgap.tsv' },
    log: fastaLog,
    digest: fastaDigest,
    label: fastaLabel,
    massgap: fastaMassgap,
    species: fastaSpecies
  },
  // What "Add FASTA and run again" sent before the fix: Characterize's
  // extension 2 with -recon_fasta. Tags reach 3+2*2 = 7 residues, the recon
  // index needs 8: the CLI exits 0 and places no spectrum.
  v112ReconExt2: {
    name: 'v112-pxd014764-recon-ext2',
    params: { ...CHARACTERIZE, recon_fasta: 'Homo_sapiens.fasta', recon_out: 'run.recon.tsv', massgap_out: 'run.massgap.tsv' },
    log: recon2Log,
    digest: recon2Digest,
    label: recon2Label,
    massgap: recon2Massgap,
    species: recon2Species
  },
  // What it sends now: the same with extension 3.
  v112ReconExt3: {
    name: 'v112-pxd014764-recon-ext3',
    params: { ...CHARACTERIZE, extension: '3', recon_fasta: 'Homo_sapiens.fasta', recon_out: 'run.recon.tsv', massgap_out: 'run.massgap.tsv' },
    log: recon3Log,
    digest: recon3Digest,
    label: recon3Label,
    massgap: recon3Massgap,
    species: recon3Species
  }
} satisfies Record<string, CliCase>

export type CliCaseId = keyof typeof CLI_CASES

/// The log as the run's log store holds it: one line per entry.
export const logLines = (c: CliCase): string[] => c.log.split(/\r?\n/).filter((l) => l !== '')

// P4c (GUI-DESIGN S7, S8): the files the Mass gaps & recon and Glyco tabs
// read, as the CLI wrote them (src/fixtures/cli/README.md).
import p4cLog from '../fixtures/cli/v112-pxd014764-delta-ext3/run.log?raw'
import p4cMassgap from '../fixtures/cli/v112-pxd014764-delta-ext3/run.massgap.tsv?raw'
import p4cRecon from '../fixtures/cli/v112-pxd014764-delta-ext3/run.recon.tsv?raw'
import p4cDelta from '../fixtures/cli/v112-pxd014764-delta-ext3/run.delta.tsv?raw'
import p4cGlyco from '../fixtures/cli/v112-pxd014764-delta-ext3/run.tags.glyco.tsv?raw'
import ecoliLog from '../fixtures/cli/v1111-ecoli-recon-loc/run.log?raw'
import ecoliMassgap from '../fixtures/cli/v1111-ecoli-recon-loc/run.massgap.tsv?raw'
import ecoliRecon from '../fixtures/cli/v1111-ecoli-recon-loc/run.recon.tsv?raw'
import ecoliDelta from '../fixtures/cli/v1111-ecoli-recon-loc/run.delta.tsv?raw'
import ecoliGlyco from '../fixtures/cli/v1111-ecoli-recon-loc/run.tags.glyco.tsv?raw'
import ecoliMzTab from '../fixtures/cli/v1111-ecoli-recon-loc/run.recon.mzTab?raw'

export interface ReconCase {
  name: string
  log: string
  massgap: string
  recon: string
  delta: string
  glyco: string
  mzTab?: string
}

export const RECON_CASES = {
  human: { name: 'v112-pxd014764-delta-ext3', log: p4cLog, massgap: p4cMassgap, recon: p4cRecon, delta: p4cDelta, glyco: p4cGlyco },
  ecoli: {
    name: 'v1111-ecoli-recon-loc',
    log: ecoliLog,
    massgap: ecoliMassgap,
    recon: ecoliRecon,
    delta: ecoliDelta,
    glyco: ecoliGlyco,
    mzTab: ecoliMzTab
  }
} satisfies Record<string, ReconCase>
