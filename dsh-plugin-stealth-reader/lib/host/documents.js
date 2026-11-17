import path from 'node:path'
import fs from 'node:fs/promises'
import { decodeText } from './encoding.js'
import { extractContent, splitTxtChapters } from './extract.js'
import { readEpub } from './epub.js'
import { readDocx } from './docx.js'

/**
 * Document formats the reader understands.
 *
 * The kind is stored with the book so the panel can adapt its wording, and so
 * a book keeps its format when it is reopened.
 */
export const FORMATS = {
  txt: { extension: '.txt', label: 'Text' },
  epub: { extension: '.epub', label: 'EPUB' },
  md: { extension: '.md', label: 'Markdown' },
  html: { extension: '.html', label: 'HTML' },
  htm: { extension: '.htm', label: 'HTML' },
  docx: { extension: '.docx', label: 'Word' },
}

/**
 * Formats the reader recognises but cannot open.
 *
 * The panel names the format instead of saying "cannot read", so the user
 * knows what to convert the file with.
 */
export const UNSUPPORTED_FORMATS = {
  mobi: { extension: '.mobi', label: 'MOBI' },
  azw: { extension: '.azw', label: 'AZW' },
  azw3: { extension: '.azw3', label: 'AZW3' },
  pdf: { extension: '.pdf', label: 'PDF' },
  chm: { extension: '.chm', label: 'CHM' },
  fb2: { extension: '.fb2', label: 'FB2' },
  djvu: { extension: '.djvu', label: 'DjVu' },
}

/**
 * The formats that may be imported from a folder.
 *
 * @type {string[]}
 */
export const IMPORTABLE_EXTENSIONS = Object.keys(FORMATS).map(key => FORMATS[key].extension)

/**
 * Detect the format of a file from its name and its first bytes.
 *
 * The name gives the intended format; the bytes settle an EPUB, whose magic
 * number is a ZIP signature.
 *
 * @param {string} name - the file name
 * @param {Buffer} [head] - the first bytes of the file
 * @returns {string} the format kind
 */
export function detectFormat(name, head) {
  const lower = String(name || '').toLowerCase()
  const extension = path.extname(lower)
  if (extension === '.epub') return 'epub'
  if (extension === '.md' || extension === '.markdown') return 'md'
  if (extension === '.html' || extension === '.htm' || extension === '.xhtml') return 'html'
  if (extension === '.docx') return 'docx'
  if (extension === '.txt') {
    // A file named .txt that is really a ZIP archive is an EPUB.
    if (head !== undefined && head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) return 'epub'
    return 'txt'
  }
  for (const kind of Object.keys(UNSUPPORTED_FORMATS)) {
    if (UNSUPPORTED_FORMATS[kind].extension === extension) return kind
  }
  return 'txt'
}

/**
 * The display name of a format.
 *
 * @param {string} kind - the format kind
 * @returns {string} the name to show
 */
export function formatLabel(kind) {
  const supported = FORMATS[kind]
  if (supported !== undefined) return supported.label
  const unsupported = UNSUPPORTED_FORMATS[kind]
  if (unsupported !== undefined) return unsupported.label
  return 'Text'
}

/**
 * Whether a file name may be imported.
 *
 * @param {string} name - the file name
 * @returns {boolean} true when the file can be a document
 */
export function isReadableDocument(name) {
  const file = String(name || '')
  if (file.startsWith('.') || file.startsWith('._')) return false
  const extension = path.extname(file).toLowerCase()
  return IMPORTABLE_EXTENSIONS.includes(extension)
}

/**
 * Split a Markdown document into chapters.
 *
 * A level-one heading starts a chapter; other headings stay with the text.
 *
 * @param {string} text - the Markdown source
 * @returns {object[]} the chapters
 */
export function splitMarkdownChapters(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const chapters = []
  let current = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#\s+\S/.test(trimmed) && trimmed.length <= 80) {
      if (current !== null) chapters.push(current)
      current = { title: trimmed.replace(/^#\s+/, '').trim(), lines: [] }
      continue
    }
    if (current === null) {
      if (trimmed === '') continue
      current = { title: '', lines: [] }
    }
    current.lines.push(line)
  }
  if (current !== null) chapters.push(current)
  if (chapters.length === 0) return [{ title: '', text: normalized.trim() }]
  return chapters.map(chapter => ({
    title: chapter.title,
    text: chapter.lines.join('\n').trim(),
  })).filter(chapter => chapter.text !== '' || chapters.length === 1)
}

/**
 * Split Word paragraphs into chapters at the Heading 1 paragraphs.
 *
 * @param {string[]} paragraphs - the document paragraphs
 * @param {string[]} headings - the heading texts, in order
 * @returns {object[]} the chapters
 */
export function splitDocxChapters(paragraphs, headings) {
  if (headings.length === 0) {
    return [{ title: '', text: paragraphs.join('\n\n') }]
  }
  const wanted = new Set(headings)
  const chapters = []
  let current = null
  for (const paragraph of paragraphs) {
    if (wanted.has(paragraph.trim()) && paragraph.trim() !== '') {
      if (current !== null) chapters.push(current)
      current = { title: paragraph.trim(), lines: [] }
      continue
    }
    if (current === null) current = { title: '', lines: [] }
    current.lines.push(paragraph)
  }
  if (current !== null) chapters.push(current)
  if (chapters.length === 0) return [{ title: '', text: paragraphs.join('\n\n') }]
  return chapters.map(chapter => ({
    title: chapter.title,
    text: chapter.lines.join('\n\n'),
  })).filter(chapter => chapter.text !== '' || chapters.length === 1)
}

/**
 * Read one document into its chapters.
 *
 * @param {string} file - the absolute file path
 * @param {string} kind - the detected format
 * @returns {Promise<object>} the title and the chapters
 */
export async function readDocument(file, kind) {
  // A format the reader cannot open is named, so the panel can say which.
  const unsupported = UNSUPPORTED_FORMATS[kind]
  if (unsupported !== undefined) {
    const failure = new Error(`${unsupported.label} documents are not supported.`)
    failure.code = 'unsupportedFormat'
    failure.format = unsupported.label
    throw failure
  }
  const bytes = await fs.readFile(file)
  const stem = path.basename(file).replace(/\.[^.]+$/, '')
  if (kind === 'epub') {
    const book = readEpub(bytes)
    return { title: book.title, chapters: book.chapters, cover: book.cover ?? null }
  }
  if (kind === 'docx') {
    const document = readDocx(bytes)
    // A Word document becomes one chapter per Heading 1 paragraph; a
    // document without headings stays a single chapter.
    const chapters = splitDocxChapters(document.paragraphs, document.headings)
    return { title: document.title !== '' ? document.title : stem, chapters }
  }
  const text = decodeText(bytes)
  if (kind === 'md') {
    return { title: stem, chapters: splitMarkdownChapters(text) }
  }
  if (kind === 'html') {
    const extracted = extractContent(text)
    const body = extracted.text !== '' ? extracted.text : text
    return {
      title: extracted.title !== '' ? extracted.title : stem,
      chapters: splitTxtChapters(body),
    }
  }
  return { title: stem, chapters: splitTxtChapters(text) }
}
