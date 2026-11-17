/**
 * Dependency-free text helpers for the stealth reader Host half.
 *
 * Two jobs live here: turning a local .txt novel into chapters, and turning a
 * fetched web page into readable chapter text. Both stay offline and
 * deterministic; nothing here executes page script.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

/** Tags whose content never contributes readable prose. */
const NOISE_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'select', 'option'])

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', middot: '·', copy: '©', reg: '®',
  laquo: '«', raquo: '»', bull: '•', deg: '°', times: '×',
}

/**
 * Decode the HTML entities that novel pages actually use.
 * @param {string} input - raw text
 * @returns {string} decoded text
 */
export function decodeEntities(input) {
  return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named === undefined ? match : named
  })
}

/**
 * Parse HTML into a minimal element tree. Script and style bodies are
 * dropped before tokenizing so their contents cannot be mistaken for markup.
 * @param {string} html - page source
 * @returns {{ tag: string, attrs: Record<string, string>, children: Array<any>, parent: any }} root node
 */
export function parseHtml(html) {
  const source = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1\s*>/gi, '')
  const root = { tag: '#root', attrs: {}, children: [], parent: null }
  const stack = [root]
  const tokenizer = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)/g
  let match
  while ((match = tokenizer.exec(source)) !== null) {
    if (match[3] !== undefined) {
      const parent = stack[stack.length - 1]
      parent.children.push({ text: decodeEntities(match[3]), parent })
      continue
    }
    const raw = match[0]
    const tag = match[1].toLowerCase()
    const closing = raw.charAt(1) === '/'
    if (VOID_TAGS.has(tag)) {
      if (!closing) {
        const parent = stack[stack.length - 1]
        parent.children.push({ tag, attrs: parseAttributes(match[2] || ''), children: [], parent })
      }
      continue
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
      continue
    }
    const parent = stack[stack.length - 1]
    const node = { tag, attrs: parseAttributes(match[2] || ''), children: [], parent }
    parent.children.push(node)
    stack.push(node)
  }
  return root
}

/**
 * Parse an HTML attribute string into a plain map.
 * @param {string} raw - attribute source
 * @returns {Record<string, string>} attribute map
 */
function parseAttributes(raw) {
  const attrs = {}
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g
  let match
  while ((match = pattern.exec(raw)) !== null) {
    let value = match[2] === undefined ? '' : match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    attrs[match[1].toLowerCase()] = decodeEntities(value)
  }
  return attrs
}

/**
 * Read the readable text of one node, keeping block boundaries as newlines.
 * @param {any} node - element node
 * @returns {string} plain text
 */
export function textContent(node) {
  if (node === undefined || node === null) return ''
  if (typeof node.text === 'string') return node.text
  const parts = []
  for (const child of node.children || []) {
    if (typeof child.text === 'string') {
      parts.push(child.text)
      continue
    }
    if (NOISE_TAGS.has(child.tag)) continue
    if (child.tag === 'br') {
      parts.push('\n')
      continue
    }
    const inner = textContent(child)
    if (inner === '') continue
    if (BLOCK_TAGS.has(child.tag)) parts.push(`\n${inner}\n`)
    else parts.push(inner)
  }
  return parts.join('')
}

/**
 * Collapse runs of whitespace into single spaces and drop blank lines.
 * @param {string} value - raw text
 * @returns {string} normalized text
 */
// Lines that belong to the page, not to the story: the site's own navigation,
// its footer, its plea for a bookmark, its copyright note. A novel page is
// mostly story, so a line that is one of these is dropped rather than shown.
const PAGE_NOISE = [
  /^(?:上一[章章節节]|下一[章章節节]|目录|目錄|返回目录|返回目錄|章节目录|章節目錄|加入书签|加入書籤|加入收藏|投推荐票|投推薦票|推荐本书|推薦本書|返回书页|返回書頁|搜书|搜書|首页|首頁|书架|書架|我的书架|我的書架)$/,
  /^(?:作者|作\s*者|分类|分類|状态|狀態|字数|字數|更新时间|更新時間|最后更新|最後更新|最新章节|最新章節|本章字数|本章字數)\s*[:：]/,
  /^(?:最新网址|最新網址|请记住本站|請記住本站|记住本站|記住本站|本站域名|手机阅读|手機閱讀|手机版|手機版)\s*[:：]?/,
  /(?:请记住本书首发域名|請記住本書首發域名|一秒记住|一秒記住|更新最快|無彈窗|无弹窗|全文阅读|全文閱讀|免费阅读|免費閱讀)/,
  /(?:本章未完|本章未完，请点击下一页|點擊下一頁|点击下一页|下一頁繼續|下一页继续)/,
  /^(?:Copyright|©|版权所有|版權所有|All Rights Reserved)/i,
  /(?:请发邮件|請發郵件|版权人认为|版權人認為|本站确认后|本站確認後|网站地图|網站地圖|欢迎收藏本站|歡迎收藏本站)/,
  // A footer that explains the site's own reading controls.
  /(?:返回书目|返回書目|按\s*[←→]\s*键|按\s*[←→]\s*鍵|加入书签方便|加入書籤方便|开启瀑布流|開啟瀑布流|瀑布流阅读|瀑布流閱讀)/,
  // A line that says where the content came from.
  /(?:本站内容系|本站內容系|根据您的指令|根據您的指令|各大小说站|各大小說站|不代表.*(?:赞成|贊成)|内容或立场|內容或立場)/,
  // A bare "site" or "read" label that sits beside the title.
  /^(?:源网站|源網站|阅读吧|閱讀吧|源站|来源|來源|阅读网|閱讀網)$/,
  /^(?:www\.|[a-z0-9-]+\.(?:com|net|cc|org|cn|info|me|biz)\b)/i,
]

