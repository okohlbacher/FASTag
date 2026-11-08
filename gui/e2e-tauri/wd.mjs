// A minimal W3C WebDriver client for tauri-driver (GUI-DESIGN section 9,
// layer 4). Only the handful of commands the specs need, over Node's fetch,
// so the job installs no WebdriverIO or Selenium tree.
const ELEMENT = 'element-6066-11e4-a52f-4a6976a6e3b5'

export class WebDriverError extends Error {}

// Every non-ASCII character goes as a \u escape. Dry run 42314786620: a
// script argument "Choose file\u2026" never matched the button of that exact
// text, while the same text came back intact in a response -- the request
// path through tauri-driver does not carry raw UTF-8 reliably. An escaped
// body is plain ASCII and the same JSON.
const ascii = (json) => json.replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

async function call(base, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : ascii(JSON.stringify(body))
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

  /** A WebDriver click; if the driver refuses it (not interactable, an
   *  overlay), a DOM click on the same element, so a spec fails on what the
   *  app does rather than on the driver's hit test. */
  async click(el) {
    try {
      await this.cmd('POST', `/element/${el}/click`, {})
    } catch (e) {
      if (!(e instanceof WebDriverError)) throw e
      await this.exec('arguments[0].click()', { [ELEMENT]: el })
    }
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

  /** A button by its exact visible text (or aria-label), once it is enabled
   *  and rendered: one in a hidden view (P2a shell) is not a button a user
   *  can press, as with Playwright's role queries.
   *  Matched in the page (whitespace collapsed) rather than by XPath, and a
   *  timeout lists the buttons there were, so a renamed label is plain. */
  async button(name, timeoutMs = 20000) {
    try {
      return await until(`the button "${name}"`, () => this.buttonNow(name), timeoutMs)
    } catch (e) {
      const have = await this.exec(
        "return [...document.querySelectorAll('button')].map((b) => (b.disabled ? '(disabled) ' : '') + (b.getClientRects().length ? '' : '(hidden) ') + (b.textContent || '').replace(/\\s+/g, ' ').trim() + (b.getAttribute('aria-label') ? ` [${b.getAttribute('aria-label')}]` : ''))"
      ).catch(() => [])
      throw new Error(`${e.message}; buttons on the page: ${JSON.stringify(have)}`)
    }
  }

  /** The enabled button named @p name now, or null. */
  async buttonNow(name) {
    const find = `const want = arguments[0];
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      for (const b of document.querySelectorAll('button')) {
        if ((norm(b.textContent) === want || norm(b.getAttribute('aria-label')) === want) && !b.disabled && b.getClientRects().length > 0) return b;
      }
      return null`
    const el = await this.exec(find, name)
    if (!el) return null
    // The W3C element key, or whatever single reference key the driver used.
    return el[ELEMENT] ?? Object.values(el)[0] ?? null
  }

  /** Wait for the body text to match @p re; returns the match. */
  waitText(re, timeoutMs = 20000) {
    return until(`text ${re}`, async () => (await this.bodyText()).match(re), timeoutMs)
  }
}

/** XPath string literal for @p s (one without both quote kinds). */
export const xq = (s) => JSON.stringify(s)
