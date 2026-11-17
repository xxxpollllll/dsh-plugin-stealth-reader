/* Drive the real-React, real-DOM harness in a real browser.
 *
 * The browser is the one installed on this machine; nothing is downloaded and
 * no test reaches the network. The page is served from this workspace, the
 * client bundle is the one that ships, and the verdict is read back over the
 * DevTools protocol.
 *
 * Usage: node verify/dom/run-dom-test.mjs
 */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const workspace = join(here, '..', '..')
/* The client half the browser loads. By default it is the one in the
 * workspace; `--packed=<tarball>` loads the one in a packed tarball, so the
 * checks run against what would really be published. */
const packedAt = (process.argv.find(argument => argument.startsWith('--packed=')) || '').slice('--packed='.length)
const bundle = packedAt === ''
  ? join(workspace, 'dsh-plugin-stealth-reader', 'lib', 'client.js')
  : join(workspace, 'verify', 'dom', 'packed', 'client.js')

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium-1223/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
]

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

/* The theme of the host, read from the installed application.
 *
 * The reader takes its colours from the host's own tokens, so the only way to
 * know that it still does is to read those tokens where they live. The
 * application is a package archive, so the file is read with the
 * application's own binary, which understands the archive. When the
 * application is not installed the theme is unknown, and the checks that need
 * it say so instead of passing for the wrong reason. */
const DSH_APP = process.env.DSH_APP || '/Applications/DeepSeek Harness.app'
const DSH_BINARY = join(DSH_APP, 'Contents', 'MacOS', 'DeepSeek Harness')
const DSH_THEME_DIR = join(
  DSH_APP, 'Contents', 'Resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai',
  'dsh-client-ui-theme', 'src', 'styles',
)
/* The theme lives in two files: the alias layer and the base layer. The
 * radius and the font live in the base one, so both are read. */
const DSH_THEME_FILES = ['design-platform.css', 'base.css']

function hostTheme() {
  if (!existsSync(DSH_BINARY)) return null
  const script = `const fs=require('node:fs');const files=${JSON.stringify(DSH_THEME_FILES)};`
    + 'const dir=' + JSON.stringify(DSH_THEME_DIR) + ';'
    + 'let out="";for(const name of files){const p=dir+"/"+name;'
    + 'if(fs.existsSync(p)){out+=fs.readFileSync(p,"utf8")+" ";}}process.stdout.write(out)'
  const result = spawnSync(DSH_BINARY, ['-e', script], {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.length === 0) return null
  return result.stdout
}

const HOST_THEME = hostTheme()

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('no Chrome executable was found')
}

/* The reader's own route, answered with synthetic chapters only. */
const SYNTHETIC = [
  '这是用于测试的第一行合成文本。',
  '这是第二行合成文本，用于测量折行。',
  '这是第三行合成文本，长度稍长一些，用来检查卡片里的裁剪行为。',
  '这是第四行合成文本。',
  '这是第五行合成文本，让整章比卡片能显示的行数更长。',
  '这是第六行合成文本，用来检查翻页之后页面仍然是完整的。',
  '这是第七行合成文本，指针移开再回来之后文本不会少掉一行。',
  '这是第八行合成文本，测量用的合成章节到这里结束。',
]
const SETTINGS = {
  placement: 'strip',
  skin: 'plain',
  scrollMode: 'chapter',
  fontSize: 15,
  lineHeight: 1.9,
  cardFoldable: true,
  cardFoldMode: 'auto',
  cardFoldedShape: 'mark',
  cardFoldDelay: 80,
  linesPerPage: 3,
}
const chapter = index => ({
  bookId: 'synthetic-book',
  bookTitle: '合成书',
  index: index || 0,
  total: 3,
  title: '合成章节',
  text: SYNTHETIC.join('\n'),
})
/* A reader who has just installed the plugin has no books at all, and the
 * first thing they see is the empty state. `?empty=1` serves that library. */
const EMPTY_LIBRARY = process.argv.includes('--empty')
/* A host that does not answer: the reader has to say so, and not wait for
 * ever. `?broken=1` breaks the route. */
