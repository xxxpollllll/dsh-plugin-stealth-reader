/**
 * End-to-end check for the web-novel flow: local HTTP server, catalog page,
 * chapter page, cache reuse. Run with node.
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const bundle = './dsh-plugin-stealth-reader'
const { ReaderService } = await import(`${bundle}/lib/index.js`)
const { extractContent } = await import(`${bundle}/lib/host/extract.js`)

let requests = 0
const server = http.createServer((request, response) => {
  requests += 1
  if (request.url === '/catalog') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<html><head><title>示例小说</title></head><body>
      <div id="list">
        <ul>
          <li><a href="/c/1.html">第一章 开始</a></li>
          <li><a href="/c/2.html">第二章 继续</a></li>
        </ul>
      </div></body></html>`)
    return
  }
  if (request.url === '/c/1.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<html><head><title>第一章 开始</title></head><body>
      <div class="read">${'这是第一章的正文内容。'.repeat(20)}</div>
      <div class="comment">读者评论</div></body></html>`)
    return
  }
  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}`

const results = []
/**
 * Run one named check.
 * @param {string} name - check name
 * @param {() => void | Promise<void>} body - check body
 * @returns {Promise<void>} resolves when the check finished
 */
async function check(name, body) {
  try {
    await body()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await check('catalog page yields a chapter list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-web-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const book = await service.addWeb({ indexUrl: `${base}/catalog` })
  assert.equal(book.kind, 'web')
  assert.equal(book.chapters.length, 2)
  assert.equal(book.chapters[0].title, '第一章 开始')
  assert.equal(book.chapters[0].url, `${base}/c/1.html`)
})

await check('chapter body is extracted and then served from the disk cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-web-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const book = await service.addWeb({ indexUrl: `${base}/catalog` })
  const before = requests
  const chapter = await service.chapter({ bookId: book.id, index: 0 })
  assert.ok(chapter.text.includes('这是第一章的正文内容'))
  assert.ok(!chapter.text.includes('读者评论'))
  const afterFirst = requests
  assert.equal(afterFirst, before + 1, 'the chapter page is fetched once')
  const again = await service.chapter({ bookId: book.id, index: 0 })
  assert.equal(requests, afterFirst, 'the cached chapter makes no new request')
  assert.equal(again.text, chapter.text)
  const cacheFiles = await fs.readdir(path.join(root, 'data', 'cache'))
  assert.equal(cacheFiles.length, 1)
})

await check('a chapter page is cleaned of the site around the story', async () => {
  // A page shaped like a real novel site: navigation, a metadata line, the
  // story, a footer, and a recommendations list.
  const page = `<!DOCTYPE html><html><head><title>第1章 测试</title></head><body>
    <div id="content">
      <p>搜书 上一章 目录 下一章 加入收藏</p>
      <p>第一章 测试</p>
      <p>作者：某某 分类：玄幻 更新时间：2026-01-01</p>
      <p>这是正文的第一段，它应该留下来。</p>
      <p>这是正文的第二段，它也应该留下来。</p>
      <p>本章未完，请点击下一页继续阅读</p>
      <p>请记住本站域名 www.example.com 欢迎收藏本站</p>
      <p>热门推荐：</p>
      <p>另一本书</p>
    </div>
  </body></html>`
  const extracted = extractContent(page)
  assert.ok(extracted.text.includes('这是正文的第一段'), 'the story was dropped')
  assert.ok(extracted.text.includes('这是正文的第二段'), 'the second paragraph was dropped')
  for (const noise of ['首页', '加入书签', '作者：', '更新时间', '本章未完', '请记住本站', '热门推荐', '另一本书']) {
    assert.ok(!extracted.text.includes(noise), 'the page noise survived: ' + noise)
  }
})

await check('a page whose text is all story is left alone', async () => {
  // Nothing that looks like page furniture, so nothing is removed.
  const page = '<html><body><div id="content"><p>第一段。</p><p>第二段。</p></div></body></html>'
  const extracted = extractContent(page)
  assert.equal(extracted.text, '第一段。\n第二段。')
})

