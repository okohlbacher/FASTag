// The log scrubber (skill gui-feedback 4): what the console ring buffer
// kept goes through it before it is shown, stored or shared. Each
// replacement is a <tag> the share preview highlights. Its corpus is
// scrub.test.ts.

export interface ScrubHints {
  // The home folder and the user name (feedback_platform; never stored).
  home?: string | null
  user?: string | null
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/// The tags the scrubber writes (the preview highlights them).
export const SCRUB_TAGS = /<(home|user|email|credentials|redacted|token|host|share|org)>/g

export function scrub(text: string, hints: ScrubHints = {}): string {
  let s = text
  // The home folder as given, either slash, any case on Windows.
  const home = hints.home?.replace(/[\\/]+$/, '')
  if (home && home.length > 2) {
    const pat = esc(home).replace(/\\\\|\//g, '[\\\\/]')
    s = s.replace(new RegExp(pat, 'gi'), '<home>')
  }
  // URL credentials: scheme://user:pass@host.
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1<credentials>@')
  // Query and fragment values of secret-looking keys.
  s = s.replace(
    /([?&#;](?:access_token|refresh_token|id_token|token|auth|authorization|key|api_key|apikey|secret|password|passwd|pwd|sig|signature|code|session|sessionid|x-amz-[a-z-]+)=)[^&#\s"']*/gi,
    '$1<redacted>'
  )
  // GitHub tokens, bearer and basic auth headers, AWS keys, JWTs.
  s = s.replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<token>')
  s = s.replace(/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <token>')
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, '<token>')
  s = s.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<token>')
  // E-mail addresses.
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
  // UNC paths: \\server\share\...
  s = s.replace(/\\\\[^\\\s/]+\\[^\\\s/]+/g, '\\\\<host>\\<share>')
  s = s.replace(/(^|[\s"'(=])\/\/(?!<)[A-Za-z0-9._-]+\/[^/\s]+/g, '$1//<host>/<share>')
  // OneDrive and SharePoint folders name the organisation.
  s = s.replace(/OneDrive - [^\\/\n"']+/g, 'OneDrive - <org>')
  // A user folder of any OS, also when the home folder was not known.
  s = s.replace(/([\\/](?:Users|home|user)[\\/])(?!<)[^\\/\s"':]+/gi, '$1<user>')
  s = s.replace(/([A-Za-z]:\\Documents and Settings\\)[^\\\s"']+/gi, '$1<user>')
  // The user name anywhere else (as a word, not inside one).
  const user = hints.user
  if (user && user.length >= 3 && !/^(root|user|admin|runner)$/i.test(user)) {
    s = s.replace(new RegExp(`(?<![A-Za-z0-9])${esc(user)}(?![A-Za-z0-9])`, 'gi'), '<user>')
  }
  return s
}
