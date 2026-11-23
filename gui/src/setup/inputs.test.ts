// The derived inputs of the Setup wizard (doc/GUI-SETUP-WIZARD.md 5.2):
// which inputs each task needs and offers, the stand-in, the carry-over of
// a form replacement and the step states.

import { describe, expect, it } from 'vitest'
import { BRIEF_HINT, conflicts } from '../paramLayout'
import { advancedParams, inputDependents } from './SetupForm'
import { TASKS, baseValues, taskById } from './tasks'
import {
  INPUTS,
  MANIFEST_INPUTS,
  carryInputs,
  extensionWarning,
  inputLabel,
  inputParams,
  missingInputs,
  stepState,
  taskInputs
} from './inputs'

const T = (id: string) => taskById(id)!

describe('inputs per task', () => {
  it('classifies every input file of the manifest once', () => {
    expect(MANIFEST_INPUTS.filter((n) => !INPUTS[n])).toEqual([])
    expect(Object.keys(INPUTS).filter((n) => !MANIFEST_INPUTS.includes(n))).toEqual([])
  })

  it('needs a FASTA only for Mass-shift survey and Database reduction', () => {
    const needs = TASKS.filter((t) => (t.required ?? []).length > 0).map((t) => t.id)
    expect(needs).toEqual(['mass-shift', 'db-reduction'])
    for (const id of needs) expect(T(id).required).toEqual(['recon_fasta'])
  })

  it('offers per task what the step-2 table says', () => {
    const offer = (id: string, v = baseValues(`builtin:${id}` as never)): string[] => taskInputs(T(id), v, 'one').addable
    expect(offer('export-tags')).toEqual(['fasta'])
    // The Filter database stands in for the Protein database: offered, and said so.
    expect(offer('mass-shift')).toEqual(['fasta'])
    expect(offer('species')).toEqual(['taxdb'])
    expect(offer('characterize')).toEqual(['taxdb'])
    expect(offer('db-reduction')).toEqual(['fasta', 'shortlist_background'])
    expect(offer('triage')).toEqual(['census_ids'])
    expect(offer('run-qc')).toEqual([])
    // The entrapment database only with a filter database.
    expect(offer('export-tags', { ...baseValues('builtin:export-tags'), fasta: '/d/h.fasta' })).toEqual(['entrapment_fasta'])
  })

  it('every `after` names an input of the same task, every set is a CLI set rule', () => {
    for (const t of TASKS)
      for (const n of t.optionalInputs ?? []) {
        const after = INPUTS[n].after
        if (after) expect(inputParams(t).has(after), `${t.id} ${n}`).toBe(true)
      }
    for (const [n, info] of Object.entries(INPUTS)) {
      if (!info.also) continue
      // Only part of the set given: the CLI refuses it, naming the set.
      const set = [n, ...info.also]
      const v: Record<string, unknown> = { [n]: '/d/x', species: true }
      expect(conflicts(v).some((c) => c.params.length === set.length - 1 && c.params.every((m) => set.includes(m))), n).toBe(true)
    }
  })

  it('no effect line is a second copy of a hint', () => {
    const lines = Object.values(INPUTS).flatMap((i) => (i.why ? [i.why] : []))
    expect(new Set(lines).size).toBe(lines.length)
    const hints = new Set([...Object.values(BRIEF_HINT), ...TASKS.flatMap((t) => Object.values(t.help))])
    for (const l of lines) expect(hints.has(l), l).toBe(false)
  })

  it('the Filter database stands in for the Protein database', () => {
    const v = { ...baseValues('builtin:mass-shift'), fasta: '/d/h.fasta' }
    expect(missingInputs(T('mass-shift'), v, { input: '/d/a.mzML', jobs: 0, mode: 'one' })).toEqual([])
    expect(taskInputs(T('mass-shift'), v, 'one').shown).toEqual(['fasta'])
    expect(missingInputs(T('mass-shift'), baseValues('builtin:mass-shift'), { input: '/d/a.mzML', jobs: 0, mode: 'one' })).toEqual(['recon_fasta'])
    expect(missingInputs(T('species'), baseValues('builtin:species'), { input: '', jobs: 0, mode: 'one' })).toEqual(['in'])
  })

  it('an input the task does not use is listed, never hidden; identifications not in Batch mode', () => {
    const species = { ...baseValues('builtin:species'), fasta: '/d/h.fasta' }
    expect(taskInputs(T('species'), species, 'one').extraneous.map((x) => x.name)).toEqual(['fasta'])
    const ids = { ...baseValues('builtin:triage'), census_ids: '/d/a.idXML' }
    expect(taskInputs(T('triage'), ids, 'one').shown).toEqual(['census_ids'])
    const batch = taskInputs(T('triage'), ids, 'batch')
    expect(batch.addable).toEqual([])
    expect(batch.extraneous).toEqual([{ name: 'census_ids', why: INPUTS.census_ids.oneFileOnly }])
  })

  it('no workflow (FASTag defaults): nothing required, every step-2 input offered', () => {
    const ti = taskInputs(null, baseValues('defaults'), 'one')
    expect(ti.required).toEqual([])
    expect(ti.addable).toEqual(['fasta', 'recon_fasta', 'shortlist_background', 'census_ids', 'taxdb'])
    expect(ti.extraneous).toEqual([])
  })

  it('no option has a control in step 2 and under Advanced', () => {
    for (const t of TASKS) {
      const adv = new Set(advancedParams(t))
      expect([...inputParams(t)].filter((n) => adv.has(n)), t.id).toEqual([])
      expect((t.about ?? []).filter((n) => adv.has(n)), t.id).toEqual([])
    }
    const adv = new Set(advancedParams(T('export-tags'), null))
    expect([...inputParams(null)].filter((n) => adv.has(n))).toEqual([])
  })

  it('every input file of the manifest has a control in every task: required, addable or under Advanced', () => {
    for (const t of [...TASKS, null]) {
      const v = t ? baseValues(`builtin:${t.id}` as never) : baseValues('defaults')
      const adv = new Set(advancedParams(t ?? T('export-tags'), t))
      for (const [n, info] of Object.entries(INPUTS)) {
        if (info.place === 'hidden' || info.partOf) continue
        if (info.place === 'setting') {
          expect([...(t?.basic ?? []), ...(t?.about ?? []), ...adv].includes(n) || !t, `${t?.id} ${n}`).toBe(true)
          continue
        }
        // An input offered after another: with that one set.
        const w = info.after ? { ...v, [info.after]: '/d/x.fasta' } : v
        const ti = taskInputs(t, w, 'one')
        expect(ti.required.includes(n) || ti.addable.includes(n) || ti.shown.includes(n) || adv.has(n), `${t?.id ?? 'defaults'} ${n}`).toBe(true)
      }
      // The settings that wait on an input only: under it in step 2 once set, else under Advanced.
      const deps = new Set([...inputDependents(t ?? T('export-tags'), t).values()].flat())
      expect(deps.has('min_filter_length') || adv.has('min_filter_length'), `${t?.id} min_filter_length`).toBe(true)
    }
  })

  it('the Filter database is offered where it stands in for the Protein database, with the entrapment database after it', () => {
    for (const id of ['mass-shift', 'db-reduction']) {
      const v = baseValues(`builtin:${id}` as never)
      expect(taskInputs(T(id), v, 'one').addable, id).toContain('fasta')
      expect(taskInputs(T(id), { ...v, fasta: '/d/h.fasta' }, 'one').addable, id).toContain('entrapment_fasta')
    }
    expect(inputLabel('fasta', T('mass-shift'))).toMatch(/Filter database.*Protein database/)
    expect(inputLabel('fasta', T('export-tags'))).toBe('Filter database')
  })

  it('warns, never blocks, on a file that is not of the formats the CLI lists', () => {
    expect(extensionWarning('recon_fasta', '/d/h.fasta')).toBeNull()
    expect(extensionWarning('recon_fasta', '/d/h.fa.gz')).toBeNull()
    expect(extensionWarning('recon_fasta', '/d/h.txt')).toBe('h.txt is not a FASTA file (.fasta, .fa, .faa).')
    expect(extensionWarning('census_ids', '/d/a.tsv')).toMatch(/is not a idXML or mzid file/)
    expect(extensionWarning('taxdb', '/d/x.anything')).toBeNull()
  })
})

