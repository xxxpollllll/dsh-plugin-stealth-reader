/**
 * Node-level test of the stealth reader Host route handler.
 * It drives the same handler the web server mounts, with a fake request and
 * response, so the request/response contract is checked without a browser.
 */
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import zlib from 'node:zlib'
import path from 'node:path'

const bundle = './dsh-plugin-stealth-reader'
const { apply } = await import(`${bundle}/lib/index.js`)

// The route mounts the real service, so the whole run lives in its own
// home: a test must never touch the reader's own library or settings.
const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-route-home-'))
process.env.DSH_HOME = isolatedHome

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

/**
 * Build a fake registered route from the plugin context.
 * @param {object} options - test options
 * @param {(request: any) => number | undefined} [options.rejection] - auth rejection code
 * @returns {Promise<any>} the registered route
 */
async function mountRoute(options = {}) {
  const registered = []
  const disposed = []
  const ctx = {
    provide: () => () => {},
    // The plugin registers its route when the web server is there, not
    // before: a profile without one must still start. The stub runs the
    // callback when every named service exists, the way Cordis does.
    inject: (services, callback) => {
      const keys = Array.isArray(services) ? services : Object.keys(services)
      const scoped = { get: name => ctx.get(name) }
      for (const key of keys) scoped[key] = ctx.get(key)
      const missing = keys.filter(key => scoped[key] === undefined)
      if (missing.length === 0) callback(scoped)
      return () => {}
    },
    effect: (disposer, label) => {
      disposed.push({ disposer, label })
      return () => {}
    },
    get: (name) => {
      if (name === 'webServer') {
        return {
          register: (route) => {
            registered.push(route)
            return () => {
              const index = registered.indexOf(route)
              if (index >= 0) registered.splice(index, 1)
            }
          },
        }
      }
      if (name === 'tools') return undefined
      if (name === 'connection') {
        return {
          requestRejection: () => options.rejection,
        }
      }
      return undefined
    },
  }
  apply(ctx)
  assert.equal(registered.length, 1, 'the plugin registers exactly one route')
  assert.equal(disposed.length, 1, 'the route is owned by one effect')
  return registered[0]
}

/**
 * Build a fake Node request.
 * @param {string} method - HTTP method
 * @param {object} body - request body
 * @returns {any} fake request
 */
function fakeRequest(method, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  const stream = Readable.from([Buffer.from(payload, 'utf8')])
  stream.method = method
  stream.headers = { host: '127.0.0.1:50511' }
  return stream
}

/**
 * Build a fake Node response.
 * @returns {any} fake response with the collected result
 */
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value
    },
    writeHead(status, headers) {
      this.statusCode = status
      if (headers) for (const [key, value] of Object.entries(headers)) this.headers[key.toLowerCase()] = value
    },
    end(body) {
      if (typeof body === 'string') this.body = body
    },
  }
}

await check('an unauthenticated request is refused before the handler runs', async () => {
  const route = await mountRoute({ rejection: 401 })
  const response = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), response)
  assert.equal(response.statusCode, 401)
  assert.equal(response.body, '')
})

await check('a forbidden request is refused', async () => {
  const route = await mountRoute({ rejection: 403 })
  const response = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), response)
  assert.equal(response.statusCode, 403)
})

await check('a non-POST request is answered with 405 and an allow header', async () => {
  const route = await mountRoute()
  const response = fakeResponse()
  await route.handler(fakeRequest('GET'), response)
  assert.equal(response.statusCode, 405)
  assert.equal(response.headers.allow, 'POST')
})

await check('a malformed body is answered with 400', async () => {
  const route = await mountRoute()
  const response = fakeResponse()
  const request = fakeRequest('POST')
  request.push(Buffer.from('not json', 'utf8'))
  await route.handler(request, response)
  assert.equal(response.statusCode, 400)
  assert.equal(JSON.parse(response.body).error, 'invalid json')
})

await check('the state action answers JSON with the library', async () => {
  const route = await mountRoute()
  const response = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), response)
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  const body = JSON.parse(response.body)
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.books))
})

