import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { createReaderBrowser } from './dsh-plugin-stealth-reader/lib/reader-browser.js'

// Logic unit fixtures only: no Electron/browser launch and no real login/state.
const site = { id: 'one', url: 'https://books.example/catalog', origin: 'https://books.example' }
const other = { id: 'two', url: 'https://other.example/', origin: 'https://other.example' }
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture(extra = {}) {
  const guests = [], acquired = [], released = [], callbacks = new Map(), states = []
  const container = { children: [], appendChild(g) { this.children.push(g); g.parent = this } }
  class Guest {
    constructor() { this.attrs = {}; this.style = {}; this.listeners = new Map(); this.url = ''; this.loads = []; this.exec = []; this.removed = false }
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'src') this.url = v }
    addEventListener(k, v) { const list = this.listeners.get(k) || []; list.push(v); this.listeners.set(k, list) }
    removeEventListener(k, v) { this.listeners.set(k, (this.listeners.get(k) || []).filter(item => item !== v)) }
    emit(k, e = {}) { for (const fn of [...(this.listeners.get(k) || [])]) fn(e) }
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(g => g !== this) }
    async loadURL(value) { this.loads.push(value); this.url = value }
    getURL() { return this.url }
    canGoBack() { return true }
    canGoForward() { return false }
    goBack() { this.back = true }
    goForward() { this.forward = true }
    reload() { this.reloaded = true }
    setZoomFactor(factor) { this.zoom = factor }
    executeJavaScript(code, gesture) { this.exec.push({ code, gesture }); return Promise.resolve({ url: this.url, html: '<html><body>safe</body></html>' }) }
  }
  const bridge = {
    async acquire(key) { acquired.push(key); return { partition: 'memory-' + key, lease: 'lease-' + acquired.length } },
    async release(lease) { released.push(lease) },
    onOpenRequested(lease, fn) { callbacks.set(lease, fn); return () => callbacks.delete(lease) },
    ...extra.bridge,
  }
  const win = { location: { protocol: 'dsh-app:', hostname: 'app' }, crypto: webcrypto,
    dshDesktop: { protocolVersion: 1, browser: bridge } }
  const document = { createElement(tag) { assert.equal(tag, 'webview'); const g = new Guest(); guests.push(g); return g } }
  const api = createReaderBrowser({ window: win, document, onState(s) { states.push(s) }, timeoutMs: 45, fetchTimeoutMs: 20, ...extra.options })
  return { api, win, bridge, guests, acquired, released, callbacks, states, container,
    async ready(s = site) { api.mount(container); await api.open(s); const g = guests.at(-1); g.emit('dom-ready'); await tick(); return g } }
}
const rejects = (promise, code) => assert.rejects(promise, err => err.code === code && err.message === code)

test('Web, missing bridge, wrong origin and unsupported protocol are disabled', async () => {
  for (const window of [{ location: { protocol: 'http:', hostname: '127.0.0.1' } },
    { location: { protocol: 'dsh-app:', hostname: 'other' } },
    { location: { protocol: 'dsh-app:', hostname: 'app' }, dshDesktop: { protocolVersion: 2, browser: {} } }]) {
    const api = createReaderBrowser({ window, document: {} })
    assert.equal(api.supported, false)
    await rejects(api.open(site), 'browserUnsupported')
    await api.dispose()
  }
})

