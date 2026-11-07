// The session hook (P1 PR c): the form's values, the last-used offer (D6),
// presets and what a run would send. The defaults Reset restores (half of
// App.test.tsx "Reset… asks first", whose confirmation moved to RunBar) are
// tested here.

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { initialValues, useSession } from './useSession'
import { PARAM_BY_NAME } from '../paramLayout'
import { installMockBridge } from '../testing/mockBridge'

describe('useSession', () => {
  it('starts from the CLI defaults, straight from the manifest', () => {
    const v = initialValues()
    expect(v['tag_length']).toBe(String(PARAM_BY_NAME.get('tag_length')!.default))
    expect(v['species']).toBe(false)
    expect(Object.keys(v).length).toBe(PARAM_BY_NAME.size)
  })

  it('reset restores the CLI defaults', async () => {
    installMockBridge()
    const { result } = renderHook(() => useSession())
    act(() => result.current.setValue('tag_length', '6'))
    expect(result.current.values['tag_length']).toBe('6')
    act(() => result.current.reset())
    expect(result.current.values).toEqual(initialValues())
  })

  it('offers only the rendered last-used values that differ, and applies them beside the tags output', async () => {
    const mock = installMockBridge()
    mock.settings.lastUsed = { tag_length: '5', digest_out: '/old/x.digest.tsv', version: '9', in: '/x' }
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.lastUsedDiff.sort()).toEqual(['digest_out', 'tag_length']))
    act(() => result.current.setOut('/d/b.tags.tsv'))
    act(() => result.current.applyLastUsed())
    expect(result.current.values['tag_length']).toBe('5')
    expect(result.current.values['digest_out']).toBe('/d/b.digest.tsv')
    expect(result.current.lastUsedDiff).toEqual([])
  })

  it('a preset is applied with its report paths beside the tags output; save and delete refresh the list', async () => {
    const mock = installMockBridge()
    mock.settings.presets = { hcd: { fragment_tolerance: '20', digest_out: '/s/a.digest.tsv' } }
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.presets).toEqual(['hcd']))
    act(() => result.current.setOut('/d/b.tags.tsv'))
    await act(async () => result.current.applyPreset('hcd'))
    expect(result.current.values['fragment_tolerance']).toBe('20')
    expect(result.current.values['digest_out']).toBe('/d/b.digest.tsv')
    act(() => result.current.setSavingName('mine'))
    await act(async () => result.current.commitPreset())
    expect(result.current.presets).toEqual(['hcd', 'mine'])
    expect(result.current.preset).toBe('mine')
    expect(result.current.savingName).toBeNull()
    await act(async () => result.current.removePreset())
    expect(result.current.presets).toEqual(['hcd'])
    expect(result.current.preset).toBe('')
  })

  it('names the changed parameters as the command line spells them, and blocks what the CLI refuses', () => {
    installMockBridge()
    const { result } = renderHook(() => useSession())
    expect(result.current.changedParams).toEqual([])
    expect(result.current.blocked).toBe(false)
    act(() => result.current.setValue('tag_length', '5'))
    expect(result.current.changedParams).toEqual(['-tag_length 5'])
    act(() => result.current.setValue('tag_length', '0'))
    expect(result.current.blocked).toBe(true)
    expect(Object.keys(result.current.invalid)).toEqual(['tag_length'])
  })

  it('choosing an instrument sets the tolerance and its unit, and remembers the choice', () => {
    installMockBridge()
    const { result } = renderHook(() => useSession())
    act(() => result.current.chooseInstrument('iontrap-cid'))
    expect(result.current.values['fragment_tolerance']).toBe('0.3')
    expect(result.current.values['fragment_tolerance_unit']).toBe('Da')
    expect(result.current.instrument).toBe('iontrap-cid')
  })
})