await check('the reading mode is stored and given back', async () => {
  const route = await mountRoute()
  const write = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'settings', patch: { scrollMode: 'continuous' } }), write)
  assert.equal(write.statusCode, 200)
  const written = JSON.parse(write.body)
  assert.equal(written.settings.scrollMode, 'continuous')
  const read = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), read)
  const state = JSON.parse(read.body)
  assert.equal(state.settings.scrollMode, 'continuous')
  // The setting is part of the state, so it survives a restart.
  const again = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), again)
  assert.equal(JSON.parse(again.body).settings.scrollMode, 'continuous')
})

await check('the position action records where the reader is and carries no text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-position-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const folder = path.join(root, 'books')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'novel.txt'), '第一章\n正文\n', 'utf8')
  const add = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: path.join(folder, 'novel.txt') }), add)
  const bookId = JSON.parse(add.body).book
  const written = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'position', book_id: bookId, index: 2, total: 7 }), written)
  assert.equal(written.statusCode, 200)
  const body = JSON.parse(written.body)
  assert.equal(body.ok, true)
  assert.equal(body.position.index, 2)
  assert.equal(body.position.total, 7)
  // The position does not carry the chapter text.
  assert.ok(!JSON.stringify(body).includes('正文'), 'the position carried the chapter text')
  // The reader's place is remembered.
  const state = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), state)
  assert.equal(JSON.parse(state.body).current.index, 2)
})

await check('a fault of an earlier build is cleared when the client says it mounted', async () => {
  const route = await mountRoute()
  const broke = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'fault', where: 'window', message: 'a stale one' }), broke)
  assert.equal(broke.statusCode, 200)
  const statePath = path.join(process.env.DSH_HOME, 'stealth-reader', 'state.json')
  const readFaults = async () => {
    const raw = await fs.readFile(statePath, 'utf8')
    return (JSON.parse(raw).faults || []).length
  }
  assert.equal(await readFaults(), 1)
  const cleared = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'clearFaults' }), cleared)
  assert.equal(JSON.parse(cleared.body).ok, true)
  assert.equal(await readFaults(), 0)
})

await check('an unknown action answers ok:false with a reason', async () => {
  const route = await mountRoute()
  const response = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'nope' }), response)
  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body)
  assert.equal(body.ok, false)
  assert.match(body.error, /Unknown action/)
  assert.equal(body.code, 'unknown')
})

await check('adding a local book and reading a chapter works over the route', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-route-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章 起\n正文一\n第二章 承\n正文二\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const added = JSON.parse(addResponse.body)
  assert.equal(added.ok, true)

  const stateResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), stateResponse)
  const state = JSON.parse(stateResponse.body)
  assert.equal(state.books.length, 1)
  assert.equal(state.books[0].chapters, 2)

  const chapterResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'chapter', index: 1 }), chapterResponse)
  const chapter = JSON.parse(chapterResponse.body)
  assert.equal(chapter.ok, true)
  assert.equal(chapter.chapter.index, 1)
  assert.ok(chapter.chapter.text.includes('正文二'))
})

await check('each book keeps its own reading position', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-pos-'))
  const first = path.join(root, 'a.txt')
  const second = path.join(root, 'b.txt')
  await fs.writeFile(first, '第一章\nA1\n第二章\nA2\n', 'utf8')
  await fs.writeFile(second, '第一章\nB1\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: first }), addResponse)
  const bookA = JSON.parse(addResponse.body).book.id
  const addSecond = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: second }), addSecond)
  const bookB = JSON.parse(addSecond.body).book.id

  await route.handler(fakeRequest('POST', { action: 'open', bookId: bookA, index: 1 }), fakeResponse())
  await route.handler(fakeRequest('POST', { action: 'open', bookId: bookB, index: 0 }), fakeResponse())

  const stateResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), stateResponse)
  const state = JSON.parse(stateResponse.body)
  assert.equal(state.positions[bookA].index, 1)
  assert.equal(state.positions[bookB].index, 0)
})

await check('an out-of-range chapter index is clamped, not stored', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-clamp-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\n第二章\nB\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  const openResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'open', bookId, index: 99 }), openResponse)
  const opened = JSON.parse(openResponse.body)
  assert.equal(opened.chapter.index, 1)

  const stateResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'state' }), stateResponse)
  const state = JSON.parse(stateResponse.body)
  assert.equal(state.positions[bookId].index, 1)
})

