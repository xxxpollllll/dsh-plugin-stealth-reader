/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
export function createReaderBrowser(options = {}) {
  const win = options.window || globalThis.window
  const doc = options.document || win?.document
  const desktop = win?.dshDesktop
  const bridge = desktop?.browser
  const supported = !!(win?.location?.protocol === 'dsh-app:' && win.location.hostname === 'app' &&
    desktop?.protocolVersion === 1 && doc && typeof bridge?.acquire === 'function' &&
    typeof bridge.release === 'function' && typeof bridge.onOpenRequested === 'function')
  const timeout = Math.max(20, Math.min(30000, Number(options.timeoutMs) || 12000))
  const fetchTimeout = Math.max(10, Math.min(timeout - 5, Number(options.fetchTimeoutMs) || 9000))
  const MAX = 700000
  const sessions = new Map()
  const pending = new Set()
  const cleanupErrors = []
  let zoomRevision = 0
  let container = null, current = null, disposed = false, generation = 0, disposePromise
  let state = Object.freeze({ siteId: null, url: '', title: '', loading: false, error: null, canGoBack: false, canGoForward: false, zoom: 1, fitWidth: false })

  function error(code) { return Object.assign(new Error(code), { code }) }
  function publish(patch) {
    state = Object.freeze({ ...state, ...patch })
    if (typeof options.onState === 'function') {
      // Do not log a callback exception: it may contain page content or URLs.
      try { options.onState({ ...state }) } catch { /* Consumer callbacks cannot own guest cleanup. */ }
    }
  }
  function fail(code) { publish({ error: code }); return error(code) }
  function usable() { if (disposed) throw error('browserDisposed'); if (!supported) throw fail('browserUnsupported') }
  function track(promise) {
    pending.add(promise)
    promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  function url(value, base) {
    if (typeof value !== 'string' || value.length > 8192) throw error('browserInvalidURL')
    let parsed
    try { parsed = new URL(value, base) } catch { throw error('browserInvalidURL') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw error('browserInvalidURL')
    return parsed
  }
  function publicURL(value) {
    try {
      const parsed = url(value)
      for (const [name, value] of [...parsed.searchParams]) if (!/^(?:id|bid|cid|book|chapter|page|p|offset|limit)$/i.test(name) || !/^\d{1,12}$/.test(value)) parsed.searchParams.delete(name)
      parsed.hash = ''
      return parsed.href
    } catch { return '' }
  }
  function safeTitle(value) {
    if (typeof value !== 'string' || /(?:token|secret|password|csrf|session|credential|authorization|bearer)|[A-Za-z0-9_-]{24,}/i.test(value)) return ''
    return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160)
  }
  function siteData(site) {
    if (!site || typeof site.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(site.id)) throw error('browserInvalidSite')
    const parsed = url(site.url)
    const origin = url(site.origin)
    if (origin.origin !== parsed.origin || origin.pathname !== '/' || origin.search || origin.hash) throw error('browserInvalidSite')
    return { id: site.id, url: parsed.href, origin: parsed.origin }
  }
  function nonce() {
    if (typeof win?.crypto?.randomUUID === 'function') return win.crypto.randomUUID()
    if (typeof win?.crypto?.getRandomValues !== 'function') throw error('browserSecureRandomRequired')
    return [...win.crypto.getRandomValues(new Uint8Array(24))].map(v => v.toString(16).padStart(2, '0')).join('')
  }
  function invalidate(record) {
    if (!record) return
    record.abort.abort()
    record.abort = new AbortController()
  }
  async function destroy(record) {
    if (!record || record.destroyed) return
    record.destroyed = true
    invalidate(record)
    for (const [name, listener] of record.listeners) record.guest.removeEventListener(name, listener)
    try { record.unsubscribe?.() } catch { cleanupErrors.push('browserUnsubscribeFailed') }
    try { record.guest.remove() } catch { cleanupErrors.push('browserDetachFailed') }
    try { await bridge.release(record.lease) } catch { cleanupErrors.push('browserReleaseFailed'); publish({ error: 'browserReleaseFailed' }) }
  }
  function guestRequired() {
    usable()
    if (!current || current.destroyed) throw fail('browserRequired')
    return current
  }
  /**
   * Wait until the current guest can run a snapshot.
   *
   * Opening a site is asynchronous: the guest is created, then the page has to
   * load before its DOM exists. Reading a chapter right after opening the site
   * would otherwise fail with "not ready" for no reason the reader can act on.
   *
   * @param {number} [budgetMs] - how long to wait, at most this long
   * @returns {Promise<void>} resolves when the guest can answer
   */
  async function waitReady(budgetMs = 0) {
    const limited = Math.max(0, Math.min(15000, Number(budgetMs) || 0))
    const deadline = Date.now() + limited
    while (current && !current.destroyed && !current.ready) {
      if (Date.now() >= deadline) throw fail('browserLoading')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!current || current.destroyed) throw fail('browserRequired')
  }
  function refresh(record, patch = {}) {
    if (current !== record || record.destroyed) return
    try {
      publish({ url: publicURL(record.guest.getURL?.() || ''),
        canGoBack: !!record.guest.canGoBack?.(), canGoForward: !!record.guest.canGoForward?.(), ...patch })
    } catch { publish({ error: 'browserStateFailed', ...patch }) }
  }
  async function load(record, target) {
    if (current !== record || record.destroyed || disposed) throw error('browserCancelled')
    invalidate(record)
    record.target = target
    publish({ loading: true, error: null })
    if (!record.ready) return
    if (typeof record.guest.loadURL !== 'function') throw fail('browserNavigationUnsupported')
    try { await record.guest.loadURL(target) } catch {
      if (current !== record || record.destroyed || disposed) throw error('browserCancelled')
      throw fail('browserNavigationFailed')
    }
  }
  function event(record, name, listener) {
    record.listeners.push([name, listener]); record.guest.addEventListener(name, listener)
  }
  function mount(target) {
    usable()
    if (!target || typeof target.appendChild !== 'function') throw fail('browserContainerRequired')
    if (current && container !== target) throw fail('browserMountConflict')
    container = target
    return { ...state }
  }
  function open(site) {
    try { usable(); site = siteData(site); if (!container) throw error('browserContainerRequired') } catch (err) { return Promise.reject(err) }
    if (current?.site.id === site.id && current.site.origin === site.origin) return Promise.resolve({ ...state })
    const ticket = ++generation
    const old = current; current = null
    invalidate(old)
    // A site is fitted as soon as it opens: a page built for a wide screen is
    // cut off in this pane, and reading it by scrolling sideways is not
    // reading. The fit is a request, not a result - it is measured again on
    // every stop-loading, so a page that arrives late is fitted too. Zoom is
    // reset with it, so switching sites does not inherit the last ratio.
    zoomRevision += 1
    publish({ siteId: site.id, url: '', title: '', loading: true, error: null, canGoBack: false, canGoForward: false,
      zoom: 1, fitWidth: true })
    return track((async () => {
      await destroy(old)
      if (disposed || generation !== ticket) throw error('browserCancelled')
      if (cleanupErrors.length) { publish({ loading: false }); throw fail(cleanupErrors[cleanupErrors.length - 1]) }
      let entry = sessions.get(site.id)
      if (!entry || entry.origin !== site.origin) { entry = { origin: site.origin, nonce: nonce() }; sessions.set(site.id, entry) }
      let reservation
      try { reservation = await bridge.acquire('stealth-reader:' + site.id + ':' + entry.nonce) }
      catch { if (generation === ticket && !disposed) publish({ loading: false, error: 'browserAcquireFailed' }); throw error('browserAcquireFailed') }
      if (!reservation || typeof reservation.lease !== 'string' || !reservation.lease || typeof reservation.partition !== 'string' || !reservation.partition || reservation.partition.startsWith('persist:')) {
        if (typeof reservation?.lease === 'string') { try { await bridge.release(reservation.lease) } catch { cleanupErrors.push('browserReleaseFailed') } }
        throw fail('browserInvalidReservation')
      }
      if (disposed || generation !== ticket) {
        try { await bridge.release(reservation.lease) } catch { cleanupErrors.push('browserReleaseFailed') }
        throw error('browserCancelled')
      }
      let record
      try {
        const guest = doc.createElement('webview')
        record = { guest, site, lease: reservation.lease, target: site.url, ready: false, started: false,
          destroyed: false, busy: false, abort: new AbortController(), listeners: [], unsubscribe: null }
        current = record
        guest.setAttribute('partition', reservation.partition)
        guest.setAttribute('name', reservation.lease)
        guest.setAttribute('src', 'about:blank#' + reservation.lease)
        guest.setAttribute('allowpopups', '')
        guest.setAttribute('webpreferences', 'nodeIntegration=no,contextIsolation=yes,sandbox=yes,webSecurity=yes')
        guest.setAttribute('aria-label', 'Reader site browser')
        guest.style.width = '100%'; guest.style.height = '100%'; guest.style.display = 'flex'
        event(record, 'dom-ready', () => {
          if (current !== record || record.destroyed) return
          record.ready = true
          if (!record.started) {
            record.started = true
            // The main process validates the bootstrap URL at this first event.
            load(record, record.target).catch(err => { if (err.code !== 'browserCancelled') publish({ loading: false, error: err.code || 'browserNavigationFailed' }) })
          } else refresh(record)
          // Zoom is optional to navigation. A missing/failed guest setter must
          // not throw out of a DOM listener or prevent bootstrap navigation.
          try { applyGuestZoom(record, state.zoom) } catch { /* Safe code already published. */ }
        })
        event(record, 'did-start-loading', () => { invalidate(record); refresh(record, { loading: true, error: null }) })
        event(record, 'did-stop-loading', () => {
          if (current !== record || record.destroyed || disposed) return
          refresh(record, { loading: false })
          if (state.fitWidth) void fitToWidth().catch(() => {})
        })
        event(record, 'did-navigate', () => { invalidate(record); refresh(record) })
        event(record, 'did-navigate-in-page', () => { invalidate(record); refresh(record) })
        event(record, 'page-title-updated', e => refresh(record, { title: safeTitle(e.title) }))
        event(record, 'did-fail-load', e => { if (e.isMainFrame !== false && e.errorCode !== -3) refresh(record, { loading: false, error: 'browserNavigationFailed' }) })
        event(record, 'render-process-gone', () => { invalidate(record); refresh(record, { loading: false, error: 'browserGuestGone' }) })
        record.unsubscribe = bridge.onOpenRequested(record.lease, value => {
          if (current !== record || record.destroyed || disposed) return
          navigate(value).catch(err => { if (err.code !== 'browserCancelled') publish({ error: err.code || 'browserNavigationFailed' }) })
        })
        container.appendChild(guest)
        return { ...state }
      } catch {
        if (record) { if (current === record) current = null; await destroy(record) }
        else { try { await bridge.release(reservation.lease) } catch { cleanupErrors.push('browserReleaseFailed') } }
        throw fail('browserAttachFailed')
      }
    })())
  }
  async function navigate(value) {
    usable()
    const record = current
    if (!record) throw fail('browserRequired')
    let target
    try { target = url(value, record.target) } catch { throw fail('browserInvalidURL') }
    // Same-origin HTTP is supported; third-party login navigation must use HTTPS.
    if (target.origin !== record.site.origin && target.protocol !== 'https:') throw fail('browserUnsafeLoginURL')
    return load(record, target.href)
  }
  async function command(name) {
    const record = guestRequired()
    if (typeof record.guest[name] !== 'function') throw fail('browserNavigationUnsupported')
    invalidate(record)
    try { await record.guest[name]() } catch { throw fail('browserNavigationFailed') }
  }

  // Fixed guest program. JSON is DATA passed to this function, never evaluated as
  // source. No page-provided scripts are copied/evaluated; no cookie/storage APIs.
  async function snapshotProgram(request) {
    const MAX = 700000
    const parseURL = value => {
      const parsed = new URL(value, location.href)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('unsafe')
      return parsed
    }
    const cleanURL = value => {
      const parsed = parseURL(value)
      for (const [name, item] of [...parsed.searchParams]) if (!/^(?:id|bid|cid|book|chapter|page|p|offset|limit)$/i.test(name) || !/^\d{1,12}$/.test(item)) parsed.searchParams.delete(name)
      parsed.hash = ''
      return parsed.href
    }
    const current = parseURL(location.href)
    if (current.origin !== request.origin) throw new Error('origin')
    let source = document, pageURL = current.href
    if (request.mode === 'fetch') {
      const target = parseURL(request.url)
      if (target.origin !== request.origin) throw new Error('origin')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), request.timeout)
      try {
        const response = await fetch(target.href, { credentials: 'same-origin', redirect: 'error', signal: controller.signal,
          referrerPolicy: 'no-referrer', headers: { Accept: 'text/html,application/xhtml+xml' } })
        if (!response.ok || response.redirected || parseURL(response.url).origin !== request.origin ||
            !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('response')
        if (Number(response.headers.get('content-length')) > MAX * 4) throw new Error('size')
        if (!response.body || typeof response.body.getReader !== 'function') throw new Error('stream')
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let text = '', bytes = 0
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > MAX * 4) throw new Error('size')
            text += decoder.decode(chunk.value, { stream: true })
            if (text.length > MAX) throw new Error('size')
          }
          text += decoder.decode()
          if (text.length > MAX) throw new Error('size')
        } finally { await reader.cancel() }
        source = new DOMParser().parseFromString(text, 'text/html')
        pageURL = response.url
      } finally { clearTimeout(timer); controller.abort() }
    }
    if (location.origin !== request.origin || location.href !== current.href) throw new Error('navigation')
    const body = source.body?.cloneNode(true)
    if (!body) throw new Error('body')
    body.querySelectorAll('form,input,textarea,button,select,option,script,style,meta,link,base,iframe,frame,frameset,object,embed,applet,template,noscript,svg,math,canvas,video,audio,source,img,picture').forEach(node => node.remove())
    for (const node of [body, ...body.querySelectorAll('*')]) {
      const hidden = node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.getAttribute('style') || '')
      if (hidden) { if (node === body) throw new Error('hidden'); node.remove(); continue }
      for (const attr of [...node.attributes]) {
        const key = attr.name.toLowerCase(), value = attr.value
        node.removeAttribute(attr.name)
        if ((key === 'id' || key === 'class') && value.length <= 160 && /^[\w\s-]+$/.test(value) && !/(?:token|secret|password|csrf|session|credential|authorization)|[A-Za-z0-9_-]{32,}/i.test(value)) node.setAttribute(key, value)
        if (key === 'href' && node.tagName === 'A') {
          try {
            const link = new URL(value, pageURL)
            if (link.origin === request.origin && !link.username && !link.password && ['http:', 'https:'].includes(link.protocol)) {
              // Keep only numeric chapter/pagination identifiers; strip auth and
              // arbitrary query values, even when their parameter name is benign.
              for (const [name, item] of [...link.searchParams]) if (!/^(?:id|bid|cid|book|chapter|page|p|offset|limit)$/i.test(name) || !/^\d{1,12}$/.test(item)) link.searchParams.delete(name)
              link.hash = ''; node.setAttribute('href', link.href)
            }
          } catch { /* Unsafe links are omitted, never returned as diagnostics. */ }
        }
      }
    }
    // Comments may contain embedded JSON credentials or application state.
    const walker = source.createTreeWalker(body, 128), comments = []
    while (walker.nextNode()) comments.push(walker.currentNode)
    for (const comment of comments) comment.remove()
    let title = typeof source.title === 'string' ? source.title : ''
    if (/(?:token|secret|password|csrf|session|credential|authorization|bearer)|[A-Za-z0-9_-]{24,}/i.test(title)) title = ''
    title = title.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = '<!doctype html><html><head><title>' + title + '</title></head><body>' + body.innerHTML + '</body></html>'
    if (html.length > MAX) throw new Error('size')
    return { url: cleanURL(pageURL), html }
  }
  async function snapshot(mode, site, value) {
    const record = guestRequired()
    // A site opened a moment ago is still loading its first page.
    await waitReady(options.readyTimeoutMs ?? 8000)
    if (record.busy) throw fail('browserBusy')
    if (mode === 'fetch' && (!site || site.id !== record.site.id || site.origin !== record.site.origin)) throw fail('browserWrongSite')
    let actual
    try { actual = url(record.guest.getURL()) } catch { throw fail('browserCaptureDenied') }
    if (actual.origin !== record.site.origin) throw fail('browserCaptureDenied')
    let target
    if (mode === 'fetch') {
      try { target = url(value, actual.href) } catch { throw fail('browserInvalidURL') }
      if (target.origin !== record.site.origin) throw fail('browserCaptureDenied')
      if ([...target.searchParams].some(([key, item]) => !/^(?:id|bid|cid|book|chapter|page|p|offset|limit)$/i.test(key) || !/^\d{1,12}$/.test(item))) throw fail('browserSensitiveURL')
      target.hash = ''
    }
    if (typeof record.guest.executeJavaScript !== 'function') throw fail('browserCaptureUnsupported')
    const signal = record.abort.signal
    const data = { mode, origin: record.site.origin, url: target?.href, timeout: fetchTimeout }
    const program = '(' + snapshotProgram.toString() + ')(' + JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ')'
    record.busy = true
    let timer, abort
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => { if (signal.aborted || current !== record || disposed) throw error('browserCancelled'); return record.guest.executeJavaScript(program, false) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(error('browserExecutionTimeout')), timeout) }),
        new Promise((_, reject) => { abort = () => reject(error('browserCancelled')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort() }),
      ])
      if (disposed || current !== record || signal.aborted) throw error('browserCancelled')
      if (!result || typeof result.url !== 'string' || typeof result.html !== 'string' || result.html.length > MAX || url(result.url).origin !== record.site.origin) throw error('browserInvalidSnapshot')
      if (url(record.guest.getURL()).origin !== record.site.origin) throw error('browserCaptureDenied')
      publish({ error: null })
      return { url: publicURL(result.url), html: result.html }
    } catch (err) {
      const code = ['browserCancelled', 'browserExecutionTimeout', 'browserInvalidSnapshot', 'browserCaptureDenied'].includes(err?.code) ? err.code : 'browserCaptureFailed'
      if (current === record && !disposed && code !== 'browserCancelled') publish({ error: code })
      throw error(code)
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); record.busy = false }
  }
  /**
   * Fetch one page of a site, opening that site when it is not open yet.
   *
   * The guest still belongs to the site's own partition, so nothing about the
   * sign-in crosses a boundary: this only removes the manual step of opening
   * the website library before a chapter can be read.
   *
   * @param {object} site - the saved site the page belongs to
   * @param {string} value - the page address
   * @returns {Promise<{url: string, html: string}>} the cleaned page
   */
  async function ensureAndFetch(site, value) {
    usable()
    const wanted = siteData(site)
    if (!container) throw fail('browserContainerRequired')
    if (!current || current.destroyed || current.site.id !== wanted.id || current.site.origin !== wanted.origin) {
      await open(wanted)
    }
    await waitReady(options.readyTimeoutMs ?? 8000)
    return snapshot('fetch', wanted, value)
  }
  async function forget(siteId) {
    usable()
    if (typeof siteId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(siteId)) throw fail('browserInvalidSite')
    sessions.delete(siteId)
    // Invalidate an acquire in flight too; its completion releases the lease.
    if (state.siteId === siteId) {
      ++generation
      const record = current; current = null
      await destroy(record)
      publish({ siteId: null, url: '', title: '', loading: false, error: null, canGoBack: false, canGoForward: false })
    }
    if (cleanupErrors.length) throw fail(cleanupErrors[cleanupErrors.length - 1])
  }
  function applyGuestZoom(record, factor) {
    if (!record || current !== record || record.destroyed || !record.ready) return
    if (typeof record.guest.setZoomFactor !== 'function') throw fail('browserZoomUnsupported')
    try { record.guest.setZoomFactor(factor) } catch { throw fail('browserZoomFailed') }
  }
  function setZoom(factor) {
    usable()
    const wanted = Number(factor)
    if (!Number.isFinite(wanted)) throw fail('browserInvalidZoom')
    const next = Math.min(Math.max(wanted, 0.4), 1.6)
    applyGuestZoom(current, next)
    zoomRevision += 1
    publish({ zoom: next, fitWidth: false, error: null })
    return { ...state }
  }
  // Fixed measurement program: returns geometry only, never page text or HTML.
  // Fit width, not height: long catalogues must still scroll vertically.
  async function fitToWidth() {
    const record = guestRequired()
    if (!record.ready || !record.started || state.loading) throw fail('browserLoading')
    if (typeof record.guest.executeJavaScript !== 'function') throw fail('browserZoomUnsupported')
    const signal = record.abort.signal
    const before = state.zoom
    const revision = ++zoomRevision
    let timer
    try {
      const ratio = await Promise.race([
        record.guest.executeJavaScript(`(() => {
          const root = document.documentElement, body = document.body;
          const viewport = root.clientWidth || window.innerWidth;
          const width = Math.max(viewport, root.scrollWidth, body ? body.scrollWidth : 0);
          return viewport > 0 && width > 0 ? viewport / width : 0;
        })()`, false),
        new Promise((_, reject) => { timer = setTimeout(() => reject(error('browserZoomFailed')), timeout) }),
      ])
      // A site switch, navigation, disposal or manual zoom invalidates this result.
      if (disposed || current !== record || record.destroyed || signal.aborted || zoomRevision !== revision) throw error('browserCancelled')
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw error('browserZoomFailed')
      const next = Math.max(0.4, Math.min(1, Math.floor(before * ratio * 100) / 100))
      applyGuestZoom(record, next)
      publish({ zoom: next, fitWidth: true, error: null })
      return { ...state }
    } catch (failure) {
      if (disposed || current !== record || record.destroyed || signal.aborted || zoomRevision !== revision) throw error('browserCancelled')
      if (failure?.code === 'browserCancelled') throw failure
      throw fail('browserZoomFailed')
    } finally { clearTimeout(timer) }
  }
  function dispose() {
    if (disposePromise) return disposePromise
    disposed = true; ++generation
    const record = current; current = null; container = null; sessions.clear()
    disposePromise = (async () => {
      await destroy(record)
      await Promise.allSettled([...pending])
      publish({ siteId: null, url: '', title: '', loading: false, canGoBack: false, canGoForward: false })
      if (cleanupErrors.length) throw error(cleanupErrors[cleanupErrors.length - 1])
    })()
    return disposePromise
  }
  return Object.freeze({ supported, mount, open, navigate, back: () => command('goBack'), forward: () => command('goForward'),
    reload: () => command('reload'), setZoom, fitToWidth, capture: () => snapshot('capture'), fetchPage: (site, value) => snapshot('fetch', site, value),
    ensureAndFetch, forget, dispose, getState: () => ({ ...state }) })
}
