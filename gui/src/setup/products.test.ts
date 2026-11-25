// database-5: a product turned off takes back the values it set.
import { describe, expect, it } from 'vitest'
import { PRODUCT_OF, setProduct } from './products'
import { initialValues } from './useSession'

const P = (n: string) => PRODUCT_OF.get(n)!

describe('setProduct off clears what the product set (database-5)', () => {
  it('the ranking takes census_score back; the table keeps census on', () => {
    const on = setProduct(P('census_sorted_out'), true, initialValues(), '/d/a.tags.tsv')
    expect(on['census']).toBe(true)
    expect(on['census_score']).toBe(true)
    const off = setProduct(P('census_sorted_out'), false, on, '/d/a.tags.tsv')
    expect(off['census_sorted_out']).toBe('')
    expect(off['census_score']).toBe(false)
    expect(off['census']).toBe(true)
    // The table off too: no census option left.
    const none = setProduct(P('census_out'), false, off, '/d/a.tags.tsv')
    expect(none['census']).toBe(false)
    expect(none['census_score']).toBe(false)
  })
  it('the charge check puts its mode back, but not a mode the user chose', () => {
    const on = setProduct(P('check_header_out'), true, initialValues(), '/d/a.tags.tsv')
    expect(on['check_header_charge']).toBe('warn')
    expect(setProduct(P('check_header_out'), false, on, '/d/a.tags.tsv')['check_header_charge']).toBe(initialValues()['check_header_charge'])
    const mine = setProduct(P('check_header_out'), false, { ...on, check_header_charge: 'both' }, '/d/a.tags.tsv')
    expect(mine['check_header_charge']).toBe('both')
  })
})