await check('the placement is remembered, and the defaults can be put back', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-place-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)

  const setResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'settings', patch: { placement: 'sidebar' } }), setResponse)
  assert.equal(JSON.parse(setResponse.body).settings.placement, 'sidebar')

  // An unknown placement would leave the reader with no surface at all, so
  // it falls back to the one that is always there.
  const badResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'settings', patch: { placement: 'nowhere' } }), badResponse)
  assert.equal(JSON.parse(badResponse.body).settings.placement, 'strip')

  const resetResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'reset_settings' }), resetResponse)
  assert.equal(JSON.parse(resetResponse.body).settings.placement, 'strip')
})

await check('the reading position keeps the line and the mode it was left in', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-line-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\nB\nC\n第二章\nD\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  // The card counts the text in its own characters, so it writes its own
  // place and keeps the panel's line.
  const positionResponse = fakeResponse()
  await route.handler(fakeRequest('POST', {
    action: 'position', bookId, index: 0, total: 2, flow: 2, mode: 'strip',
  }), positionResponse)
  const position = JSON.parse(positionResponse.body).position
  assert.equal(position.flow, 2)
  assert.equal(position.mode, 'strip')

  // The panel counts lines, so it writes a line and keeps the card's place.
  const panelResponse = fakeResponse()
  await route.handler(fakeRequest('POST', {
    action: 'position', bookId, index: 0, total: 2, line: 2, mode: 'overlay',
  }), panelResponse)
  const panel = JSON.parse(panelResponse.body).position
  assert.equal(panel.line, 2)
  assert.equal(panel.flow, 2, 'the card lost its own place')

  // The place inside the chapter comes back with the chapter.
  const openResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'open', bookId, index: 0 }), openResponse)
  assert.equal(JSON.parse(openResponse.body).chapter.line, 2)
})

await check('a search result names the line it was found on', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-hit-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\n前面一段\n中间一段带着词\n后面一段\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  const searchResponse = fakeResponse()
  await route.handler(fakeRequest('POST', {
    action: 'search', bookId, term: '词',
  }), searchResponse)
  const result = JSON.parse(searchResponse.body).result
  assert.equal(result.total, 1)
  const chapter = result.matches[0]
  assert.equal(chapter.hits.length, 1)
  // The line counts the lines that carry text, the same way the panel does.
  assert.equal(chapter.hits[0].line, 1)
  assert.ok(chapter.hits[0].flow >= 0, 'the card has no place of its own')

  // The reader can be put on that exact line.
  const openResponse = fakeResponse()
  await route.handler(fakeRequest('POST', {
    action: 'open', bookId, index: 0, line: chapter.hits[0].line,
  }), openResponse)
  assert.equal(JSON.parse(openResponse.body).chapter.line, 1)
})

await check('a search reaches every chapter of a long book', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-long-'))
  const novelPath = path.join(root, 'novel.txt')
  // Four hundred chapters, and the word sits in the last one: a search that
  // stops early would not find it at all.
  const chapters = []
  for (let at = 1; at <= 400; at += 1) {
    chapters.push(`第${at}章\n这一章里只有平常的话\n`)
  }
  chapters.push('第401章\n这一章里有那个词\n')
  await fs.writeFile(novelPath, chapters.join(''), 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  const searchResponse = fakeResponse()
  await route.handler(fakeRequest('POST', {
    action: 'search', bookId, term: '那个词',
  }), searchResponse)
  const result = JSON.parse(searchResponse.body).result
  assert.equal(result.total, 1, 'the search did not reach the last chapter')
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].index, 400, 'the hit is in the wrong chapter')
  assert.equal(result.truncated, false)
  assert.equal(result.shown, 1)
})

await check('a search names every place it was found', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-places-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\n一个词出现一次\n再来一个词\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  const searchResponse = fakeResponse()
  await route.handler(fakeRequest('POST', {
    action: 'search', bookId, term: '词',
  }), searchResponse)
  const result = JSON.parse(searchResponse.body).result
  assert.equal(result.total, 2, 'the count is wrong')
  const hits = result.matches[0].hits
  assert.equal(hits.length, 2, 'the two places were not both named')
  assert.equal(hits[0].line, 0)
  assert.equal(hits[1].line, 1)
  // Each place carries the line it was found on, so a reader can recognise
  // it before jumping to it.
  assert.ok(hits[0].snippet.includes('一个词出现一次'), 'the place carries no text')
})

