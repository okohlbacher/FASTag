// A JSON Schema validator for the keyword subset the feedback schemas use
// (schema/report.schema.json, schema/feedback-public.schema.json; the same
// subset tools/feedback_triage.py supports): type, enum, const, required,
// properties, additionalProperties, propertyNames, maxProperties, items,
// maxItems, minLength, maxLength, pattern, minimum, maximum, anyOf and local
// $ref. An unknown keyword is an error, so a schema cannot silently use one.

type Schema = Record<string, unknown>

const KNOWN = new Set([
  '$schema', '$id', 'title', 'description', '$defs', 'type', 'enum', 'const', 'required', 'properties',
  'additionalProperties', 'propertyNames', 'maxProperties', 'items', 'maxItems', 'minLength', 'maxLength',
  'pattern', 'minimum', 'maximum', 'anyOf', '$ref'
])

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

const typeOk = (t: string, v: unknown): boolean => {
  const a = typeOf(v)
  return a === t || (t === 'number' && a === 'integer')
}

/// The errors of @p value against @p schema (empty: valid).
export function validate(schema: Schema, value: unknown): string[] {
  const root = schema
  const errors: string[] = []
  const walk = (s: Schema, v: unknown, at: string): void => {
    for (const k of Object.keys(s)) if (!KNOWN.has(k)) errors.push(`${at}: schema keyword ${k} is not supported`)
    if (typeof s.$ref === 'string') {
      const name = s.$ref.replace(/^#\/\$defs\//, '')
      const def = (root.$defs as Record<string, Schema> | undefined)?.[name]
      if (!def) errors.push(`${at}: unknown $ref ${s.$ref}`)
      else walk(def, v, at)
    }
    if (s.anyOf) {
      const ok = (s.anyOf as Schema[]).some((sub) => {
        const before = errors.length
        walk(sub, v, at)
        const fine = errors.length === before
        errors.length = before
        return fine
      })
      if (!ok) errors.push(`${at}: matches none of anyOf`)
    }
    if (s.type !== undefined) {
      const ts = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string]
      if (!ts.some((t) => typeOk(t, v))) {
        errors.push(`${at}: ${typeOf(v)} is not ${ts.join('|')}`)
        return
      }
    }
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) errors.push(`${at}: is not ${JSON.stringify(s.const)}`)
    if (s.enum && !(s.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(v))) errors.push(`${at}: ${JSON.stringify(v)} is not one of ${JSON.stringify(s.enum)}`)
    if (typeof v === 'string') {
      const n = [...v].length
      if (typeof s.minLength === 'number' && n < s.minLength) errors.push(`${at}: shorter than ${s.minLength}`)
      if (typeof s.maxLength === 'number' && n > s.maxLength) errors.push(`${at}: longer than ${s.maxLength}`)
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${at}: ${JSON.stringify(v)} does not match ${s.pattern}`)
    }
    if (typeof v === 'number') {
      if (typeof s.minimum === 'number' && v < s.minimum) errors.push(`${at}: below ${s.minimum}`)
      if (typeof s.maximum === 'number' && v > s.maximum) errors.push(`${at}: above ${s.maximum}`)
    }
    if (Array.isArray(v)) {
      if (typeof s.maxItems === 'number' && v.length > s.maxItems) errors.push(`${at}: more than ${s.maxItems} items`)
      if (s.items) v.forEach((x, i) => walk(s.items as Schema, x, `${at}/${i}`))
    }
    if (typeOf(v) === 'object') {
      const o = v as Record<string, unknown>
      const props = (s.properties ?? {}) as Record<string, Schema>
      for (const r of (s.required as string[] | undefined) ?? []) if (!(r in o)) errors.push(`${at}: ${r} is missing`)
      if (typeof s.maxProperties === 'number' && Object.keys(o).length > s.maxProperties) errors.push(`${at}: more than ${s.maxProperties} properties`)
      for (const [k, x] of Object.entries(o)) {
        if (s.propertyNames) walk(s.propertyNames as Schema, k, `${at}/${k} (name)`)
        if (k in props) walk(props[k], x, `${at}/${k}`)
        else if (s.additionalProperties === false) errors.push(`${at}: ${k} is not allowed`)
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties as Schema, x, `${at}/${k}`)
      }
    }
  }
  walk(schema, value, '')
  return errors
}
