// @ts-nocheck -- test-only helper; uses node APIs outside the app tsconfig
// Inputs the tests in this folder take from outside the repository. None is
// required: a test that needs one is skipped when it is not set.
//
//   FASTAG_GUI_TEST_OUTPUTS    a directory of real FASTag 1.9.0 outputs on the
//                              public E. coli fixture (map/, docs/, parsers/)
//                              and the pipe-order helper
//                              (cli/order_rs/target/debug/order_rs). When it
//                              is unset, the outputs committed in
//                              src/fixtures/real/ are used (P1), so only the
//                              tests that also need the helper or a CLI skip.
//   FASTAG_ORDER_RS            the pipe-order helper, if not in that directory
//   FASTAG_BIN                 a FASTag CLI to run (cli-consistency); it must be
//                              the version of params.generated.json, since the GUI
//                              sends options an older CLI does not know
//
// Repository files are found relative to this file.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const env = (k: string): string => (process.env[k] ?? '').trim()

/** gui/src/fixtures/, with a trailing slash. */
export const FIXTURES_DIR: string = join(__dirname, '..', 'fixtures') + '/'

/** The committed real CLI outputs (src/fixtures/real/, see its README.md). */
export const REAL_DIR: string = join(FIXTURES_DIR, 'real')

/** The test-outputs directory: FASTAG_GUI_TEST_OUTPUTS, else REAL_DIR. */
export const SCRATCH: string = env('FASTAG_GUI_TEST_OUTPUTS') || REAL_DIR

/** A path inside the test-outputs directory. */
export const scratchPath = (rel: string): string => (SCRATCH ? join(SCRATCH, rel) : '')

/** True when the test-outputs directory holds every one of @p rel. */
export const haveScratch = (...rel: string[]): boolean =>
  SCRATCH !== '' && rel.every((r) => existsSync(scratchPath(r)))

/** A scratch file's text, or null when it is missing or the dir is unset. */
export const readScratch = (rel: string): string | null =>
  haveScratch(rel) ? readFileSync(scratchPath(rel), 'utf8') : null

/** The FASTag CLI named by FASTAG_BIN, or '' when it is unset or missing. */
export const FASTAG_BIN: string = ((): string => {
  const b = env('FASTAG_BIN')
  return b && existsSync(b) ? b : ''
})()

/** The pipe-order helper, or '' when it is not available. */
export const ORDER_RS: string = ((): string => {
  const b = env('FASTAG_ORDER_RS') || scratchPath('cli/order_rs/target/debug/order_rs')
  return b && existsSync(b) ? b : ''
})()

/** The repository's test/fixtures/ directory, with a trailing slash. */
export const REPO_FIXTURES_DIR: string = join(__dirname, '..', '..', '..', 'test', 'fixtures') + '/'

/** gui/src-tauri/. */
export const SRC_TAURI_DIR: string = join(__dirname, '..', '..', 'src-tauri')