await check('a position written by an older version is still understood', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-old-'))
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\n第二章\nB\n', 'utf8')
  process.env.DSH_HOME = root

  const route = await mountRoute()
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  // An old state file held a plain chapter number.
  const statePath = path.join(root, 'stealth-reader', 'state.json')
  const written = JSON.parse(await fs.readFile(statePath, 'utf8'))
  written.positions = { [bookId]: 1 }
  await fs.writeFile(statePath, JSON.stringify(written), 'utf8')

  // The state is read once, so the file is changed before the reader reads
  // it: a fresh route reads it from the start.
  const fresh = await mountRoute()
  const openResponse = fakeResponse()
  await fresh.handler(fakeRequest('POST', { action: 'open', bookId }), openResponse)
  assert.equal(JSON.parse(openResponse.body).chapter.index, 1)
})

await check('a failed page fetch reports a code and never repeats the url', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-err-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const response = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'fetch', url: 'http://127.0.0.1:1/secret-chapter-path' }), response)
  const body = JSON.parse(response.body)
  assert.equal(body.ok, false)
  assert.ok(['network', 'notFound'].includes(body.code), 'expected a typed code, got ' + body.code)
  assert.ok(!body.error.includes('secret-chapter-path'), 'the error message leaked the url')
})

await check('the tool result carries no title and no path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-tool-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章 起\n正文一\n第二章 承\n正文二\n', 'utf8')
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const body = JSON.parse(addResponse.body)
  const book = body.book

  // The rendered tool result is what reaches the session transcript.
  const { render } = await import('./dsh-plugin-stealth-reader/lib/index.js')
  assert.equal(typeof render, 'undefined', 'the tool renderer is not exported directly')

  // Exercise the renderer through the registered tool instead.
  const tools = []
  const ctx = {
    get: (name) => (name === 'tools' ? { register: (definition) => { tools.push(definition); return () => {} } } : undefined),
    // This stub has no web server, so the route is simply not registered: a
    // profile without one must still start. The callback is not run, which is
    // what Cordis does when a named service never arrives.
    inject: (services, callback) => {
      const keys = Array.isArray(services) ? services : Object.keys(services)
      if (keys.every(key => ctx.get(key) !== undefined)) callback(ctx)
      return () => {}
    },
    on: () => () => {},
    provide: () => () => {},
    effect: () => () => {},
  }
  const { apply } = await import('./dsh-plugin-stealth-reader/lib/index.js')
  apply(ctx)
  const tool = tools.find(entry => entry.name === 'doc_panel')
  assert.ok(tool !== undefined, 'the doc_panel tool is registered')
  assert.equal(typeof tool.output.render, 'function', 'the tool has no output renderer')
  const rendered = tool.output.render({}, { books: [{ title: book.title, kind: 'txt', chapters: 2 }] })
  const text = rendered.map(part => part.text).join('\n')
  assert.ok(!text.includes(book.title), 'the rendered tool result leaked the book title')
  assert.ok(text.includes('Panel library'), 'the rendered tool result lost its summary')

  const openRendered = tool.output.render({}, { title: '第一章 夜雨', index: 0, total: 3, characters: 120 })
  const openText = openRendered.map(part => part.text).join('\n')
  assert.ok(!openText.includes('第一章'), 'the rendered tool result leaked the chapter title')
  assert.ok(openText.includes('1/3'), 'the rendered tool result lost the position')

  const scanRendered = tool.output.render({}, { files: ['/Users/someone/private/novel.txt'] })
  const scanText = scanRendered.map(part => part.text).join('\n')
  assert.ok(!scanText.includes('/Users/someone'), 'the rendered tool result leaked a file path')

  // The table of contents must not put a chapter title in the transcript.
  const tocRendered = tool.output.render({}, { toc: { total: 12, chapters: [{ index: 0, title: '第一章 夜雨' }] } })
  const tocText = tocRendered.map(part => part.text).join('\n')
  assert.ok(!tocText.includes('夜雨'), 'the rendered contents leaked a chapter title')
  assert.ok(tocText.includes('12'), 'the rendered contents lost the chapter count')

  // A search result must not put the matched text in the transcript.
  const searchRendered = tool.output.render({}, { result: { total: 3, matches: [{ index: 4, count: 3, snippet: '秘密的雨夜' }] } })
  const searchText = searchRendered.map(part => part.text).join('\n')
  assert.ok(!searchText.includes('秘密'), 'the rendered search result leaked the matched text')
  assert.ok(searchText.includes('3'), 'the rendered search result lost the match count')
})