describe('carry-over of a form replacement', () => {
  const ms = baseValues('builtin:mass-shift')
  it('keeps a protein database from Mass-shift survey to Database reduction, drops it for Species', () => {
    const prev = { ...ms, recon_fasta: '/d/h.fasta' }
    const toDb = carryInputs(prev, baseValues('builtin:db-reduction'), T('db-reduction'), ms)
    expect(toDb.values.recon_fasta).toBe('/d/h.fasta')
    expect(toDb.kept).toEqual(['Protein database'])
    const toSpecies = carryInputs(prev, baseValues('builtin:species'), T('species'), ms)
    expect(toSpecies.values.recon_fasta).toBe('')
    expect(toSpecies.dropped).toEqual(['Protein database'])
  })

  it('keeps the instrument and fixed modifications the user changed; counts the replaced settings', () => {
    const prev = { ...ms, fragment_tolerance: '0.3', fragment_tolerance_unit: 'Da', fixed_modifications: [], recon_missed_cleavages: '4' }
    const c = carryInputs(prev, baseValues('builtin:species'), T('species'), ms)
    expect([c.values.fragment_tolerance, c.values.fragment_tolerance_unit, c.values.fixed_modifications]).toEqual(['0.3', 'Da', []])
    expect(c.kept).toEqual(['instrument', 'fixed modifications'])
    expect(c.replaced).toBe(1)
    // Reset (no common block): the instrument goes back too.
    expect(carryInputs(prev, ms, T('mass-shift'), ms, false).values.fragment_tolerance).toBe(ms.fragment_tolerance)
  })

  it('a taxonomy set moves as one', () => {
    const sp = baseValues('builtin:species')
    const prev = { ...sp, taxdb: '/t/x.taxdb', taxonomy_nodes: '/t/nodes.dmp', taxonomy_names: '/t/names.dmp' }
    const c = carryInputs(prev, baseValues('builtin:characterize'), T('characterize'), sp)
    expect([c.values.taxdb, c.values.taxonomy_nodes, c.values.taxonomy_names]).toEqual(['/t/x.taxdb', '/t/nodes.dmp', '/t/names.dmp'])
    expect(c.kept).toEqual(['Your taxonomy'])
  })
})

describe('step states', () => {
  const base = { confirmed: true, step: 2 as const, inputErrors: 0, settingErrors: 0, outputErrors: 0 }
  it('locks steps 2-4 only while no task is confirmed', () => {
    expect(stepState({ ...base, confirmed: false, step: 1 })).toEqual({ 1: 'current', 2: 'locked', 3: 'locked', 4: 'locked' })
    expect(stepState({ ...base, step: 1 })).toEqual({ 1: 'current', 2: 'todo', 3: 'todo', 4: 'todo' })
  })
  it('Settings stays reachable while Inputs is blocked', () => {
    expect(stepState({ ...base, step: 3, inputErrors: 1 })).toEqual({ 1: 'done', 2: 'blocked', 3: 'current', 4: 'todo' })
    expect(stepState({ ...base, inputErrors: 2 })[2]).toBe('blocked')
  })
})
