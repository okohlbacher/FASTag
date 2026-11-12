import { describe, expect, it } from 'vitest'
import { FAQ_BY_ID } from './faq'
import { textOf } from './search'
import { LOG_WINDOW } from '../run/LogDrawer'
import { MAX_LOG } from '../runJob'
import { taskById } from '../setup/tasks'

const entry = (id: string): string => {
  const faq = FAQ_BY_ID.get(id)!
  return textOf([faq.symptoms, ...faq.causes, ...faq.fixes]).replace(/\s+/g, ' ')
}

describe('troubleshooting guidance matches the app', () => {
  it('explains missing paths, unavailable CLI, preflight checks and completed batches', () => {
    const text = entry('faq-run-disabled')
    for (const reason of ['No input file', 'output path is empty', 'FASTag cannot start', 'still running', 'red flag', 'no files remain', 'Retry failed']) {
      expect(text).toContain(reason)
    }
    expect(text).toContain('a blocking check cannot be overridden')
  })

  it('describes the real log display and retention limits', () => {
    const text = entry('faq-run-failed')
    expect(text).toContain(`last ${LOG_WINDOW.toLocaleString('en-US')} lines`)
    expect(text).toContain(`at most ${MAX_LOG.toLocaleString('en-US')} lines`)
    expect(text).not.toContain('shows every message')
  })

  it('uses the Characterize species settings as the standard starting point', () => {
    const task = taskById('characterize')!
    const text = entry('faq-species-off')
    expect(text).toContain(`extension ${task.values.extension}`)
    expect(text).toContain('Characterize a run')
    expect(entry('faq-species-short')).toContain('custom index')
    expect(entry('faq-species-short')).not.toContain('usually far fewer')
  })

  it('distinguishes detected instrument metadata from choosing the MS2 analyser', () => {
    const text = entry('faq-tolerance-warning')
    expect(text).toContain('input checks may identify the instrument')
    expect(text).toContain('Confirm the analyser that measured MS2')
    expect(text).not.toContain('FASTag cannot know the instrument')
  })
})
