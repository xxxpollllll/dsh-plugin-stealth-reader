import zlib from 'node:zlib'

/**
 * Minimal, dependency-free ZIP reader.
 *
 * EPUB files are ZIP archives. The bundle has no dependencies, so the
 * central directory is parsed directly and the entries are inflated with
 * Node's built-in zlib.
 */

const EOCD_SIGNATURE = 0x06054b50
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50
const EOCD64_SIGNATURE = 0x06064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/**
 * Find the end-of-central-directory record.
 *
 * @param {Buffer} buffer - the archive bytes
 * @returns {number} the offset of the record, or -1
 */
function findEocd(buffer) {
  // The record is at the end, after an optional comment of up to 64 KiB.
  const start = Math.max(0, buffer.length - 0x10000 - 22)
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/**
 * Read one archive entry.
 *
 * @param {Buffer} buffer - the archive bytes
 * @param {object} entry - the central directory entry
 * @returns {Buffer} the uncompressed bytes
 */
function readEntry(buffer, entry) {
  const localOffset = entry.localHeaderOffset
  if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new Error('bad local header')
  }
  // The local header repeats the name and extra field lengths.
  const nameLength = buffer.readUInt16LE(localOffset + 26)
  const extraLength = buffer.readUInt16LE(localOffset + 28)
  const dataStart = localOffset + 30 + nameLength + extraLength
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.compressionMethod === 0) return Buffer.from(data)
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(data)
  throw new Error(`unsupported compression method ${entry.compressionMethod}`)
}

/**
 * List the entries of a ZIP archive.
 *
 * @param {Buffer} buffer - the archive bytes
 * @returns {object[]} the entries, with name, size and a read method
 */
export function listZipEntries(buffer) {
  const eocd = findEocd(buffer)
  if (eocd < 0) throw new Error('not a zip archive')

  let entryCount = buffer.readUInt16LE(eocd + 10)
  let directoryOffset = buffer.readUInt32LE(eocd + 16)

  // ZIP64: the 32-bit fields are placeholders and the real values live in a
  // separate record.
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    for (let offset = eocd - 20; offset >= 0; offset -= 1) {
      if (buffer.readUInt32LE(offset) === EOCD64_LOCATOR_SIGNATURE) {
        const zip64 = Number(buffer.readBigUInt64LE(offset + 8))
        if (buffer.readUInt32LE(zip64) === EOCD64_SIGNATURE) {
          entryCount = Number(buffer.readBigUInt64LE(zip64 + 32))
          directoryOffset = Number(buffer.readBigUInt64LE(zip64 + 48))
        }
        break
      }
    }
  }

  const entries = []
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) break
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    let compressedSize = buffer.readUInt32LE(offset + 20)
    let uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    let localHeaderOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)

    // ZIP64 extra field: the real sizes and offset live there.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let extra = offset + 46 + nameLength
      const extraEnd = extra + extraLength
      while (extra + 4 <= extraEnd) {
        const headerId = buffer.readUInt16LE(extra)
        const dataSize = buffer.readUInt16LE(extra + 2)
        if (headerId === 0x0001) {
          let field = extra + 4
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = Number(buffer.readBigUInt64LE(field))
            field += 8
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(buffer.readBigUInt64LE(field))
            field += 8
          }
          if (localHeaderOffset === 0xffffffff) {
            localHeaderOffset = Number(buffer.readBigUInt64LE(field))
          }
          break
        }
        extra += 4 + dataSize
      }
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      read: () => readEntry(buffer, {
        compressionMethod,
        compressedSize,
        localHeaderOffset,
      }),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/**
 * Read one named entry of a ZIP archive.
 *
 * @param {Buffer} buffer - the archive bytes
 * @param {string} name - the entry name
 * @returns {Buffer | null} the bytes, or null when the entry is absent
 */
export function readZipEntry(buffer, name) {
  const wanted = normaliseZipName(name)
  for (const entry of listZipEntries(buffer)) {
    if (normaliseZipName(entry.name) === wanted) return entry.read()
  }
  return null
}

/**
 * Normalise an entry name for comparison.
 *
 * @param {string} name - the entry name
 * @returns {string} the comparable name
 */
function normaliseZipName(name) {
  return String(name || '').replace(/^\.?\//, '').toLowerCase()
}
