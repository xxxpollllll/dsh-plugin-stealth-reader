/**
 * Host half of the stealth reader bundle.
 *
 * Owns the book library, the on-disk chapter cache and the agent tool. The
 * Client half owns the panel; it talks to this half over one local HTTP
 * route registered on the Harness web server, so the panel never needs a
 * cross-origin request and novel text never enters a session transcript.
 */
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractContent, parseHtml, selectAll, splitTxtChapters, textContent } from './host/extract.js'
import { decodeText } from './host/encoding.js'
import { detectFormat, isReadableDocument, readDocument } from './host/documents.js'
import { normalizeHttpUrl, sanitizeSites, siteRecord } from './host/sites.js'

export const name = 'stealthReader'

/**
 * A failure with a stable code the panel can localize without showing a URL.
 */
export class ReaderError extends Error {
  /**
   * @param {string} code - stable error code
   * @param {string} message - English fallback message
   */
  constructor(code, message) {
    super(message)
    this.name = 'ReaderError'
    this.code = code
  }
}
/**
 * Build the text around a search hit.
 *
 * A window of a few characters is not enough to tell one hit from another,
 * so the whole line the hit sits on is given. A line that is longer than a
 * screen is cut around the hit, so the reader still sees what was found.
 *
 * @param {string} text - the chapter text
 * @param {number} at - the offset of the hit
 * @returns {string} the text around the hit
 */
function makeSnippet(text, at) {
  const source = String(text || '')
  const start = source.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  let end = source.indexOf('\n', at)
  if (end === -1) end = source.length
  const line = source.slice(start, end).trim()
  if (line.length <= 240) return line
  // A very long line is cut around the hit, with a little of it on both
  // sides, so the reader can still recognise the place.
  const column = Math.max(0, at - start)
  const from = Math.max(0, column - 80)
  const before = from > 0 ? '…' : ''
  const after = from + 240 < line.length ? '…' : ''
  return `${before}${line.slice(from, from + 240)}${after}`
}

/**
 * The place a character sits on.
 *
 * The two surfaces count the text differently: the panel draws one line per
 * line of the file that carries text, and the card joins those lines into
 * one flow and counts characters in it. A hit therefore has two places, and
 * a search result can be put on either of them.
 *
 * An offset that lands on a blank line belongs to the line after it, because
 * a blank line is never drawn.
 *
 * @param {string} text - the chapter text
 * @param {number} offset - the character offset
 * @returns {{line: number, flow: number}} the panel line and the flow offset
 */
function placeAt(text, offset) {
  const lines = String(text || '').split('\n')
  let cursor = 0
  let flow = 0
  let count = 0
  let line = 0
  let flowAt = 0
  for (const raw of lines) {
    if (cursor > offset) break
    const trimmed = raw.trim()
    if (trimmed !== '') {
      // The card joins the trimmed lines with a single space, so the flow
      // offset of a line is the length of the lines before it plus the
      // spaces between them.
      const leading = raw.length - raw.trimStart().length
      const column = Math.min(Math.max(offset - cursor - leading, 0), trimmed.length)
      line = count
      flowAt = flow + column
      count += 1
      flow += trimmed.length + 1
    }
    cursor += raw.length + 1
  }
  return { line, flow: flowAt }
}

/**
 * Read the first bytes of a file.
 *
 * @param {string} file - the absolute file path
 * @param {number} count - how many bytes to read
 * @returns {Promise<Buffer>} the bytes, or an empty buffer
 */
async function readHead(file, count) {
  let handle
  try {
    handle = await fs.open(file, 'r')
    const buffer = Buffer.alloc(count)
    const { bytesRead } = await handle.read(buffer, 0, count, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return Buffer.alloc(0)
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {})
  }
}

/**
 * Remove a leading heading line from a chapter body.
 *
 * The extracted content usually begins with the chapter's own heading; that
 * heading is a title, not text to read.
 * @param {string} text - the extracted body
 * @param {string} title - the extracted heading
 * @returns {string} the body without the leading heading
 */
function dropLeadingTitle(text, title) {
  const body = typeof text === 'string' ? text : ''
  const heading = typeof title === 'string' ? title.trim() : ''
  if (heading === '') return body
  const lines = body.split('\n')
  const first = (lines[0] || '').trim()
  const flat = heading.replace(/\s+/g, ' ')
  // A site often writes the book name before the chapter title on that first
  // line ("书名 第1章 …"), so the line only has to end with the title rather
  // than equal it. The line is dropped either way: it is a heading, not text.
  if (first !== heading && first !== flat && !first.endsWith(heading) && !first.endsWith(flat)) return body
  return lines.slice(1).join('\n').replace(/^\n+/, '')
}

/**
 * Resolve a user-supplied path, expanding a leading `~`.
 *
 * A path typed by hand usually starts with `~`, and `path.resolve` alone
 * would turn it into a directory named `~` that does not exist.
 * @param {string} input - the path as the user wrote it
 * @returns {string} the absolute path
 */
function resolveUserPath(input) {
  const raw = String(input || '').trim()
  if (raw === '~') return os.homedir()
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
  return path.resolve(raw)
}



/* Only the tools are required. The web server is the way the panel reaches
 * this half, so it is wanted — but it is not something every profile has, and
 * a profile without it must still start. A required service that never
 * arrives leaves this plugin waiting for ever, and the Harness refuses to
 * boot with a plugin still waiting. The route is therefore registered when
 * the server appears, and a profile without one simply has no route. */
export const inject = ['tools']

const ROUTE_PATH = '/stealth-reader/api'
const STATE_VERSION = 1
// A chapter shorter than this was not a chapter: a page that builds its text
// in the browser, or one that turned the request away, yields a placeholder.
const MIN_CHAPTER_CHARS = 40
// A list shorter than this is not a book's catalog: it is the handful of
// "recommended" links a chapter page carries.
const CATALOG_MIN_CHAPTERS = 20
// How long a fetched web chapter is trusted. A serial is written after it is
// published, so a copy is kept for a day and then fetched again.
const WEB_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/**
 * Counts the temporary files, so two concurrent writes never collide.
 *
 * @type {number}
 */
let saveCounter = 0
const PREVIEW_TTL_MS = 10 * 60 * 1000
const MAX_BROWSER_HTML_BYTES = 1.5 * 1024 * 1024
const MAX_PREVIEWS = 20
// A cover is decoration for the library grid. Keeping the bound small means a
// malformed EPUB cannot fill the disk or slow every snapshot read.
const MAX_COVER_BYTES = 1.5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20000
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
// A search returns every place the term was found, so the reader can be put
// on the exact sentence and not only on the chapter that holds it. The list
// is bounded, because a common word can occur thousands of times and the
// reader would not look at them all.
const MAX_HITS_PER_CHAPTER = 1000
const MAX_HITS_TOTAL = 1000

const DEFAULT_SETTINGS = {
  /** Disguise skin rendered by the panel. */
  skin: 'log',
  /** Panel font size in pixels. */
  fontSize: 15,
  /** Panel width in pixels. */
  width: 430,
  /** Line height as a multiple of the font size. */
  lineHeight: 1.9,
  /** Reading font family key. */
  font: 'sans',
  /** Reading mode: 'chapter' shows one chapter, 'continuous' scrolls on. */
  scrollMode: 'chapter',
  /**
   * Where the reader is shown: 'strip' is the card above the composer,
   * 'sidebar' the Harness right column.
   */
  placement: 'strip',
  /** How many reading lines the open card shows. */
  stripLines: 3,
  /** Extra folders scanned for .txt novels. */
  libraryDirs: [],
  /** How the library is drawn: a row per book, or a shelf of covers. */
  libraryShape: 'list',
  /**
   * What the card's first line says. 'book' names the book, 'progress' shows
   * how far in the reader is, 'neutral' is a disguise that names nothing.
   */
  cardHead: 'book',
  /**
   * What the folded bar says in its middle. 'head' follows the first-line
   * setting; 'cover' is a fixed cover story for a disguise; 'chapter' names
   * only the chapter position.
   */
  barLabel: 'head',
  /**
   * The cover story shown when barLabel is 'cover'. Plain text, bounded.
   *
   * Empty means the reader has not chosen one, and the card uses the first
   * ready-made story in the interface language. A baked-in English default
   * used to sit here, and because the preset buttons compare against the
   * translated string, no preset ever showed as chosen in any other
   * language.
   */
  barCoverText: '',
  /**
   * How much of the book's progress the folded bar shows: 'percent' is the
   * number alone, 'track' the line alone, 'both' the two of them, 'none'
   * neither.
   */
  barProgress: 'percent',
  /** How long the card waits before it folds away once the pointer leaves. */
  cardFoldDelay: 260,
  /**
   * How the card folds. 'manual' folds only when the reader asks; 'auto' also
   * folds when the pointer leaves; 'never' keeps the card open always.
   */
  cardFoldMode: 'manual',
  /**
   * Where the folded mark sits: 'left', 'center' or 'right'. The mark is the
   * whole card when it is folded, so this is the card's own position.
   */
  cardAlign: 'right',
  /** A small horizontal nudge for the folded mark, in pixels, -200..200. */
  cardOffset: 0,
  /**
   * Whether the card may fold at all. With this off the card is always the
   * full card and its fold button is not offered, which is a different thing
   * from a fold mode that simply never folds on its own.
   */
  cardFoldable: true,
  /**
   * What a folded card looks like: 'mark' is the small round mark, 'bar' is a
   * one-line bar in the composer stack, the way the Goal card reads.
   */
  cardFoldedShape: 'mark',
}

/** The longest a card may wait before it folds itself away, in ms. */
const MAX_FOLD_DELAY = 800
/** The shortest such wait: a card that vanishes instantly cannot be read. */
const MIN_FOLD_DELAY = 80

/** Only declared, non-secret preferences may cross the storage/UI boundary. */
function publicSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, libraryDirs: [] }
  if (input && typeof input === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (Object.hasOwn(input, key)) settings[key] = input[key]
    }
  }
  return settings
}

/**
 * The reading modes a position may be recorded in.
 *
 * @type {ReadonlySet<string>}
 */
