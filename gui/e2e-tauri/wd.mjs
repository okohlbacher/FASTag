// A minimal W3C WebDriver client for tauri-driver (GUI-DESIGN section 9,
// layer 4). Only the handful of commands the specs need, over Node's fetch,
// so the job installs no WebdriverIO or Selenium tree.
const ELEMENT = 'element-6066-11e4-a52f-4a6976a6e3b5'

export class WebDriverError extends Error {}

async function call(base, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new WebDriverError(`${method} ${path}: HTTP ${r.status}: ${text.slice(0, 300)}`)
  }
  if (!r.ok || (json.value && json.value.error)) {
    const v = json.value || {}
    const e = new WebDriverError(`${method} ${path}: ${v.error || r.status}: ${v.message || text.slice(0, 300)}`)
    e.code = v.error
    throw e
  }
  return json.value
}

export const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

/** Poll @p fn until it returns a truthy value, or fail with @p what. */
export async function until(what, fn, timeoutMs = 20000, everyMs = 50) {
  const end = Date.now() + timeoutMs
  let last
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${last ? `: ${last.message}` : ''}`)
    await sleep(everyMs)
  }
}

export class Session {
  /** Start the app at @p application through tauri-driver at @p base. */
  static async start(application, base = 'http://127.0.0.1:4444') {
    const v = await call(base, 'POST', '/session', {
      capabilities: { alwaysMatch: { browserName: 'wry', 'tauri:options': { application } } }
    })
    return new Session(base, v.sessionId)
  }

  constructor(base, id) {
    this.base = base
    this.id = id
  }

  cmd(method, path, body) {
    return call(this.base, method, `/session/${this.id}${path}`, body)
  }

  async end() {
    await this.cmd('DELETE', '').catch(() => {})
  }

  /** Run @p script (a function body) in the webview with @p args. */
  exec(script, ...args) {
    return this.cmd('POST', '/execute/sync', { script, args })
  }

  /** Run @p script with a callback as its last argument (arguments[arguments.length - 1]). */
  execAsync(script, ...args) {
    return this.cmd('POST', '/execute/async', { script, args })
  }

  async find(xpath) {
    const v = await this.cmd('POST', '/element', { using: 'xpath', value: xpath })
    return v[ELEMENT]
  }

  async findAll(xpath) {
    const v = await this.cmd('POST', '/elements', { using: 'xpath', value: xpath })
    return v.map((e) => e[ELEMENT])
  }

  click(el) {
    return this.cmd('POST', `/element/${el}/click`, {})
  }

  text(el) {
    return this.cmd('GET', `/element/${el}/text`)
  }

  async enabled(el) {
    return this.cmd('GET', `/element/${el}/enabled`)
  }

  /** The page's visible text. */
  bodyText() {
    return this.exec('return document.body.innerText')
  }

  /** A button by its exact visible text (or aria-label), once it is enabled. */
  async button(name, timeoutMs = 20000) {
    const q = JSON.stringify(name)
    const xp = `//button[normalize-space(.)=${q} or @aria-label=${q}]`
    return until(
      `the button "${name}"`,
      async () => {
        const [el] = await this.findAll(xp)
        return el && (await this.enabled(el)) ? el : null
      },
      timeoutMs
    )
  }

  /** Wait for the body text to match @p re; returns the match. */
  waitText(re, timeoutMs = 20000) {
    return until(`text ${re}`, async () => (await this.bodyText()).match(re), timeoutMs)
  }
}

/** XPath string literal for @p s (one without both quote kinds). */
export const xq = (s) => JSON.stringify(s)