test('lease bootstrap attributes and first dom-ready navigation; same site stays live', async () => {
  const f = fixture(); f.api.mount(f.container); await f.api.open(site)
  const g = f.guests[0]
  assert.equal(f.api.supported, true)
  assert.deepEqual(g.loads, [])
  assert.equal(g.attrs.name, 'lease-1')
  assert.equal(g.attrs.src, 'about:blank#lease-1')
  assert.equal(g.attrs.allowpopups, '')
  assert.equal(g.attrs.preload, undefined)
  assert.equal(g.attrs.webpreferences, 'nodeIntegration=no,contextIsolation=yes,sandbox=yes,webSecurity=yes')
  g.emit('dom-ready'); await tick()
  assert.deepEqual(g.loads, [site.url])
  g.emit('dom-ready'); await tick(); assert.equal(g.loads.length, 1)
  await f.api.open(site); assert.equal(f.guests.length, 1)
  await f.api.back(); await f.api.forward(); await f.api.reload()
  assert.ok(g.back && g.forward && g.reloaded)
  assert.throws(() => f.api.mount({ appendChild() {} }), { code: 'browserMountConflict' })
  await f.api.dispose()
  assert.deepEqual(f.released, ['lease-1']); assert.equal(f.callbacks.size, 0)
  assert.equal(g.removed, true)
  assert.ok([...g.listeners.values()].every(list => list.length === 0))
})

test('different sites destroy prior guests; revisit reuses key, forget rotates it', async () => {
  const f = fixture(); const g = await f.ready()
  const first = f.acquired[0]
  assert.match(first, /^stealth-reader:one:/)
  await f.api.open(other)
  assert.ok(g.removed); assert.deepEqual(f.released, ['lease-1'])
  assert.notEqual(first, f.acquired[1])
  await f.api.open(site); assert.equal(first, f.acquired[2])
  await f.api.forget(site.id)
  await rejects(f.api.capture(), 'browserRequired')
  await f.api.open(site); assert.notEqual(first, f.acquired[3])
  await f.api.dispose()
  assert.equal(f.released.length, 4)
})

