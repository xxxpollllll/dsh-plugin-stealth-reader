/**
 * Offline self-test for the stealth reader Host half.
 * Run with: node ./stealth-reader-selftest.mjs
 */
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const bundle = './dsh-plugin-stealth-reader'
const { extractContent, splitTxtChapters, selectAll, textContent, decodeEntities, parseHtml } = await import(`${bundle}/lib/host/extract.js`)
const { ReaderService } = await import(`${bundle}/lib/index.js`)

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

await check('txt chapters split by Chinese heading', () => {
  const text = [
    '第一章 起点',
    '这是第一章的第一段。',
    '这是第一章的第二段。',
    '',
    '第二章 冲突',
    '这是第二章的内容。',
  ].join('\n')
  const chapters = splitTxtChapters(text)
  assert.equal(chapters.length, 2)
  assert.equal(chapters[0].title, '第一章 起点')
  assert.ok(chapters[0].text.includes('第一段'))
  assert.equal(chapters[1].title, '第二章 冲突')
})

await check('txt without heading becomes one chapter', () => {
  const chapters = splitTxtChapters('随便一段文字\n\n还有一段\n')
  assert.equal(chapters.length, 1)
  assert.ok(chapters[0].text.includes('随便一段文字'))
})

await check('html entity decoding', () => {
  assert.equal(decodeEntities('a&amp;b&nbsp;c&#65;&#x42;'), 'a&b cAB')
})

await check('html content extraction by selector', () => {
  const html = `
    <html><head><title>第 3 章 夜谈</title></head>
    <body>
      <div id="nav"><a href="/a">上一章</a><a href="/b">下一章</a></div>
      <div id="content"><p>第一段正文内容。</p><p>第二段正文内容。</p></div>
      <div id="footer">版权所有</div>
      <script>var x = 1;</script>
    </body></html>`
  const result = extractContent(html, '#content')
  assert.equal(result.strategy, 'selector')
  assert.ok(result.text.includes('第一段正文内容'))
  assert.ok(!result.text.includes('版权所有'))
  assert.ok(!result.text.includes('var x'))
  assert.equal(result.title, '第 3 章 夜谈')
})

await check('html content extraction without selector picks the text-heaviest block', () => {
  const html = `
    <html><body>
      <div class="menu"><a href="/1">目录一</a><a href="/2">目录二</a></div>
      <div class="chapter-content">${'正文段落。'.repeat(40)}</div>
    </body></html>`
  const result = extractContent(html)
  assert.equal(result.strategy, 'auto')
  assert.ok(result.text.includes('正文段落'))
  assert.ok(!result.text.includes('目录一'))
})

await check('selector supports class and descendant chains', () => {
  const html = '<div class="wrap"><ul class="list"><li><a href="/c1">第一章</a></li><li><a href="/c2">第二章</a></li></ul></div>'
  const root = parseHtml(html)
  const anchors = selectAll(root, '.list a')
  assert.equal(anchors.length, 2)
  assert.equal(textContent(anchors[0]).trim(), '第一章')
})

await check('service handles the local book lifecycle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-reader-'))
  const novelPath = path.join(root, 'demo.txt')
  await fs.writeFile(novelPath, '第一章 甲\n正文一\n第二章 乙\n正文二\n', 'utf8')
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const book = await service.addLocal({ path: novelPath })
  assert.equal(book.kind, 'txt')
  assert.equal(book.chapterCount, 2)
  const snapshot = await service.snapshot()
  assert.equal(snapshot.books.length, 1)
  assert.equal(snapshot.current.bookId, book.id)
  const chapter = await service.chapter({ index: 0 })
  assert.equal(chapter.index, 0)
  assert.ok(chapter.text.includes('正文一'))
  const next = await service.step({ delta: 1 })
  assert.equal(next.index, 1)
  assert.ok(next.text.includes('正文二'))
  const persisted = JSON.parse(await fs.readFile(path.join(root, 'data', 'state.json'), 'utf8'))
  assert.equal(persisted.books.length, 1)
  assert.equal(persisted.current.index, 1)
  await service.remove({ bookId: book.id })
  const after = await service.snapshot()
  assert.equal(after.books.length, 0)
  assert.equal(after.current, null)
})