const CARD_HEADS = new Set(['book', 'progress', 'neutral'])
const CARD_FOLD_MODES = new Set(['manual', 'auto', 'never'])
const CARD_ALIGNS = new Set(['left', 'center', 'right'])
const CARD_FOLDED_SHAPES = new Set(['mark', 'bar'])
const BAR_LABELS = new Set(['head', 'chapter', 'cover'])
/** How much of the book's progress the folded bar shows. */
const BAR_PROGRESS = new Set(['percent', 'track', 'both', 'none'])
const PLACEMENTS = new Set(['strip', 'sidebar'])

/**
 * Resolve the directory that stores the library state and the chapter cache.
 * @returns {string} absolute data directory
 */
function dataRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'stealth-reader')
}

/**
 * Hash a source string into a short stable identifier.
 * @param {string} value - source identifier
 * @returns {string} hex identifier
 */
function sourceId(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
}

/**
 * The identifier a local file gets as a book.
 *
 * A cover file is named after it, so the two have to agree exactly.
 *
 * @param {string} file - absolute path of the document
 * @returns {string} the book identifier
 */
function bookIdOf(file) {
  return sourceId(file)
}

/**
 * Fetch one URL with browser-like headers and a bounded timeout.
 * @param {string} url - absolute URL
 * @returns {Promise<string>} response body
 */
