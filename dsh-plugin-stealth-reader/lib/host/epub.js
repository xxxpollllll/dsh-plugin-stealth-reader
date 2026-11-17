import { listZipEntries, readZipEntry } from './zip.js'
import { decodeEntities, parseHtml, textContent } from './extract.js'

/**
 * EPUB reader.
 *
 * An EPUB is a ZIP archive whose spine lists the reading order. This reader
 * resolves the package document, follows the spine and turns every content
 * document into a chapter of plain text.
 */

/**
 * Read the XML attribute of the first matching element.
 *
 * @param {string} xml - the document text
 * @param {string} tag - the tag name
 * @param {string} attribute - the attribute name
 * @returns {string} the attribute value, or an empty string
 */
function readAttribute(xml, tag, attribute) {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${attribute}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = pattern.exec(xml)
  return match === null ? '' : decodeEntities(match[1])
}

/**
 * Read the text of the first matching element.
 *
 * @param {string} xml - the document text
 * @param {string} tag - the tag name
 * @returns {string} the element text, or an empty string
 */
function readElementText(xml, tag) {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = pattern.exec(xml)
  if (match === null) return ''
  return decodeEntities(match[1].replace(/<[^>]*>/g, '')).trim()
}

/**
 * Resolve a relative path against a base path inside the archive.
 *
 * @param {string} base - the path of the referring file
 * @param {string} relative - the path to resolve
 * @returns {string} the resolved archive path
 */