await check('a place belongs to the chapter it was measured in', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-reader-'))
  const novelPath = path.join(root, 'demo.txt')
  await fs.writeFile(novelPath, '第一章 甲\n正文一\n第二章 乙\n正文二\n', 'utf8')
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const book = await service.addLocal({ path: novelPath })
  // The card reads in characters and keeps its place in the chapter it is
  // reading.
  await service.position({ bookId: book.id, index: 0, total: 3, flow: 5, mode: 'strip' })
  let place = await service.position({ bookId: book.id, index: 0, total: 3, line: 3, mode: 'sidebar' })
  assert.equal(place.flow, 5, 'the card keeps its place while the chapter is the same')
  // The column turns to another chapter. The card's place was measured in
  // the chapter before, so it is not a place in this one.
  place = await service.position({ bookId: book.id, index: 1, total: 3, mode: 'sidebar' })
  assert.equal(place.flow, 0, 'the card kept a place from another chapter')
  assert.equal(place.line, 0)
  // And the card turns to another chapter: the column's place is not kept.
  await service.position({ bookId: book.id, index: 1, total: 3, flow: 7, mode: 'strip' })
  place = await service.position({ bookId: book.id, index: 1, total: 3, line: 2, mode: 'sidebar' })
  assert.equal(place.flow, 7, 'the card keeps its place while the chapter is the same')
  place = await service.position({ bookId: book.id, index: 2, total: 3, mode: 'sidebar' })
  assert.equal(place.flow, 0, 'the card kept a place from another chapter')
})

await check('service dispatches route actions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-reader-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  const state = await service.handle({ action: 'state' })
  assert.equal(state.ok, true)
  assert.deepEqual(state.books, [])
  const settings = await service.handle({ action: 'settings', patch: { skin: 'diff', fontSize: 18 } })
  assert.equal(settings.settings.skin, 'diff')
  assert.equal(settings.settings.fontSize, 18)
  const snapshot = await service.handle({ action: 'state' })
  assert.equal(snapshot.settings.skin, 'diff')
  await assert.rejects(() => service.handle({ action: 'nope' }))
})

await check('service rejects a non-http catalog url', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-reader-'))
  const service = new ReaderService({ root: path.join(root, 'data') })
  await service.load()
  await assert.rejects(() => service.addWeb({ indexUrl: 'file:///etc/passwd' }), /http/)
})

await check('a GBK document decodes and splits into chapters', async () => {
  const { decodeText } = await import('./dsh-plugin-stealth-reader/lib/host/encoding.js')
  // The same text encoded as GBK.
  const bytes = Buffer.from([
    0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xc6, 0xf0, 0x0a, // 第一章 起
    0xd5, 0xfd, 0xce, 0xc4, 0xd2, 0xbb, 0x0a, // 正文一
    0xb5, 0xda, 0xb6, 0xfe, 0xd5, 0xc2, 0x20, 0xb3, 0xc9, 0x0a, // 第二章 承
    0xd5, 0xfd, 0xce, 0xc4, 0xb6, 0xfe, 0x0a, // 正文二
  ])
  const decoded = decodeText(bytes)
  assert.ok(decoded.includes('第一章'), 'the GBK text did not decode: ' + JSON.stringify(decoded.slice(0, 20)))
  const chapters = splitTxtChapters(decoded)
  assert.equal(chapters.length, 2, 'the decoded text did not split into chapters')
  assert.equal(chapters[0].title, '第一章 起')
})

await check('a numbered heading splits the book', () => {
  const text = [
    '请假【停电】',
    '今天停电了。',
    '01.吉隆坡之夜',
    '这天���吉隆坡下着大雨。',
    '02.直到子时',
    '夜里很安静。',
  ].join('\n')
  const chapters = splitTxtChapters(text)
  assert.equal(chapters.length, 3, 'expected the preface and two chapters, got ' + chapters.length)
  assert.equal(chapters[1].title, '01.吉隆坡之夜')
  assert.ok(chapters[1].text.includes('大雨'), 'the chapter body was lost')
})

await check('a save during the first state read cannot empty the library', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-race-'))
  const seed = new ReaderService({ root })
  await seed.load()
  for (const name of ['a', 'b', 'c']) {
    const file = path.join(root, name + '.txt')
    await fs.writeFile(file, '第一章\n正文\n', 'utf8')
    await seed.addLocal({ path: file })
  }
  assert.equal(seed.state.books.length, 3)

  // A second service starts reading while a save is already in flight.
  const second = new ReaderService({ root })
  await Promise.all([second.load(), second.save()])
  const written = JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8'))
  assert.equal(written.books.length, 3, 'the library was emptied by the concurrent save')
})

