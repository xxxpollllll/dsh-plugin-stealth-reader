/** Public site metadata only. Authentication belongs to the site's browser session. */
import { createHash } from 'node:crypto'

/** Normalize an explicit HTTP(S) address without accepting embedded credentials. */
export function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new TypeError('Enter an HTTP or HTTPS URL.')
  const input = value.trim()
  if (!/^https?:\/\//i.test(input) || /[\u0000-\u0020\u007f\\]/u.test(input)) {
    throw new TypeError('Enter an explicit HTTP or HTTPS URL without whitespace or backslashes.')
  }
  let url
  try { url = new URL(input) } catch { throw new TypeError('Enter a valid HTTP or HTTPS URL.') }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) throw new TypeError('Only HTTP and HTTPS sites are supported.')
  if (url.username || url.password || /^https?:\/\/[^/?#]*@/i.test(input)) {
    throw new TypeError('Site URLs must not contain a username or password. Sign in inside the site browser instead.')
  }
  url.hash = ''
  return url.toString()
}

/** Produce a fresh, allowlisted metadata record; never retain extra input fields. */
export function siteRecord(input = {}) {
  const url = normalizeHttpUrl(input.url)
  const parsed = new URL(url)
  if (input.title !== undefined && typeof input.title !== 'string') throw new TypeError('The site title must be text.')
  const title = (input.title || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || parsed.hostname
  return {
    id: createHash('sha256').update(`site:${url}`).digest('hex').slice(0, 16),
    title,
    url,
    origin: parsed.origin,
  }
}

/** Drop malformed legacy metadata and any credential/header/storage fields. */
export function sanitizeSites(input) {
  const sites = []
  const seen = new Set()
  for (const entry of Array.isArray(input) ? input : []) {
    try {
      const site = siteRecord(entry)
      if (seen.has(site.id)) continue
      seen.add(site.id)
      sites.push(site)
    } catch {
      // Invalid persisted sites must not make an existing local library unreadable.
    }
  }
  return sites
}
