// A larger indexed mzML made of one small public file's spectra, repeated:
// the real-CLI cancel spec needs a run that is still going when Cancel is
// clicked, and the 139-spectrum E. coli fixture often finishes first
// (dry run 42321224285, ubuntu-22.04: "cancel": "finished").
//
// Copy k of spectrum i gets index k*n+i and the id of the original with
// scan=<k*1000000 + scan>, so every id stays unique. The index is rebuilt
// with the new byte offsets (the file is written as latin1, one byte per
// char, as the fixture's ISO-8859-1 declaration says), chromatograms kept.
import { createWriteStream, readFileSync } from 'node:fs'
import { once } from 'node:events'

/** Write @p copies repetitions of the spectra of @p src to @p dst; returns the spectrum count. */
export async function repeatMzML(src, dst, copies) {
  const t = readFileSync(src, 'latin1')
  const listOpen = t.indexOf('<spectrumList')
  const listBody = t.indexOf('>', listOpen) + 1
  const listClose = t.indexOf('</spectrumList>')
  const mzmlEnd = t.indexOf('</mzML>') + '</mzML>'.length
  if (listOpen < 0 || listClose < 0 || mzmlEnd < 7) throw new Error(`${src}: not an mzML with a spectrumList`)
  const blocks = t.slice(listBody, listClose).match(/<spectrum [\s\S]*?<\/spectrum>/g) ?? []
  if (blocks.length === 0) throw new Error(`${src}: no spectra`)
  const n = blocks.length
  const head = t.slice(0, listBody).replace(/(<spectrumList[^>]*\bcount=")\d+"/, `$1${n * copies}"`)
  const tail = t.slice(listClose, mzmlEnd)

  const w = createWriteStream(dst, { encoding: 'latin1' })
  let at = 0
  const put = async (s) => {
    at += s.length
    if (!w.write(s, 'latin1')) await once(w, 'drain')
  }
  const offsets = []
  await put(head)
  for (let k = 0; k < copies; k++) {
    for (let i = 0; i < n; i++) {
      let id = ''
      const b = blocks[i]
        .replace(/^<spectrum id="([^"]*)"/, (_m, old) => {
          id = old.replace(/scan=(\d+)/, (_s, scan) => `scan=${k * 1000000 + Number(scan)}`)
          if (id === old && k > 0) id = `${old} copy=${k}`
          return `<spectrum id="${id}"`
        })
        .replace(/^(<spectrum [^>]*\bindex=")\d+"/, `$1${k * n + i}"`)
      await put('\n\t\t\t')
      offsets.push([id, at])
      await put(b)
    }
  }
  await put('\n\t\t')
  const tailAt = at
  await put(tail)
  const chroms = [...tail.matchAll(/<chromatogram id="([^"]*)"/g)].map((m) => [m[1], tailAt + m.index])
  await put('\n')
  const indexAt = at
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  let idx = `<indexList count="${chroms.length ? 2 : 1}">\n\t<index name="spectrum">\n`
  for (const [id, o] of offsets) idx += `\t\t<offset idRef="${esc(id)}">${o}</offset>\n`
  idx += '\t</index>\n'
  if (chroms.length) {
    idx += '\t<index name="chromatogram">\n'
    for (const [id, o] of chroms) idx += `\t\t<offset idRef="${esc(id)}">${o}</offset>\n`
    idx += '\t</index>\n'
  }
  idx += `</indexList>\n<indexListOffset>${indexAt}</indexListOffset>\n<fileChecksum>0</fileChecksum>\n</indexedmzML>\n`
  await put(idx)
  w.end()
  await once(w, 'finish')
  return n * copies
}
