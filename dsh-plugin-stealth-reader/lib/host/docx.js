import { readZipEntry } from './zip.js'
import { decodeEntities, parseHtml, textContent } from './extract.js'

/**
 * DOCX reader.
 *
 * A DOCX file is a ZIP archive whose `word/document.xml` holds the text.
 * Paragraphs are separated by `w:p` elements and tabs and line breaks by
 * `w:tab` and `w:br`.
 */

/**
 * Turn one WordprocessingML document into paragraphs.
 *
 * @param {string} xml - the document XML
 * @returns {object[]} the paragraphs
 */
export function parseDocxParagraphs(xml) {
  const source = String(xml || '')
  const paragraphs = []
  const paragraphPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let match = paragraphPattern.exec(source)
  while (match !== null) {
    const body = match[1]
    // A tab and a break are the run-level forms of a separator.
    const prepared = body
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<w:cr\b[^>]*\/>/g, '\n')
    const root = parseHtml(prepared)
    const text = textContent(root)
    if (text.trim() !== '') paragraphs.push(text)
    match = paragraphPattern.exec(source)
  }
  return paragraphs
}

/**
 * Read the heading style of a paragraph, when it carries one.
 *
 * @param {string} xml - the document XML
 * @returns {string[]} the headings, in order
 */
function readHeadings(xml) {
  const headings = []
  const pattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let match = pattern.exec(xml)
  while (match !== null) {
    if (/w:val\s*=\s*"(?:Heading|标题|heading)1"/i.test(match[1])) {
      const root = parseHtml(match[1].replace(/<w:tab\b[^>]*\/>/g, '\t'))
      const text = textContent(root).trim()
      if (text !== '') headings.push(text)
    }
    match = pattern.exec(xml)
  }
  return headings
}

/**
 * Read a DOCX archive.
 *
 * @param {Buffer} buffer - the archive bytes
 * @returns {object} the title and the chapters
 */
export function readDocx(buffer) {
  const document = readZipEntry(buffer, 'word/document.xml')
  if (document === null) throw new Error('no document.xml')
  const xml = document.toString('utf8')

  const core = readZipEntry(buffer, 'docProps/core.xml')
  let title = ''
  if (core !== null) {
    const coreText = core.toString('utf8')
    const match = /<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(coreText)
    if (match !== null) title = decodeEntities(match[1].replace(/<[^>]*>/g, '')).trim()
  }

  const paragraphs = parseDocxParagraphs(xml)
  if (paragraphs.length === 0) throw new Error('the document has no text')
  const headings = readHeadings(xml)
  return { title, paragraphs, headings }
}
