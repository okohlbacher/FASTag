// The build's identity for feedback reports (src/feedback/buildInfo.ts):
// the full commit, whether the tree had uncommitted changes, the build time
// and the channel, read from git when vite starts. Without git (a source
// tarball) the commit is "unknown" and the report says so; CI may set
// FASTAG_COMMIT (e.g. to GITHUB_SHA) instead.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('..', import.meta.url))

function git(args) {
  try {
    return execFileSync('git', args, { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

/// @p version: the app version (tauri.conf.json); @p mode: vite's mode.
export function buildInfo(version, mode) {
  const env = process.env.FASTAG_COMMIT?.trim().toLowerCase()
  const head = env && /^[0-9a-f]{7,40}$/.test(env) ? env : git(['rev-parse', 'HEAD'])
  const commit = head && /^[0-9a-f]{7,40}$/.test(head) ? head : 'unknown'
  const status = commit === 'unknown' || env ? null : git(['status', '--porcelain', '--untracked-files=no'])
  const channel = mode === 'e2e' ? 'e2e' : mode === 'development' || mode === 'test' ? 'dev' : /-/.test(version) ? 'prerelease' : 'release'
  return {
    version,
    commit,
    dirty: status == null ? null : status.length > 0,
    build_date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    channel
  }
}
