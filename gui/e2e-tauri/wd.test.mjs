import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Session, WebDriverError } from './wd.mjs'

// Literal from https://www.w3.org/TR/webdriver2/#elements, independent of the client constant.
const W3C_ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'

test('find and findAll extract standard WebDriver element references', async () => {
  const session = new Session('', 'test')
  session.cmd = async (_method, path) => path === '/element'
    ? { [W3C_ELEMENT]: 'search' }
    : [{ [W3C_ELEMENT]: 'first' }, { [W3C_ELEMENT]: 'second' }]
  assert.equal(await session.find('//input'), 'search')
  assert.deepEqual(await session.findAll('//button'), ['first', 'second'])
})

test('unexpected element references report their payload instead of silently returning undefined', async () => {
  const session = new Session('', 'test')
  session.cmd = async (_method, path) => path === '/element' ? { wrong: 'search' } : [{ wrong: 'first' }]
  await assert.rejects(session.find('//input'), /Unexpected element reference.*wrong/)
  await assert.rejects(session.findAll('//button'), /Unexpected element references.*wrong/)
})

test('DOM click fallback sends a standard WebDriver element reference', async () => {
  const session = new Session('', 'test')
  session.cmd = async (_method, path, body) => {
    if (path === '/element/help/click') throw new WebDriverError('not interactable')
    assert.equal(path, '/execute/sync')
    assert.deepEqual(body, { script: 'arguments[0].click()', args: [{ [W3C_ELEMENT]: 'help' }] })
  }
  await session.click('help')
})
