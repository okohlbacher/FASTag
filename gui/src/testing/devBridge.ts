// `npm run dev` opened in a plain browser has no Tauri backend. Install the
// test mock with the report fixtures instead, so the React part can be looked
// at without the CLI. Only main.tsx loads this, and only in a dev build.

import { installMockBridge } from './mockBridge'
import digestTsv from '../fixtures/digest.tsv?raw'
import labelTsv from '../fixtures/label.tsv?raw'
import massgapTsv from '../fixtures/massgap.tsv?raw'

export function installDevBridge(): void {
  const mock = installMockBridge()
  mock.binaryInfo = { ...mock.binaryInfo, detail: 'browser preview: no CLI' }
  const reports: Record<string, string> = {
    '/demo/a.digest.tsv': digestTsv,
    '/demo/a.label.tsv': labelTsv,
    '/demo/a.massgap.tsv': massgapTsv
  }
  mock.reportFiles = reports
  mock.nextPickResults = '/demo/a.tags.tsv'
  // Each "open a report" adds the next one.
  const order = Object.keys(reports)
  let next = 0
  mock.pickReport = () => Promise.resolve(order[next++ % order.length])
}