test('safe navigation and popup forwarding; third-party login is browse-only', async () => {
  const f = fixture(); const g = await f.ready()
  for (const target of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:secret@books.example/', 'data:text/html,hi']) await rejects(f.api.navigate(target), 'browserInvalidURL')
  await rejects(f.api.navigate('http://login.example/'), 'browserUnsafeLoginURL')
  f.callbacks.get('lease-1')('https://login.example/signin?token=SECRET#secret')
  await tick(); assert.equal(g.url, 'https://login.example/signin?token=SECRET#secret')
  g.emit('did-navigate'); g.emit('did-stop-loading')
  assert.equal(f.api.getState().url, 'https://login.example/signin')
  await rejects(f.api.capture(), 'browserCaptureDenied')
  await rejects(f.api.fetchPage(site, site.url), 'browserCaptureDenied')
  // A site is fitted as it opens, and the measurement is one fixed program
  // that only asks the page for its width. Nothing that reads the page's text
  // may run here.
  const readers = g.exec.filter(entry => !/scrollWidth/.test(entry.code))
  assert.deepEqual(readers, [], 'a capture ran a script that reads the page')
  f.callbacks.get('lease-1')('javascript:bad()'); await tick()
  assert.equal(f.api.getState().error, 'browserInvalidURL')
  assert.ok(!JSON.stringify(f.states).includes('SECRET'))
  await f.api.dispose()
})

test('fetch requires a live same-site guest; guards execJS and bounds output', async () => {
  const f = fixture()
  await rejects(f.api.fetchPage(site, site.url), 'browserRequired')
  const g = await f.ready()
  await rejects(f.api.fetchPage(other, site.url), 'browserWrongSite')
  await rejects(f.api.fetchPage(site, 'https://other.example/chapter'), 'browserCaptureDenied')
  await rejects(f.api.fetchPage(site, 'https://u:p@books.example/'), 'browserInvalidURL')
  await rejects(f.api.fetchPage(site, site.url + '?access_token=secret'), 'browserSensitiveURL')
  g.executeJavaScript = undefined
  await rejects(f.api.capture(), 'browserCaptureUnsupported')
  g.executeJavaScript = () => ({ url: site.url, html: 'x'.repeat(700001) })
  await rejects(f.api.capture(), 'browserInvalidSnapshot')
  g.executeJavaScript = () => ({ url: other.url, html: 'x' })
  await rejects(f.api.capture(), 'browserInvalidSnapshot')
  g.executeJavaScript = () => Promise.reject(new Error('SECRET body cookie URL'))
  await rejects(f.api.capture(), 'browserCaptureFailed')
  assert.ok(!JSON.stringify(f.states).includes('SECRET'))
  await f.api.dispose()
})

test('fixed guest program receives JSON data, never evaluates target code', async () => {
  const f = fixture(); const g = await f.ready()
  const input = 'https://books.example/chapter/%22)%3BglobalThis.INJECTED%3Dtrue%3B%2F%2F?chapter=1'
  await f.api.fetchPage(site, input)
  assert.equal(g.exec.length, 1); assert.equal(g.exec[0].gesture, false)
  assert.match(g.exec[0].code, /credentials: 'same-origin', redirect: 'error'/)
  assert.match(g.exec[0].code, /controller\.abort\(\)/)
  assert.doesNotMatch(g.exec[0].code, /document\.cookie|localStorage|sessionStorage|\beval\(|new Function/)
  // Compile and run with only the minimum context: it must fail safely at URL
  // validation rather than execute data from the URL as JavaScript.
  const context = vm.createContext({ URL, location: { href: other.url, origin: other.origin } })
  await assert.rejects(vm.runInContext(g.exec[0].code, context), /origin/)
  assert.equal(context.INJECTED, undefined)
  await f.api.dispose()
})

// Tiny DOM model to execute the shipped fixed sanitizer, not a browser/visual
// simulation. It only implements the tree/attribute APIs used by that program.
function documentFixture() {
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  class Element {
    constructor(tag, attrs = {}, children = []) { this.tagName = tag.toUpperCase(); this.map = { ...attrs }; this.children = children; for (const child of children) if (typeof child === 'object') child.parent = this }
    get attributes() { return Object.entries(this.map).map(([name, value]) => ({ name, value })) }
    setAttribute(key, value) { this.map[key] = value }
    getAttribute(key) { return this.map[key] ?? null }
    hasAttribute(key) { return Object.hasOwn(this.map, key) }
    removeAttribute(key) { delete this.map[key] }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this) }
    querySelectorAll(selector) {
      const tags = selector.toUpperCase().split(','), found = []
      for (const node of this.children) if (node instanceof Element) { if (selector === '*' || tags.includes(node.tagName)) found.push(node); found.push(...node.querySelectorAll(selector)) }
      return found
    }
    cloneNode() { return new Element(this.tagName, this.map, this.children.map(child => child instanceof Element ? child.cloneNode() : child)) }
    get innerHTML() { return this.children.map(child => child instanceof Element ? child.outerHTML : escape(child)).join('') }
    get outerHTML() { return '<' + this.tagName.toLowerCase() + Object.entries(this.map).map(([k, v]) => ' ' + k + '="' + escape(v) + '"').join('') + '>' + this.innerHTML + '</' + this.tagName.toLowerCase() + '>' }
  }
  const body = new Element('body', { id: 'chapter', 'data-session': 'SECRET' }, [
    new Element('form', {}, [new Element('input', { value: 'PASSWORD' }), 'TOKEN']),
    new Element('script', {}, ['SCRIPT_SECRET']),
    new Element('meta', { content: 'META_SECRET' }),
    new Element('div', { hidden: '' }, ['HIDDEN_SECRET']),
    new Element('p', { id: 'content', class: 'story main', onclick: 'alert(1)', 'data-token': 'ATTR_SECRET' }, ['Story text']),
    new Element('a', { href: '/chapter?cid=12&token=LINK_SECRET&name=PRIVATE#secret', class: 'chapter-link' }, [new Element('span', { style: 'color:red' }, ['Next chapter'])]),
    new Element('a', { href: 'https://outside.example/?secret=OUTSIDE' }, ['external']),
  ])
  return { title: 'Book & chapter', body, createTreeWalker() { return { nextNode() { return false } } } }
}