const BROKEN_ROUTE = process.argv.includes('--broken')
/* The book page opens its first saved site by itself, so the scenario needs
 * sites to open. Their addresses are synthetic and never leave the process. */
const WITH_SITES = process.argv.includes('--sites')
function answer(action, payload) {
  if (action === 'state') {
    return {
      current: EMPTY_LIBRARY ? null : { bookId: 'synthetic-book', index: 0 },
      books: EMPTY_LIBRARY ? [] : [{ id: 'synthetic-book', title: '合成书', kind: 'local' }],
      // Two saved sites, so the book page has something to open by itself.
      // The addresses are for this test only and never leave the process.
      sites: WITH_SITES
        ? [
          { id: 'site-one', title: '合成书站一', origin: 'https://one.example', url: 'https://one.example/' },
          { id: 'site-two', title: '合成书站二', origin: 'https://two.example', url: 'https://two.example/' },
        ]
        : [],
      settings: SETTINGS,
      positions: {},
    }
  }
  if (action === 'chapter') return { chapter: chapter(payload.index) }
  if (action === 'open') return { chapter: chapter(payload.index) }
  if (action === 'toc') return { chapters: [{ index: 0, title: '合成章节' }], current: 0 }
  if (action === 'search') return { places: [] }
  if (action === 'settings') return { settings: SETTINGS }
  return {}
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (request.method === 'POST' && url.pathname === '/stealth-reader/api') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { body = {} }
    const payload = Object.assign({}, body)
    delete payload.action
    if (BROKEN_ROUTE) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        .end(JSON.stringify({ ok: false, error: 'the host did not answer' }))
      return
    }
    const result = answer(body.action, payload)
    const body2 = JSON.stringify(Object.assign({ ok: true }, result))
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(body2)
    return
  }
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204).end()
    return
  }
  if (url.pathname === '/host-tokens.css') {
    const body = HOST_THEME === null ? '/* the host theme is not available */' : HOST_THEME
    response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }).end(body)
    return
  }
  const path = url.pathname === '/' ? '/harness.html' : url.pathname
  const files = {
    '/harness.html': join(here, 'harness.html'),
    '/harness.js': join(here, 'harness.js'),
    '/loader.js': join(here, 'loader.js'),
    '/client.js': bundle,
    '/vendor/react.js': join(here, 'vendor', 'react.js'),
    '/vendor/react-dom.js': join(here, 'vendor', 'react-dom.js'),
  }
  const file = files[path]
  if (file === undefined) {
    response.writeHead(404).end('not found')
    return
  }
  try {
    const body = await readFile(file)
    response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body)
  } catch (failure) {
    response.writeHead(500).end(String(failure && failure.message))
  }
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const chrome = findChrome()
const profile = join(process.env.TMPDIR || '/tmp', `dsh-reader-dom-${process.pid}`)
const child = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--user-data-dir=' + profile,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const wsUrl = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('the browser did not report a debugging endpoint')), 30000)
  child.stderr.on('data', chunk => {
    buffer += chunk.toString()
    const match = buffer.match(/ws:\/\/[^\s]+/)
    if (match) { clearTimeout(timer); resolve(match[0]) }
  })
  child.on('exit', code => { clearTimeout(timer); reject(new Error('the browser exited with ' + code)) })
})

/* The browser-level endpoint only lists targets; the page target needs its own
 * socket, so the list is read over HTTP. */
const browserId = wsUrl.split('/').pop()
const listPort = Number(wsUrl.match(/:(\d+)\//)?.[1])
let target = null
for (let attempt = 0; attempt < 50 && target === null; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 100))
  try {
    const response = await fetch(`http://127.0.0.1:${listPort}/json/list`)
    const targets = await response.json()
    target = targets.find(item => item.type === 'page')
  } catch { /* the browser is still starting */ }
}
if (target === null) throw new Error('the browser exposed no page target')

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (entry === undefined) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('the devtools socket failed')), { once: true })
})
const send = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params: params || {} }))
})

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
/* A headless page is not focused, so the browser skips the focus events the
 * reader relies on. Focus emulation makes the page behave like a visible one. */
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
    console.error('browser error:', message.params.entry.text)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    console.error('page exception:', message.params?.exceptionDetails?.text)
  }
})
const shotAt = process.argv.find(argument => argument.startsWith('--shot='))
const shotTarget = (process.argv.find(argument => argument.startsWith('--target=')) || '').slice('--target='.length)
/* The query is built from the options that are on, so a run without one
 * option cannot leave a stray separator and ask for a page that is not
 * there. */