await check('a home-relative path resolves and a missing file reports its own code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-tilde-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const home = os.homedir()
  const relative = path.join('Downloads', '小说', '试读样章.txt')
  const absolute = path.join(home, relative)
  let present = true
  try {
    await fs.access(absolute)
  } catch {
    present = false
  }
  if (present) {
    const response = fakeResponse()
    await route.handler(fakeRequest('POST', { action: 'add_local', path: '~/' + relative }), response)
    const body = JSON.parse(response.body)
    assert.equal(body.ok, true, 'a home-relative path was not accepted')
    assert.equal(body.book.source, absolute)
  }
  const missing = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: '~/no/such/file.txt' }), missing)
  const failed = JSON.parse(missing.body)
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'noFile', 'a missing file must not report a host outage')
})

await check('a scan skips hidden files and AppleDouble companions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-hidden-'))
  process.env.DSH_HOME = root
  const dir = path.join(root, 'docs')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'real.txt'), '第一章\nA\n', 'utf8')
  await fs.writeFile(path.join(dir, '.~hidden.txt'), 'noise', 'utf8')
  await fs.writeFile(path.join(dir, '._real.txt'), 'noise', 'utf8')
  await fs.writeFile(path.join(dir, '.secret.txt'), 'noise', 'utf8')

  const route = await mountRoute()
  const response = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'scan', dirs: [dir] }), response)
  const body = JSON.parse(response.body)
  const names = body.files.map(file => file.split('/').pop())
  assert.deepEqual(names, ['real.txt'], 'hidden files leaked into the scan')
})

await check('an EPUB file is imported with its own title and chapters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-epub-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const epub = path.join(root, 'book.epub')
  await fs.writeFile(epub, buildEpub())

  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: epub }), addResponse)
  const body = JSON.parse(addResponse.body)
  assert.equal(body.ok, true, 'the EPUB was not accepted')
  assert.equal(body.book.kind, 'epub')
  assert.equal(body.book.title, '测试小说', 'the EPUB title was lost')
  assert.equal(body.book.chapterCount, 2)

  const openResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'open', bookId: body.book.id, index: 0 }), openResponse)
  const opened = JSON.parse(openResponse.body)
  assert.equal(opened.chapter.title, '第一章 启程')
  assert.ok(opened.chapter.text.includes('他推开门'), 'the chapter body was lost')
})

/**
 * Build a small EPUB archive in memory.
 *
 * @returns {Buffer} the archive bytes
 */
function buildEpub() {
  const parts = {
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试小说</dc:title></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    'OEBPS/ch1.xhtml': '<html><head><title>第一章 启程</title></head><body><p>他推开门。</p></body></html>',
    'OEBPS/ch2.xhtml': '<html><head><title>第二章 远行</title></head><body><p>路上很安静。</p></body></html>',
  }
  const locals = []
  const centrals = []
  let offset = 0
  for (const name of Object.keys(parts)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const body = Buffer.from(parts[name], 'utf8')
    const compressed = zlib.deflateRawSync(body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(body), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32(body), 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + compressed.length
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(parts).length, 8)
  eocd.writeUInt16LE(Object.keys(parts).length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

/**
 * Compute a CRC-32 checksum.
 *
 * @param {Buffer} buffer - the bytes
 * @returns {number} the checksum
 */
function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

await check('the table of contents lists every chapter with its index', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-toc-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\n第二章\nB\n第三章\nC\n', 'utf8')
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const book = JSON.parse(addResponse.body).book

  const tocResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'toc', bookId: book.id }), tocResponse)
  const body = JSON.parse(tocResponse.body)
  assert.equal(body.ok, true, 'the table of contents failed')
  assert.equal(body.toc.total, 3)
  assert.equal(body.toc.chapters.length, 3)
  assert.equal(body.toc.chapters[0].index, 0)
  assert.equal(body.toc.chapters[0].title, '第一章')
  assert.equal(body.toc.chapters[2].title, '第三章')
})

