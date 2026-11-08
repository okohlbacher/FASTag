// What the CLI the app runs can do, read from the options its `--helphelp`
// lists (inspect.rs cli_capabilities), never from its version string: an
// integration build still says 1.11.0, and a later release may drop a flag.

export interface CliCapabilities {
  // The option names --helphelp lists, without the dash.
  options: string[]
  // -probe_input: the pre-run metadata probe (probe.ts).
  probeInput: boolean
  // -acquisition_check (1.12): a raw-DIA input is refused with exit 11.
  acquisitionCheck: boolean
}

export const NO_CAPABILITIES: CliCapabilities = { options: [], probeInput: false, acquisitionCheck: false }

export function capabilitiesOf(options: string[]): CliCapabilities {
  const has = new Set(options)
  return { options, probeInput: has.has('probe_input'), acquisitionCheck: has.has('acquisition_check') }
}