function resolveArchivePath(base, relative) {
  const clean = String(relative || '').split('#')[0]
  if (clean === '') return ''
  if (/^[a-z]+:/i.test(clean)) return ''
  const parts = base.split('/')
  parts.pop()
  for (const segment of clean.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

/**
 * Extract the readable text of one content document.
 *
 * @param {string} html - the XHTML source
 * @returns {object} the title and the body text
 */
export function extractXhtml(html) {
  const source = String(html || '')
  // The document title is the usual chapter name.
  const headTitle = readElementText(source, 'title')
  let body = source
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)
  if (bodyMatch !== null) body = bodyMatch[1]
  const root = parseHtml(body)
  const paragraphs = []
  const blocks = root.children.filter(child => child.name === 'p' || child.name === 'div' || child.name === 'h1' || child.name === 'h2' || child.name === 'h3' || child.name === 'h4' || child.name === 'blockquote' || child.name === 'li')
  for (const block of blocks) {
    const text = textContent(block).trim()
    if (text !== '') paragraphs.push(text)
  }
  let text = paragraphs.join('\n\n')
  if (text === '') text = textContent(root).trim()
  // A leading heading repeats the chapter name.
  const heading = /^#{1,3}\s*(.+)$/m.exec(text)
  const title = headTitle !== '' ? headTitle : (heading !== null ? heading[1].trim() : '')
  return { title, text }
}

/**
 * Read an EPUB archive.
 *
 * @param {Buffer} buffer - the archive bytes
 * @returns {object} the title and the chapters
 */
export function readEpub(buffer) {
  const entries = listZipEntries(buffer)
  const names = entries.map(entry => entry.name)

  // The container points at the package document.
  const containerEntry = names.find(name => /(^|\/)META-INF\/container\.xml$/i.test(name))
  if (containerEntry === undefined) throw new Error('no container.xml')
  const container = readZipEntry(buffer, containerEntry).toString('utf8')
  const opfPath = readAttribute(container, 'rootfile', 'full-path')
  if (opfPath === '') throw new Error('no package document')

  const opf = readZipEntry(buffer, opfPath)
  if (opf === null) throw new Error('the package document is missing')
  const opfText = opf.toString('utf8')

  const title = readElementText(opfText, 'dc:title') || readElementText(opfText, 'title')

  // The manifest maps identifiers to files.
  const manifest = new Map()
  const itemPattern = /<item\b[^>]*>/gi
  let itemMatch = itemPattern.exec(opfText)
  while (itemMatch !== null) {
    const tag = itemMatch[0]
    const id = readAttribute(tag, 'item', 'id')
    const href = readAttribute(tag, 'item', 'href')
    const mediaType = readAttribute(tag, 'item', 'media-type')
    if (id !== '' && href !== '') {
      manifest.set(id, {
        href: resolveArchivePath(opfPath, decodeURIComponent(href)),
        mediaType,
      })
    }
    itemMatch = itemPattern.exec(opfText)
  }

  // The spine gives the reading order.
  const spine = []
  const itemrefPattern = /<itemref\b[^>]*>/gi
  let refMatch = itemrefPattern.exec(opfText)
  while (refMatch !== null) {
    const idref = readAttribute(refMatch[0], 'itemref', 'idref')
    if (idref !== '' && manifest.has(idref)) spine.push(manifest.get(idref))
    refMatch = itemrefPattern.exec(opfText)
  }

  const chapters = []
  for (const item of spine) {
    if (item.mediaType !== '' && !/xhtml|html/i.test(item.mediaType)) continue
    const bytes = readZipEntry(buffer, item.href)
    if (bytes === null) continue
    const extracted = extractXhtml(bytes.toString('utf8'))
    if (extracted.text === '') continue
    chapters.push({ title: extracted.title, text: extracted.text })
  }

  if (chapters.length === 0) throw new Error('the book has no readable chapters')
  return { title, chapters, cover: readCover(buffer, opfText, manifest) }
}

/**
 * Find the cover image of an EPUB, when it declares one.
 *
 * The EPUB 3 way is a manifest item with the `cover-image` property; the EPUB 2
 * way is a `<meta name="cover" content="id">` pointing at a manifest id. A book
 * that declares neither simply has no cover, which is not an error.
 *
 * @param {Buffer} buffer - the archive bytes
 * @param {string} opfText - the package document
 * @param {Map<string, { href: string, mediaType: string }>} manifest - manifest items
 * @returns {{ bytes: Buffer, mediaType: string } | null} the cover, or null
 */
function readCover(buffer, opfText, manifest) {
  const wanted = []
  // EPUB 3: the manifest item that says it is the cover image.
  const itemPattern = /<item\b[^>]*>/gi
  let itemMatch = itemPattern.exec(opfText)
  while (itemMatch !== null) {
    const tag = itemMatch[0]
    if (/\bproperties\s*=\s*"[^"]*\bcover-image\b/i.test(tag)) {
      const id = readAttribute(tag, 'item', 'id')
      if (id !== '') wanted.push(id)
    }
    itemMatch = itemPattern.exec(opfText)
  }
  // EPUB 2: a meta element naming the id of the cover.
  const metaPattern = /<meta\b[^>]*>/gi
  let metaMatch = metaPattern.exec(opfText)
  while (metaMatch !== null) {
    const tag = metaMatch[0]
    if (/\bname\s*=\s*"cover"/i.test(tag)) {
      const id = readAttribute(tag, 'meta', 'content')
      if (id !== '') wanted.push(id)
    }
    metaMatch = metaPattern.exec(opfText)
  }
  for (const id of wanted) {
    const item = manifest.get(id)
    if (item === undefined) continue
    if (item.mediaType !== '' && !/^image\//i.test(item.mediaType)) continue
    const bytes = readZipEntry(buffer, item.href)
    if (bytes === null || bytes.length === 0) continue
    return { bytes, mediaType: item.mediaType !== '' ? item.mediaType : mimeOf(item.href) }
  }
  return null
}

/**
 * The image type of a file name, for a cover the manifest did not label.
 * @param {string} name - the archive path
 * @returns {string} the media type
 */
function mimeOf(name) {
  const extension = String(name).toLowerCase().split('.').pop()
  if (extension === 'png') return 'image/png'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  return 'image/jpeg'
}