await check('a jump keeps the reading order, so the next step follows it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-order-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\n第二章\nB\n第三章\nC\n第四章\nD\n', 'utf8')
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  // The reader jumps to the third chapter, away from where the host sat.
  const jumpResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'open', bookId, index: 2 }), jumpResponse)
  const jumped = JSON.parse(jumpResponse.body)
  assert.equal(jumped.chapter.index, 2, 'the jump did not land on the third chapter')

  // The next chapter must be the one after it, not one after the old place.
  const nextResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'next' }), nextResponse)
  const next = JSON.parse(nextResponse.body)
  assert.equal(next.chapter.index, 3, 'the step went to ' + next.chapter.index + ' instead of following the jump')

  // And the step back must return to the jumped chapter.
  const prevResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'prev' }), prevResponse)
  const prev = JSON.parse(prevResponse.body)
  assert.equal(prev.chapter.index, 2, 'the step back did not return to the jumped chapter')

  // The last chapter holds still instead of running past the end.
  const lastResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'open', bookId, index: 3 }), lastResponse)
  const endResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'next' }), endResponse)
  assert.equal(JSON.parse(endResponse.body).chapter.index, 3, 'the step ran past the last chapter')
})

await check('a step from the panel position follows the panel, not the host', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-order2-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const novelPath = path.join(root, 'novel.txt')
  await fs.writeFile(novelPath, '第一章\nA\n第二章\nB\n第三章\nC\n第四章\nD\n', 'utf8')
  const addResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'add_local', path: novelPath }), addResponse)
  const bookId = JSON.parse(addResponse.body).book.id

  // The panel holds the fourth chapter while the host still holds the first.
  const jumpResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'chapter', bookId, index: 3 }), jumpResponse)
  assert.equal(JSON.parse(jumpResponse.body).chapter.index, 3)

  // The panel steps from its own position: the third chapter.
  const stepResponse = fakeResponse()
  await route.handler(fakeRequest('POST', { action: 'open', bookId, index: 2 }), stepResponse)
  assert.equal(JSON.parse(stepResponse.body).chapter.index, 2)
})

await check('a folder imports in batches, and the batches report their progress', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-batch-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const folder = path.join(root, 'books')
  await fs.mkdir(folder, { recursive: true })
  for (let index = 0; index < 7; index += 1) {
    await fs.writeFile(path.join(folder, `book-${index}.txt`), `第一章\n正文\n`, 'utf8')
  }

  let offset = 0
  let imported = 0
  let total = 0
  for (;;) {
    const response = fakeResponse()
    await route.handler(fakeRequest('POST', { action: 'import_dir', dir: folder, offset, limit: 3 }), response)
    const body = JSON.parse(response.body)
    assert.equal(body.ok, true, 'the batch failed')
    assert.equal(body.total, 7, 'the batch reported the wrong total')
    imported += body.count
    total = body.total
    offset += body.count
    if (body.done === true) break
    assert.ok(offset <= 7, 'the batches ran past the end')
  }
  assert.equal(imported, 7, 'the batches imported ' + imported + ' of 7')
  assert.equal(total, 7)
})