async function fetchText(url) {
  // Host fetches are anonymous. Browser sign-in state is never read or copied.
  try { url = normalizeHttpUrl(url) } catch (failure) { throw new ReaderError('invalidUrl', failure.message) }
  let response
  try {
    const headers = {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    response = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    })
  } catch (error) {
    // The message never repeats the URL: it would surface inside the panel.
    throw new ReaderError('network', error instanceof Error && error.name === 'TimeoutError'
      ? 'The page did not answer in time.'
      : 'The page could not be reached.')
  }
  if (!response.ok) {
    // A 404 is a missing page; any other status is the server's answer and
    // must not be reported as a missing page.
    if (response.status === 404) throw new ReaderError('notFound', 'The page was not found.')
    throw new ReaderError('httpError', `The page answered with status ${response.status}.`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  const head = buffer.subarray(0, 2048).toString('latin1').toLowerCase()
  const charsetMatch = /charset=["']?([\w-]+)/.exec(head)
  const charset = charsetMatch ? charsetMatch[1] : 'utf-8'
  let text
  try {
    text = new TextDecoder(charset).decode(buffer)
  } catch {
    text = buffer.toString('utf8')
  }
  return text
}

/** Reject credential-bearing envelopes; HTML itself is untrusted page data. */
function rejectCredentialFields(input) {
  if (!input || typeof input !== 'object') return
  for (const key of Object.keys(input)) {
    if (/^(?:siteCookie|cookies?|headers?|authorization|credentials?|password|username|(?:local|session)?storage|tokens?|clientSecret)$/i.test(key)) {
      throw new ReaderError('unsafeCredential', 'Do not send cookies, headers, credentials, or browser storage to the reader. Sign in inside the site browser.')
    }
    const value = input[key]
    if (value && typeof value === 'object') rejectCredentialFields(value)
  }
}

/** Bind every browser page, chapter link, and cache entry to its saved site. */
function boundSiteUrl(site, input, base) {
  let url
  try {
    url = normalizeHttpUrl(base === undefined ? input : new URL(input, base).toString())
  } catch {
    throw new ReaderError('invalidSiteUrl', 'The page must have a valid HTTP or HTTPS URL without embedded credentials.')
  }
  if (new URL(url).origin !== site.origin) {
    throw new ReaderError('siteOrigin', 'This page belongs to a different site. Add that site separately and browse it explicitly.')
  }
  return url
}

/** Extract only prose; do not cache login, purchase, or unsupported empty pages. */
function readableBrowserPage(html, selector) {
  const root = parseHtmlDocument(html)
  const pageTitle = textContent(selectAll(root, 'title')[0] || selectAll(root, 'h1')[0]).trim()
  const extracted = extractContent(html, selector)
  const text = dropLeadingTitle(extracted.text, extracted.title)
  const challenge = /(?:请先登录|请登录后|登录后(?:阅读|查看)|需要登录|付费(?:阅读|章节)|订阅(?:本章|后阅读)|购买(?:本章|章节)|解锁(?:本章|章节)|VIP章节|sign\s*in\s*to\s*(?:read|continue)|log\s*in\s*to\s*(?:read|continue)|subscribe\s*to\s*(?:read|continue)|purchase\s*(?:this\s*)?chapter)/i
  const passwordForm = selectAll(root, 'input').some(node => String(node.attrs.type || '').toLowerCase() === 'password')
  if (passwordForm || /^(?:登录|登入|sign in|log in)(?:\s|[-_|]|$)/i.test(pageTitle) || challenge.test(pageTitle) || challenge.test(text)) {
    throw new ReaderError('unreadablePage', 'The page requires sign-in or purchase. Complete access in the site browser; locked text is not imported.')
  }
  if (text.replace(/\s/g, '').length < MIN_CHAPTER_CHARS) {
    throw new ReaderError('emptyChapter', 'The page held no readable chapter text. Open a readable chapter in the site browser first.')
  }
  return { title: extracted.title, text }
}

/**
 * The reader service: library state, chapter access and the client bridge.
 */
export class ReaderService {
  /**
   * @param {object} [options] - service options
   */
  constructor(options = {}) {
    this.root = options.root || dataRoot()
    this.cacheDir = path.join(this.root, 'cache')
    this.statePath = path.join(this.root, 'state.json')
    this.state = { version: STATE_VERSION, settings: { ...DEFAULT_SETTINGS, libraryDirs: [] }, sites: [], books: [], current: null, positions: {} }
    this.txtCache = new Map()
    // Parsed preview records only: raw HTML and credentials are never retained.
    this.previews = new Map()
    this.confirmations = new Map()
    // The in-flight state read; undefined means it has not started.
    this.loading = undefined
    // The pending debounced write and its timer.
    this.saveTimer = undefined
  }

  /**
   * Load persisted state once, tolerating a missing or damaged file.
   * @returns {Promise<void>} resolves when state is ready
   */
  async load() {
    // The in-flight promise is cached, not a boolean: a second caller must
    // wait for the read to finish instead of continuing with the empty
    // default state, which a concurrent save would then write to disk.
    if (this.loading === undefined) {
      this.loading = this.readState()
    }
    return this.loading
  }

  /**
   * Read the state file into memory.
   * @returns {Promise<void>} resolves when the state is in memory
   */
  async readState() {
    let mustScrub = false
    try {
      const raw = await fs.readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        // Check only presence: never use, send, or return the old credential.
        mustScrub = Object.hasOwn(parsed, 'siteCookie')
          || !!(parsed.settings && Object.hasOwn(parsed.settings, 'siteCookie'))
        this.state = {
          version: STATE_VERSION,
          settings: publicSettings(parsed.settings),
          sites: sanitizeSites(parsed.sites),
          books: Array.isArray(parsed.books) ? parsed.books : [],
          current: parsed.current || null,
          positions: parsed.positions && typeof parsed.positions === 'object' ? parsed.positions : {},
          // The faults of the last run are kept, so a panel that broke
          // before a restart is still explainable.
          faults: Array.isArray(parsed.faults) ? parsed.faults : [],
        }
        this.migratePositions()
      }
    } catch {
      // A missing or unreadable state file simply means an empty library.
    }
    // Do not call save() here: it waits on this very load promise. Migration
    // failures remain visible rather than silently leaving the secret on disk.
    if (mustScrub) await this.writeState()
  }

  /**
   * Bring the remembered positions up to the current shape.
   *
   * A position used to be a plain chapter number; it is now an object that
   * also carries the place inside the chapter and the mode it was read in.
   * An old file is migrated on read, so the rest of the code only ever sees
   * the new shape.
   *
   * @returns {void}
   */
  migratePositions() {
    for (const [bookId, remembered] of Object.entries(this.state.positions)) {
      if (remembered === null || typeof remembered !== 'object') {
        const index = Number.isInteger(remembered) ? remembered : 0
        this.state.positions[bookId] = { index, offset: 0, line: 0, flow: 0, mode: DEFAULT_SETTINGS.placement }
      }
    }
  }

  /**
   * Persist the current state atomically.
   * @returns {Promise<void>} resolves when the file is written
   */
  async save() {
    // Saving before the state is in memory would write an empty library.
    await this.load()
    await this.writeState()
  }

  /** Persist only public site metadata and allowlisted non-secret settings. */
  async writeState() {
    delete this.state.siteCookie
    this.state.settings = publicSettings(this.state.settings)
    this.state.sites = sanitizeSites(this.state.sites)
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    // Two concurrent writes must not share a temporary name, or one renames
    // the other's file away and the second rename fails.
    const temporary = `${this.statePath}.${process.pid}.${saveCounter++}.tmp`
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 })
    try {
      await fs.rename(temporary, this.statePath)
    } catch (failure) {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw failure
    }
  }

  /**
   * Write the state soon, coalescing a burst of changes into one write.
   *
   * The reading position changes on every chapter turn, and the state file
   * holds the whole library, so an immediate write per turn is wasted work.
   * A later immediate save cancels the pending one.
   *
   * @param {number} [delayMs] - how long to wait, defaults to 400ms
   * @returns {void}
   */
  scheduleSave(delayMs = 400) {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.save().catch(() => {
        // A failed write must not take the reader down; the next change
        // writes the file again.
      })
    }, delayMs)
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  /**
   * Public snapshot handed to the panel.
   * @returns {Promise<object>} library snapshot
   */
  async snapshot() {
    await this.load()
    // The cache count is awaited per book, so the map callback stays sync and
    // the snapshot is assembled from finished values.
    const cachedCounts = await Promise.all(this.state.books.map(book => this.cachedChapters(book)))
    const books = this.state.books.map((book, at) => ({
      id: book.id,
      kind: book.kind,
      title: book.title,
      source: book.kind === 'txt' ? path.basename(book.source) : book.source,
      chapters: book.chapters ? book.chapters.length : book.chapterCount || 0,
      // Whether a real cover exists. The image itself is fetched separately,
      // so a library read never carries megabytes of artwork.
      ...(typeof book.cover === 'string' ? { hasCover: true } : {}),
      ...(book.transport === 'browser' ? { transport: 'browser', siteId: book.siteId } : {}),
      // Where the book came from, in one word the panel can show: a file on
      // this machine, or a page read from a website.
      origin: book.transport === 'browser' ? 'web' : 'local',
      // How much of it is already on disk, so the shelf can say whether a book
      // is available offline instead of leaving that to guesswork.
      cached: cachedCounts[at],
    }))
    return {
      settings: publicSettings(this.state.settings),
      sites: sanitizeSites(this.state.sites),
      books,
      current: this.state.current,
      positions: this.state.positions,
      lastScan: this.state.lastScan || null,
    }
  }

  /**
   * Count how many chapters of one book are already stored on disk.
   *
   * The number is a status, not content: the panel shows it to say whether a
   * book can be read offline, so nothing here reads or returns chapter text.
   *
   * @param {object} book - book record
   * @returns {Promise<number>} chapters with a stored copy
   */
  async cachedChapters(book) {
    const chapters = Array.isArray(book.chapters) ? book.chapters : []
    if (chapters.length === 0) {
      // A local file is read from the file itself, so it needs no cache.
      return book.transport === 'browser' ? 0 : 0
    }
    let found = 0
    if (book.transport === 'browser') {
      for (const chapter of chapters) {
        if (typeof chapter.url !== 'string') continue
        try {
          await fs.access(this.browserCacheFile(book.siteId, chapter.url))
          found += 1
        } catch {
          // A chapter with no stored copy simply is not counted.
        }
      }
      return found
    }
    for (const chapter of chapters) {
      if (typeof chapter.url !== 'string') continue
      try {
        await fs.access(path.join(this.cacheDir, `${sourceId(chapter.url)}.json`))
        found += 1
      } catch {
        // Same here: absent is a normal state, not a failure.
      }
    }
    return found
  }

  /**
   * Find one book record.
   * @param {string} bookId - book identifier
   * @returns {object | undefined} book record
   */
  findBook(bookId) {
    return this.state.books.find(book => book.id === bookId)
  }

  /**
   * Resolve the chapter list of one book.
   * @param {object} book - book record
   * @returns {Promise<Array<{ title: string, text?: string, url?: string }>>} chapter list
   */
  async chaptersOf(book) {
    if (book.kind === 'web') return book.chapters || []
    const cached = this.txtCache.get(book.id)
    if (cached) return cached
    const document = await readDocument(book.source, book.kind || 'txt')
    const chapters = document.chapters
    this.txtCache.set(book.id, chapters)
    // A book imported before a parser fix carries a stale count.
    if (book.chapterCount !== chapters.length) {
      book.chapterCount = chapters.length
      await this.save()
    }
    return chapters
  }

  /**
   * Read one chapter of one book.
   * @param {object} options - read options
   * @param {string} [options.bookId] - book identifier, defaults to the current book
   * @param {number} [options.index] - chapter index, defaults to the current chapter
   * @returns {Promise<object>} chapter payload
   */
  async chapter(options = {}) {
    await this.load()
    const current = this.state.current || {}
    const bookId = options.bookId || current.bookId
    const book = this.findBook(bookId)
    if (book === undefined) throw new ReaderError('noBook', 'No book is open.')
    const chapters = await this.chaptersOf(book)
    if (chapters.length === 0) throw new ReaderError('noBook', 'This book has no chapters.')
    const index = Math.min(Math.max(Number.isInteger(options.index) ? options.index : (current.index || 0), 0), chapters.length - 1)
    const chapter = chapters[index]
    let text = chapter.text
    if (text === undefined) {
      text = await this.fetchChapterText(book, chapter.url)
    }
    return {
      bookId: book.id,
      bookTitle: book.title,
      // No hardcoded language: the client localizes a missing section title.
      title: chapter.title || '',
      index,
      total: chapters.length,
      text,
    }
  }

  /**
   * Search the whole book.
   *
   * Every chapter is scanned and the matches are reported with the chapter
   * they belong to, so the panel can offer a result list.
   *
   * @param {object} [options] - search options
   * @param {string} [options.bookId] - book identifier, defaults to the current book
   * @param {string} options.term - the text to look for
   * @param {number} [options.limit] - the maximum number of results
   * @returns {Promise<object>} the matches
   */
  async search(options = {}) {
    await this.load()
    const term = String(options.term || '').trim()
    if (term === '') return { term, total: 0, shown: 0, matches: [] }
    const current = this.state.current || {}
    const bookId = options.bookId || current.bookId
    const book = this.findBook(bookId)
    if (book === undefined) throw new ReaderError('noBook', 'No book is open.')
    const chapters = await this.chaptersOf(book)
    const needle = term.toLowerCase()
    const matches = []
    let total = 0
    // How many places are kept in total, across every chapter.
    let kept = 0
    // Every chapter is searched, so a word that only appears near the end
    // of a long book is found as well.
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]
      let text = chapter.text
      if (text === undefined) {
        // A web chapter is fetched on demand; a search must not fail because
        // one page is unreachable.
        try {
          text = await this.fetchChapterText(book, chapter.url)
        } catch {
          continue
        }
      }
      const lower = String(text).toLowerCase()
      let at = lower.indexOf(needle)
      if (at === -1) continue
      let count = 0
      let first = at
      // Every place the term was found is kept, so a result can name the
      // exact sentence instead of only the chapter it sits in.
      const hits = []
      while (at !== -1) {
        count += 1
        if (count === 1) first = at
        if (hits.length < MAX_HITS_PER_CHAPTER && kept < MAX_HITS_TOTAL) {
          kept += 1
          const place = placeAt(text, at)
          hits.push({
            at,
            line: place.line,
            flow: place.flow,
            snippet: makeSnippet(text, at),
          })
        }
        at = lower.indexOf(needle, at + needle.length)
      }
      total += count
      if (hits.length > 0) {
        const head = hits[0]
        matches.push({
          index,
          title: chapter.title || '',
          count,
          // Where the first match sits inside the chapter, so the reader can
          // be put on the sentence rather than on the first line of it.
          at: first,
          line: head.line,
          flow: head.flow,
          snippet: head.snippet,
          hits,
        })
      }
    }
    // The count is every place the word was found, and the list holds as
    // many of them as a reader can use. When the list is shorter, it says
    // so rather than pretending it is all of them.
    return {
      term,
      total,
      shown: kept,
      truncated: kept < total,
      matches,
      bookId: book.id,
    }
  }

  /**
   * List the chapters of the current book.
   *
   * The table of contents carries the title and the index of every chapter,
   * so the panel can offer a chapter list without reading the whole book.
   *
   * @param {object} [options] - toc options
   * @param {string} [options.bookId] - book identifier, defaults to the current book
   * @returns {Promise<object>} the chapter list
   */
  async toc(options = {}) {
    await this.load()
    const current = this.state.current || {}
    const bookId = options.bookId || current.bookId
    const book = this.findBook(bookId)
    if (book === undefined) throw new ReaderError('noBook', 'No book is open.')
    const chapters = await this.chaptersOf(book)
    const index = Number.isInteger(options.index) ? options.index : (current.index || 0)
    return {
      bookId: book.id,
      bookTitle: book.title,
      index,
      total: chapters.length,
      chapters: chapters.map((chapter, position) => ({
        index: position,
        title: chapter.title || '',
      })),
    }
  }

  /**
   * Whether this process has no isolated site browser at all.
   *
   * The browser guest lives in the desktop window's renderer, so a Host that
   * was never asked for one has no way to carry a sign-in. Reported rather
   * than guessed: the reader decides what to tell the reader.
   *
   * @returns {boolean} true when only anonymous reads are possible
   */
  browserless() {
    return this.browserAttached !== true
  }

  /**
   * Read one public chapter with no credential of any kind.
   *
   * @param {string} url - the chapter address, already bound to its site
   * @param {string} [selector] - the body selector, when the site needs one
   * @returns {Promise<string>} the chapter text
   */
  async fetchAnonymousChapter(url, selector) {
    const html = await fetchText(url)
    const extracted = extractContent(html, selector)
    const text = dropLeadingTitle(extracted.text !== '' ? extracted.text : extracted.title, extracted.title)
    if (text.replace(/\s/g, '').length < MIN_CHAPTER_CHARS) {
      throw new ReaderError('emptyChapter', 'The page held no chapter text. The site may require a sign-in; open it in the website library.')
    }
    return text
  }

  /**
   * Read a chapter page, using the on-disk cache when possible.
   * @param {object} book - book record
   * @param {string} url - chapter URL
   * @returns {Promise<string>} chapter text
   */
  async fetchChapterText(book, url) {
    if (book.transport === 'browser') {
      const site = this.siteForBook(book)
      const bound = boundSiteUrl(site, url)
      let cachedText = null
      try {
        const cached = JSON.parse(await fs.readFile(this.browserCacheFile(book.siteId, bound), 'utf8'))
        const age = Date.now() - Number(cached.fetchedAt || 0)
        if (cached.siteId === book.siteId && cached.url === bound && typeof cached.text === 'string'
          && age >= 0 && age < WEB_CACHE_TTL_MS) return cached.text
        if (typeof cached.text === 'string') cachedText = cached.text
      } catch {
        // No browser copy yet; the anonymous read below may still reach it.
      }
      // A free chapter of a public site is readable without any sign-in. The
      // isolated browser is the better path when it is available, but it only
      // exists in the desktop window, so a Web page or a site that refuses the
      // guest must not turn a readable book into a dead one. This request
      // carries no Cookie, header or storage value at all.
      try {
        return await this.fetchAnonymousChapter(bound, book.contentSelector)
      } catch (failure) {
        if (cachedText !== null) return cachedText
        // Neither path worked: ask for the browser, which is the one that can
        // carry the reader's own sign-in.
        if (failure && (failure.code === 'network' || failure.code === 'httpError')
          && !this.browserless()) {
          const wanted = new ReaderError('browserRequired', 'Open this chapter in the reader site browser to load it. Browser sign-in credentials remain inside that browser.')
          wanted.need = { bookId: book.id, siteId: book.siteId, url: bound }
          throw wanted
        }
        throw failure
      }
    }
    const cacheFile = path.join(this.cacheDir, `${sourceId(url)}.json`)
    let stale = null
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'))
      // A web chapter is not finished when it is first read: a serial is
      // written after it is published, so an old copy is only trusted for a
      // while and is then fetched again.
      const age = Date.now() - Number(cached.fetchedAt || 0)
      const fresh = Number.isFinite(age) && age >= 0 && age < WEB_CACHE_TTL_MS
      if (typeof cached.text === 'string') {
        if (fresh) return cached.text
        // The copy is old, so it is a fallback rather than the answer.
        stale = cached.text
      }
    } catch {
      // Cache miss: fetch the page once and keep the result on disk.
    }
    let html
    try {
      html = await fetchText(url)
    } catch (failure) {
      // The site is unreachable. An old copy is still better than nothing,
      // and the chapter was readable before.
      if (stale !== null) return stale
      throw failure
    }
    const extracted = extractContent(html, book.contentSelector)
    // The content block normally starts with the chapter heading; keeping it
    // would put the title into the body of every chapter.
    const text = dropLeadingTitle(extracted.text !== '' ? extracted.text : extracted.title, extracted.title)
    // A page that yields almost nothing was not the chapter: a site that
    // builds the text in the browser, or one that turned the request away.
    // The empty result is reported instead of cached, so a later attempt can
    // still succeed.
    if (text.replace(/\s/g, '').length < MIN_CHAPTER_CHARS) {
      throw new ReaderError(
        'emptyChapter',
        'The page held no chapter text. The site may build it in the browser.',
      )
    }
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
      await fs.writeFile(cacheFile, JSON.stringify({ url, title: extracted.title, text, fetchedAt: Date.now() }), 'utf8')
    } catch {
      // A cache write failure must not break reading.
    }
    return text
  }

  /**
   * Open one book and make it the current reading position.
   * @param {object} options - open options
   * @param {string} [options.bookId] - book identifier
   * @param {number} [options.index] - chapter index
   * @param {number} [options.line] - the line inside the chapter to land on
   * @param {number} [options.flow] - the place inside the chapter, in the
   *   card's own characters
   * @returns {Promise<object>} chapter payload
   */
  async open(options = {}) {
    await this.load()
    const bookId = options.bookId || (this.state.current && this.state.current.bookId)
    if (bookId === undefined) throw new Error('no book id given')
    const book = this.findBook(bookId)
    if (book === undefined) throw new Error('unknown book')
    const chapters = await this.chaptersOf(book)
    const total = chapters.length
    // The saved position is an object; a state file written before it grew
    // holds a plain chapter number, which still has to open the right
    // chapter.
    const remembered = this.state.positions[book.id]
    const savedIndex = remembered !== null && typeof remembered === 'object'
      ? remembered.index
      : remembered
    const requested = Number.isInteger(options.index)
      ? options.index
      : (Number.isInteger(savedIndex) ? savedIndex : 0)
    const index = total === 0 ? 0 : Math.min(Math.max(requested, 0), total - 1)
    this.state.current = { bookId: book.id, index }
    // The place inside the chapter survives an open, so the reader lands on
    // the same line. A move to another chapter starts at the top of it.
    const sameChapter = remembered !== null && typeof remembered === 'object'
      && remembered.index === index
    const offset = sameChapter && Number.isFinite(remembered.offset) ? remembered.offset : 0
    const line = sameChapter && Number.isInteger(remembered.line) ? remembered.line : 0
    const flow = sameChapter && Number.isInteger(remembered.flow) ? remembered.flow : 0
    // The mode is where the reader was last seen, not where it is seen now:
    // the strip and the panel are two views of one book.
    const mode = remembered !== null && typeof remembered === 'object' && PLACEMENTS.has(remembered.mode)
      ? remembered.mode
      : this.state.settings.placement
    // A jump names the exact place it wants, so a search result can put the
    // reader on the sentence instead of on the first line of the chapter.
    // The panel counts lines and the card counts characters, so each one
    // names its own place and the other keeps the place it had.
    const wanted = Number.isInteger(options.line) && options.line >= 0 ? options.line : null
    const wantedFlow = Number.isInteger(options.flow) && options.flow >= 0 ? options.flow : null
    this.state.positions[book.id] = {
      index,
      offset: wanted === null ? offset : 0,
      line: wanted === null ? line : wanted,
      flow: wantedFlow === null ? flow : wantedFlow,
      mode,
    }
    await this.save()
    const chapter = await this.chapter({ bookId: book.id, index })
    const place = this.state.positions[book.id]
    return { ...chapter, offset: place.offset, line: place.line, flow: place.flow }
  }

  /**
   * Record where the reader is, without sending the text again.
   *
   * The panel already holds the chapter, so the text does not travel a
   * second time. The total comes from the panel, so no chapter list is
   * read either.
   *
   * The place inside the chapter travels with it, so the reader comes back
   * to the same line instead of the top of the chapter.
   *
   * @param {object} options - position options
   * @param {string} [options.bookId] - book identifier
   * @param {number} [options.index] - the zero-based chapter index
   * @param {number} [options.total] - the number of chapters in the book
   * @param {number} [options.offset] - the place inside the chapter, in pixels
   * @param {number} [options.line] - the line inside the chapter, for the panel
   * @param {number} [options.flow] - the place inside the chapter, in the
   *   card's own characters
   * @param {string} [options.mode] - the reading mode the offset belongs to
   * @returns {Promise<object>} the recorded position
   */
  async position(options = {}) {
    await this.load()
    const bookId = options.bookId || (this.state.current && this.state.current.bookId)
    if (bookId === undefined) throw new ReaderError('noBook', 'No book is open.')
    const book = this.findBook(bookId)
    if (book === undefined) throw new ReaderError('noBook', 'No book is open.')
    const requested = Number.isInteger(options.index) ? options.index : 0
    const total = Number.isInteger(options.total) && options.total > 0 ? options.total : 0
    const index = total === 0 ? Math.max(requested, 0) : Math.min(Math.max(requested, 0), total - 1)
    const offset = Number.isFinite(options.offset) && options.offset > 0 ? Math.floor(options.offset) : 0
    const line = Number.isInteger(options.line) && options.line > 0 ? options.line : 0
    const flow = Number.isInteger(options.flow) && options.flow > 0 ? options.flow : 0
    const mode = PLACEMENTS.has(options.mode) ? options.mode : 'overlay'
    this.state.current = { bookId: book.id, index }
    // The panel and the card count the text differently, so each one writes
    // its own place and the other keeps the place it had. A reader who read
    // in the panel and then opened the card still finds the sentence.
    const previous = this.state.positions[book.id]
    const kept = previous !== null && typeof previous === 'object' ? previous : {}
    // A place belongs to the chapter it was measured in. A card's place is a
    // number of characters and a panel's place is a number of lines, so a
    // place kept from another chapter is not a place in this one: it points
    // at a sentence that was never there, and the reader lands in the
    // middle of the wrong text and cannot turn a page. A chapter that has
    // just been entered starts its place at the top.
    const sameChapter = kept.index === index
    const place = {
      index,
      offset: mode === 'strip' ? (sameChapter && Number.isFinite(kept.offset) ? kept.offset : 0) : offset,
      line: mode === 'strip' ? (sameChapter && Number.isInteger(kept.line) ? kept.line : 0) : line,
      flow: mode === 'strip' ? flow : (sameChapter && Number.isInteger(kept.flow) ? kept.flow : 0),
      mode,
    }
    this.state.positions[book.id] = place
    // The position changes on every chapter turn, and the state file holds
    // the whole library, so the write is debounced: a burst of turns costs
    // one write instead of one per turn.
    this.scheduleSave()
    return { bookId: book.id, index, total, offset: place.offset, line: place.line, flow: place.flow, mode }
  }

  /**
   * Move to the next or previous chapter of the current book.
   * @param {object} options - step options
   * @param {number} [options.delta] - step size, defaults to 1
   * @returns {Promise<object>} chapter payload
   */
  async step(options = {}) {
    await this.load()
    const current = this.state.current || {}
    // An absolute target wins, so the panel can move from its own position
    // without depending on the host's position being in step.
    if (Number.isInteger(options.index)) {
      return this.open({ bookId: options.bookId || current.bookId, index: options.index })
    }
    const delta = Number.isInteger(options.delta) ? options.delta : 1
    return this.open({ bookId: current.bookId, index: (current.index || 0) + delta })
  }

  /**
   * Add a local .txt novel to the library.
   * @param {object} options - add options
   * @param {string} options.path - absolute path of the .txt file
   * @returns {Promise<object>} the stored book record
   */
  async addLocal(options = {}) {
    await this.load()
    const target = resolveUserPath(options.path)
    let stat
    try {
      stat = await fs.stat(target)
    } catch {
      // A missing file is the most common failure, and it needs its own code
      // so the panel can say so instead of reporting a host outage.
      throw new ReaderError('noFile', 'That file could not be found.')
    }
    if (!stat.isFile()) throw new ReaderError('noFile', 'That path is not a file.')
    const existing = this.state.books.find(book => book.source === target)
    if (existing !== undefined) return existing
    const head = await readHead(target, 4)
    const kind = detectFormat(path.basename(target), head)
    let chapters
    let title = path.basename(target).replace(/\.[^.]+$/, '')
    let cover = null
    try {
      const document = await readDocument(target, kind)
      chapters = document.chapters
      // An EPUB carries its own title, which beats the file name.
      if (document.title !== '' && document.title !== title) title = document.title
      // An EPUB may also carry a cover; a book without one is normal.
      if (document.cover !== null && document.cover !== undefined) {
        cover = await this.writeCover(bookIdOf(target), document.cover)
      }
    } catch (failure) {
      // An unsupported format is named; anything else is a broken file.
      if (failure && failure.code === 'unsupportedFormat') {
        const error = new ReaderError('unsupportedFormat', failure.message)
        error.format = failure.format
        throw error
      }
      throw new ReaderError('badFormat', 'This document could not be read.')
    }
    const book = {
      id: sourceId(target),
      kind,
      title,
      source: target,
      chapterCount: chapters.length,
      // A cover is optional: a book without one draws a generated spine.
      ...(cover === null ? {} : { cover }),
      addedAt: Date.now(),
    }
    this.txtCache.set(book.id, chapters)
    this.state.books.push(book)
    if (this.state.current === null) this.state.current = { bookId: book.id, index: 0 }
    await this.save()
    return book
  }

  /**
   * Store one cover image beside the library and return its file name.
   *
   * Only the image's own bytes are kept: an EPUB cannot make the reader write
   * an arbitrary path, and an oversized image is dropped instead of slowing
   * every library read.
   *
   * @param {string} bookId - the book the cover belongs to
   * @param {{ bytes: Buffer, mediaType: string }} cover - the extracted image
   * @returns {Promise<string | null>} the stored file name, or null
   */
  async writeCover(bookId, cover) {
    if (!cover || !Buffer.isBuffer(cover.bytes)) return null
    if (cover.bytes.length === 0 || cover.bytes.length > MAX_COVER_BYTES) return null
    const type = String(cover.mediaType || '')
    const extension = type === 'image/png' ? '.png'
      : type === 'image/gif' ? '.gif'
        : type === 'image/webp' ? '.webp'
          : '.jpg'
    const name = `${bookId}${extension}`
    try {
      const directory = path.join(this.root, 'covers')
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.writeFile(path.join(directory, name), cover.bytes, { mode: 0o600 })
      return name
    } catch {
      // A cover is decoration: a read-only or full disk must not fail an import.
      return null
    }
  }

  /**
   * Read one stored cover for the panel.
   *
   * @param {string} bookId - the book whose cover is wanted
   * @returns {Promise<{ bytes: Buffer, mime: string } | null>} the image, or null
   */
  async coverOf(bookId) {
    await this.load()
    const book = this.findBook(bookId)
    if (book === undefined || typeof book.cover !== 'string') return null
    // The name is written by this service, but a hand-edited state file must
    // not turn into a read of a path it chose.
    if (!/^[A-Za-z0-9_-]{1,64}\.(png|jpg|gif|webp)$/.test(book.cover)) return null
    const mime = book.cover.endsWith('.png') ? 'image/png'
      : book.cover.endsWith('.gif') ? 'image/gif'
        : book.cover.endsWith('.webp') ? 'image/webp'
          : 'image/jpeg'
    try {
      return { bytes: await fs.readFile(path.join(this.root, 'covers', book.cover)), mime }
    } catch {
      return null
    }
  }

  /**
   * Scan folders for .txt novels.
   * @param {object} options - scan options
   * @param {string[]} [options.dirs] - folders to scan
   * @returns {Promise<string[]>} absolute file paths
   */
  async scan(options = {}) {
    const requested = Array.isArray(options.dirs) && options.dirs.length > 0
      ? options.dirs
      : this.state.settings.libraryDirs
    const dirs = requested.map(dir => resolveUserPath(dir))
    const found = []
    this.state.lastScan = { dirs: dirs || [], found: 0 }
    for (const dir of dirs || []) {
      try {
        await fs.access(String(dir))
      } catch {
        this.state.lastScan.missing = this.state.lastScan.missing || []
        this.state.lastScan.missing.push(String(dir))
      }
    }
    for (const dir of dirs || []) {
      let entries
      try {
        entries = await fs.readdir(String(dir), { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const full = path.join(String(dir), entry.name)
        if (entry.isFile() && isReadableDocument(entry.name)) found.push(full)
        else if (entry.isDirectory() && found.length < 500) {
          try {
            const nested = await fs.readdir(full, { withFileTypes: true })
            for (const child of nested) {
              if (child.isFile() && isReadableDocument(child.name)) found.push(path.join(full, child.name))
            }
          } catch {
            // Unreadable subfolder: skip it.
          }
        }
      }
    }
    this.state.lastScan.found = found.length
    // Remember the folder, so the next scan has a default target.
    const known = Array.isArray(this.state.settings.libraryDirs) ? this.state.settings.libraryDirs : []
    for (const dir of dirs || []) {
      if (!known.includes(dir)) known.push(dir)
    }
    this.state.settings.libraryDirs = known.slice(-20)
    await this.save()
    return found
  }

  /**
   * Add a web novel to the library using a catalog page.
   * @param {object} options - add options
   * @param {string} options.indexUrl - catalog page URL
   * @param {string} [options.chapterSelector] - selector matching chapter links
   * @param {string} [options.contentSelector] - selector matching the chapter body
   * @param {string} [options.title] - display title
   * @returns {Promise<object>} the stored book record
   */
  async addWeb(options = {}) {
    await this.load()
    const given = String(options.indexUrl || '').trim()
    if (!/^https?:\/\//i.test(given)) throw new Error('the catalog URL must be http(s)')
    // Any page of the book will do: a reader who is on chapter 12 can paste
    // that page, and the catalog is found from it.
    let indexUrl = given
    let html = await fetchText(indexUrl)
    let chapters = extractChapterList(html, indexUrl, options.chapterSelector)
    // A chapter page carries a handful of links that look like chapters — the
    // "recommended" strip at the bottom. A catalog carries the whole book, so
    // a short list is followed back to the catalog it came from.
    if (chapters.length < CATALOG_MIN_CHAPTERS) {
      const catalog = findCatalogUrl(html, indexUrl)
      if (catalog !== null && catalog !== indexUrl) {
        try {
          const catalogHtml = await fetchText(catalog)
          const catalogChapters = extractChapterList(catalogHtml, catalog, options.chapterSelector)
          if (catalogChapters.length > chapters.length) {
            indexUrl = catalog
            html = catalogHtml
            chapters = catalogChapters
          }
        } catch {
          // The catalog could not be read, so the page the reader gave is
          // used as it is rather than failing outright.
        }
      }
    }
    if (chapters.length === 0) throw new Error('no chapter links found on the catalog page')
    const existing = this.state.books.find(book => book.source === indexUrl)
    if (existing !== undefined) {
      existing.chapters = chapters
      existing.contentSelector = options.contentSelector || existing.contentSelector
      await this.save()
      return existing
    }
    const book = {
      id: sourceId(indexUrl),
      kind: 'web',
      // No URL as a title: it would surface in the library and in tooltips.
      title: options.title || extractPageTitle(html) || '',
      source: indexUrl,
      contentSelector: options.contentSelector || '',
      chapters,
      chapterCount: chapters.length,
      addedAt: Date.now(),
    }
    this.state.books.push(book)
    if (this.state.current === null) this.state.current = { bookId: book.id, index: 0 }
    await this.save()
    return book
  }

  /**
   * Read one URL without adding it to the library and show it in the panel.
   * @param {object} options - fetch options
   * @param {string} options.url - page URL
   * @param {string} [options.selector] - content selector
   * @returns {Promise<object>} chapter payload
   */
  async fetchAdhoc(options = {}) {
    await this.load()
    const url = String(options.url || '').trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('the URL must be http(s)')
    const html = await fetchText(url)
    const extracted = extractContent(html, options.selector)
    const bookId = sourceId(`adhoc:${url}`)
    const book = {
      id: bookId,
      kind: 'web',
      title: extracted.title || url,
      source: url,
      contentSelector: options.selector || '',
      chapters: [{ title: extracted.title || url, url }],
      chapterCount: 1,
      addedAt: Date.now(),
      adhoc: true,
    }
    const existingIndex = this.state.books.findIndex(entry => entry.id === bookId)
    if (existingIndex >= 0) this.state.books[existingIndex] = book
    else this.state.books.push(book)
    this.state.current = { bookId, index: 0 }
    await this.save()
    return {
      bookId,
      bookTitle: book.title,
      title: book.chapters[0].title,
      index: 0,
      total: 1,
      text: extracted.text,
    }
  }

  /** Saved site metadata, or the immutable source origin of a retained book. */
  siteForBook(book) {
    const registered = this.state.sites.find(site => site.id === book.siteId)
    if (registered) return registered
    try { return { id: book.siteId, origin: new URL(normalizeHttpUrl(book.source)).origin } } catch {
      throw new ReaderError('noSite', 'The book has no valid site. Add its site again before browsing.')
    }
  }

  /** Separate browser cache namespace: anonymous cache entries cannot satisfy it. */
  browserCacheFile(siteId, url) {
    return path.join(this.cacheDir, `browser-${sourceId(`${siteId}:${url}`)}.json`)
  }

  /** Cache cleaned prose only, never the supplied HTML or browser session. */
  async writeBrowserCache(siteId, url, chapter) {
    await fs.mkdir(this.cacheDir, { recursive: true, mode: 0o700 })
    const file = this.browserCacheFile(siteId, url)
    const temporary = `${file}.${process.pid}.${saveCounter++}.tmp`
    await fs.writeFile(temporary, JSON.stringify({ siteId, url, title: chapter.title || '', text: chapter.text, fetchedAt: Date.now() }), { encoding: 'utf8', mode: 0o600 })
    try { await fs.rename(temporary, file) } catch (failure) {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw failure
    }
  }

  /** A staged browser import. Caller accumulates initial/catalog/sample pages. */
  async previewWeb(options = {}) {
    await this.load()
    rejectCredentialFields(options)
    const site = this.state.sites.find(entry => entry.id === options.siteId)
    if (!site) throw new ReaderError('noSite', 'Add this site before previewing a book.')
    const url = boundSiteUrl(site, options.url)
    if (!Object.hasOwn(options, 'pages')) {
      const failure = new ReaderError('browserRequired', 'Use the desktop site browser to preview the current book; the Host does not copy browser credentials.')
      failure.need = { siteId: site.id, url }
      throw failure
    }
    if (!Array.isArray(options.pages) || options.pages.length > 3) {
      throw new ReaderError('invalidPages', 'Supply at most three browser pages: current page, catalog, and sample chapter.')
    }
    let size = 0
    const pages = new Map()
    for (const page of options.pages) {
      if (!page || typeof page !== 'object' || typeof page.html !== 'string'
        || Object.keys(page).some(key => key !== 'url' && key !== 'html')) {
        throw new ReaderError('invalidPages', 'Each browser page must contain only its URL and HTML text.')
      }
      size += Buffer.byteLength(page.html, 'utf8')
      if (size >= MAX_BROWSER_HTML_BYTES) throw new ReaderError('pageTooLarge', 'Browser pages must total less than 1.5 MiB.')
      const pageUrl = boundSiteUrl(site, page.url)
      if (pages.has(pageUrl)) throw new ReaderError('invalidPages', 'Each browser page URL must appear once.')
      pages.set(pageUrl, page.html)
    }
    let indexUrl = url
    let html = pages.get(url)
    if (html === undefined) return { needs: { kind: 'catalog', url } }
    // Follow an explicit catalog link BEFORE accepting chapter-looking links.
    // Otherwise a chapter's recommendation strip can masquerade as its book.
    const catalog = findCatalogUrl(html, url, true)
    if (catalog && catalog !== url) {
      indexUrl = boundSiteUrl(site, catalog)
      html = pages.get(indexUrl)
      if (html === undefined) return { needs: { kind: 'catalog', url: indexUrl } }
    }
    const chapters = extractChapterList(html, indexUrl).filter(chapter => {
      try { chapter.url = boundSiteUrl(site, chapter.url); return true } catch { return false }
    })
    if (!chapters.length) throw new ReaderError('noCatalog', 'No same-site chapter catalog was found. Open the book catalog in the site browser.')
    // An actual chapter without a catalog link is not a small catalog simply
    // because its recommendations happen to use numbered chapter labels.
    if ((!catalog || catalog === url) && CHAPTER_NUMBER.test(extractPageTitle(html))) {
      throw new ReaderError('noCatalog', 'This looks like a chapter page. Open its book catalog before adding the book.')
    }
    const sampleUrl = chapters[0].url
    const sampleHtml = pages.get(sampleUrl)
    if (sampleHtml === undefined) return { needs: { kind: 'sample', url: sampleUrl } }
    const sample = readableBrowserPage(sampleHtml)
    const now = Date.now()
    for (const [key, value] of this.previews) if (value.expiresAt <= now) this.previews.delete(key)
    while (this.previews.size >= MAX_PREVIEWS) this.previews.delete(this.previews.keys().next().value)
    const previewId = randomBytes(24).toString('hex')
    const title = extractPageTitle(html) || site.title
    const preview = { previewId, title, indexUrl, chapterCount: chapters.length,
      sampleChapters: chapters.slice(0, 5).map(chapter => ({ ...chapter })), sample: sample.text.slice(0, 1200), warnings: [] }
    this.previews.set(previewId, { siteId: site.id, title, indexUrl, chapters,
      sample: { url: sampleUrl, title: sample.title || chapters[0].title, text: sample.text }, expiresAt: now + PREVIEW_TTL_MS })
    return { preview }
  }

  /** Explicit confirmation is the only stage that changes the library. */
  async confirmWeb(options = {}) {
    await this.load()
    rejectCredentialFields(options)
    const pending = this.previews.get(options.previewId)
    if (!pending || pending.expiresAt <= Date.now()) {
      this.previews.delete(options.previewId)
      throw new ReaderError('previewExpired', 'The book preview expired. Recognize the current book again before adding it.')
    }
    const site = this.state.sites.find(entry => entry.id === pending.siteId)
    if (!site) throw new ReaderError('noSite', 'The preview site was removed. Add the site and preview again.')
    // Consume before awaiting disk IO: two clicks cannot reuse one token.
    this.previews.delete(options.previewId)
    const key = `${site.id}:${pending.indexUrl}`
    if (this.confirmations.has(key)) return this.confirmations.get(key)
    const commit = (async () => {
      // Do not replace another transport or overwrite an existing position.
      const existing = this.state.books.find(book => book.transport === 'browser' && book.siteId === site.id && book.source === pending.indexUrl)
      if (existing) return existing
      const book = { id: sourceId(`browser:${site.id}:${pending.indexUrl}`), kind: 'web',
        title: pending.title, source: pending.indexUrl, siteId: site.id, transport: 'browser',
        chapters: pending.chapters.map(chapter => ({ ...chapter })), chapterCount: pending.chapters.length, addedAt: Date.now() }
      await this.writeBrowserCache(site.id, pending.sample.url, pending.sample)
      this.state.books.push(book)
      try { await this.save() } catch (failure) {
        const at = this.state.books.indexOf(book)
        if (at >= 0) this.state.books.splice(at, 1)
        throw failure
      }
      return book
    })()
    this.confirmations.set(key, commit)
    try { return await commit } finally { this.confirmations.delete(key) }
  }

  /** Accept only a listed chapter from its book's same-origin browser guest. */
  async cacheBrowserPage(options = {}) {
    await this.load()
    // A page arriving from the desktop guest is the only proof that this
    // session has one, and it is what makes a browser-required failure worth
    // showing instead of silently reading anonymously.
    this.browserAttached = true
    rejectCredentialFields(options)
    const book = this.findBook(options.bookId)
    if (!book || book.transport !== 'browser') throw new ReaderError('noBook', 'That browser book is not in the library.')
    const url = boundSiteUrl(this.siteForBook(book), options.url)
    if (!book.chapters.some(chapter => chapter.url === url)) throw new ReaderError('unknownChapter', 'That page is not a chapter of this book.')
    if (typeof options.html !== 'string') throw new ReaderError('invalidPages', 'A browser chapter must contain HTML text.')
    if (Buffer.byteLength(options.html, 'utf8') >= MAX_BROWSER_HTML_BYTES) throw new ReaderError('pageTooLarge', 'The browser chapter must be smaller than 1.5 MiB.')
    const chapter = readableBrowserPage(options.html, book.contentSelector)
    await this.writeBrowserCache(book.siteId, url, chapter)
    return { bookId: book.id, siteId: book.siteId, url, characters: chapter.text.length }
  }

  /** Add public site metadata without contacting it or attaching an account. */
  async addSite(options = {}) {
    await this.load()
    rejectCredentialFields(options)
    let site
    try { site = siteRecord(options) } catch (failure) { throw new ReaderError('invalidSite', failure.message) }
    const existing = this.state.sites.find(entry => entry.id === site.id)
    if (existing) return { ...existing }
    this.state.sites.push(site)
    await this.save()
    return { ...site }
  }

  /** Removing a bookmark does not remove books, cache, or reading positions. */
  async removeSite(options = {}) {
    await this.load()
    const index = this.state.sites.findIndex(site => site.id === options.siteId)
    if (index < 0) throw new ReaderError('noSite', 'That site is not registered.')
    this.state.sites.splice(index, 1)
    await this.save()
    return { ok: true }
  }

  /**
   * Remove one book from the library.
   * @param {object} options - remove options
   * @param {string} options.bookId - book identifier
   * @returns {Promise<object>} removal result
   */
  async remove(options = {}) {
    await this.load()
    const bookId = String(options.bookId || '')
    const index = this.state.books.findIndex(book => book.id === bookId)
    if (index < 0) throw new Error('unknown book')
    this.state.books.splice(index, 1)
    this.txtCache.delete(bookId)
    if (this.state.current && this.state.current.bookId === bookId) {
      this.state.current = this.state.books.length > 0
        ? { bookId: this.state.books[0].id, index: 0 }
        : null
    }
    await this.save()
    return { ok: true }
  }

  /**
   * Update the panel settings.
   * @param {object} options - settings patch
   * @returns {Promise<object>} the stored settings
   */
  async updateSettings(options = {}) {
    await this.load()
    const patch = options.patch || {}
    if (Object.hasOwn(patch, 'siteCookie')) {
      throw new ReaderError('unsafeCredential', 'Global site cookies are no longer supported. Sign in inside the site browser; credentials must never be copied into reader settings.')
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (patch[key] !== undefined) this.state.settings[key] = patch[key]
    }
    // An unknown placement would leave the panel with no surface at all.
    if (!PLACEMENTS.has(this.state.settings.placement)) {
      this.state.settings.placement = DEFAULT_SETTINGS.placement
    }
    // An unknown library shape would draw neither the list nor the shelf.
    if (this.state.settings.libraryShape !== 'shelf') {
      this.state.settings.libraryShape = 'list'
    }
    // An unknown head would leave the first line blank.
    if (!CARD_HEADS.has(this.state.settings.cardHead)) {
      this.state.settings.cardHead = DEFAULT_SETTINGS.cardHead
    }
    // A fold delay of zero would make the card unreadable; a huge one would
    // leave it open over the text.
    const delay = Number(this.state.settings.cardFoldDelay)
    this.state.settings.cardFoldDelay = Number.isFinite(delay)
      ? Math.min(Math.max(Math.round(delay), MIN_FOLD_DELAY), MAX_FOLD_DELAY)
      : DEFAULT_SETTINGS.cardFoldDelay
    // An unknown fold mode or alignment would leave the card with no rule.
    if (!CARD_FOLD_MODES.has(this.state.settings.cardFoldMode)) {
      this.state.settings.cardFoldMode = DEFAULT_SETTINGS.cardFoldMode
    }
    if (!CARD_ALIGNS.has(this.state.settings.cardAlign)) {
      this.state.settings.cardAlign = DEFAULT_SETTINGS.cardAlign
    }
    // The nudge is bounded so the mark cannot be pushed off the card.
    const offset = Number(this.state.settings.cardOffset)
    this.state.settings.cardOffset = Number.isFinite(offset)
      ? Math.min(Math.max(Math.round(offset), -200), 200)
      : 0
    // An unknown folded shape would draw neither the mark nor the bar.
    if (!CARD_FOLDED_SHAPES.has(this.state.settings.cardFoldedShape)) {
      this.state.settings.cardFoldedShape = DEFAULT_SETTINGS.cardFoldedShape
    }
    // An unknown bar label would leave the bar's middle blank.
    if (!BAR_LABELS.has(this.state.settings.barLabel)) {
      this.state.settings.barLabel = DEFAULT_SETTINGS.barLabel
    }
    // An unknown progress mode would leave the bar with no progress at all.
    if (!BAR_PROGRESS.has(this.state.settings.barProgress)) {
      this.state.settings.barProgress = DEFAULT_SETTINGS.barProgress
    }
    // The cover story is one short line of plain text. Control characters are
    // stripped and the length is bounded, so it cannot break the row.
    if (typeof this.state.settings.barCoverText !== 'string') {
      this.state.settings.barCoverText = DEFAULT_SETTINGS.barCoverText
    } else {
      this.state.settings.barCoverText = this.state.settings.barCoverText
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .slice(0, 40)
    }
    await this.save()
    return this.state.settings
  }

  /**
   * Put every reading preference back to its shipped value.
   *
   * The library is not touched: the defaults are about how the reader looks
   * and where it is shown, not about which books it holds.
   *
   * @returns {Promise<object>} the restored settings
   */
  async resetSettings() {
    await this.load()
    this.state.settings = { ...DEFAULT_SETTINGS, libraryDirs: [...DEFAULT_SETTINGS.libraryDirs] }
    await this.save()
    return this.state.settings
  }

  /**
   * Dispatch one client request.
   * @param {object} request - parsed request body
   * @returns {Promise<object>} response body
   */
  async handle(request) {
    // The state is read before anything is changed: an action that changes
    // the state before the read would have its change thrown away by it.
    await this.load()
    const action = String(request.action || '')
    switch (action) {
      case 'fault': {
        // A client render fault: keep the last few so a blanked panel is
        // explainable from the Host side.
        const faults = Array.isArray(this.state.faults) ? this.state.faults : []
        faults.push({
          where: String(request.where || '').slice(0, 40),
          message: String(request.message || '').slice(0, 300),
          at: Date.now(),
        })
        this.state.faults = faults.slice(-10)
        await this.save()
        return { ok: true }
      }

      case 'state': {
        // The client asks for the state when the panel opens, so the time of
        // the last request says whether the panel is alive.
        const now = Date.now()
        if (this.state.lastContact === undefined || now - this.state.lastContact > 10000) {
          this.state.lastContact = now
          await this.save()
        }
        return { ok: true, ...(await this.snapshot()) }
      }
      case 'chapter': return { ok: true, chapter: await this.chapter(request) }
      // One cover at a time, as a data URL: the panel draws it in an image, and
      // keeping it on this authenticated route means no second, unguarded way
      // into the library files.
      case 'cover': {
        const cover = await this.coverOf(request.bookId)
        if (cover === null) return { ok: true, cover: null }
        return { ok: true, cover: { mime: cover.mime,
          data: `data:${cover.mime};base64,${cover.bytes.toString('base64')}` } }
      }
      case 'toc': return { ok: true, toc: await this.toc(request) }
      case 'search': return { ok: true, result: await this.search(request) }
      case 'open': return { ok: true, chapter: await this.open(request) }
      case 'position': return { ok: true, position: await this.position(request) }
      // The client says it mounted, so the faults of an earlier build are
      // stale: a build that works leaves no fault behind.
      case 'clearFaults':
        this.state.faults = []
        await this.save()
        return { ok: true }
      case 'next': return { ok: true, chapter: await this.step({ delta: 1 }) }
      case 'prev': return { ok: true, chapter: await this.step({ delta: -1 }) }
      case 'add_local': return { ok: true, book: await this.addLocal(request) }
      case 'add_web': return { ok: true, book: await this.addWeb(request) }
      case 'site_add': return { ok: true, site: await this.addSite(request) }
      case 'site_remove': return { ok: true, ...(await this.removeSite(request)) }
      case 'web_preview': return { ok: true, ...(await this.previewWeb(request)) }
      case 'web_confirm': return { ok: true, book: await this.confirmWeb(request) }
      case 'browser_cache': return { ok: true, ...(await this.cacheBrowserPage(request)) }
      case 'remove': return { ok: true, ...(await this.remove(request)) }
      case 'scan': return { ok: true, files: await this.scan(request) }
      case 'import_dir': {
        // Import every supported file in one folder: one click instead of one
        // click per file. The work is done in batches so the panel can show
        // progress instead of waiting in silence.
        const dir = resolveUserPath(request.dir)
        const files = await this.scan({ dirs: [dir] })
        const offset = Number.isInteger(request.offset) ? Math.max(request.offset, 0) : 0
        const limit = Number.isInteger(request.limit) ? Math.min(Math.max(request.limit, 1), 50) : 50
        const books = []
        for (const file of files.slice(offset, offset + limit)) {
          try {
            books.push(await this.addLocal({ path: file }))
          } catch {
            // A file that cannot be read is skipped; the rest still import.
          }
        }
        await this.save()
        return {
          ok: true,
          books,
          count: books.length,
          total: files.length,
          offset,
          done: offset + limit >= files.length,
        }
      }
      case 'settings': return { ok: true, settings: await this.updateSettings(request) }
      case 'reset_settings': return { ok: true, settings: await this.resetSettings() }
      case 'fetch': return { ok: true, chapter: await this.fetchAdhoc(request) }
      default: throw new ReaderError('unknown', 'Unknown action.')
    }
  }
}

/**
 * Find the catalog page a chapter page belongs to.
 *
 * A chapter page carries a link back to its table of contents, usually
 * labelled "目录". Following it is what lets a reader paste any page of a
 * book instead of hunting for the catalog first.
 *
 * @param {string} html - the page source
 * @param {string} baseUrl - the page's own URL
 * @returns {string | null} the catalog URL, or null when the page has none
 */
function findCatalogUrl(html, baseUrl, browser = false) {
  const root = parseHtmlDocument(html)
  const wanted = /^(?:目录|目錄|章节目录|章節目錄|返回目录|返回目錄|书目|書目|index|contents)$/i
  for (const anchor of selectAll(root, 'a')) {
    const text = textContent(anchor).replace(/\s+/g, ' ').trim()
    if (!wanted.test(text)) continue
    const href = anchor.attrs.href || ''
    if (href === '' || /^(javascript|#|mailto):/i.test(href)) continue
    try {
      const url = new URL(href, baseUrl).toString()
      // The catalog of a book sits above its chapters, so it must be shorter
      // than the page it was found on, or it is the page itself.
      if (!browser && url.length >= baseUrl.length) continue
      return url
    } catch {
      continue
    }
  }
  return null
}

/**
 * Collect chapter links from a catalog page.
 * @param {string} html - catalog page source
 * @param {string} baseUrl - catalog URL used to resolve relative links
 * @param {string} [selector] - optional link selector
 * @returns {Array<{ title: string, url: string }>} chapter list
 */
function extractChapterList(html, baseUrl, selector) {
  const root = parseHtmlDocument(html)
  const anchors = []
  const trimmed = selector && selector.trim() !== ''
  if (trimmed) {
    for (const node of selectAll(root, selector)) {
      // The selector may address the anchor itself or a list that holds them.
      if (node.tag === 'a') anchors.push(node)
      else anchors.push(...selectAll(node, 'a'))
    }
  } else {
    anchors.push(...selectAll(root, 'a'))
  }
  const chapters = []
  const seen = new Set()
  for (const anchor of anchors) {
    const title = textContent(anchor).replace(/\s+/g, ' ').trim()
    const href = anchor.attrs.href || ''
    if (title === '' || href === '' || /^(javascript|#|mailto):/i.test(href)) continue
    let url
    try {
      url = new URL(href, baseUrl).toString()
    } catch {
      continue
    }
    if (!/^https?:/i.test(url)) continue
    if (title.length > 60) continue
    if (!trimmed && !/第.{0,8}[章节節回卷篇话話]|\d+\s*章|chapter/i.test(title)) continue
    if (seen.has(url)) continue
    seen.add(url)
    chapters.push({ title, url })
    if (chapters.length >= 500) break
  }
  const ordered = orderChapters(chapters)
  if (ordered.length > 0) return ordered
  // No link carried a chapter title, so the catalog names its chapters some
  // other way. The links that share the most common shape are the chapters:
  // a catalog is hundreds of links of one shape, and the page around it is
  // a handful of other shapes.
  return orderChapters(chaptersByShape(anchors, baseUrl))
}

/**
 * Collect the links that share the catalog's own shape.
 *
 * A catalog is hundreds of links of one shape ("/book/1/12.html") beside a
 * handful of other links. The largest group is the chapters, which is what
 * makes a site whose chapter titles are not numbered still readable.
 *
 * @param {Array<any>} anchors - every link on the page
 * @param {string} baseUrl - the catalog URL, for resolving relative links
 * @returns {Array<{ title: string, url: string }>} the links of the largest shape
 */
function chaptersByShape(anchors, baseUrl) {
  const groups = new Map()
  for (const anchor of anchors) {
    const href = anchor.attrs.href || ''
    if (href === '' || /^(javascript|#|mailto):/i.test(href)) continue
    let url
    try {
      url = new URL(href, baseUrl).toString()
    } catch {
      continue
    }
    if (!/^https?:/i.test(url)) continue
    // The shape is the path with its numbers taken out, so every chapter of
    // one book falls into the same group.
    let path = ''
    try {
      path = new URL(url).pathname.replace(/\d+/g, '#')
    } catch {
      continue
    }
    const title = textContent(anchor).replace(/\s+/g, ' ').trim()
    if (title === '') continue
    const group = groups.get(path)
    if (group === undefined) groups.set(path, [{ title, url }])
    else group.push({ title, url })
  }
  let best = []
  for (const group of groups.values()) {
    if (group.length > best.length) best = group
  }
  // A handful of links is a menu, not a book.
  return best.length >= 5 ? best : []
}

// The number a chapter title carries: an Arabic one, or a Chinese one, which
// novel sites use for the first chapters before switching to Arabic.
const CHAPTER_NUMBER = /第\s*([0-9０-９]+|[一二三四五六七八九十百千万零两廿卅]+)\s*[章节節回卷部篇集话話]/

/**
 * Read the number a chapter title carries.
 * @param {string} title - the chapter title
 * @returns {number} the number, or -1 when the title carries none
 */
function chapterNumber(title) {
  const match = String(title || '').match(CHAPTER_NUMBER)
  if (match === null) return -1
  const raw = match[1]
  if (/^[0-9０-９]+$/.test(raw)) return Number(raw.replace(/[０-９]/g, digit => String('０１２３４５６７８９'.indexOf(digit))))
  // A Chinese numeral, which novel sites use for the opening chapters.
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let current = 0
  for (const char of raw) {
    if (digits[char] !== undefined) {
      current = digits[char]
      continue
    }
    const unit = units[char]
    if (unit === undefined) continue
    if (unit === 10000) {
      section = (section + current) * unit
      total += section
      section = 0
      current = 0
      continue
    }
    section += (current === 0 ? 1 : current) * unit
    current = 0
  }
  return total + section + current
}

/**
 * Put the chapters in reading order.
 *
 * A catalog page often lists the newest chapter first, so the list has to be
 * put back in order or the reader opens the book at its last chapter. The
 * order is only changed when every chapter carries a number and the numbers
 * are a permutation of 1..n, so an unusual catalog keeps the order the page
 * gave.
 *
 * @param {Array<{ title: string, url: string }>} chapters - the chapters as found
 * @returns {Array<{ title: string, url: string }>} the chapters in reading order
 */
function orderChapters(chapters) {
  if (chapters.length < 2) return chapters
  const numbers = chapters.map(chapter => chapterNumber(chapter.title))
  if (numbers.some(number => number < 1)) return chapters
  // A catalog usually lists the newest chapter first and then the book in
  // order, so a page that is already in order carries one out-of-place head.
  // The numbers have to look like one chapter each, or the page was not a
  // catalog and its order is kept.
  const sorted = numbers.slice().sort((left, right) => left - right)
  for (let at = 1; at < sorted.length; at += 1) {
    if (sorted[at] === sorted[at - 1]) return chapters
  }
  // The numbers have to cover most of 1..n, which a catalog does and a
  // sidebar of "latest chapters" does not.
  const span = sorted[sorted.length - 1] - sorted[0] + 1
  if (span > sorted.length * 2) return chapters
  const paired = chapters.map((chapter, at) => ({ chapter, number: numbers[at] }))
  paired.sort((left, right) => left.number - right.number)
  return paired.map(item => item.chapter)
}

/**
 * Read the document title of a page.
 * @param {string} html - page source
 * @returns {string} document title
 */
function extractPageTitle(html) {
  const root = parseHtmlDocument(html)
  const node = selectAll(root, 'title')[0] || selectAll(root, 'h1')[0]
  if (node === undefined) return ''
  return cleanBookTitle(textContent(node).replace(/\s+/g, ' ').trim())
}

// A novel site puts its own search keywords in the page title, joined by an
// underscore or a dash: "书名小说_作者_书名最新章节_笔趣阁". Only the name is
// the book.
const TITLE_SEPARATOR = /\s*[_|｜]\s*|\s+[-–—]\s+/

/**
 * Reduce a page title to the name of the book.
 *
 * The title of a novel page is written for a search engine: the name, then
 * the author, then the name again, then the site. The first segment that is
 * not one of those is the name.
 *
 * @param {string} raw - the page title as written
 * @returns {string} the name of the book
 */
function cleanBookTitle(raw) {
  const text = String(raw || '').trim()
  if (text === '') return ''
  const segments = text.split(TITLE_SEPARATOR).map(part => part.trim()).filter(part => part !== '')
  if (segments.length === 0) return text
  // The first segment carries the site's own tail on some sites
  // ("…小说", "…最新章节"), so it is trimmed of those words.
  const trimmed = segments[0]
    .replace(/(?:最新章节|无弹窗|全文免费阅读|全文阅读|小说|免费阅读)$/u, '')
    .trim()
  const name = trimmed === '' ? segments[0] : trimmed
  return name.length <= 60 ? name : name.slice(0, 60)
}

/**
 * Parse HTML into the shared element tree.
 * @param {string} html - page source
 * @returns {any} parsed root
 */
function parseHtmlDocument(html) {
  return parseHtml(html)
}

/**
 * Read a bounded JSON request body from a Node HTTP request.
 * @param {any} request - the incoming request
 * @returns {Promise<object>} parsed body
 */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Host half entry point.
 * @param {any} ctx - Cordis context
 * @returns {void}
 */
export function apply(ctx) {
  const service = new ReaderService()
  ctx.provide(name, service)

  /* The route is registered when the web server appears, not before: the
   * server may arrive after this plugin, and a profile without one must
   * still start. */
  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.webServer
    const dispose = webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (request, response) => {
        const connection = ctx.get('connection')
        if (connection !== undefined) {
          const rejection = connection.requestRejection({ headers: request.headers })
          if (rejection !== undefined) {
            response.statusCode = rejection
            response.end()
            return
          }
        }
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.setHeader('allow', 'POST')
          response.end()
          return
        }
        let body
        try {
          body = await readJsonBody(request)
        } catch {
          response.statusCode = 400
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ ok: false, error: 'invalid json' }))
          return
        }
        try {
          const result = await service.handle(body)
          response.statusCode = 200
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.setHeader('cache-control', 'no-store')
          response.end(JSON.stringify(result))
        } catch (error) {
          response.statusCode = 200
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.setHeader('cache-control', 'no-store')
          response.end(JSON.stringify({
            ok: false,
            code: error instanceof ReaderError ? error.code : 'failed',
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof ReaderError && error.format !== undefined ? { format: error.format } : {}),
            ...(error instanceof ReaderError && error.code === 'browserRequired' && error.need ? {
              need: {
                ...(typeof error.need.bookId === 'string' ? { bookId: error.need.bookId } : {}),
                ...(typeof error.need.siteId === 'string' ? { siteId: error.need.siteId } : {}),
                ...(typeof error.need.url === 'string' ? { url: error.need.url } : {}),
              },
            } : {}),
          }))
        }
      },
    })
    ctx.effect(() => dispose, 'stealth-reader.route')
  })

  const tools = ctx.get('tools')
  if (tools !== undefined) {
    const dispose = tools.register({
      name: 'doc_panel',
      description: 'Operate the local document panel: list its library, open a document, '
        + 'step through its sections, add a local .txt file or a web page, and scan a folder. '
        + 'The panel keeps document text out of the conversation by default; '
        + 'pass reveal=true only when the user explicitly asks for the text itself.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'open', 'chapter', 'toc', 'search', 'next', 'prev', 'add_local', 'add_web', 'fetch', 'remove', 'scan', 'import_dir'],
            description: 'library operation to perform',
          },
          book_id: { type: 'string', description: 'book identifier for open, chapter and remove' },
          index: { type: 'integer', description: 'zero-based chapter index for open and chapter' },
          path: { type: 'string', description: 'absolute path of a local .txt file for add_local' },
          dir: { type: 'string', description: 'folder of .txt files, for scan and import_dir' },
          url: { type: 'string', description: 'catalog page URL for add_web, or a chapter URL for fetch' },
          chapter_selector: { type: 'string', description: 'CSS selector matching chapter links on the catalog page' },
          content_selector: { type: 'string', description: 'CSS selector matching the chapter body' },
          name: { type: 'string', description: 'display title for add_web' },
          term: { type: 'string', description: 'text to look for with search' },
          reveal: { type: 'boolean', description: 'return the chapter text in the tool result' },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            book: { type: 'string' },
            title: { type: 'string' },
            index: { type: 'integer' },
            total: { type: 'integer' },
            characters: { type: 'integer' },
            text: { type: 'string' },
            books: { type: 'array' },
            files: { type: 'array' },
            count: { type: 'integer' },
            chapters: { type: 'integer' },
            current: { type: 'object' },
          },
        },
        render: (args, value) => {
          const data = value && typeof value === 'object' ? value : {}
          const lines = []
          // The rendered result is what reaches the session transcript, so it
          // carries counts and positions only: no title, no path.
          if (data.files !== undefined) {
            lines.push(`Panel scan found ${data.files.length} file(s).`)
          } else if (data.books !== undefined) {
            lines.push(`Panel library: ${data.books.length} document(s)`)
          } else if (data.count !== undefined) {
            lines.push(`Panel scan found ${data.count} file(s).`)
          } else if (data.toc !== undefined) {
            // The chapter titles stay out of the transcript.
            lines.push(`Panel contents: ${data.toc.total} chapter(s)`)
          } else if (data.result !== undefined && data.result.matches !== undefined) {
            lines.push(`Panel search: ${data.result.total} match(es) in ${data.result.matches.length} chapter(s)`)
          } else if (data.index !== undefined && data.total !== undefined) {
            lines.push(`Side panel position: ${(data.index ?? 0) + 1}/${data.total ?? 1}, ${data.characters ?? 0} chars`)
          } else if (data.book !== undefined) {
            lines.push('Added to the side panel.')
          } else {
            lines.push('Side panel updated.')
          }
          if (typeof data.text === 'string' && data.text !== '') lines.push(data.text)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async (args) => {
        const input = args && typeof args === 'object' ? args : {}
        const action = String(input.action || 'list')
        if (action === 'list') {
          const snapshot = await service.snapshot()
          // The names and the paths stay in the panel: the tool result must
          // not put a book title or a file path into the session.
          return {
            ok: true,
            books: snapshot.books.map(book => ({
              id: book.id,
              kind: book.kind,
              chapters: book.chapters,
            })),
            current: snapshot.current,
          }
        }
        if (action === 'scan') {
          const files = await service.scan({ dirs: input.dir ? [input.dir] : undefined })
          // The file names are the book titles, so only the count is reported.
          return { ok: true, files: files.map((_, position) => ({ index: position })), count: files.length }
        }
        if (action === 'add_local') {
          const book = await service.addLocal({ path: input.path })
          return { ok: true, book: book.id, chapters: book.chapterCount }
        }
        if (action === 'add_web') {
          const book = await service.addWeb({
            indexUrl: input.url,
            chapterSelector: input.chapter_selector,
            contentSelector: input.content_selector,
            title: input.name,
          })
          return { ok: true, book: book.id, chapters: book.chapterCount }
        }
        if (action === 'remove') {
          await service.remove({ bookId: input.book_id })
          return { ok: true, book: 'removed' }
        }
        if (action === 'fetch') {
          const chapter = await service.fetchAdhoc({ url: input.url, selector: input.content_selector })
          return {
            ok: true,
            index: chapter.index,
            total: chapter.total,
            characters: chapter.text.length,
            // The text is only returned when it is asked for explicitly.
            ...(input.reveal === true ? { text: chapter.text } : {}),
          }
        }
        if (action === 'toc') {
          const toc = await service.toc({ bookId: input.book_id })
          // The titles stay out of the transcript; the counts are enough.
          return {
            ok: true,
            toc: {
              total: toc.total,
              chapters: toc.chapters.map(entry => ({ index: entry.index })),
            },
          }
        }
        if (action === 'search') {
          const result = await service.search({ bookId: input.book_id, term: input.term })
          return {
            ok: true,
            result: {
              total: result.total,
              matches: result.matches.map(match => ({ index: match.index, count: match.count })),
            },
          }
        }
        const chapter = action === 'next'
          ? await service.step({ delta: 1 })
          : action === 'prev'
            ? await service.step({ delta: -1 })
            : await service.open({ bookId: input.book_id, index: input.index })
        return {
          ok: true,
          index: chapter.index,
          total: chapter.total,
          characters: chapter.text.length,
          ...(input.reveal === true ? { text: chapter.text } : {}),
        }
      },
    })
    ctx.effect(() => dispose, 'stealth-reader.tool')
  }
}
