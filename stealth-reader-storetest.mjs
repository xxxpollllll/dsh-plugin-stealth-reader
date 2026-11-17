/** Offline store/browser-contract regressions. Every service uses an isolated temp root. */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { ReaderError, ReaderService, apply } from './dsh-plugin-stealth-reader/lib/index.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-reader-storetest-'))
const originalFetch = globalThis.fetch
let tests = 0
async function check(name, run) {
  await run()
  tests += 1
  console.log(`PASS ${name}`)
}
function service(label) { return new ReaderService({ root: path.join(root, label) }) }
function rejectsCode(operation, code) { return assert.rejects(operation, error => error instanceof ReaderError && error.code === code) }
const origin = 'https://books.example'
const url = `${origin}/book/1/`
const catalog = `<html><title>测试书_站点</title><body><div id="list"><a href="1.html">第1章 开始</a><a href="2.html">第2章 继续</a><a href="https://elsewhere.example/3.html">第3章 站外</a></div></body></html>`
const prose = '这是离线测试的故事正文。'.repeat(30)
const sample = `<html><title>第1章 开始</title><div id="content"><h1>第1章 开始</h1><p>${prose}</p></div><script>document.cookie = 'MUST_NOT_RETAIN_SCRIPT'</script></html>`
const sample2 = `<html><title>第2章 继续</title><div id="content"><p>${prose}下一章。</p></div></html>`
const pages = [{ url, html: catalog }, { url: `${url}1.html`, html: sample }]
let fetchCalls = []
globalThis.fetch = async (address, options) => {
  fetchCalls.push({ address, options })
  return new Response(address === url ? catalog : sample, { status: 200 })
}

