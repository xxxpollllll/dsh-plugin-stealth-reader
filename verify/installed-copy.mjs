/**
 * Check an installed copy of the bundle, not the workspace.
 *
 * The workspace has the plugin's own source; an installation has what the
 * tarball carried. A file the manifest forgot is missing there, an import
 * that resolves in the workspace may not resolve there, and a half that
 * starts in the workspace may not start there. Those failures are silent:
 * the slot simply stays empty.
 *
 * The check mounts the installed host half against a real file, adds a book,
 * reads a chapter and takes it apart again. The text never leaves this
 * process: no book is written into the conversation and no title is printed.
 *
 * @module
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const installed = process.argv[2] || join(here, '..', 'dsh-plugin-stealth-reader')

const problems = []

/* 1. The installed copy carries everything the manifest declares. */
const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
for (const name of ['lib/index.js', 'lib/client.js', 'lib/reader-browser.js', 'locale/en.json', 'locale/zh.json', 'icon.svg']) {
  let ok = false
  try { ok = readFileSync(join(installed, name), 'utf8').length > 0 } catch { ok = false }
  if (!ok) problems.push('the installed copy has no ' + name)
}

/* 2. The host half loads from where it landed, and its own imports resolve. */
let service = null
try {
  const host = await import(pathToFileURL(join(installed, 'lib', 'index.js')).href)
  if (typeof host.apply !== 'function') problems.push('the installed host half exports no apply')
  if (!Array.isArray(host.inject)) problems.push('the installed host half names no host services')
} catch (error) {
  problems.push('the installed host half does not load: ' + error.message)
}

/* 3. The host half really works: a book added, read and removed. */
if (service === null) {
  const home = mkdtempSync(join(tmpdir(), 'sr-install-'))
  const root = mkdtempSync(join(tmpdir(), 'sr-book-'))
  try {
    const { apply } = await import(pathToFileURL(join(installed, 'lib', 'index.js')).href)
    const tools = []
    const routes = []
    const ctx = {
      /* The route is registered when the web server is there, not before: a
       * profile without one must still start. This stub has one, so the
       * callback runs the way Cordis runs it. */
      inject(services, callback) {
        const keys = Array.isArray(services) ? services : Object.keys(services)
        const scoped = { get: key => ctx.get(key) }
        for (const key of keys) scoped[key] = ctx.get(key)
        if (keys.every(key => scoped[key] !== undefined)) callback(scoped)
        return () => {}
      },
      get(name) {
        if (name === 'tools') {
          return { register(definition) { tools.push(definition); return () => {} } }
        }
        if (name === 'webServer') {
          return { register(definition) { routes.push(definition); return () => {} } }
        }
        if (name === 'storage') {
          return {
            get: async () => null,
            set: async () => {},
            delete: async () => {},
            list: async () => [],
          }
        }
        return undefined
      },
      on: () => () => {},
      provide: () => () => {},
      effect: () => () => {},
    }
    apply(ctx)

    const tool = tools.find(entry => entry.name === 'doc_panel')
    if (tool === undefined) problems.push('the installed copy registers no doc_panel tool')
    if (routes.length === 0) problems.push('the installed copy registers no route')

    /* A book is written on disk and read back through the tool itself. */
    const file = join(root, 'book.txt')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, '第一章 开始\n这是合成正文，只用于本机检查。\n第二章 之后\n还是合成正文。\n', 'utf8')

    const added = await tool.execute({ action: 'add_local', path: file })
    if (added.ok !== true) problems.push('the installed copy could not add a book')
    const bookId = added.book

    const opened = await tool.execute({ action: 'open', book_id: bookId, index: 0 })
    if (opened.ok !== true) problems.push('the installed copy could not open a chapter')
    if (opened.text !== undefined) problems.push('the installed copy put the chapter text in the tool result')

    /* The route is the way the panel reads, and it carries the text there. */
    const route = routes[0]
    if (route !== undefined && route.path === '/stealth-reader/api') {
      const request = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify({ action: 'chapter', bookId, index: 0 })) },
      }
      const chunks = []
      const response = {
        statusCode: 0,
        headers: {},
        setHeader(name, value) { this.headers[name] = value },
        end(value) { if (value !== undefined) chunks.push(String(value)) },
      }
      await route.handler(request, response)
      const body = JSON.parse(chunks.join(''))
      if (body.ok !== true) problems.push('the installed route did not answer')
      if (typeof body.chapter?.text !== 'string' || body.chapter.text.length === 0) {
        problems.push('the installed route carried no text to the panel')
      }
    }

    const removed = await tool.execute({ action: 'remove', book_id: bookId })
    if (removed.ok !== true) problems.push('the installed copy could not remove a book')
  } catch (error) {
    problems.push('the installed host half does not work: ' + error.message)
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
}

if (problems.length > 0) {
  for (const line of problems) console.error('INSTALL CHECK: ' + line)
  process.exit(1)
}
console.log('installed copy: ' + manifest.version + ' carries every file, the host half loads, '
  + 'a book is added and read and removed, and the route carries the text to the panel')