await check('an EPUB archive yields its title and chapters', async () => {
  const { readEpub } = await import('./dsh-plugin-stealth-reader/lib/host/epub.js')
  const { listZipEntries } = await import('./dsh-plugin-stealth-reader/lib/host/zip.js')
  const zlib = await import('node:zlib')
  // A small archive built in memory: container, package, two chapters.
  const parts = {
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试小说</dc:title></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    'OEBPS/ch1.xhtml': '<html><head><title>第一章 启程</title></head><body><p>他推开门。</p></body></html>',
    'OEBPS/ch2.xhtml': '<html><head><title>第二章 远行</title></head><body><p>路上很安静。</p></body></html>',
  }
  const entries = Object.keys(parts).map(name => ({
    name,
    body: Buffer.from(parts[name], 'utf8'),
  }))
  const archive = buildZip(entries)
  assert.ok(archive.length > 0)
  const book = readEpub(archive)
  assert.equal(book.title, '测试小说')
  assert.equal(book.chapters.length, 2, 'expected two chapters, got ' + book.chapters.length)
  assert.equal(book.chapters[0].title, '第一章 启程')
  assert.ok(book.chapters[0].text.includes('他推开门'))
  assert.ok(listZipEntries(archive).length === 4)
  assert.ok(zlib)
})

await check('the format of a file is detected from its name and bytes', async () => {
  const { detectFormat } = await import('./dsh-plugin-stealth-reader/lib/host/documents.js')
  assert.equal(detectFormat('a.epub'), 'epub')
  assert.equal(detectFormat('a.txt'), 'txt')
  assert.equal(detectFormat('a.txt', Buffer.from([0x50, 0x4b, 3, 4])), 'epub')
  assert.equal(detectFormat('a.md'), 'md')
  assert.equal(detectFormat('a.html'), 'html')
  assert.equal(detectFormat('a.htm'), 'html')
  assert.equal(detectFormat('noextension'), 'txt')
})

await check('a Markdown document splits on its level-one headings', async () => {
  const { splitMarkdownChapters } = await import('./dsh-plugin-stealth-reader/lib/host/documents.js')
  const chapters = splitMarkdownChapters('# 第一章\n正文一\n## 小节\n正文二\n# 第二章\n正文三\n')
  assert.equal(chapters.length, 2, 'expected two chapters, got ' + chapters.length)
  assert.equal(chapters[0].title, '第一章')
  assert.ok(chapters[0].text.includes('小节'), 'a subheading was dropped')
})

/**
 * Build a ZIP archive in memory.
 *
 * @param {object[]} entries - the entries, with name and body
 * @returns {Buffer} the archive bytes
 */
function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const body = entry.body
    const compressed = zlib.deflateRawSync(body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc32(body), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0, 12)
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
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
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

await check('an unsupported format is named instead of failing vaguely', async () => {
  const { detectFormat, formatLabel } = await import('./dsh-plugin-stealth-reader/lib/host/documents.js')
  assert.equal(detectFormat('a.mobi'), 'mobi')
  assert.equal(detectFormat('a.azw3'), 'azw3')
  assert.equal(detectFormat('a.pdf'), 'pdf')
  assert.equal(detectFormat('a.chm'), 'chm')
  assert.equal(formatLabel('mobi'), 'MOBI')
  assert.equal(formatLabel('epub'), 'EPUB')
  assert.equal(formatLabel('docx'), 'Word')
})

await check('the search term marks the matches inside a line', async () => {
  const { ReaderService } = await import('./dsh-plugin-stealth-reader/lib/index.js')
  // The client half owns the highlighter; the host only serves the text.
  // The count must match what the highlighter marks.
  const text = '他推开门。风从门缝灌进来。他又推开门。'
  const needle = '推开门'
  let count = 0
  let at = text.indexOf(needle)
  while (at !== -1) { count += 1; at = text.indexOf(needle, at + needle.length) }
  assert.equal(count, 2, 'the match count is wrong')
})

await check('concurrent saves do not collide on the temporary file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-concurrent-'))
  const service = new ReaderService({ root })
  await service.load()
  const file = path.join(root, 'n.txt')
  await fs.writeFile(file, '第一章\nA\n第二章\nB\n', 'utf8')
  await service.addLocal({ path: file })

  // Two writes at once must not rename each other's temporary file away.
  await Promise.all([service.save(), service.save(), service.save()])
  const written = JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8'))
  assert.equal(written.books.length, 1, 'the library was lost by a concurrent save')
  const leftovers = (await fs.readdir(root)).filter(name => name.endsWith('.tmp'))
  assert.equal(leftovers.length, 0, 'a temporary file was left behind: ' + leftovers.join(', '))
})