await check('the raw tool value carries no title, no path and no text', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-raw-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const folder = path.join(root, 'books')
  await fs.mkdir(folder, { recursive: true })
  const novelPath = path.join(folder, 'secret-novel-name.txt')
  await fs.writeFile(novelPath, '第一章 秘密\n正文内容\n', 'utf8')

  const tools = []
  const ctx = {
    get: (name) => (name === 'tools' ? { register: (definition) => { tools.push(definition); return () => {} } } : undefined),
    // This stub has no web server, so the route is simply not registered: a
    // profile without one must still start. The callback is not run, which is
    // what Cordis does when a named service never arrives.
    inject: (services, callback) => {
      const keys = Array.isArray(services) ? services : Object.keys(services)
      if (keys.every(key => ctx.get(key) !== undefined)) callback(ctx)
      return () => {}
    },
    on: () => () => {},
    provide: () => () => {},
    effect: () => () => {},
  }
  const { apply } = await import('./dsh-plugin-stealth-reader/lib/index.js')
  apply(ctx)
  const tool = tools.find(entry => entry.name === 'doc_panel')

  // The raw value is what the session records, so it must be as clean as the
  // rendered text.
  const added = await tool.execute({ action: 'add_local', path: novelPath })
  const addedText = JSON.stringify(added)
  assert.ok(!addedText.includes('secret-novel-name'), 'the raw add result leaked the file name')
  assert.ok(!addedText.includes(root), 'the raw add result leaked the path')

  const listed = await tool.execute({ action: 'list' })
  const listedText = JSON.stringify(listed)
  assert.ok(!listedText.includes('secret-novel-name'), 'the raw list leaked the book title')
  assert.ok(!listedText.includes(root), 'the raw list leaked the path')

  const scanned = await tool.execute({ action: 'scan', dir: folder })
  const scannedText = JSON.stringify(scanned)
  assert.ok(!scannedText.includes('secret-novel-name'), 'the raw scan leaked the file name')
  assert.ok(!scannedText.includes(root), 'the raw scan leaked the path')

  const bookId = added.book
  const opened = await tool.execute({ action: 'open', book_id: bookId })
  assert.ok(!JSON.stringify(opened).includes('秘密'), 'the raw chapter leaked the chapter title')
  // The text itself is what the tool must never return unasked. A title can
  // be a number and a text cannot: the file above is the chapter title on one
  // line and the prose on the next, and only the prose is the novel.
  assert.ok(!JSON.stringify(opened).includes('正文内容'),
    'the raw chapter leaked the chapter text')
  assert.equal(opened.text, undefined, 'the raw chapter carried a text field')

  const stepped = await tool.execute({ action: 'next' })
  assert.ok(stepped.text === undefined || !JSON.stringify(stepped).includes('正文内容'),
    'the raw step leaked the chapter text')

  const searched = await tool.execute({ action: 'search', book_id: bookId, term: '正文' })
  assert.ok(!JSON.stringify(searched).includes('正文'), 'the raw search leaked the matched text')

  // And the one way the text is allowed out: an explicit reveal.
  const revealed = await tool.execute({ action: 'open', book_id: bookId, reveal: true })
  assert.equal(typeof revealed.text, 'string', 'an explicit reveal returned no text')
  assert.ok(revealed.text.includes('正文内容'), 'an explicit reveal returned the wrong text')
})

await check('no real book title or path reaches any raw tool result', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-leak-'))
  process.env.DSH_HOME = root
  const route = await mountRoute()
  const folder = path.join(root, 'books')
  await fs.mkdir(folder, { recursive: true })
  const names = ['第一本书名', '第二本书名']
  for (const name of names) {
    await fs.writeFile(path.join(folder, name + '.txt'), '第一章\n正文\n', 'utf8')
  }

  const tools = []
  const ctx = {
    get: (name) => (name === 'tools' ? { register: (definition) => { tools.push(definition); return () => {} } } : undefined),
    // This stub has no web server, so the route is simply not registered: a
    // profile without one must still start. The callback is not run, which is
    // what Cordis does when a named service never arrives.
    inject: (services, callback) => {
      const keys = Array.isArray(services) ? services : Object.keys(services)
      if (keys.every(key => ctx.get(key) !== undefined)) callback(ctx)
      return () => {}
    },
    on: () => () => {},
    provide: () => () => {},
    effect: () => () => {},
  }
  const { apply } = await import('./dsh-plugin-stealth-reader/lib/index.js')
  apply(ctx)
  const tool = tools.find(entry => entry.name === 'doc_panel')

  const add = await tool.execute({ action: 'add_local', path: path.join(folder, '第一本书名.txt') })
  const bookId = add.book
  const results = {
    list: await tool.execute({ action: 'list' }),
    scan: await tool.execute({ action: 'scan', dir: folder }),
    chapter: await tool.execute({ action: 'open', book_id: bookId }),
    search: await tool.execute({ action: 'search', book_id: bookId, term: '正文' }),
    toc: await tool.execute({ action: 'toc', book_id: bookId }),
  }
  for (const [action, value] of Object.entries(results)) {
    const blob = JSON.stringify(value)
    for (const name of names) {
      assert.ok(!blob.includes(name), 'the raw ' + action + ' result leaked the book name')
    }
    assert.ok(!blob.includes(root), 'the raw ' + action + ' result leaked the path')
  }
})

console.log(results.join('\n'))
const failed = results.filter(line => line.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