await check('a catalog listed newest-first is put back in reading order', async () => {
  // The shape a real catalog has: the newest chapter is pinned first, then
  // the book runs from chapter one.
  const links = [5, 1, 2, 3, 4].map(n => `<a href="/c/${n}.html">第${n}章 测试</a>`).join('')
  const page = `<html><body><div id="list">${links}</div></body></html>`
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-order-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    assert.equal(book.chapters.length, 5, 'the chapters were not found')
    assert.equal(book.chapters[0].title, '第1章 测试', 'the book does not open at its first chapter')
    assert.equal(book.chapters[4].title, '第5章 测试', 'the last chapter is not last')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a search-engine page title is reduced to the name of the book', async () => {
  const page = '<html><head><title>某本书小说_作者名_某本书最新章节_笔趣阁</title></head>'
    + '<body><div id="list"><a href="/1.html">第1章 甲</a><a href="/2.html">第2章 乙</a></div></body></html>'
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-title-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    assert.equal(book.title, '某本书', 'the book kept the search-engine title')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a chapter page that builds its text in the browser is reported, not cached', async () => {
  // A site that answers a request for a chapter with a placeholder page: the
  // text is built by its own JavaScript, which this reader cannot run.
  const placeholder = '<html><head><title>加载中……</title></head><body>加载中……</body></html>'
  const catalog = '<html><body><div id="list">'
    + '<a href="/c/1.html">第1章 甲</a><a href="/c/2.html">第2章 乙</a></div></body></html>'
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url.includes('/c/') ? placeholder : catalog)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-empty-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    let failed = null
    try {
      await service.chapter({ bookId: book.id, index: 0 })
    } catch (error) {
      failed = error
    }
    assert.ok(failed !== null, 'the empty page was accepted as a chapter')
    assert.equal(failed.code, 'emptyChapter', 'the failure was not named')
    // Nothing was cached, so a later attempt can still succeed.
    const cacheDir = path.join(root, 'data', 'cache')
    let cached = []
    try { cached = await fs.readdir(cacheDir) } catch { cached = [] }
    assert.equal(cached.length, 0, 'the empty page was cached')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a catalog whose chapters carry no number is still read', async () => {
  // Some sites title their chapters with words only. The links that share the
  // catalog's own shape are the chapters.
  const chapters = ['开端', '相遇', '别离', '重逢', '终局']
    .map((name, at) => `<a href="/read/9/${at + 1}.html">${name}</a>`).join('')
  const page = '<html><body><div class="menu"><a href="/">首页</a><a href="/top">排行</a></div>'
    + `<div class="list">${chapters}</div></body></html>`
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(page)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-shape-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/9/` })
    assert.equal(book.chapters.length, 5, 'the chapters were not found by shape')
    assert.equal(book.chapters[0].title, '开端', 'the first chapter is wrong')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a web chapter is fetched again once its copy is old', async () => {
  // A serial is written after it is published, so an old copy must not be
  // the answer forever.
  const PAD = '这是一段足够长的正文，用来跨过空页面的门槛，让这一章像真实的一章。'
  let served = '第一版正文，这是最初写下的内容，后面作者会修改它。' + PAD
  let hits = 0
  const catalog = '<html><body><div id="list">'
    + '<a href="/c/1.html">第1章 甲</a><a href="/c/2.html">第2章 乙</a></div></body></html>'
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url.includes('/c/')) {
      hits += 1
      response.end(`<html><body><div id="content"><p>${served}</p></div></body></html>`)
      return
    }
    response.end(catalog)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-ttl-'))
  const dataRoot = path.join(root, 'data')
  const service = new ReaderService({ root: dataRoot })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    const first = await service.chapter({ bookId: book.id, index: 0 })
    assert.ok(first.text.includes('第一版正文'), 'the first read was wrong')
    assert.equal(hits, 1, 'the chapter was not fetched once')
    // A second read inside the window is served from the copy.
    await service.chapter({ bookId: book.id, index: 0 })
    assert.equal(hits, 1, 'the fresh copy was not used')
    // Age the copy past the window, the way a day of reading would.
    const cacheDir = path.join(dataRoot, 'cache')
    const files = await fs.readdir(cacheDir)
    for (const file of files) {
      const path_ = path.join(cacheDir, file)
      const entry = JSON.parse(await fs.readFile(path_, 'utf8'))
      entry.fetchedAt = Date.now() - 48 * 60 * 60 * 1000
      await fs.writeFile(path_, JSON.stringify(entry), 'utf8')
    }
    // The author changed the chapter, and the old copy is not trusted.
    served = '第二版正文，作者后来改成了这个样子。' + PAD
    const again = await service.chapter({ bookId: book.id, index: 0 })
    assert.ok(again.text.includes('第二版正文'), 'the old copy was served as the answer')
    assert.equal(hits, 2, 'the chapter was not fetched again')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('an old copy is still readable when the site cannot be reached', async () => {
  const catalog = '<html><body><div id="list">'
    + '<a href="/c/1.html">第1章 甲</a><a href="/c/2.html">第2章 乙</a></div></body></html>'
  let down = false
  const server = http.createServer((request, response) => {
    if (down) {
      response.writeHead(503)
      response.end('')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url.includes('/c/')) {
      response.end('<html><body><div id="content"><p>这段正文在站点下线之后仍然应该能读到，因为之前读过。'
        + '这是一段足够长的正文，用来跨过空页面的门槛，让这一章像真实的一章。</p></div></body></html>')
      return
    }
    response.end(catalog)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-stale-'))
  const dataRoot = path.join(root, 'data')
  const service = new ReaderService({ root: dataRoot })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    const first = await service.chapter({ bookId: book.id, index: 0 })
    assert.ok(first.text.includes('这段正文'), 'the first read was wrong')
    // Age the copy and take the site down.
    const cacheDir = path.join(dataRoot, 'cache')
    for (const file of await fs.readdir(cacheDir)) {
      const path_ = path.join(cacheDir, file)
      const entry = JSON.parse(await fs.readFile(path_, 'utf8'))
      entry.fetchedAt = Date.now() - 48 * 60 * 60 * 1000
      await fs.writeFile(path_, JSON.stringify(entry), 'utf8')
    }
    down = true
    const again = await service.chapter({ bookId: book.id, index: 0 })
    assert.ok(again.text.includes('这段正文'), 'the old copy was thrown away')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a chapter title written for a search engine does not enter the text', async () => {
  // The page title is the chapter name, then the book, then the site. Only
  // the name is the heading, and the heading is not part of the text.
  const page = '<html><head><title>第1章 甲_某本书_玄幻小说_某站</title></head>'
    + '<body><div id="content"><p>某本书 第1章 甲</p>'
    + '<p>这是正文的第一段，它应该留下来，而且它足够长，能跨过空页面的门槛。</p>'
    + '<p>这是正文的第二段，它也应该留下来，同样足够长，让这一页像真实的一章。</p></div></body></html>'
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url.includes('/c/')) {
      response.end(page)
      return
    }
    response.end('<html><body><div id="list">'
      + '<a href="/c/1.html">第1章 甲</a><a href="/c/2.html">第2章 乙</a></div></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-heading-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    const chapter = await service.chapter({ bookId: book.id, index: 0 })
    const first = chapter.text.split('\n')[0]
    // The heading line is dropped, so the text opens on the story.
    assert.ok(first.startsWith('这是正文的第一段'), 'the heading stayed in the text: ' + first)
    assert.ok(!chapter.text.includes('某站'), 'the site name stayed in the text')
    assert.ok(!chapter.text.includes('玄幻小说'), 'the category stayed in the text')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a search-engine title repeated inside the text is dropped', async () => {
  // Some pages repeat their own title inside the content block, written for
  // a search engine. That line is a heading, not text.
  const page = '<html><head><title>第1章 甲_某本书_玄幻小说_某站</title></head><body><div id="content">'
    + '<p>第1章 甲_某本书_玄幻小说_某站</p>'
    + '<p>这是正文的第一段，它应该留下来，而且它足够长，能跨过空页面的门槛。</p>'
    + '<p>这是正文的第二段，它也应该留下来，同样足够长，让这一页像真实的一章。</p></div></body></html>'
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url.includes('/c/')) {
      response.end(page)
      return
    }
    response.end('<html><body><div id="list">'
      + '<a href="/c/1.html">第1章 甲</a><a href="/c/2.html">第2章 乙</a></div></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-seo-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    const chapter = await service.chapter({ bookId: book.id, index: 0 })
    const first = chapter.text.split('\n')[0]
    assert.ok(first.startsWith('这是正文的第一段'), 'the search title stayed in the text: ' + first)
    assert.ok(!chapter.text.includes('某站'), 'the site name stayed in the text')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('any page of a book will do, not just the catalog', async () => {
  // A chapter page carries a link back to its table of contents and a handful
  // of "recommended" links that look like chapters. Pasting a chapter page is
  // what a reader does, so the catalog is found from it.
  const chapters = []
  for (let n = 1; n <= 30; n += 1) chapters.push(`<a href="/c/${n}.html">第${n}章 甲</a>`)
  const catalog = `<html><body><div id="list">${chapters.join('')}</div></body></html>`
  const chapterPage = '<html><body>'
    + '<a href="/book/1/">目录</a>'
    + '<div id="content"><p>' + '这一章的正文字数足够多，让阅读器认得出它是一章而不是一个空页。'.repeat(3) + '</p></div>'
    + '<div class="rec">'
    + [1, 2, 3, 4, 5].map(n => `<a href="/other/${n}.html">第${n}章 别的书</a>`).join('')
    + '</div></body></html>'
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/book/1/') {
      response.end(catalog)
      return
    }
    if (request.url.startsWith('/c/')) {
      response.end(chapterPage)
      return
    }
    response.end('<html><body>没有</body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-anypage-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    // The reader pastes a chapter page, not the catalog.
    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/c/12.html` })
    assert.equal(book.chapters.length, 30, 'the catalog was not found from the chapter page')
    assert.equal(book.chapters[0].title, '第1章 甲', 'the first chapter is wrong')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('a global sign-in cookie is refused and never sent to any site', async () => {
  // The old design kept one pasted Cookie and sent it to whatever URL was
  // fetched. That is a cross-site credential leak, so the setting is refused
  // and an anonymous fetch must never carry a Cookie header.
  let sawCookie = null
  const chapters = []
  for (let n = 1; n <= 25; n += 1) chapters.push(`<a href="/c/${n}.html">第${n}章 甲</a>`)
  const catalog = `<html><body><div id="list">${chapters.join('')}</div></body></html>`
  const server = http.createServer((request, response) => {
    if (typeof request.headers.cookie === 'string') sawCookie = request.headers.cookie
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url.startsWith('/c/')) {
      response.end('<html><body><div id="content"><p>' + '这一段正文足够长，让阅读器认得出它是一章。'.repeat(3) + '</p></div></body></html>')
      return
    }
    response.end(catalog)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-nocookie-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  try {
    let refused = null
    try {
      await service.updateSettings({ patch: { siteCookie: 'signed=yes' } })
    } catch (error) {
      refused = error
    }
    assert.ok(refused !== null, 'the global cookie setting was accepted')
    assert.equal(refused.code, 'unsafeCredential', 'the refusal code changed')

    const book = await service.addWeb({ indexUrl: `http://127.0.0.1:${port}/book/1/` })
    await service.chapter({ bookId: book.id, index: 0 })
    assert.equal(sawCookie, null, 'a Cookie header reached the site')

    // A stored legacy value is scrubbed on load and never projected back.
    const settings = (await service.snapshot()).settings
    assert.ok(!('siteCookie' in settings), 'the snapshot still exposes a cookie field')
    assert.ok(!JSON.stringify(await service.handle({ action: 'state' })).includes('siteCookie'),
      'the route state still mentions the cookie field')
  } finally {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

await check('route handler answers JSON for a valid action', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-web-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const handler = request => service.handle(request)
  const result = await handler({ action: 'state' })
  assert.equal(result.ok, true)
  assert.ok(Array.isArray(result.books))
  const body = JSON.stringify(result)
  assert.ok(body.includes('"ok":true'))
})

await check('ad-hoc fetch shows one page without adding a catalog', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-web-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const chapter = await service.fetchAdhoc({ url: `${base}/c/1.html` })
  assert.equal(chapter.total, 1)
  assert.ok(chapter.text.includes('这是第一章的正文内容'))
  const snapshot = await service.snapshot()
  assert.equal(snapshot.books.length, 1)
  assert.equal(snapshot.current.bookId, chapter.bookId)
})

server.close()
console.log(results.join('\n'))
const failed = results.filter(line => line.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