test('fixed capture sanitizer removes forms/hidden data/attributes, keeps chapter selectors and nested anchor text', async () => {
  const f = fixture(); const g = await f.ready(); await f.api.capture()
  const document = documentFixture()
  const context = vm.createContext({ URL, document, location: { href: site.url + '?token=PAGE_SECRET', origin: site.origin } })
  const result = await vm.runInContext(g.exec[0].code, context)
  assert.equal(result.url, site.url)
  assert.match(result.html, /<title>Book &amp; chapter<\/title>/)
  assert.match(result.html, /id="content" class="story main"/)
  assert.match(result.html, /href="https:\/\/books.example\/chapter\?cid=12"/)
  assert.match(result.html, /<span>Next chapter<\/span>/)
  assert.doesNotMatch(result.html, /SECRET|PASSWORD|TOKEN|PRIVATE|onclick|data-session|hidden|<form|<script|<meta/)
  assert.doesNotMatch(result.html, /href="https:\/\/outside/)
  document.body.map.hidden = ''
  await assert.rejects(vm.runInContext(g.exec[0].code, context), /hidden/)
  await f.api.dispose()
})

test('fixed fetch program uses abort, rejects redirects/type/size and cleans parsed HTML', async () => {
  const f = fixture(); const g = await f.ready(); await f.api.fetchPage(site, '/chapter?cid=12')
  const code = g.exec[0].code, document = documentFixture(), calls = []
  const response = { ok: true, redirected: false, url: site.origin + '/chapter?cid=12',
    headers: new Map([['content-type', 'text/html']]), body: { getReader() { let read = false; return {
      async read() { if (read) return { done: true }; read = true; return { done: false, value: new TextEncoder().encode('<html>fixture</html>') } }, async cancel() {},
    } } } }
  const context = vm.createContext({ URL, AbortController, TextDecoder, setTimeout, clearTimeout, document,
    location: { href: site.url, origin: site.origin }, DOMParser: class { parseFromString() { return documentFixture() } },
    async fetch(target, config) { calls.push({ target, config }); return response },
  })
  const result = await vm.runInContext(code, context)
  assert.equal(result.url, site.origin + '/chapter?cid=12')
  assert.match(result.html, /Story text/); assert.doesNotMatch(result.html, /SECRET|PASSWORD|TOKEN/)
  assert.equal(calls[0].config.credentials, 'same-origin'); assert.equal(calls[0].config.redirect, 'error')
  assert.equal(calls[0].config.signal.aborted, true)
  response.redirected = true
  await assert.rejects(vm.runInContext(code, context), /response/)
  response.redirected = false; response.headers.set('content-type', 'application/json')
  await assert.rejects(vm.runInContext(code, context), /response/)
  response.headers.set('content-type', 'text/html'); response.headers.set('content-length', '99999999')
  await assert.rejects(vm.runInContext(code, context), /size/)
  response.headers.delete('content-length')
  context.fetch = async (_, config) => new Promise((resolve, reject) => config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  await assert.rejects(vm.runInContext(code, context), /aborted/)
  await f.api.dispose()
})

test('execution timeout, no reentry and navigation/dispose discard late results', async () => {
  const f = fixture(); const g = await f.ready(); const result = deferred()
  g.executeJavaScript = () => result.promise
  const capture = f.api.capture()
  await rejects(f.api.capture(), 'browserBusy')
  await rejects(capture, 'browserExecutionTimeout')
  result.resolve({ url: site.url, html: 'late' }); await tick()
  const result2 = deferred(); g.executeJavaScript = () => result2.promise
  const capture2 = f.api.capture(); await tick()
  await f.api.navigate('/next')
  await rejects(capture2, 'browserCancelled')
  result2.resolve({ url: site.url, html: 'late2' }); await tick()
  const result3 = deferred(); g.executeJavaScript = () => result3.promise
  const capture3 = f.api.capture(); await tick()
  await f.api.dispose(); await rejects(capture3, 'browserCancelled')
  result3.resolve({ url: site.url, html: 'late3' }); await tick()
  await rejects(f.api.open(site), 'browserDisposed')
})

test('ensureAndFetch opens a site that was never opened, then reads one page', async () => {
  const f = fixture()
  f.api.mount(f.container)
  const pending = f.api.ensureAndFetch(site, site.origin + '/chapter?cid=12')
  // The guest is created asynchronously; let open() publish it first.
  await tick()
  const guest = f.guests.at(-1)
  if (guest === undefined) throw new Error('the site was never opened')
  guest.emit('dom-ready')
  // dom-ready makes the helper load the site itself, so the page the guest
  // ends on is set after that first navigation, the way a real site works.
  await tick()
  guest.url = site.origin + '/chapter?cid=12'
  const page = await pending
  assert.equal(page.url, site.origin + '/chapter?cid=12')
  assert.ok(typeof page.html === 'string')
  assert.deepEqual(f.acquired.length, 1)
})

test('ensureAndFetch reuses the guest already open for the same site', async () => {
  const f = fixture()
  await f.ready()
  const before = f.acquired.length
  const guest = f.guests.at(-1)
  const pending = f.api.ensureAndFetch(site, site.origin + '/chapter?cid=7')
  await tick()
  guest.url = site.origin + '/chapter?cid=7'
  await pending
  assert.deepEqual(f.acquired.length, before)
})



test('dispose and superseding open release acquisitions that complete late', async () => {
  const delayed = deferred(), f = fixture({ bridge: { acquire() { return delayed.promise } } })
  f.api.mount(f.container)
  const opening = f.api.open(site); await tick()
  const rejected = rejects(opening, 'browserCancelled')
  const disposal = f.api.dispose()
  delayed.resolve({ lease: 'late-lease', partition: 'late-partition' })
  await rejected; await disposal
  assert.deepEqual(f.released, ['late-lease']); assert.equal(f.guests.length, 0)

  const late = deferred(), s = fixture()
  s.bridge.acquire = async key => { s.acquired.push(key); if (s.acquired.length === 1) return late.promise; return { lease: 'second', partition: 'memory-second' } }
  s.api.mount(s.container)
  const first = s.api.open(site); await tick()
  const firstRejected = rejects(first, 'browserCancelled')
  await s.api.open(other)
  late.resolve({ lease: 'first', partition: 'memory-first' })
  await firstRejected
  assert.deepEqual(s.released, ['first']); assert.equal(s.guests.length, 1)
  await s.api.dispose(); assert.deepEqual(s.released, ['first', 'second'])
})

test('acquire/attach/release errors expose only safe codes, no raw messages', async () => {
  const f = fixture({ bridge: { async acquire() { throw new Error('SECRET') } } }); f.api.mount(f.container)
  await rejects(f.api.open(site), 'browserAcquireFailed')
  assert.ok(!JSON.stringify(f.states).includes('SECRET')); await f.api.dispose()
  const s = fixture({ bridge: { async release() { throw new Error('SECRET') } } }); await s.ready()
  await rejects(s.api.dispose(), 'browserReleaseFailed')
  assert.ok(!JSON.stringify(s.states).includes('SECRET'))
})


test('a site is fitted as soon as it opens, without being asked', async () => {
  const f = fixture(); const g = await f.ready()
  // Opening a site asks for the fit: a page built for a wide screen is cut
  // off in this pane, and reading it by scrolling sideways is not reading.
  assert.equal(f.api.getState().fitWidth, true, 'opening a site did not ask for a fit')
  assert.equal(f.api.getState().zoom, 1, 'a fresh site did not start at its own size')
  // The fit is measured when the page stops loading, so a page that arrives
  // late is fitted too, and the request is not consumed by the first attempt.
  let asked = 0
  g.executeJavaScript = code => {
    assert.ok(code.includes('scrollWidth'))
    asked += 1
    return Promise.resolve(0.6)
  }
  g.emit('did-stop-loading'); await tick(); await tick()
  assert.ok(asked > 0, 'the fit was never measured')
  assert.equal(f.api.getState().zoom, 0.6, 'the measured fit was not applied')
  assert.equal(g.zoom, 0.6, 'the guest never took the fitted size')
  // A second load measures again, because the page may be a different page.
  g.emit('did-stop-loading'); await tick(); await tick()
  assert.equal(asked, 2, 'the fit was only measured once')
  await f.api.dispose()
})

test('switching sites starts the new one at its own size and fits it', async () => {
  const f = fixture(); const g = await f.ready()
  g.emit('did-stop-loading')
  g.executeJavaScript = () => Promise.resolve(0.5)
  await f.api.fitToWidth()
  assert.equal(f.api.getState().zoom, 0.5)
  // The fit belongs to the page it was measured on: another site starts at
  // its own size and is fitted on its own, not at the last site's ratio.
  const next = await f.api.open(other)
  assert.equal(next.zoom, 1, 'the new site inherited the old ratio')
  assert.equal(next.fitWidth, true, 'the new site was not fitted')
  const g2 = f.guests.at(-1)
  g2.emit('dom-ready')
  g2.emit('did-stop-loading'); await tick(); await tick()
  assert.equal(g2.zoom, 1, 'the new site kept the old size')
  await f.api.dispose()
})

test('zoom is applied and clamped, and every site starts at its own size', async () => {
  const f = fixture(); const g = await f.ready()
  f.api.setZoom(0.7); assert.equal(g.zoom, 0.7)
  f.api.setZoom(5); assert.equal(g.zoom, 1.6)
  f.api.setZoom(0.01); assert.equal(g.zoom, 0.4)
  f.api.setZoom(0.7)
  // A fit belongs to the page it was measured on. Since every site is fitted
  // as it opens, the ratio of one site is not carried to the next: the new
  // page is measured on its own and starts at its own size.
  await f.api.open(other)
  const next = f.guests.at(-1); next.emit('dom-ready'); await tick()
  assert.equal(next.zoom, 1, 'the new site kept the other ratio')
  assert.equal(f.api.getState().zoom, 1)
  assert.equal(f.api.getState().fitWidth, true, 'the new site was not fitted')
  await f.api.dispose()
})

test('fit width measures geometry, reports actual zoom and refits after loading', async () => {
  const f = fixture(); const g = await f.ready()
  g.emit('did-stop-loading')
  g.executeJavaScript = code => {
    assert.ok(code.includes('scrollWidth'))
    assert.ok(!code.includes('innerHTML') && !code.includes('textContent'))
    return Promise.resolve(0.66)
  }
  await f.api.fitToWidth()
  assert.equal(g.zoom, 0.66)
  assert.equal(f.api.getState().fitWidth, true)
  g.executeJavaScript = () => Promise.resolve(1)
  g.emit('did-stop-loading'); await tick()
  assert.equal(g.zoom, 0.66)
  f.api.setZoom(1)
  assert.equal(f.api.getState().fitWidth, false)
  await f.api.dispose()
})

test('fit width keeps its agreed limits: sideways only, forty percent floor, never larger', async () => {
  const f = fixture(); const g = await f.ready()
  g.emit('did-stop-loading')

  // The measurement is of the width and nothing else: a page that is tall
  // is not made shorter, and a page that already fits is not enlarged.
  g.executeJavaScript = code => {
    assert.ok(code.includes('clientWidth') && code.includes('scrollWidth'))
    assert.ok(!code.includes('clientHeight') && !code.includes('scrollHeight'))
    return Promise.resolve(1)
  }
  f.api.setZoom(0.5)
  await f.api.fitToWidth()
  assert.equal(g.zoom, 0.5, 'a page that already fits must not be enlarged')
  assert.equal(f.api.getState().fitWidth, true)

  // A page twice as wide as the window is scaled to half, and never past
  // the agreed floor of forty percent, however wide it is.
  g.executeJavaScript = () => Promise.resolve(0.5)
  f.api.setZoom(1)
  await f.api.fitToWidth()
  assert.equal(g.zoom, 0.5)
  g.executeJavaScript = () => Promise.resolve(0.05)
  f.api.setZoom(1)
  await f.api.fitToWidth()
  assert.equal(g.zoom, 0.4, 'the fit must not go below forty percent')
  assert.ok(g.zoom >= 0.4)

  // The fit is measured once: a later layout of its own does not change it.
  const settled = g.zoom
  g.executeJavaScript = () => Promise.resolve(0.2)
  g.emit('dom-ready')
  await tick()
  assert.equal(g.zoom, settled, 'a late layout must not refit the page')

  await f.api.dispose()
})

test('fit width rejects stale and invalid results without disclosing page values', async () => {
  const f = fixture(); const g = await f.ready(); g.emit('did-stop-loading')
  const pending = deferred(); g.executeJavaScript = () => pending.promise
  const fitting = f.api.fitToWidth()
  f.api.setZoom(0.8); pending.resolve(0.5)
  await rejects(fitting, 'browserCancelled')
  assert.equal(g.zoom, 0.8)
  g.executeJavaScript = () => Promise.resolve('PRIVATE_PAGE_VALUE')
  await rejects(f.api.fitToWidth(), 'browserZoomFailed')
  assert.ok(!JSON.stringify(f.states).includes('PRIVATE_PAGE_VALUE'))
  await f.api.dispose()
})

test('unsupported or failed zoom cannot break initial navigation or leak guest errors', async () => {
  for (const setter of [undefined, () => { throw new Error('PRIVATE_GUEST_ERROR') }]) {
    const f = fixture(); f.api.mount(f.container); await f.api.open(site)
    const g = f.guests[0]; g.setZoomFactor = setter
    assert.doesNotThrow(() => g.emit('dom-ready'))
    await tick()
    assert.deepEqual(g.loads, [site.url])
    assert.equal(f.api.getState().error, setter ? 'browserZoomFailed' : 'browserZoomUnsupported')
    assert.ok(!JSON.stringify(f.states).includes('PRIVATE_GUEST_ERROR'))
    g.setZoomFactor = value => { g.zoom = value }
    f.api.setZoom(0.8)
    assert.equal(f.api.getState().error, null)
    assert.equal(g.zoom, 0.8)
    await f.api.dispose()
  }
})

test('fit normalizes non-Error guest rejections and clears errors on recovery', async () => {
  const f = fixture(); const g = await f.ready(); g.emit('did-stop-loading')
  for (const value of [null, undefined, 'PRIVATE_GUEST_REJECTION']) {
    g.executeJavaScript = () => Promise.reject(value)
    await rejects(f.api.fitToWidth(), 'browserZoomFailed')
    assert.equal(f.api.getState().error, 'browserZoomFailed')
  }
  assert.ok(!JSON.stringify(f.states).includes('PRIVATE_GUEST_REJECTION'))
  g.executeJavaScript = () => Promise.resolve(0.7)
  await f.api.fitToWidth()
  assert.equal(f.api.getState().error, null)
  await f.api.dispose()
})

test('same-value manual reset invalidates fitting; latest fit wins concurrent measurements', async () => {
  const f = fixture(); const g = await f.ready(); g.emit('did-stop-loading')
  const first = deferred(); g.executeJavaScript = () => first.promise
  const fitting = f.api.fitToWidth()
  f.api.setZoom(1); first.resolve(0.5)
  await rejects(fitting, 'browserCancelled')
  assert.equal(f.api.getState().zoom, 1)
  const early = deferred(), latest = deferred(); let calls = 0
  g.executeJavaScript = () => (++calls === 1 ? early.promise : latest.promise)
  const oldFit = f.api.fitToWidth(), newFit = f.api.fitToWidth()
  latest.resolve(0.8); await newFit
  early.resolve(0.5); await rejects(oldFit, 'browserCancelled')
  assert.equal(f.api.getState().zoom, 0.8)
  assert.equal(g.zoom, 0.8)
  await f.api.dispose()
})