/**
 * Drop the lines a novel page carries that are not the novel.
 *
 * A chapter page is mostly story: its navigation, its metadata line and its
 * footer are a small, recognisable set. Dropping them is what makes the text
 * read as a chapter instead of as a web page.
 *
 * @param {string} text - the extracted text, one line per line
 * @returns {string} the text without the page's own lines
 */
export function stripPageNoise(text) {
  const lines = String(text).split('\n')
  const kept = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    // A recommendations block is the end of the page: everything after it is
    // a list of other books, not this chapter.
    if (PAGE_TAIL_MARKER.test(trimmed)) break
    if (PAGE_NOISE.some(pattern => pattern.test(trimmed))) continue
    kept.push(trimmed)
  }
  // A page that lost everything was not a novel page after all, so the text
  // is left as it came rather than shown empty.
  return kept.length === 0 ? String(text) : kept.join('\n')
}

// A line that starts the page's own tail: other books, a comment form, a
// copyright note. Everything after it is not this chapter.
const PAGE_TAIL_MARKER = /^(?:热门推荐|熱門推薦|相关推荐|相關推薦|猜你喜欢|猜你喜歡|推荐阅读|推薦閱讀|本站推荐|本站推薦|更多推荐|更多推薦|章节报错|章節報錯|求月票|月票|打赏|打賞|书友评论|書友評論|发表评论|發表評論|版权声明|版權聲明|免责声明|免責聲明)\s*[:：]?$/

function normalizeText(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0\u3000 ]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .join('\n')
}

/**
 * Test one element against a simple selector such as `div`, `#id`, `.cls`.
 * @param {any} node - element node
 * @param {string} simple - simple selector
 * @returns {boolean} whether the node matches
 */