const pageQuery = []
if (shotAt) pageQuery.push('shot=' + (shotTarget || 'card'))
if (process.argv.includes('--dark')) pageQuery.push('theme=dark')
if (EMPTY_LIBRARY) pageQuery.push('empty=1')
if (BROKEN_ROUTE) pageQuery.push('broken=1')
if (process.argv.includes('--zh')) pageQuery.push('locale=zh')
if (WITH_SITES) pageQuery.push('sites=1')
await send('Page.navigate', {
  url: `http://127.0.0.1:${port}/harness.html${pageQuery.length > 0 ? '?' + pageQuery.join('&') : ''}`,
})

let done = false
let pictured = false
for (let attempt = 0; attempt < 100 && !done; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 200))
  /* The picture is taken while the run is going on, so every check still
   * happens and the card is on screen when it is photographed. */
  if (shotAt && !pictured) {
    const ready = await send('Runtime.evaluate', {
      expression: 'window.__SHOT_READY__ === true ? JSON.stringify(window.__CARD_BOX__ || null) : ""',
      returnByValue: true,
    })
    const value = ready.result && ready.result.value
    if (typeof value === 'string' && value !== '') {
      pictured = true
      const box = JSON.parse(value)
      if (box !== null) {
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: box.width,
            height: box.height,
            scale: 2,
          },
        })
        await writeFile(shotAt.slice('--shot='.length), Buffer.from(shot.data, 'base64'))
        console.log('wrote', shotAt.slice('--shot='.length))
      }
      await send('Runtime.evaluate', { expression: 'window.__SHOT_DONE__ = true' })
    }
  }
  const outcome = await send('Runtime.evaluate', {
    expression: 'window.__DONE__ === true ? JSON.stringify(window.__RESULTS__) : ""',
    returnByValue: true,
  })
  const value = outcome.result && outcome.result.value
  if (typeof value === 'string' && value !== '') done = true
}

let rows = []
if (done) {
  const outcome = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__RESULTS__)',
    returnByValue: true,
  })
  rows = JSON.parse(outcome.result.value)
} else {
  const text = await send('Runtime.evaluate', {
    expression: 'document.getElementById("results") ? document.getElementById("results").textContent : "no results"',
    returnByValue: true,
  })
  console.error('the page did not finish:', text.result && text.result.value)
}

if (process.argv.includes('--measure')) {
  const outcome = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__MEASUREMENTS__ || [])',
    returnByValue: true,
  })
  const rows = JSON.parse(outcome.result.value || '[]')
  const observed = await send('Runtime.evaluate', {
    expression: 'JSON.stringify((window.__RO__ || []).slice(-14))',
    returnByValue: true,
  })
  console.log('resize observations:', observed.result.value)
  for (const row of rows) {
    const fixed = row.children.filter(child => !child.className.includes('foot-label') && !child.className.includes('hint'))
      .reduce((sum, child) => sum + child.width, 0)
    console.log(`width ${row.width}: scroll ${row.scroll} / client ${row.client} -> overflow ${row.overflow} | fixed children ${fixed}px`)
    console.log('   ' + row.children.map(child => `${child.className.replace('sr-strip-', '')}=${child.width}`).join(' '))
  }
}

socket.close()
child.kill('SIGTERM')
server.close()

let failed = 0
for (const row of rows) {
  if (!row.ok) failed += 1
  console.log((row.ok ? 'PASS  ' : 'FAIL  ') + row.name + (row.detail ? ' :: ' + row.detail : ''))
}
console.log(`\n${rows.length - failed}/${rows.length} real-DOM checks passed`)
process.exit(failed === 0 && rows.length > 0 ? 0 : 1)
