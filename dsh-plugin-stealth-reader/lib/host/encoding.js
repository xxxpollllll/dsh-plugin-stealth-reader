/**
 * Text encoding detection.
 *
 * Chinese novels are frequently distributed as GBK. Reading them as UTF-8
 * produces replacement characters, and the chapter headings become
 * unreadable, so the whole book collapses into one chapter.
 */

/**
 * Decode a document buffer, detecting the encoding.
 *
 * @param {Buffer} buffer - the raw file bytes
 * @returns {string} the decoded text
 */
export function decodeText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const utf8 = bytes.toString('utf8')
  // A few replacement characters can be genuine; more than one percent of the
  // text means the file is not UTF-8 at all.
  const broken = (utf8.match(/�/g) || []).length
  if (broken <= 3 || broken * 100 < utf8.length) return utf8
  for (const encoding of ['gb18030', 'gbk', 'big5']) {
    try {
      const decoded = new TextDecoder(encoding).decode(bytes)
      const stillBroken = (decoded.match(/�/g) || []).length
      if (stillBroken < broken) return decoded
    } catch {
      // This encoding is unavailable in this runtime.
    }
  }
  return utf8
}
