// Which input files of step 2 are not on disk (doc/GUI-SETUP-WIZARD.md 5.6):
// the backend's path_status, asked once per set of paths and debounced. A
// cache, not the truth: a run re-checks every input itself.

import { useEffect, useState } from 'react'

export function usePathStatus(paths: readonly string[]): string[] {
  const key = [...new Set(paths)].sort().join('\n')
  const [missing, setMissing] = useState<{ key: string; paths: string[] }>({ key: '', paths: [] })
  useEffect(() => {
    if (!key || typeof window.fastag.pathStatus !== 'function') {
      setMissing({ key, paths: [] })
      return
    }
    let gone = false
    const t = setTimeout(() => {
      window.fastag
        .pathStatus(key.split('\n'))
        .then((st) => !gone && setMissing({ key, paths: st.filter((x) => !x.exists).map((x) => x.path) }))
        .catch(() => !gone && setMissing({ key, paths: [] }))
    }, 200)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [key])
  // Only the answer for the paths the form holds now.
  return missing.key === key ? missing.paths : []
}