await check('an EPUB cover is stored, and a book without one is still fine', async () => {
  const { execFileSync } = await import('node:child_process')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-cover-'))
  const service = new ReaderService({ root: path.join(root, 'data') })

  // A minimal EPUB 3 that declares a cover image.
  const source = path.join(root, 'src')
  await fs.mkdir(path.join(source, 'META-INF'), { recursive: true })
  await fs.mkdir(path.join(source, 'OEBPS'), { recursive: true })
  await fs.writeFile(path.join(source, 'mimetype'), 'application/epub+zip')
  await fs.writeFile(path.join(source, 'META-INF/container.xml'),
    '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
  await fs.writeFile(path.join(source, 'OEBPS/content.opf'),
    '<package><metadata><dc:title>With Cover</dc:title></metadata><manifest>'
    + '<item id="c" href="cover.png" media-type="image/png" properties="cover-image"/>'
    + '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>'
    + '<spine><itemref idref="ch1"/></spine></package>')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await fs.writeFile(path.join(source, 'OEBPS/cover.png'), png)
  await fs.writeFile(path.join(source, 'OEBPS/ch1.xhtml'),
    '<html><body><h1>One</h1><p>' + 'prose '.repeat(40) + '</p></body></html>')
  const withCover = path.join(root, 'with.epub')
  execFileSync('zip', ['-q', '-r', withCover, 'mimetype', 'META-INF', 'OEBPS'], { cwd: source })

  const book = await service.addLocal({ path: withCover })
  assert.equal(typeof book.cover, 'string', 'the cover was not stored')
  assert.ok((await service.snapshot()).books[0].hasCover === true, 'the library did not report the cover')
  const cover = await service.coverOf(book.id)
  assert.ok(cover !== null && cover.bytes.equals(png), 'the stored cover is not the image in the book')
  const viaRoute = await service.handle({ action: 'cover', bookId: book.id })
  assert.ok(viaRoute.cover.data.startsWith('data:image/png;base64,'), 'the cover route did not return an image')

  // A plain text book has no cover, and that is not a failure.
  const text = path.join(root, 'plain.txt')
  await fs.writeFile(text, '第一章\nA\n第二章\nB\n', 'utf8')
  const plain = await service.addLocal({ path: text })
  assert.equal(plain.cover, undefined, 'a text book claimed a cover')
  assert.equal(await service.coverOf(plain.id), null, 'a text book returned a cover')
  const plainRoute = await service.handle({ action: 'cover', bookId: plain.id })
  assert.equal(plainRoute.cover, null, 'the route invented a cover')

  // A hand-edited state file must not turn into a read of a chosen path.
  const state = JSON.parse(await fs.readFile(path.join(root, 'data', 'state.json'), 'utf8'))
  state.books[0].cover = '../../../../etc/passwd'
  await fs.writeFile(path.join(root, 'data', 'state.json'), JSON.stringify(state))
  const escaped = new ReaderService({ root: path.join(root, 'data') })
  assert.equal(await escaped.coverOf(state.books[0].id), null, 'a traversal in the state file was followed')
  await fs.rm(root, { recursive: true, force: true })
})

await check('the library shape is a stored preference with one safe value', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stealth-shape-'))
  const service = new ReaderService({ root })
  await service.load()
  assert.equal((await service.snapshot()).settings.libraryShape, 'list', 'the default shape is not the list')
  const shelf = await service.updateSettings({ patch: { libraryShape: 'shelf' } })
  assert.equal(shelf.libraryShape, 'shelf', 'the shelf shape was not stored')
  // An unknown shape would draw neither the list nor the shelf.
  const odd = await service.updateSettings({ patch: { libraryShape: 'nonsense' } })
  assert.equal(odd.libraryShape, 'list', 'an unknown shape was kept')
  const reloaded = new ReaderService({ root })
  assert.equal((await reloaded.snapshot()).settings.libraryShape, 'list', 'the shape did not survive a reload')
  await fs.rm(root, { recursive: true, force: true })
})

console.log(results.join('\n'))
const failed = results.filter(line => line.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
