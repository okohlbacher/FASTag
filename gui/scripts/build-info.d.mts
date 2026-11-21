export declare function buildInfo(
  version: string,
  mode: string
): { version: string; commit: string; dirty: boolean | null; build_date: string; channel: 'release' | 'prerelease' | 'dev' | 'e2e' }