try {
  await check('legacy cookie is scrubbed on load without losing local library/positions', async () => {
    const s = service('migration')
    await fs.mkdir(s.root, { recursive: true })
    const local = { id: 'local-book', kind: 'txt', title: 'Local', source: '/synthetic/nonexistent.txt', chapterCount: 8 }
    const position = { index: 4, offset: 89, line: 5, mode: 'strip' }
    await fs.writeFile(s.statePath, JSON.stringify({ settings: { skin: 'terminal', siteCookie: 'SYNTHETIC_OLD_SECRET', otherSecret: 'DO_NOT_EXPOSE' }, siteCookie: 'TOP_LEVEL_SECRET', books: [local], current: { bookId: local.id, index: 4 }, positions: { [local.id]: position } }))
    await s.load()
    const disk = await fs.readFile(s.statePath, 'utf8')
    for (const secret of ['siteCookie', 'SYNTHETIC_OLD_SECRET', 'TOP_LEVEL_SECRET', 'otherSecret', 'DO_NOT_EXPOSE']) assert.ok(!disk.includes(secret))
    assert.deepEqual(s.state.books, [local])
    assert.deepEqual(s.state.positions[local.id], position)
    assert.deepEqual(s.state.current, { bookId: local.id, index: 4 })
    assert.equal(s.state.settings.skin, 'terminal')
    assert.equal((await fs.stat(s.statePath)).mode & 0o777, 0o600)
    assert.ok(!JSON.stringify(await s.snapshot()).includes('SECRET'))
  })

  await check('settings reject even empty/undefined legacy cookie atomically', async () => {
    const s = service('settings')
    for (const value of ['', undefined, null, 'SYNTHETIC_NEW_SECRET']) {
      await rejectsCode(() => s.updateSettings({ patch: { skin: 'changed', siteCookie: value } }), 'unsafeCredential')
      assert.equal(s.state.settings.skin, 'log')
    }
    await s.updateSettings({ patch: { fontSize: 18 } })
    s.state.settings.siteCookie = 'INJECTED_SECRET'
    s.state.siteCookie = 'TOP_SECRET'
    assert.ok(!JSON.stringify(await s.snapshot()).includes('SECRET'))
    await s.save()
    assert.ok(!Object.hasOwn(s.state.settings, 'siteCookie'))
    assert.ok(!Object.hasOwn(JSON.parse(await fs.readFile(s.statePath, 'utf8')), 'siteCookie'))
  })

  await check('forbidden credential property values are never accessed', async () => {
    const s = service('credential-getter')
    await s.load()
    Object.defineProperty(s.state.settings, 'siteCookie', { enumerable: true, configurable: true, get() { throw new Error('Credential value must never be read') } })
    assert.ok(!Object.hasOwn((await s.snapshot()).settings, 'siteCookie'))
    await s.fetchAdhoc({ url: `${origin}/getter-safe` })
    const patch = {}
    Object.defineProperty(patch, 'siteCookie', { enumerable: true, get() { throw new Error('Credential value must never be read') } })
    await rejectsCode(() => s.updateSettings({ patch }), 'unsafeCredential')
    const payload = { url: origin }
    Object.defineProperty(payload, 'cookie', { enumerable: true, get() { throw new Error('Credential value must never be read') } })
    await rejectsCode(() => s.addSite(payload), 'unsafeCredential')
  })

  await check('every existing Host web-fetch path is anonymous', async () => {
    const s = service('anonymous')
    await s.load()
    s.state.settings.siteCookie = 'NEVER_SEND_THIS'
    const start = fetchCalls.length
    const book = await s.addWeb({ indexUrl: url })
    s.state.settings.siteCookie = 'NEVER_SEND_THIS'
    await s.chapter({ bookId: book.id, index: 0 })
    await s.fetchAdhoc({ url: `${origin}/loose` })
    const calls = fetchCalls.slice(start)
    assert.ok(calls.length >= 3)
    for (const call of calls) {
      assert.equal(call.options.credentials, 'omit')
      assert.ok(!Object.keys(call.options.headers).some(key => /cookie|authorization/i.test(key)))
      assert.ok(!JSON.stringify(call).includes('NEVER_SEND_THIS'))
    }
  })

  const s = service('browser')
  let site
  let preview
  let book
  await check('sites canonicalize explicit HTTP(S), preserve path, and deduplicate fragments', async () => {
    const response = await s.handle({ action: 'site_add', url: 'HTTPS://BOOKS.EXAMPLE:443/start#part', title: '  常用站点  ' })
    assert.deepEqual(Object.keys(response.site).sort(), ['id', 'origin', 'title', 'url'])
    assert.equal(response.site.url, `${origin}/start`)
    assert.equal(response.site.title, '常用站点')
    const again = await s.handle({ action: 'site_add', url: `${origin}/start#other`, title: 'Ignored duplicate title' })
    assert.deepEqual(again.site, response.site)
    site = response.site
    assert.equal((await s.snapshot()).sites.length, 1)
    const snapshot = await s.handle({ action: 'state' })
    assert.deepEqual(snapshot.sites, [site])
  })

  await check('sites reject credentials, malformed schemes, and credential-bearing envelopes', async () => {
    for (const bad of ['https://alice:secret@books.example/', 'https://@books.example/', 'javascript:alert(1)', 'file:///tmp/book', 'books.example', 'https://books.example\\@evil.example/', 'https://books.example/with space']) {
      await rejectsCode(() => s.addSite({ url: bad }), 'invalidSite')
    }
    for (const key of ['cookie', 'headers', 'authorization', 'storage']) await rejectsCode(() => s.addSite({ url: origin, [key]: 'SYNTHETIC_SECRET' }), 'unsafeCredential')
    assert.equal((await s.snapshot()).sites.length, 1)
  })

  await check('browser preview stages catalog then sample without fetching or changing library', async () => {
    const before = fetchCalls.length
    const chapterUrl = `${url}2.html`
    const chapterHtml = `<title>第2章 继续</title><div id="content">${prose}</div><a href="${url}">返回目录</a><a href="/unrelated/1.html">第1章 推荐</a>`
    const initial = { url: chapterUrl, html: chapterHtml }
    const first = await s.handle({ action: 'web_preview', siteId: site.id, url: chapterUrl, pages: [initial] })
    assert.deepEqual(first.needs, { kind: 'catalog', url })
    const second = await s.handle({ action: 'web_preview', siteId: site.id, url: chapterUrl, pages: [initial, pages[0]] })
    assert.deepEqual(second.needs, { kind: 'sample', url: `${url}1.html` })
    const third = await s.handle({ action: 'web_preview', siteId: site.id, url: chapterUrl, pages: [initial, ...pages] })
    preview = third.preview
    assert.equal(preview.title, '测试书')
    assert.equal(preview.chapterCount, 2)
    assert.equal(preview.sampleChapters.length, 2)
    assert.ok(preview.sample.includes(prose.slice(0, 30)))
    assert.equal(s.state.books.length, 0)
    assert.equal(s.state.current, null)
    assert.equal(fetchCalls.length, before)
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url }), 'browserRequired')
    assert.equal(fetchCalls.length, before)
  })

  await check('preview rejects cross-origin, credentials, oversized/malformed pages and chapter recommendations', async () => {
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url: 'https://other.example/', pages: [] }), 'siteOrigin')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, pages: [{ url: 'https://other.example/', html: '' }] }), 'siteOrigin')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, pages: [{ url, html: '', headers: {} }] }), 'unsafeCredential')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, cookie: 'fake', pages: [] }), 'unsafeCredential')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, pages: Array(4).fill(pages[0]) }), 'invalidPages')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, pages: [{ url, html: 'x'.repeat(1.5 * 1024 * 1024) }] }), 'pageTooLarge')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, pages: [pages[0], pages[0]] }), 'invalidPages')
    await rejectsCode(() => s.previewWeb({ siteId: site.id, url, pages: [{ url, html: '<title>第5章 当前章节</title><a href="1.html">第1章 推荐</a><a href="2.html">第2章 推荐</a>' }] }), 'noCatalog')
    assert.equal(s.state.books.length, 0)
  })

  await check('empty/login/paywall sample is rejected before confirming anything', async () => {
    for (const html of ['<div id="content">短文</div>', '<title>登录</title><form><input type="password"></form><p>' + prose + '</p>', '<div id="content">请先登录后阅读。' + prose + '</div>', '<div id="content">购买本章后继续阅读。' + prose + '</div>']) {
      await assert.rejects(() => s.previewWeb({ siteId: site.id, url, pages: [pages[0], { url: pages[1].url, html }] }), error => error instanceof ReaderError && ['emptyChapter', 'unreadablePage'].includes(error.code))
    }
    assert.equal(s.state.books.length, 0)
  })

  await check('confirm consumes in-memory token and preserves current book and positions', async () => {
    s.state.current = { bookId: 'previous-local', index: 7 }
    s.state.positions['previous-local'] = { index: 7, line: 42, offset: 50, mode: 'strip' }
    const beforeCurrent = structuredClone(s.state.current)
    const beforePositions = structuredClone(s.state.positions)
    book = (await s.handle({ action: 'web_confirm', previewId: preview.previewId })).book
    assert.equal(book.transport, 'browser')
    assert.equal(book.siteId, site.id)
    assert.deepEqual(s.state.current, beforeCurrent)
    assert.deepEqual(s.state.positions, beforePositions)
    await rejectsCode(() => s.confirmWeb({ previewId: preview.previewId }), 'previewExpired')
    assert.equal((await s.snapshot()).books[0].transport, 'browser')
    const disk = await fs.readFile(s.statePath, 'utf8')
    assert.ok(!disk.includes('previewId') && !disk.includes('<html>') && !disk.includes('MUST_NOT_RETAIN_SCRIPT'))
  })

  await check('a public chapter is readable without the browser, and without any credential', async () => {
    // The isolated browser only exists in the desktop window, so a Web page or
    // a site that refuses the guest must still be able to read a free chapter.
    // What must never happen is a credential riding along.
    const before = fetchCalls.length
    assert.ok((await s.chapter({ bookId: book.id, index: 0 })).text.includes(prose))
    // Chapter 0 was already stored by the browser path, so reading it again
    // must not hit the network at all. A chapter with no browser copy has to
    // be fetched anonymously and must carry no credential.
    assert.equal(fetchCalls.length, before, 'a cached chapter was fetched again')
    await s.chapter({ bookId: book.id, index: 0 })
    const anonymous = fetchCalls.slice(before)
    for (const call of anonymous) {
      const headers = (call.options && call.options.headers) || {}
      const names = Object.keys(headers).map(name => name.toLowerCase())
      assert.ok(!names.includes('cookie'), 'a Cookie header was sent to read a public chapter')
      assert.ok(!names.includes('authorization'), 'an Authorization header was sent')
      assert.equal(call.options && call.options.credentials, undefined)
    }
    // A browser copy is still preferred when one arrives, and it stays in the
    // site's own partition on disk.
    const result = await s.handle({ action: 'browser_cache', bookId: book.id, url: `${url}2.html`, html: sample2 })
    assert.ok(result.characters > 40)
    const afterCache = fetchCalls.length
    assert.ok((await s.chapter({ bookId: book.id, index: 1 })).text.includes('下一章'))
    assert.equal(fetchCalls.length, afterCache, 'a cached browser chapter was fetched again')
    const files = await fs.readdir(s.cacheDir)
    assert.ok(files.every(file => file.startsWith('browser-')))
    for (const file of files) {
      const cache = await fs.readFile(path.join(s.cacheDir, file), 'utf8')
      assert.ok(!cache.includes('<html>') && !cache.includes('MUST_NOT_RETAIN_SCRIPT'))
    }
  })

  await check('browser cache validates book membership, origin, size and readability', async () => {
    await rejectsCode(() => s.cacheBrowserPage({ bookId: book.id, url: `${origin}/not-in-book`, html: sample }), 'unknownChapter')
    await rejectsCode(() => s.cacheBrowserPage({ bookId: book.id, url: 'https://other.example/1.html', html: sample }), 'siteOrigin')
    await rejectsCode(() => s.cacheBrowserPage({ bookId: book.id, url: `${url}2.html`, html: sample, headers: {} }), 'unsafeCredential')
    await rejectsCode(() => s.cacheBrowserPage({ bookId: book.id, url: `${url}2.html`, html: 'x'.repeat(1.5 * 1024 * 1024) }), 'pageTooLarge')
    await rejectsCode(() => s.cacheBrowserPage({ bookId: book.id, url: `${url}2.html`, html: '<div id="content">请先登录' + prose + '</div>' }), 'unreadablePage')
  })

  await check('expired tokens and restart cannot confirm staged previews', async () => {
    const response = await s.previewWeb({ siteId: site.id, url, pages })
    s.previews.get(response.preview.previewId).expiresAt = 0
    await rejectsCode(() => s.confirmWeb({ previewId: response.preview.previewId }), 'previewExpired')
    const staged = await s.previewWeb({ siteId: site.id, url, pages })
    const reloaded = new ReaderService({ root: s.root })
    await rejectsCode(() => reloaded.confirmWeb({ previewId: staged.preview.previewId }), 'previewExpired')
  })

  await check('concurrent confirmations deduplicate one book without reusing a token', async () => {
    const concurrent = service('concurrent-confirm')
    const site = await concurrent.addSite({ url: origin })
    const a = (await concurrent.previewWeb({ siteId: site.id, url, pages })).preview
    const b = (await concurrent.previewWeb({ siteId: site.id, url, pages })).preview
    const results = await Promise.allSettled([
      concurrent.confirmWeb({ previewId: a.previewId }),
      concurrent.confirmWeb({ previewId: a.previewId }),
      concurrent.confirmWeb({ previewId: b.previewId }),
    ])
    assert.equal(results.filter(entry => entry.status === 'fulfilled').length, 2)
    assert.equal(results[1].reason.code, 'previewExpired')
    assert.equal(concurrent.state.books.length, 1)
    assert.equal(JSON.parse(await fs.readFile(concurrent.statePath, 'utf8')).books.length, 1)
    assert.equal(concurrent.state.current, null)
  })

  await check('stale browser cache and unrelated anonymous cache cannot grant access', async () => {
    const cached = JSON.parse(await fs.readFile(s.browserCacheFile(site.id, `${url}2.html`), 'utf8'))
    cached.fetchedAt = 0
    await fs.writeFile(s.browserCacheFile(site.id, `${url}2.html`), JSON.stringify(cached))
    const hash = (await import('node:crypto')).createHash('sha256').update(`${url}2.html`).digest('hex').slice(0, 16)
    await fs.writeFile(path.join(s.cacheDir, `${hash}.json`), JSON.stringify({ text: 'UNRELATED_ANONYMOUS_CACHE', fetchedAt: Date.now() }))
    const before = fetchCalls.length
    // A stale browser copy is no longer a dead end: the public page is read
    // again with no credential, and the stale text is only the fallback when
    // that read fails.
    const text = (await s.chapter({ bookId: book.id, index: 1 })).text
    assert.ok(text.length > 0)
    assert.ok(!text.includes('UNRELATED_ANONYMOUS_CACHE'), 'an unrelated anonymous file was served as this chapter')
    assert.ok(fetchCalls.length > before, 'the stale chapter was served without asking the site again')
    for (const call of fetchCalls.slice(before)) {
      const headers = (call.options && call.options.headers) || {}
      assert.ok(!Object.keys(headers).some(name => name.toLowerCase() === 'cookie'))
    }
  })

  await check('persisted site entries are safe allowlists and survive reload', async () => {
    const reloaded = new ReaderService({ root: s.root })
    await reloaded.load()
    assert.deepEqual((await reloaded.snapshot()).sites, [site])
    reloaded.state.sites[0].cookie = 'SYNTHETIC_IGNORED_SECRET'
    reloaded.state.sites.push({ url: 'https://user:secret@malformed.example/' })
    await reloaded.save()
    const disk = await fs.readFile(reloaded.statePath, 'utf8')
    assert.ok(!disk.includes('SYNTHETIC_IGNORED_SECRET') && !disk.includes('user:secret'))
    assert.equal(reloaded.state.sites.length, 1)
  })

  await check('site removal retains books, cache and reading positions', async () => {
    const before = structuredClone({ books: s.state.books, current: s.state.current, positions: s.state.positions })
    await s.handle({ action: 'site_remove', siteId: site.id })
    assert.equal((await s.snapshot()).sites.length, 0)
    assert.deepEqual({ books: s.state.books, current: s.state.current, positions: s.state.positions }, before)
    assert.ok((await s.chapter({ bookId: book.id, index: 0 })).text.includes(prose))
    await rejectsCode(() => s.removeSite({ siteId: 'missing' }), 'noSite')
  })

  await check('HTTP bridge serializes safe browserRequired needs', async () => {
    let handler
    let hosted
    apply({
      provide(_name, value) { hosted = value; value.root = path.join(root, 'route'); value.cacheDir = path.join(value.root, 'cache'); value.statePath = path.join(value.root, 'state.json') },
      get(key) { return key === 'webServer' ? { register(route) { handler = route.handler; return () => {} } } : undefined },
      // The route is registered when the web server is there, not before, so
      // this stub runs the callback the way Cordis does when it has arrived.
      inject(services, callback) {
        const keys = Array.isArray(services) ? services : Object.keys(services)
        const scoped = { get: key => this.get ? this.get(key) : undefined }
        for (const key of keys) scoped[key] = scoped.get(key)
        if (keys.every(key => scoped[key] !== undefined)) callback(scoped)
        return () => {}
      },
      effect() {},
    })
    await hosted.load()
    hosted.state.books = [book]
    const request = Readable.from([Buffer.from(JSON.stringify({ action: 'chapter', bookId: book.id, index: 1 }))])
    request.method = 'POST'
    request.headers = {}
    let response
    await handler(request, { setHeader() {}, end(body) { response = JSON.parse(body) } })
    // A public chapter now answers rather than demanding a browser, and the
    // route never carries a credential either way.
    assert.equal(response.ok, true)
    assert.ok(typeof response.chapter.text === 'string' && response.chapter.text.length > 0)
    assert.ok(!JSON.stringify(response).includes('cookie='))
    assert.ok(!JSON.stringify(response).includes('Cookie'))
  })
  console.log(`\n${tests} store/security checks passed. No real library or network was used.`)
} finally {
  globalThis.fetch = originalFetch
  // Guard the resolved absolute path before removing only this owned temp tree.
  assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'stealth-reader-storetest-')))
  await fs.rm(root, { recursive: true, force: true })
}