function matchesSimple(node, simple) {
  const pattern = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][\w-]+)*)$/
  const match = pattern.exec(simple)
  if (match === null) return false
  const tag = match[1]
  if (tag !== undefined && node.tag !== tag.toLowerCase()) return false
  const rest = match[2] || ''
  const tokens = rest.match(/[.#][\w-]+/g) || []
  for (const token of tokens) {
    if (token.charAt(0) === '#') {
      if (node.attrs.id !== token.slice(1)) return false
    } else {
      const classes = (node.attrs.class || '').split(/\s+/).filter(Boolean)
      if (!classes.includes(token.slice(1))) return false
    }
  }
  return true
}

/**
 * Collect every element matching a comma-separated descendant selector.
 * @param {any} root - search root
 * @param {string} selector - selector string
 * @returns {any[]} matched elements in document order
 */
export function selectAll(root, selector) {
  const text = String(selector || '').trim()
  if (text === '') return []
  const groups = text.split(',').map(part => part.trim()).filter(part => part !== '')
  const found = []
  const seen = new Set()
  const walk = (node) => {
    for (const child of node.children || []) {
      if (typeof child.text !== 'string') {
        for (const group of groups) {
          const chain = group.split(/\s+/).filter(Boolean)
          if (chain.length === 1) {
            if (matchesSimple(child, chain[0])) {
              if (!seen.has(child)) {
                seen.add(child)
                found.push(child)
              }
            }
          } else if (matchChain(child, chain)) {
            if (!seen.has(child)) {
              seen.add(child)
              found.push(child)
            }
          }
        }
        walk(child)
      }
    }
  }
  walk(root)
  return found
}

/**
 * Match a descendant chain against one element.
 * @param {any} node - element node
 * @param {string[]} chain - selector chain
 * @returns {boolean} whether the chain matches
 */
function matchChain(node, chain) {
  if (!matchesSimple(node, chain[chain.length - 1])) return false
  if (chain.length === 1) return true
  let parent = node.parent
  const rest = chain.slice(0, -1)
  while (parent) {
    if (matchesSimple(parent, rest[rest.length - 1]) && matchChain(parent, rest)) return true
    parent = parent.parent
  }
  return false
}

/**
 * Score how likely an element holds the main article body.
 * @param {any} node - element node
 * @param {number} [minLength] - minimum text length worth considering
 * @returns {number} higher is more likely, -1 rejects the node
 */
function contentScore(node, minLength = 60) {
  const text = textContent(node)
  const length = text.replace(/\s+/g, '').length
  if (length < minLength) return -1
  const marker = `${node.attrs.id || ''} ${node.attrs.class || ''}`.toLowerCase()
  let score = length
  if (/(content|chapter|article|book|txt|text|read|main|showtxt|postbody|小说|正文|内容)/.test(marker)) score += length * 0.5
  const linkText = selectAll(node, 'a').map(textContent).join('').replace(/\s+/g, '').length
  score -= linkText * 1.5
  if (NOISE_TAGS.has(node.tag)) return -1
  return score
}

/**
 * Collect every element in the tree, in document order.
 * @param {any} root - search root
 * @returns {any[]} element nodes
 */
export function elements(root) {
  const found = []
  const walk = (node) => {
    for (const child of node.children || []) {
      if (typeof child.text === 'string') continue
      found.push(child)
      walk(child)
    }
  }
  walk(root)
  return found
}

/**
 * Extract readable chapter text from an HTML page.
 * @param {string} html - page source
 * @param {string} [selector] - optional content selector
 * @returns {{ title: string, text: string, strategy: string }} extracted text
 */
/**
 * Reduce a page title to the heading it names.
 *
 * A chapter page writes its title for a search engine: "第1章 名字_书名_分类
 * _站点". Only the first segment is the heading, and the rest is the site's
 * own tail.
 *
 * @param {string} raw - the page title as written
 * @returns {string} the heading
 */
/**
 * Drop a search-engine title that leaked into the first line of the text.
 *
 * Some pages repeat their own title inside the content block, written for a
 * search engine: "第1章 名字_书名_分类_站点". That line is a heading, not
 * text, so it goes.
 *
 * @param {string} text - the extracted text
 * @param {string} title - the heading the page names
 * @returns {string} the text without that line
 */
export function dropSearchTitle(text, title) {
  const body = typeof text === 'string' ? text : ''
  const heading = typeof title === 'string' ? title.trim() : ''
  if (heading === '') return body
  const lines = body.split('\n')
  const first = (lines[0] || '').trim()
  // The line is the heading with a search-engine tail, so it is long, it
  // holds the heading, and it carries one of the separators those titles use.
  if (!first.includes(heading)) return body
  if (!/[_|｜]/.test(first)) return body
  return lines.slice(1).join('\n').replace(/^\n+/, '')
}

export function cleanPageTitle(raw) {
  const text = String(raw || '').trim()
  if (text === '') return ''
  const first = text.split(/\s*[_|｜]\s*/)[0]
  return (first === undefined ? text : first).trim()
}

export function extractContent(html, selector) {
  const root = parseHtml(html)
  const titleNode = selectAll(root, 'title')[0] || selectAll(root, 'h1')[0]
  const title = titleNode ? cleanPageTitle(normalizeText(textContent(titleNode)).split('\n')[0]) : ''

  let best = null
  let strategy = 'none'
  if (selector && selector.trim() !== '') {
    for (const node of selectAll(root, selector)) {
      const score = contentScore(node, 1)
      if (score > 0 && (best === null || score > best.score)) best = { node, score }
    }
    if (best !== null) strategy = 'selector'
  }
  if (best === null) {
    const candidates = elements(root)
    for (const node of candidates) {
      if (!['div', 'article', 'section', 'main', 'td', 'dd', 'body'].includes(node.tag)) continue
      const score = contentScore(node)
      if (score > 0 && (best === null || score > best.score)) best = { node, score }
    }
    if (best !== null) strategy = 'auto'
  }
  const raw = best === null ? normalizeText(textContent(root)) : normalizeText(textContent(best.node))
  // The page's own navigation and footer are not the novel, so they are
  // dropped before the text reaches the reader.
  const text = stripPageNoise(raw)
  return { title, text: dropSearchTitle(text, title), strategy }
}

const CHAPTER_HEADING = /^\s*(?:(?:第\s*[0-9０-９一二三四五六七八九十百千万零两廿卅]+\s*[章节節回卷部篇集话話幕折])|(?:[Cc]hapter\s+\d+)|(?:序章|序言|楔子|引子|尾声|尾聲|后记|後記|番外|终章|終章|附录|附錄)|(?:[0-9０-９]{1,4}\s*[.、．]\s*\S)|(?:[0-9０-９]{1,4}\s*[章节節回卷部篇集话話幕折]))\s*.*$/

/**
 * Split a local novel file into chapters.
 * @param {string} text - file content
 * @returns {Array<{ title: string, text: string }>} chapter list
 */
export function splitTxtChapters(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const chapters = []
  let current = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed !== '' && trimmed.length <= 40 && CHAPTER_HEADING.test(trimmed)) {
      if (current !== null) chapters.push(current)
      current = { title: trimmed, lines: [] }
      continue
    }
    if (current === null) {
      if (trimmed === '') continue
      current = { title: '', lines: [] }
    }
    current.lines.push(line)
  }
  if (current !== null) chapters.push(current)
  if (chapters.length === 0) return [{ title: '', text: normalizeText(normalized) }]
  return chapters.map(chapter => ({
    title: chapter.title,
    text: normalizeText(chapter.lines.join('\n')),
  })).filter(chapter => chapter.text !== '' || chapters.length === 1)
}
