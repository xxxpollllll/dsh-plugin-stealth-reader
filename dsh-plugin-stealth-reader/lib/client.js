/**
 * Client half of the stealth reader bundle.
 *
 * Renders a small reading panel in the frame-wide `shell.overlay` layer. The
 * panel never writes into a conversation: it reads chapters through the Host
 * half over one same-origin route, so no novel text lands in a session log.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-stealth-reader',
  factory: function factory(require) {
    const React = require('react')
    const h = React.createElement
    // The renderer is optional: without it the reader's surfaces stay where
    // they were, inside the frame's own layer.
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }
    // The layout effect is the one that runs before the browser paints. A
    // runtime without it still measures the page, only a frame later.
    const useLayout = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect

    // The isolated site browser is inlined: the Client half is one static file
    // loaded by the module loader, so it cannot import a sibling module.
/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
/** Desktop-only, lease-scoped reader guest. No cookies/storage leave the guest.
 * Keep the mounted container in the DOM (hide it with CSS). Removing/reparenting
 * an attached Electron webview cannot reuse its one-shot attachment lease.
 * forget/dispose release guests and abandon partition keys, NOT erase storage:
 * the Desktop main process retains those memory partitions until App exit.
 */
function createReaderBrowser(options = {}) {
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


    const EN = {
      peek: 'Reader',
      open: 'Open reader',
      hide: 'Hide reader',
      prev: 'Previous chapter',
      next: 'Next chapter',
      skin: 'Change appearance',
      library: 'Library',
      pickerTitle: 'Your books',
      pickerHint: 'Pick a book and it opens right away.',
      pickerSearch: 'Search books',
      pickerEmpty: 'No books yet. Add one and it shows up here.',
      pickerNoMatch: 'No book matches that.',
      pickerAdd: 'Add a book',
      pickerContents: 'Chapters',
      pickerChapters: '{n} chapters',
      fontUp: 'Larger text',
      fontDown: 'Smaller text',
      close: 'Close',
      addLocal: 'Add a local file',
      addWeb: 'Add a web novel',
      path: 'Absolute path of the .txt file',
      localPathHint: 'Path of a .txt, .epub, .md or .html file',
      catalog: 'Catalog page URL',
      chapterSelector: 'Chapter link selector (optional)',
      contentSelector: 'Chapter body selector (optional)',
      title: 'Title',
      add: 'Add',
      remove: 'Remove',
      empty: 'The library is empty. Add a local .txt file or a web novel.',
      noBook: 'No book is open.',
      loading: 'Loading…',
      failed: 'The reader host is not reachable.',
      shortcutHint: 'Ctrl+Alt+N toggles the panel',
      neutralPrev: 'Older entry',
      neutralNext: 'Newer entry',
      neutralZoomOut: 'Zoom out',
      neutralZoomUp: 'Zoom in',
      neutralModeSingle: 'Single entry',
      loadingMore: 'Loading the next section…',
      endOfBook: 'End of document',
      neutralModeContinuous: 'Continuous entries',
      neutralView: 'Appearance',
      neutralPane: 'Content',
      noFolder: 'No folder was chosen.',
      rescan: 'Rescan',
      scannedN: 'Found {n} file(s).',
      importedN: 'Imported {n} document(s).',
      importingN: 'Importing {done} of {total}…',
      neutralList: 'List',
      neutralCollapse: 'Collapse',
      neutralOpen: 'Open',
      neutralEmpty: 'No entries.',
      readingArea: 'Reading area',
      progress: 'Reading progress',
      neutralProgress: 'Progress',
      jumpTo: 'Go to chapter',
      jumpHint: 'Chapter #',
      search: 'Search in chapter',
      searchHint: 'Find…',
      matches: '{n} match',
      chapters: '{n} chapter(s)',
      noMatch: 'none',
      prevMatch: 'Previous match',
      nextMatch: 'Next match',
      errUnsupported: 'This document format is not supported.',
      errUnsupportedFormat: '{format} documents are not supported. Convert the file to TXT or EPUB.',
      errUnsupportedFormatNeutral: 'the {format} format is not supported',
      settings: 'Reading settings',
      toc: 'Table of contents',
      neutralJump: 'Go to item',
      neutralJumpHint: 'No.',
      neutralSearch: 'Find in view',
      neutralSearchHint: 'Enter to search',
      neutralPrevMatch: 'Previous result',
      neutralNextMatch: 'Next result',
      neutralResults: 'Results',
      neutralNoTxt: 'No supported file was found in that folder.',
      neutralAddWeb: 'Add a web item',
      neutralTitle: 'Name',
      neutralSelector: 'Selector (optional)',
      neutralCatalog: 'Page address',
      neutralPath: 'Path of a local file',
      neutralLocalPathHint: 'Path of a local file',
      neutralEmptyList: 'Nothing here yet.',
      disguisedDoc: 'Document {n}',
      shortcut_toggle: 'Show or hide the reading panel',
      shortcut_next: 'Next chapter',
      shortcut_prev: 'Previous chapter',
      shortcut_skin: 'Change the appearance',
      shortcut_place: 'Move the reader between the card and the side column',
      toSidebar: 'Move to the side column',
      toStrip: 'Move to the card above the input',
      neutralToSidebar: 'Move to the side',
      neutralToStrip: 'Move to the top',
      shortcut_larger: 'Larger text',
      shortcut_smaller: 'Smaller text',
      searchAllHint: 'Press Enter to search the whole book',
      lineN: 'line {n}',
      sectionsN: '{n} chapters',
      booksN: '{n} books',
      booksOne: '{n} book',
      showingFirst: 'showing the first {n} of {m}',
      searchResults: 'Search results',
      noResults: 'No matches',
      neutralSettings: 'Options',
      fontSize: 'Text size',
      lineHeight: 'Line spacing',
      readingFont: 'Font',
      panelWidth: 'Width',
      readingMode: 'Reading mode',
      modeChapter: 'One chapter',
      modeContinuous: 'Continuous',
      setLibrary: 'Documents',
      setLibraryList: 'Your books',
      setLibraryListHint: 'Pick one to read it.',
      setAddLocal: 'Add a file',
      setAddLocalHint: 'A path to a .txt, .epub, .md, .html or .docx file.',
      setAddWeb: 'Add a web novel',
      setAddWebHint: 'Anonymous import from a book or catalog address. For sign-in sites, use Find books.',
      setSelectors: 'If the chapters are not found',
      setAdvanced: 'Advanced',
      setSelectorsHint: 'Optional. Leave both empty unless the site needs them.',
      setChapterSelector: 'Chapter link selector',
      setContentSelector: 'Text selector',
      setAddFolder: 'Add a folder',
      setFolders: 'Folders already scanned',
      setFoldersHint: 'Books already added stay when a folder is dropped.',
      setRemoveFolder: 'Stop scanning this folder',
      setAddFolderHint: 'Every novel in a folder, in one go.',
      importedOne: 'Added.',
      neutralUrl: 'https://…',
      docN: 'Document {n}',
      setReading: 'Reading',
      setCard: 'The card above the input',
      setAppearance: 'Appearance',
      setPlacement: 'Where the reader opens',
      setPlacementHint: 'The two shapes are alternatives: only one is on screen.',
      setFontSize: 'Text size',
      setLineHeight: 'Line spacing',
      setReadingFont: 'Typeface',
      setReadingFontHint: 'Used by the plain skin. The other skins are typewritten on purpose, because the typeface is part of the disguise.',
      setReadingMode: 'Reading mode',
      setStripLines: 'Lines shown',
      setStripLinesHint: 'How many lines the open card shows.',
      setSkin: 'Disguise',
      setSkinHint: 'What the panel looks like to anyone reading over your shoulder.',
      setPanelWidth: 'Panel width',
      placement: 'Where to show it',
      placementOverlay: 'Floating panel',
      placementSidebar: 'Side column',
      placementStrip: 'Line above the box',
      neutralPlacementOverlay: 'Floating window',
      neutralPlacementSidebar: 'Side column',
      neutralPlacementStrip: 'Line above the input',
      restoreDefaults: 'Restore defaults',
      defaultsRestored: 'Defaults restored.',
      settingsUnsaved: 'Not saved yet.',
      stripHint: 'Scroll to read',
      sidebarHint: 'Read in the side column',
      stripExpand: 'Open the reader',
      stripNeutralPosition: 'Document {n} · Section {m}',
      stripNeutralEmpty: 'No document loaded',
      stripPosition: 'Document {n} · Section {m}/{total}',
      stripWheelHint: 'Scroll to read',
      stripBack: 'Previous line',
      stripForward: 'Next line',
      stripNoBook: 'No document open',
      stripEmptyCard: 'No book open yet. Press “Find books” to add one.',
      stripNamed: '{book} · {m}/{total}',
      font_sans: 'Sans',
      font_serif: 'Serif',
      font_mono: 'Mono',
      sectionN: 'Section {n}',
      openHintNeutral: 'Open (Ctrl+Alt+N)',
      emptyChapter: 'This section has no text.',
      addMenu: 'Add a document…',
      chooseFolder: 'Choose a folder…',
      scanned: 'Files found',
      confirmRemove: 'Remove?',
      errNetwork: 'The page could not be reached.',
      errNotFound: 'The page was not found.',
      errUnknown: 'Unknown action.',
      errHost: 'The reader host is not reachable.',
      errHttp: 'The page answered with an error.',
      errNoFile: 'That file could not be found.',
      errEmpty: 'This chapter came back empty. The site may build its text in the browser, which this reader cannot run.',
      errEmptyNeutral: 'This section came back empty.',
      errBadFormat: 'That document could not be read.',
      errHostNeutral: 'Host unreachable.',
      noTxt: 'No .txt file was found in that folder.',
      openHint: 'Open the reader panel (Ctrl+Alt+N)',
      shop: 'Find books',
      shopNeutral: 'Sources',
      shopTitle: 'Website library',
      shopHint: 'Add a website once. Browse and sign in there, then preview a book before adding it.',
      shopSites: 'My websites',
      shopAddSite: 'Add website',
      shopSiteName: 'Website name (optional)',
      shopSiteUrl: 'Website home address',
      shopNoSites: 'No websites yet. Add the home address of a site you use.',
      shopVisit: 'Browse',
      shopSelect: 'Choose a website to browse.',
      shopRemoveHint: 'Remove website? Existing books stay.',
      shopAddress: 'Page address',
      shopGo: 'Go',
      shopFit: 'Fit width',
      shopZoomReset: 'Reset to 100%',
      shopZoomIn: 'Zoom in',
      shopZoomOut: 'Zoom out',
      shopBack: 'Back',
      shopForward: 'Forward',
      shopReload: 'Reload',
      shopIdentify: 'Identify this book',
      shopIdentifying: 'Finding the catalog and checking sample text…',
      shopPreview: 'Check before adding',
      shopConfirm: 'Confirm add to library',
      shopCancel: 'Cancel preview',
      shopRead: 'Start reading',
      shopAdded: 'Added to your library. Your current reading position was not changed.',
      shopSample: 'Cleaned sample',
      shopDesktopOnly: 'Browsing and sign-in need the Harness desktop window. This Web page cannot access its isolated browser.',
      shopOpenExternal: 'Open website in your browser',
      shopPrivacy: 'The original site is visible here and makes network requests. Sign in on the site itself. Login is temporary; restart clears it. Free chapters only.',
      shopForget: 'Disconnect login session',
      shopForgetHint: 'Disconnect this website session? You will need to sign in again.',
      shopDisconnected: 'The old session is disconnected. Its temporary partition is released when the app exits.',
      shopFailed: 'Could not identify the book. Open its book details or catalog page and try again.',
      shopBrowserNeeded: 'Open this book’s website in Find books first. Sign in there if needed, then return to reading.',
      shopBrowserError: 'The isolated browser is not ready. Reopen the website and try again.',
      shopSiteMismatch: 'Return to the selected website before identifying a book. Other websites cannot use its login session.',
      shopRestricted: 'No free readable text was found. Complete the site’s normal login or verification; locked chapters are not imported.',
      shopExpired: 'This preview expired. Identify the book again.',
      shopUnsafe: 'Use a public HTTP(S) website address without account tokens or embedded credentials.',
      shopAdvanced: 'Advanced: anonymous URL import',
      shopSettingsHint: 'Manage sources and browse websites. No passwords or Cookie copying.',
      shopSlow: 'The site did not finish loading. Retry after its page is ready.',
      shopPreviewNeutral: 'Identified book',
      shopSampleNeutral: 'A sample was checked and looks readable.',
      setTab_reading: 'Reading',
      setTab_appearance: 'Looks',
      setTab_library: 'Books',
      setTab_sites: 'Websites',
      setShapeShelf: 'Show covers',
      setShapeList: 'Show list',
      shelfLocalMeta: 'Local · {n} chapters',
      shelfWebMeta: 'Web · {cached}/{total} saved',
      stripFold: 'Fold the card away',
      stripNeutralHead: 'Document {n}',
      stripProgressHead: '{percent}% · chapter {m}/{total}',
      setCardHead: 'First line',
      setCardHeadHint: 'What the card shows on its first line.',
      cardHead_book: 'The book',
      cardHead_progress: 'Progress',
      cardHead_neutral: 'Neutral (no title)',
      setCardFoldDelay: 'Fold delay',
      setCardFoldDelayHint: 'How long the card waits before folding when the pointer leaves.',
      setCardFoldMode: 'Folding',
      setCardFoldModeHint: 'When the card folds itself away.',
      cardFoldMode_manual: 'Only when I fold it',
      cardFoldMode_auto: 'When the pointer leaves',
      cardFoldMode_never: 'Never',
      setCardAlign: 'Folded mark position',
      setCardAlignHint: 'Where the folded card sits.',
      cardAlign_left: 'Left',
      cardAlign_center: 'Center',
      cardAlign_right: 'Right',
      setCardOffset: 'Nudge',
      setCardOffsetHint: 'Shift the folded mark sideways.',
      setCardFoldable: 'Can fold',
      setCardFoldableHint: 'Whether the card can be folded at all.',
      cardFoldable_yes: 'Yes',
      cardFoldable_no: 'No, always the card',
      setCardFoldedShape: 'Folded shape',
      setCardFoldedShapeHint: 'What the card becomes when folded.',
      cardFoldedShape_mark: 'Small round mark',
      cardFoldedShape_bar: 'One-line bar',
      setBarLabel: 'Bar text',
      setBarLabelHint: 'What the folded bar says in its middle.',
      barLabel_head: 'Same as the first line',
      barLabel_chapter: 'Chapter position',
      barLabel_cover: 'Custom text',
      setBarCoverText: 'Custom bar text',
      setBarCoverTextHint: 'Shown on the folded bar instead of the book.',
      setBarProgress: 'Bar progress',
      setBarProgressHint: 'How much of the book the folded bar shows.',
      barProgress_percent: 'Percent only',
      barProgress_track: 'Progress line',
      barProgress_both: 'Percent and line',
      barProgress_none: 'Nothing',
      barCover_notes: 'Reading notes',
      barCover_log: 'Work log',
      barCover_draft: 'Draft notes',
      barCover_sync: 'Sync summary',
      stripToCard: 'Turn the bar back into the card',
      openReaderNow: 'Open the reader',
    }
    const ZH = {
      peek: '阅读',
      open: '打开阅读器',
      hide: '隐藏阅读器',
      prev: '上一章',
      next: '下一章',
      skin: '切换外观',
      library: '书库',
      pickerTitle: '我的书',
      pickerHint: '点一本就立刻开始读。',
      pickerSearch: '搜索书名',
      pickerEmpty: '还没有书，添加后会出现在这里。',
      pickerNoMatch: '没有匹配的书。',
      pickerAdd: '添加书籍',
      pickerContents: '目录',
      pickerChapters: '{n} 章',
      fontUp: '放大字号',
      fontDown: '缩小字号',
      close: '关闭',
      addLocal: '添加本地文件',
      addWeb: '添加网络小说',
      path: 'txt 文件的绝对路径',
      localPathHint: '.txt、.epub、.md 或 .html 文件的路径',
      catalog: '目录页地址',
      chapterSelector: '章节链接选择器（可选）',
      contentSelector: '正文选择器（可选）',
      title: '书名',
      add: '添加',
      remove: '移除',
      empty: '书库是空的。添加一个本地 txt 文件或一本网络小说。',
      noBook: '当前没有打开的书。',
      loading: '加载中…',
      failed: '无法连接到阅读器后台。',
      shortcutHint: 'Ctrl+Alt+N 唤起/隐藏面板',
      neutralPrev: '上一条',
      neutralNext: '下一条',
      neutralZoomOut: '缩小',
      neutralZoomUp: '放大',
      neutralModeSingle: '单条记录',
      loadingMore: '正在载入下一节…',
      endOfBook: '文档结束',
      neutralModeContinuous: '连续记录',
      neutralView: '外观',
      neutralPane: '内容',
      noFolder: '未选择文件夹。',
      rescan: '重新扫描',
      scannedN: '找到 {n} 个文件。',
      importedN: '已导入 {n} 个文档。',
      importingN: '正在导入 {done}/{total}…',
      neutralList: '列表',
      neutralCollapse: '收起',
      neutralOpen: '打开',
      neutralEmpty: '无记录。',
      readingArea: '阅读区',
      progress: '阅读进度',
      neutralProgress: '进度',
      jumpTo: '跳转到章节',
      jumpHint: '第几章',
      search: '在本章内搜索',
      searchHint: '查找…',
      matches: '{n} 处匹配',
      chapters: '{n} 章',
      noMatch: '无',
      prevMatch: '上一处',
      nextMatch: '下一处',
      errUnsupported: '不支持该文档格式。',
      errUnsupportedFormat: '不支持 {format} 格式，请转换为 TXT 或 EPUB。',
      errUnsupportedFormatNeutral: '不支持 {format} 格式',
      settings: '阅读设置',
      toc: '目录',
      neutralJump: '跳转到条目',
      neutralJumpHint: '序号',
      neutralSearch: '在当前视图内查找',
      neutralSearchHint: '回车搜索',
      neutralPrevMatch: '上一处结果',
      neutralNextMatch: '下一处结果',
      neutralResults: '结果',
      neutralNoTxt: '该文件夹里没有可支持的文件。',
      neutralAddWeb: '添加网络项目',
      neutralTitle: '名称',
      neutralSelector: '选择器（可选）',
      neutralCatalog: '页面地址',
      neutralPath: '本地文件路径',
      neutralLocalPathHint: '本地文件路径',
      neutralEmptyList: '这里还没有内容。',
      disguisedDoc: '文档 {n}',
      shortcut_toggle: '显示或隐藏阅读面板',
      shortcut_next: '下一章',
      shortcut_prev: '上一章',
      shortcut_skin: '切换外观',
      shortcut_place: '在对话栏卡片和右侧栏之间切换阅读器',
      toSidebar: '移到右侧栏',
      toStrip: '移到输入框上方的卡片',
      neutralToSidebar: '移到侧边',
      neutralToStrip: '移到上方',
      shortcut_larger: '放大文字',
      shortcut_smaller: '缩小文字',
      searchAllHint: '回车搜索全书',
      lineN: '第 {n} 行',
      sectionsN: '共 {n} 章',
      booksN: '共 {n} 本',
      booksOne: '共 {n} 本',
      showingFirst: '只列出前 {n} 处，共 {m} 处',
      searchResults: '搜索结果',
      noResults: '没有匹配',
      neutralSettings: '选项',
      fontSize: '字号',
      lineHeight: '行距',
      readingFont: '字体',
      panelWidth: '宽度',
      readingMode: '阅读方式',
      modeChapter: '单章',
      modeContinuous: '连续滚动',
      setLibrary: '文档',
      setLibraryList: '我的书',
      setLibraryListHint: '点一本开始阅读。',
      setAddLocal: '添加文件',
      setAddLocalHint: '支持 .txt、.epub、.md、.html、.docx 的路径。',
      setAddWeb: '添加网页小说',
      setAddWebHint: '从书籍或目录地址匿名导入；需要登录时请用“找书”。',
      setSelectors: '如果找不到章节',
      setAdvanced: '高级',
      setSelectorsHint: '可选。除非站点需要，否则留空。',
      setChapterSelector: '章节链接选择器',
      setContentSelector: '正文选择器',
      setAddFolder: '添加文件夹',
      setFolders: '已扫描的文件夹',
      setFoldersHint: '移除文件夹不会删除已经导入的书。',
      setRemoveFolder: '不再扫描这个文件夹',
      setAddFolderHint: '一次性导入整个文件夹里的小说。',
      importedOne: '已添加。',
      neutralUrl: 'https://…',
      docN: '文档 {n}',
      setReading: '阅读',
      setCard: '输入框上方的卡片',
      setAppearance: '外观',
      setPlacement: '阅读器打开位置',
      setPlacementHint: '两种形态互斥，同时只会出现一个。',
      setFontSize: '字号',
      setLineHeight: '行距',
      setReadingFont: '字体',
      setReadingFontHint: '仅「plain」皮肤使用。其它皮肤刻意用等宽字体，因为字体正是伪装的一部分。',
      setReadingMode: '阅读方式',
      setStripLines: '显示行数',
      setStripLinesHint: '展开后卡片显示几行。',
      setSkin: '伪装',
      setSkinHint: '别人从旁边看时，面板显示成什么样子。',
      setPanelWidth: '面板宽度',
      placement: '显示位置',
      placementOverlay: '浮动面板',
      placementSidebar: '右侧栏',
      placementStrip: '输入框上方',
      neutralPlacementOverlay: '浮动窗口',
      neutralPlacementSidebar: '侧边栏',
      neutralPlacementStrip: '输入框上方',
      restoreDefaults: '恢复默认',
      defaultsRestored: '已恢复默认设置。',
      settingsUnsaved: '尚未保存。',
      stripHint: '滚动以阅读',
      sidebarHint: '在侧边栏阅读',
      stripExpand: '打开阅读器',
      stripNeutralPosition: '文档 {n} · 章节 {m}',
      stripNeutralEmpty: '未载入文档',
      stripPosition: '文档 {n} · 第 {m}/{total} 节',
      stripWheelHint: '滚动以阅读',
      stripBack: '上一行',
      stripForward: '下一行',
      stripNoBook: '尚未打开文档',
      stripEmptyCard: '还没有书。点「找书」添加一本。',
      stripNamed: '{book} · 第 {m}/{total} 章',
      font_sans: '无衬线',
      font_serif: '衬线',
      font_mono: '等宽',
      sectionN: '第 {n} 节',
      openHintNeutral: '打开（Ctrl+Alt+N）',
      emptyChapter: '这一节没有内容。',
      addMenu: '添加文档…',
      chooseFolder: '选择文件夹…',
      scanned: '找到的文件',
      confirmRemove: '确认移除？',
      errNetwork: '无法连接到该页面。',
      errNotFound: '页面不存在。',
      errUnknown: '未知操作。',
      errHost: '阅读器后台不可达。',
      errHttp: '页面返回了错误。',
      errNoFile: '找不到该文件。',
      errEmpty: '这一章抓不到正文。该站点可能在浏览器里生成正文，阅读器无法执行。',
      errEmptyNeutral: '这一节内容为空。',
      errBadFormat: '无法读取该文档。',
      errHostNeutral: '后台不可达。',
      noTxt: '该文件夹里没有 .txt 文件。',
      openHint: '打开阅读面板（Ctrl+Alt+N）',
      shop: '找书',
      shopNeutral: '来源',
      shopTitle: '网站书城',
      shopHint: '网站只需添加一次。在原站找书、登录，再预览加入书库。',
      shopSites: '常用网站',
      shopAddSite: '添加网站',
      shopSiteName: '网站名称（选填）',
      shopSiteUrl: '网站首页地址',
      shopNoSites: '还没有网站。添加一个你常用的网站首页即可。',
      shopVisit: '进入网站',
      shopSelect: '选一个网站开始找书。',
      shopRemoveHint: '移除网站？已加入的书会保留。',
      shopAddress: '网页地址',
      shopGo: '前往',
      shopFit: '适应宽度',
      shopZoomReset: '恢复 100%',
      shopZoomIn: '放大',
      shopZoomOut: '缩小',
      shopBack: '后退',
      shopForward: '前进',
      shopReload: '刷新',
      shopIdentify: '识别本书',
      shopIdentifying: '正在查找目录、检查正文样本…',
      shopPreview: '加入前确认',
      shopConfirm: '确认加入书库',
      shopCancel: '取消预览',
      shopRead: '开始阅读',
      shopAdded: '已加入书库，没有改变你当前的阅读进度。',
      shopSample: '清洗后的正文样本',
      shopDesktopOnly: '站内浏览和登录需要 Harness 桌面窗口；当前 Web 页面无法使用隔离浏览器。',
      shopOpenExternal: '在外部浏览器打开网站',
      shopPrivacy: '这里显示原网站，会产生网络请求。请直接在站内登录；登录态为临时，重启应用后清除。只导入免费可读章节。',
      shopForget: '断开登录会话',
      shopForgetHint: '断开这个网站的登录会话？下次需重新登录。',
      shopDisconnected: '已断开旧会话；其临时存储分区将在退出应用后释放。',
      shopFailed: '未能识别本书。请进入书籍详情或目录页后重试。',
      shopBrowserNeeded: '请先在“找书”中进入这本书的网站，需要时登录，再返回阅读。',
      shopBrowserError: '隔离浏览器尚未就绪，请重新进入网站后重试。',
      shopSiteMismatch: '请返回所选网站后再识别；其他网站不能使用它的登录会话。',
      shopRestricted: '未找到免费可读正文。请在站内正常登录或完成验证；不导入锁定章节。',
      shopExpired: '预览已过期，请重新识别本书。',
      shopUnsafe: '请使用不含账号令牌或内嵌凭据的公开 HTTP(S) 网站地址。',
      shopAdvanced: '高级：匿名网址导入',
      shopSettingsHint: '管理来源网站并站内找书，无需复制密码或 Cookie。',
      shopSlow: '网站尚未加载完成，请稍后重试。',
      shopPreviewNeutral: '已识别的书籍',
      shopSampleNeutral: '已检查样本，正文可读。',
      setTab_reading: '阅读',
      setTab_appearance: '外观',
      setTab_library: '书库',
      setTab_sites: '网站',
      setShapeShelf: '书页形式',
      setShapeList: '列表形式',
      shelfLocalMeta: '本地 · {n} 章',
      shelfWebMeta: '网络 · 已存 {cached}/{total}',
      stripFold: '收起卡片',
      stripNeutralHead: '文档 {n}',
      stripProgressHead: '{percent}% · 第 {m}/{total} 章',
      setCardHead: '首行内容',
      setCardHeadHint: '卡片第一行显示什么。',
      cardHead_book: '书名',
      cardHead_progress: '进度',
      cardHead_neutral: '中性（不显示书名）',
      setCardFoldDelay: '收起延迟',
      setCardFoldDelayHint: '鼠标移开后卡片等待多久收起。',
      setCardFoldMode: '收起方式',
      setCardFoldModeHint: '卡片什么时候自动收起。',
      cardFoldMode_manual: '只在点收缩时',
      cardFoldMode_auto: '鼠标移开时',
      cardFoldMode_never: '从不自动收起',
      setCardAlign: '小圆标位置',
      setCardAlignHint: '收起后小圆标停在哪里。',
      cardAlign_left: '左',
      cardAlign_center: '中',
      cardAlign_right: '右',
      setCardOffset: '位置微调',
      setCardOffsetHint: '把小圆标左右挪一点。',
      setCardFoldable: '可以收起',
      setCardFoldableHint: '卡片是否允许收起。',
      cardFoldable_yes: '可以',
      cardFoldable_no: '不，始终是卡片',
      setCardFoldedShape: '收起后的样子',
      setCardFoldedShapeHint: '卡片收起后变成什么。',
      cardFoldedShape_mark: '小圆标',
      cardFoldedShape_bar: '一行细条',
      setBarLabel: '细条文字',
      setBarLabelHint: '收起后细条中间显示什么。',
      barLabel_head: '与首行相同',
      barLabel_chapter: '章节位置',
      barLabel_cover: '自定义文字',
      setBarCoverText: '自定义文字内容',
      setBarCoverTextHint: '收起后显示这段文字，不显示书名。',
      setBarProgress: '细条进度',
      setBarProgressHint: '细条上显示多少阅读进度。',
      barProgress_percent: '只显示百分比',
      barProgress_track: '只显示进度线',
      barProgress_both: '百分比和进度线',
      barProgress_none: '都不显示',
      barCover_notes: '阅读笔记',
      barCover_log: '工作日志',
      barCover_draft: '草稿备忘',
      barCover_sync: '同步摘要',
      stripToCard: '变回卡片',
      openReaderNow: '打开阅读器',
    }
    /**
 * The add form's draft.
 *
 * The drawer unmounts when it closes, so the draft lives outside React: a
 * half-typed path survives a stray close.
 */
const addDraft = {
  localPath: '',
  webUrl: '',
  chapterSelector: '',
  contentSelector: '',
  bookTitle: '',
}
const READING_FONTS = {
  sans: 'var(--dsw-font-family,inherit)',
  serif: 'Georgia, "Songti SC", "SimSun", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
}
const SKINS = ['log', 'terminal', 'diff', 'plain']

// The continuous mode keeps a window of chapters in the body, so a long
// reading session does not grow the page without bound.
const MAX_LOADED_CHAPTERS = 16
// The next chapter is fetched this far before the end of the text, so the
// text never runs out under the reader.
const APPEND_THRESHOLD = 600
// The previous chapter is fetched this far above the start of the text.
const PREPEND_THRESHOLD = 400
// The space between two chapters in the column. It must match the CSS.
const CHAPTER_GAP = 16
// How much text one step of the card shows when the reader has not chosen.
// How many reading lines the open card shows when the reader has not chosen.
/**
 * The cover story the card shows, in the reader's own language.
 *
 * An empty setting means "not chosen yet", and the first ready-made story
 * stands in. The settings page and the card both come through here, so the
 * story the page highlights is the story the bar shows.
 *
 * @param {string} raw - the stored setting
 * @returns {string} the story, or '' when the bar should show none
 */
function coverStory(raw) {
  const chosen = typeof raw === 'string' ? raw.trim() : ''
  if (chosen !== '') return chosen
  return translator('barCover_notes')
}

const DEFAULT_LINES = 3
// The card's self-folding wait: one set of bounds for the slider, the render
// path and the host's validation. Three copies of "80" and "2000" is how the
// slider came to say 800 while the reader used up to 2000.
const MIN_FOLD_DELAY = 80
const MAX_FOLD_DELAY = 800
const DEFAULT_FOLD_DELAY = 260

/**
 * Merge one chapter into the loaded window.
 *
 * The window keeps the newest chapters in reading order: appending drops
 * the oldest, prepending drops the last. The chapter being read is never
 * dropped, so a step forward cannot skip one.
 *
 * @param {Array<object>} stream - the loaded chapters, in reading order
 * @param {object} chapter - the chapter to merge in
 * @param {string} where - 'start' or 'end' of the window
 * @param {number} limit - the largest window to keep
 * @param {number} [keepIndex] - the chapter being read
 * @returns {Array<object>} the new window
 */
function mergeChapter(stream, chapter, where, limit, keepIndex) {
  const next = where === 'start' ? [chapter].concat(stream) : stream.concat([chapter])
  if (next.length <= limit) return next
  if (where === 'start') {
    const kept = next.slice(0, limit)
    const dropped = next[limit]
    if (keepIndex !== undefined && dropped !== undefined && dropped.index <= keepIndex) {
      kept.push(dropped)
    }
    return kept
  }
  return next.slice(next.length - limit)
}

/**
 * Find the chapter block of one chapter in the body.
 *
 * @param {object} node - the scrolling body
 * @param {number} index - the chapter index
 * @returns {object|null} the block, or null when it is not in the body
 */
function findChapterBlock(node, index) {
  if (node === null || node === undefined) return null
  if (typeof node.querySelector !== 'function') return null
  const block = node.querySelector(`[data-chapter="${index}"]`)
  return block === undefined ? null : block
}

/**
 * Find the chapter that the top of the view shows.
 *
 * @param {object} node - the scrolling body
 * @returns {number|null} the chapter index, or null when it cannot be read
 */
function chapterAtTop(node) {
  if (node === null || node === undefined) return null
  if (typeof node.querySelectorAll !== 'function') return null
  if (typeof node.getBoundingClientRect !== 'function') return null
  const bodyRect = node.getBoundingClientRect()
  if (bodyRect === null || bodyRect === undefined) return null
  const blocks = node.querySelectorAll('[data-chapter]')
  let found = null
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === null || block === undefined) continue
    if (typeof block.getBoundingClientRect !== 'function') continue
    if (typeof block.getAttribute !== 'function') continue
    const rect = block.getBoundingClientRect()
    if (rect === null || rect === undefined) continue
    // The body has a padding, so the first block sits below its top edge.
    if (rect.top - bodyRect.top <= 32) {
      const value = Number(block.getAttribute('data-chapter'))
      if (Number.isFinite(value)) found = value
    }
  }
  return found
}

/**
 * The line of the text that is under the reader's eye.
 *
 * The lines carry their own number, so the line that is read is found by
 * looking at the top of the reading area. It is the same count the strip
 * uses, so the two surfaces name the same place.
 *
 * @param {any} node - the reading area
 * @returns {number} the zero-based line number, or 0 when it is unknown
 */
function lineAtTop(node) {
  if (node === null || node === undefined) return 0
  if (typeof node.querySelectorAll !== 'function') return 0
  if (typeof node.getBoundingClientRect !== 'function') return 0
  const bodyRect = node.getBoundingClientRect()
  if (bodyRect === null || bodyRect === undefined) return 0
  const rows = node.querySelectorAll('[data-row]')
  let found = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row === null || row === undefined) continue
    if (typeof row.getBoundingClientRect !== 'function') continue
    if (typeof row.getAttribute !== 'function') continue
    const rect = row.getBoundingClientRect()
    if (rect === null || rect === undefined) continue
    if (rect.bottom - bodyRect.top <= 4) continue
    const value = Number(row.getAttribute('data-row'))
    if (Number.isFinite(value)) found = value
  }
  return found
}

    const DISGUISE_TITLE = {
      log: 'app.log',
      terminal: 'session',
      diff: 'review.diff',
      plain: '',
    }

    /** The surfaces the reader can be shown on. */
    const PLACEMENTS = ['strip', 'sidebar']

    /* The colours of the reader's own surfaces.
     *
     * One list, so every surface of the reader takes the colours of the host
     * in the same way. A surface that floats beside the application's root is
     * no longer inside the surface that declares them, so it declares them
     * itself; the card inside the composer does the same.
     *
     * The line height of the text has a name of its own: `--sr-line` is the
     * colour of a line, and a rule that wanted the colour was handed the
     * height instead, which made every border of the reader disappear. */
    const READER_TOKENS = `--sr-bg:var(--dsw-alias-bg-layer-1,#ffffff);
  --sr-bg2:var(--dsw-alias-bg-layer-2,#f6f7f8);
  --sr-ink:var(--dsw-alias-label-primary,#151719);
  --sr-muted:var(--dsw-alias-label-secondary,#5d6469);
  --sr-line:var(--dsw-alias-border-l1,#e2e5e8);
  --sr-line2:var(--dsw-alias-border-l2,#cdd2d7);
  --sr-accent:var(--dsw-alias-brand-primary,#2f6feb);
  --sr-ok:var(--dsw-alias-state-success-primary,#1f9d55);
  --sr-warn:var(--dsw-alias-state-warn-primary,#b7791f);
  --sr-err:var(--dsw-alias-state-error-primary,#d64545);
  --sr-diff-add:var(--dsw-alias-state-success-primary,#1f9d55);
  --sr-diff-del:var(--dsw-alias-state-error-primary,#d64545);
  --sr-diff-add-bg:color-mix(in srgb,var(--sr-diff-add) 10%,transparent);
  --sr-diff-del-bg:color-mix(in srgb,var(--sr-diff-del) 10%,transparent);
  /* The host's own states for a row under the pointer and for the row that is
   * chosen. The reader used one colour for both, and in the light theme that
   * colour was the colour of the surface itself: the rows showed nothing when
   * the pointer was over them. */
  --sr-hover:var(--dsw-alias-interactive-bg-hover,rgba(15,17,21,.06));
  --sr-active:var(--dsw-alias-interactive-bg-active,rgba(15,17,21,.10));
  --sr-hover-accent:var(--dsw-alias-interactive-bg-hover-accent,rgba(15,17,21,.14));
  font-family:var(--dsw-font-family,inherit);
  color-scheme:inherit;`
    const CSS = `
/* The website library is a page of its own: a centred card with a size of its
   own, so it does not stretch across the whole window and so the browser
   inside it keeps a readable width. */
/* The book catalog: a page of its own with the list of books on it. */
/* The way a popup arrives.

   The earlier version lifted the box 4px and scaled it, which read as a wobble
   rather than as an arrival. This one does not move the box at all: the frame
   stays exactly where it will sit, and only its contents settle into it. A
   surface whose box jumps is the thing that looks unpolished; a surface that is
   already in place and simply becomes readable does not. */
@keyframes sr-pop-in{
  from{opacity:0}
  to{opacity:1}}
@keyframes sr-pop-inner-in{
  from{opacity:0;transform:translateY(3px)}
  to{opacity:1;transform:translateY(0)}}
.sr-picker,.sr-set-settings-page{animation:sr-pop-in 120ms ease-out both}
/* The shelf stays mounted while hidden, so its arrival hangs on the class
   that says it is open: a mount-time animation would already have played
   before anyone saw it. */
.sr-shop.is-open{animation:sr-pop-in 120ms ease-out both}
/* The frame fades in place; what it holds settles a beat later, which is what
   makes the arrival read as "a page is ready" rather than "a box appeared". */
.sr-picker>*:first-child,
.sr-set-settings-page>*:first-child{animation:sr-pop-inner-in 160ms ease-out 30ms both}
/* The shelf's head is its identity; the rest of it is a browser that must not
   slide while a page is loading underneath. */
.sr-shop.is-open>*:first-child{animation:sr-pop-inner-in 160ms ease-out 30ms both}
/* The list over the card is anchored to the card, so it does not recentre: it
   fades in place and its rows settle from the edge it opens against. */
.sr-strip-popup{animation:sr-pop-in 100ms ease-out both}
.sr-strip-popup>*:first-child{animation:sr-pop-inner-in 140ms ease-out both}
/* A docked surface fills the pane it was given; it has no frame of its own to
   arrive, so it only becomes readable. */
.sr-picker.sr-picker-sidebar,
.sr-set-settings-page.sr-set-settings-sidebar{animation:sr-pop-in 120ms ease-out both}
.sr-picker.sr-picker-sidebar>*,
.sr-set-settings-page.sr-set-settings-sidebar>*{animation:none}
@media (prefers-reduced-motion:reduce){
  .sr-picker,.sr-set-settings-page,.sr-shop,.sr-strip-popup,
  .sr-picker>*:first-child,.sr-set-settings-page>*:first-child,
  .sr-shop>*:first-child,.sr-strip-popup>*:first-child{animation:none}
}

/* One vocabulary for every popup.

   The reader meets four popups: the catalog, the website shelf, the settings
   page and the list over the card. They used to be 260/430/520/1080 wide with
   two different radii and three different shadows, which reads as four
   unrelated things. They now share one radius, one shadow and one border, and
   their sizes come from what each one holds:

     --sr-pop-w         every floating popup is this wide
     --sr-pop-h         and this tall at most
     --sr-pop-h-min     a short list stops shrinking here

   One compact size for all four, because the content is short lines: a
   chapter title, a book name, a setting label. A wider page was only empty
   space beside the text.

   One size for the pages, because a reader who opens the catalog and then the
   settings should not see the frame change size around the same kind of
   content. The shelf used to be 1040 wide against the catalog's 520, which
   read as two different applications. */
.sr-picker,.sr-shop,.sr-set-settings-page,.sr-strip-popup{
  --sr-pop-radius:var(--dsw-radius-lg,12px);
  --sr-pop-shadow:0 12px 32px color-mix(in srgb,var(--sr-ink) 16%,transparent);
  --sr-pop-border:1px solid var(--sr-line);
  border:var(--sr-pop-border);
  border-radius:var(--sr-pop-radius);
  background:var(--sr-bg);
  color:var(--sr-ink);
  box-shadow:var(--sr-pop-shadow)}

/* Every floating popup hangs from the same line, so opening one after another
   does not feel like the frame wandering around the screen. The frame grows
   downward from that line instead of being centred, because the edge the eye
   reads is the top one. */
.sr-picker{position:absolute;left:50%;top:var(--sr-pop-top,96px);transform:translateX(-50%);z-index:4;
  pointer-events:auto;min-width:0;min-height:0;
  width:min(var(--sr-pop-w,460px),calc(100% - 32px));
  /* A list sizes to its rows between a floor and the shared ceiling: a
     library of three books is a compact card, a library of forty fills the
     frame. Centring is what makes every popup open in the same place, not a
     fixed height - a fixed height left a short list mostly empty. */
  height:auto;
  /* The catalog is a list, so it is as tall as its rows: a library of one book
     used to sit in a 340px frame with an empty half under the row, which
     reads as a page that failed to load. The settings page keeps the floor,
     because a page of groups needs the room. */
  min-height:min(var(--sr-pop-h-min-list,0px),calc(100% - 96px));
  max-height:min(var(--sr-pop-h,520px),calc(100% - 96px));
  display:flex;flex-direction:column;overflow:hidden;-webkit-app-region:no-drag}
.sr-picker-sidebar{position:relative;left:auto;top:auto;transform:none;width:100%;height:100%;
  max-height:none;border:0;border-radius:0;box-shadow:none;background:transparent}
.sr-pick-head{padding:14px 16px 10px}
.sr-pick-hint{margin:0;padding:8px 16px 0;color:var(--sr-muted);font-size:12px;line-height:1.6}
.sr-pick-tools{padding:12px 16px}
.sr-pick-tools .sr-set-input{flex:1 1 auto;min-width:0}
.sr-pick-list{display:flex;
  flex-direction:column;gap:0}
/* The chapters of one book, opened beside its name. */
.sr-pick-book{display:flex;flex-direction:column}
.sr-pick-chapters{list-style:none;margin:0 0 4px;padding:0 0 4px 26px;
  border-left:1px solid var(--sr-line);margin-left:16px}
/* The chapters of a book in the catalog are rows of the same list as every
   other list in the reader. */
.sr-pick-chapter{color:inherit}
.sr-pick-chapter:disabled{opacity:.55;cursor:default}
/* The small arrow that opens the chapters of a book. */
.sr-pick-toc{flex:none;border:0;background:transparent;color:var(--sr-muted);font-size:11px;
  cursor:pointer;padding:2px 4px;border-radius:var(--dsw-radius-sm,6px);line-height:1}
.sr-pick-toc:hover{color:var(--sr-ink);background:var(--sr-hover)}
.sr-pick-toc:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-pick-toc:disabled{opacity:.55;cursor:default}
.sr-pick-row{display:flex;align-items:center;gap:6px;border-radius:var(--dsw-radius-md,8px)}
.sr-pick-row:hover{background:var(--sr-hover)}
/* The book is a row of the same list as every other list in the reader. */
.sr-pick-open{flex:1;min-width:0;padding:8px 8px}
.sr-pick-open:disabled{opacity:.55;cursor:default}
.sr-pick-web{flex:none;font-size:10px;border:0.5px solid var(--sr-line2);border-radius:999px;
  padding:1px 7px;color:var(--sr-muted)}
.sr-pick-go{flex:none;padding-right:10px;color:var(--sr-muted);font-size:13px}
.sr-pick-empty{margin:0;padding:24px 16px;color:var(--sr-muted);font-size:12px;text-align:center}
/* The catalog over the composer sits inside the reader's own layer. */
.sr-root .sr-picker{position:fixed}
.sr-root .sr-picker-sidebar{position:relative}
.sr-shop{position:fixed;left:50%;top:var(--sr-pop-top,96px);transform:translateX(-50%);z-index:80;
  pointer-events:auto;min-width:0;min-height:0;
  /* Wider than a list: this surface carries a web page, and a page needs
     width the way a list of titles does not. */
  width:min(var(--sr-pop-wide,860px),calc(100% - 32px));
  height:min(var(--sr-pop-h,520px),calc(100% - 96px));
  display:flex;flex-direction:column;font-size:13px;overflow:hidden;-webkit-app-region:no-drag}
/* The head of the page carries the same title as the settings page: one
   size, one weight, one inset, so the two pages of the reader do not look
   like two different applications. */
.sr-shop-head{display:flex;align-items:center;gap:8px;justify-content:space-between;
  padding:14px 16px 10px;border-bottom:1px solid var(--sr-line);flex:none;font-size:12px}
.sr-shop-head strong{flex:1;min-width:0;font-size:14px;font-weight:500;line-height:20px;
  color:var(--sr-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-shop-head>.sr-btn{margin-left:auto;flex:none}
.sr-shop-lead,.sr-shop-privacy{margin:0;color:var(--sr-muted);line-height:1.6}
.sr-shop-lead{flex:none;padding:10px 16px 0;font-size:12px}
.sr-shop-privacy{border-top:1px solid var(--sr-line);font-size:12px;flex:none;padding:10px 16px}
.sr-shop-layout{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
/* The sites are tabs across the top: a side column cost the embedded page
   half the window. */
.sr-shop-tabs{flex:none;display:flex;align-items:center;gap:2px;padding:6px 10px;
  border-bottom:1px solid var(--sr-line);overflow-x:auto;scrollbar-width:thin}
.sr-shop-tab{display:flex;align-items:center;flex:none;border-radius:var(--dsw-radius-sm,8px)}
.sr-shop-tab:hover{background:var(--sr-hover)}
.sr-shop-addrow{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px}
.sr-shop-add{display:flex;align-items:center;gap:6px;flex:1;min-width:0;flex-wrap:wrap}
.sr-shop-add[hidden]{display:none}
.sr-shop-sites{padding:14px;overflow:auto;border-right:1px solid var(--sr-line);background:var(--sr-bg2)}
.sr-shop-tabs .sr-shop-visit{display:flex;align-items:center;padding:5px 10px;
  border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--sr-ink);
  font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap;max-width:200px;overflow:hidden}
.sr-shop-tabs .sr-shop-visit strong{font-weight:500;overflow:hidden;text-overflow:ellipsis}
/* The address rides beside the name while there is room, and is dropped
   rather than wrapped when there is not. */
.sr-shop-tab-origin{margin-left:6px;color:var(--sr-muted);font-size:11px;
  overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0;display:inline}
@media (max-width:520px){.sr-shop-tab-origin{display:none}}
.sr-shop-tabs .sr-shop-visit[aria-selected="true"]{background:var(--sr-bg2);
  box-shadow:inset 0 -2px 0 var(--sr-accent)}
.sr-shop-tabs .sr-shop-visit:focus-visible{outline:2px solid var(--sr-accent);outline-offset:-2px}
.sr-shop-tabs .sr-btn{width:20px;height:20px;padding:0;font-size:11px;opacity:.6}
.sr-shop-tabs .sr-btn:hover{opacity:1}
.sr-shop-sites h3,.sr-shop-preview h3{margin:0 0 10px;font-size:13px;font-weight:600}
.sr-shop-site{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.sr-shop-visit{min-width:0;flex:1;border:1px solid var(--sr-line);border-radius:var(--dsw-radius-md,8px);
  padding:10px 11px;background:var(--sr-bg);color:var(--sr-ink);font:inherit;text-align:left;cursor:pointer}
.sr-shop-visit:hover{border-color:var(--sr-accent)}
.sr-shop-visit[aria-pressed=true]{border-color:var(--sr-accent);box-shadow:inset 0 0 0 1px var(--sr-accent)}
.sr-shop-visit strong,.sr-shop-visit span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-shop-visit span{color:var(--sr-muted);font-size:11px;margin-top:3px}
.sr-shop-add{display:flex;flex-direction:column;gap:10px;margin-top:18px;padding-top:14px;
  border-top:1px solid var(--sr-line)}
.sr-shop-add label{display:grid;gap:5px;color:var(--sr-muted);font-size:12px}
.sr-shop-main{display:flex;flex-direction:column;min-height:0;min-width:0;padding:14px;overflow:auto;gap:10px}
.sr-pick-directory{display:flex;flex-direction:column;min-height:0}
.sr-pick-directory .sr-pick-list{padding:0}
.sr-picker .sr-pick-list{padding:4px 8px 12px}
.sr-pick-directory-compact .sr-pick-list{max-height:190px;overflow:auto}
.sr-shop-toolbar,.sr-shop-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sr-shop-toolbar .sr-set-input{flex:1;min-width:120px}
.sr-shop-guest{flex:1 0 240px;min-height:240px;border:1px solid var(--sr-line);
  border-radius:var(--dsw-radius-md,8px);background:var(--sr-bg2);overflow:hidden}
.sr-shop-guest webview{display:flex;width:100%;height:100%;min-height:240px}
.sr-shop-preview{padding:14px;border:1px solid var(--sr-line);border-radius:var(--dsw-radius-md,10px);
  flex:none;background:var(--sr-bg2)}
.sr-shop-preview h4{margin:8px 0}.sr-shop-preview ol{margin:6px 0;padding-left:22px;color:var(--sr-muted)}
.sr-shop-sample{white-space:pre-wrap;max-height:160px;overflow:auto;line-height:1.8;margin:8px 0}
.sr-shop :is(button,input):focus-visible{outline:2px solid var(--sr-accent);outline-offset:2px}
@media(max-width:640px){.sr-shop{left:8px;right:8px;top:8px;bottom:8px;transform:none;
  width:auto;height:auto}
  .sr-shop-tabs{max-width:100%}
  .sr-shop-main{overflow:visible}.sr-shop-guest{min-height:280px}.sr-shop-lead{display:none}}
/* The host gives every direct child of the overlay layer pointer-events:auto.
   Doubling the class keeps this root click-through with the same specificity
   the host rule has, so the order of the two stylesheets cannot change the
   behaviour. */
.sr-root.sr-root{pointer-events:none}
/* The tokens of the reader's own surfaces. A surface that floats beside the
   application's root is no longer inside the surface that declares them, so
   it declares them itself. */
.sr-float{${READER_TOKENS}
  /* A page above a modal takes the colour of a card, the way it did before:
     the overlay colour the host gives an overlay is a shade darker than the
     pages inside it, which made the reader's own pages look like a different
     application from the reader's card. */
  --sr-bg:var(--dsw-alias-bg-layer-1,#ffffff)}
/* The root of the reader's surfaces inside the overlay layer of the
   application. The pages that have to float above a modal the host owns are
   drawn beside the application's root instead, the way the host draws its own
   modals; see .sr-float-page. */
.sr-root{position:absolute;inset:0;pointer-events:none;z-index:20}
.sr-root *{box-sizing:border-box}
.sr-peek{position:absolute;right:20px;bottom:60px;pointer-events:auto;width:30px;height:30px;
  display:grid;place-items:center;border-radius:var(--dsw-radius-lg,10px);border:1px solid var(--sr-line);
  background:var(--sr-bg);color:var(--sr-muted);font-size:14px;line-height:1;cursor:pointer;
  opacity:.6;transition:opacity .15s,color .15s;-webkit-app-region:no-drag}
.sr-peek svg{width:15px;height:15px;display:block}
.sr-peek:hover{opacity:1;color:var(--sr-ink)}
.sr-peek:focus-visible{outline:2px solid var(--sr-accent);outline-offset:2px}
.sr-panel{position:absolute;right:16px;bottom:16px;pointer-events:auto;display:flex;flex-direction:column;
  /* The panel's own scale for the icon buttons of the family. */
  --sr-ibtn-size:26px;--sr-ibtn-glyph:13px;--sr-ibtn-radius:6px;
  width:var(--sr-width,430px);min-width:0;max-width:calc(100% - 32px);max-height:calc(100% - 96px);
  border:1px solid var(--sr-line);border-radius:14px;background:var(--sr-bg);color:var(--sr-ink);
  box-shadow:0 8px 28px rgba(0,0,0,.14);overflow:hidden;-webkit-app-region:no-drag}
.sr-head{display:flex;align-items:center;gap:5px;padding:8px 10px;border-bottom:1px solid var(--sr-line);
  flex-wrap:wrap;
  font-size:12px;color:var(--sr-muted);flex:none}
.sr-head .sr-name{flex:1 1 auto;min-width:42px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:var(--sr-ink)}
.sr-head .sr-count{font-variant-numeric:tabular-nums;flex:none}
/* The panel's buttons are the same family: the look is shared, and the
   panel says how big its icons are once. */
.sr-btn{flex:none;min-width:22px;height:var(--sr-ibtn-size,26px);padding:0 6px;
  border:1px solid transparent;border-radius:var(--sr-ibtn-radius,6px);
  background:transparent;color:var(--sr-muted);
  font-size:var(--sr-ibtn-glyph,13px);line-height:1;cursor:pointer}
.sr-btn:hover{background:var(--sr-hover);color:var(--sr-ink)}
.sr-btn:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-btn:disabled{opacity:.42;cursor:default}
.sr-toc{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--sr-bg);
  min-width:0;overflow:hidden}
.sr-messages{flex:none;padding:6px 10px 0;position:relative;z-index:3}
.sr-messages .sr-error,.sr-messages .sr-note{margin:0 0 6px}
/* One list, one way of being a list.
   Every list in the reader — the chapters of a book, the places a word was
   found, the books of the library — is built the same way: a head that
   names the list and closes it, and rows that carry a small fact on the
   left and the text on the right. The reader learns it once. */
.sr-list-head{flex:none;display:flex;align-items:center;gap:6px;padding:7px 9px;
  border-bottom:1px solid var(--sr-line);font-size:12px;color:var(--sr-muted)}
.sr-list-head strong{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--sr-ink);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-list-head .sr-match-count{flex:none}
.sr-list-tools{flex:none;display:flex;align-items:center;gap:6px;padding:8px 9px;
  border-bottom:1px solid var(--sr-line)}
.sr-list-body{flex:1;min-height:0;overflow:auto;padding:4px}
.sr-list-row{display:flex;align-items:flex-start;gap:8px;width:100%;box-sizing:border-box;text-align:left;border:0;
  background:transparent;color:var(--sr-ink);font:inherit;font-size:12px;line-height:1.6;
  padding:7px 8px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;min-width:0}
.sr-list-row:hover{background:var(--sr-hover)}
.sr-list-row.is-current{background:var(--sr-active);color:var(--sr-accent);font-weight:600}
.sr-list-row:focus-visible{outline:2px solid var(--sr-accent);outline-offset:-2px}
/* The small facts on the left of a row: the chapter, the line. */
.sr-list-where{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;
  /* Wide enough for "2623 章" on one line, narrow enough to leave the title
     room in a compact window. */
  min-width:58px;max-width:84px;color:var(--sr-muted);font-size:10.5px;line-height:1.35;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
/* The text on the right of a row: it wraps, so a long line can be read. */
.sr-list-text{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
/* A one-line text, for the rows whose text is a name and not a sentence. */
.sr-list-text-clip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The rule for the icon buttons of the reader.
   One family, one look: no frame of their own, quiet ink, a soft background
   under the pointer and a clear ring when the keyboard is on it. The glyph
   is one size, and the hit area is the glyph plus a fixed frame, so every
   icon button feels the same under the hand. A surface says how big its
   icons are once, in one place, and every icon button in it follows.
   A new icon button takes this class and nothing else. */
.sr-ibtn{flex:none;display:inline-grid;place-items:center;
  width:var(--sr-ibtn-size,22px);height:var(--sr-ibtn-size,22px);padding:0;
  border:0;border-radius:var(--sr-ibtn-radius,6px);background:transparent;
  color:var(--sr-muted);font:inherit;font-size:var(--sr-ibtn-glyph,13px);line-height:1;
  cursor:pointer;appearance:none;-webkit-appearance:none}
.sr-ibtn:hover{background:var(--sr-hover);color:var(--sr-ink)}
.sr-ibtn:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-ibtn:disabled{opacity:.42;cursor:default}
.sr-ibtn>svg{width:var(--sr-ibtn-glyph,13px);height:var(--sr-ibtn-glyph,13px);display:block}
/* The labelled button of the same family: the same height, the same radius
   and the same reaction, only the width follows the words. */
.sr-lbtn{flex:none;display:inline-grid;place-items:center;
  height:var(--sr-ibtn-size,22px);padding:0 7px;
  border:0;border-radius:var(--sr-ibtn-radius,6px);background:transparent;
  color:var(--sr-muted);font:inherit;font-size:var(--sr-ibtn-label,12px);line-height:1;cursor:pointer}
.sr-lbtn:hover{background:var(--sr-hover);color:var(--sr-ink)}
.sr-lbtn:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
/* The magnifier of the search button is drawn in the ink, so it is not the
   same glyph as the shop's. It takes the size of the icon it sits in. */
.sr-lens{position:relative;display:inline-block;
  width:var(--sr-ibtn-glyph,12px);height:var(--sr-ibtn-glyph,12px);flex:none}
.sr-lens::before{content:'';position:absolute;left:0;top:0;width:58%;height:58%;
  border:1.4px solid currentColor;border-radius:50%}
.sr-lens::after{content:'';position:absolute;right:1%;bottom:6%;width:36%;height:1.4px;
  background:currentColor;border-radius:1px;transform:rotate(45deg);transform-origin:right center}
/* The search page: a field of its own, and every hit listed with the line it
   was found on, so a reader can recognise the place before jumping. */
.sr-search-page{display:flex;flex-direction:column;flex:1;min-height:0;background:var(--sr-bg)}
/* Search needs a full title, not the compact numeric column used by the TOC.
   A full-width metadata line above the excerpt stays readable in a small popup. */
.sr-search-hit{flex-direction:column;gap:5px;padding:9px 10px}
.sr-search-hit .sr-list-where{display:grid;grid-template-columns:minmax(0,1fr) auto;
  align-items:start;gap:8px;flex:auto;width:100%;min-width:0;max-width:none;
  overflow:visible;white-space:normal;text-align:left;font-size:11px;line-height:1.5}
.sr-search-chapter{min-width:0;white-space:normal;overflow-wrap:anywhere;
  font-size:12px;font-weight:500;color:var(--sr-ink)}
.sr-search-location{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--sr-muted)}
.sr-search-hit .sr-list-text{flex:auto;width:100%;line-height:1.65}
.sr-search-field{flex:1;min-width:0;border:1px solid var(--sr-line);background:var(--sr-bg);
  color:var(--sr-ink);font:inherit;font-size:13px;line-height:1.5;padding:5px 9px;
  border-radius:var(--dsw-radius-sm,8px)}
.sr-search-field:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-search-field::placeholder{color:var(--sr-muted);opacity:1}
.sr-search-count{flex:none;font-size:11px;color:var(--sr-muted);font-variant-numeric:tabular-nums}
/* The word is filled in the list, so a place can be recognised at a glance;
   in the text it keeps the quieter underline of the body. */
.sr-list-text mark.sr-hit{background:var(--sr-accent);color:var(--sr-bg);border-radius:2px;
  padding:0 1px;box-shadow:none}
/* The note that says the list is shorter than the count. */
.sr-list-note{padding:4px 8px 6px;color:var(--sr-muted);font-size:11px;line-height:1.5}
/* The list of the places, drawn over the window: the composer cuts off
   anything that grows out of it, so the list lives above it. */
/* The list is anchored to the window, not to the card: the card measures
   itself against the window, so the list can open exactly over it. */
/* The list the card opens is a popup like the others: same width, same top
   line, same frame. It used to be a 320px strip glued to the card's own rect,
   which meant two surfaces with two shapes. The card is still what opened it,
   and clicking away still closes it. */
.sr-strip-popup{position:fixed;z-index:6;pointer-events:auto;
  left:50%;top:var(--sr-pop-top,96px);transform:translateX(-50%);
  display:flex;flex-direction:column;
  width:min(var(--sr-pop-w,460px),calc(100% - 32px));
  height:auto;
  min-height:min(var(--sr-pop-h-min,340px),calc(100% - 96px));
  max-height:min(var(--sr-pop-h,520px),calc(100% - 96px));
  overflow:hidden}

.sr-settings{flex:none;padding:8px 10px;border-bottom:1px solid var(--sr-line);
  display:flex;flex-direction:column;gap:7px;background:var(--sr-bg2)}
/* The settings page is a page of its own, in the same place as the panel it
   replaces: the reader shows either the text or the settings, never both, so
   the reading area keeps its height and its place. */
/* The preferences page. The shape follows the Harness settings: a title, then
   sections told apart by spacing, with the fields of one section in a quiet
   panel. The only hairlines are the dividers inside that panel. */
.sr-set-settings-page{position:absolute;left:50%;top:var(--sr-pop-top,96px);transform:translateX(-50%);
  pointer-events:auto;
  width:min(var(--sr-pop-w,460px),calc(100% - 32px));
  /* Content-sized between a floor and the shared ceiling: a tab with three
     fields is a compact card, a tab with a whole library fills the frame. */
  height:auto;
  min-height:min(var(--sr-pop-h-min,340px),calc(100% - 96px));
  max-height:min(var(--sr-pop-h,520px),calc(100% - 96px));
  display:flex;flex-direction:column;overflow:hidden;z-index:3}
.sr-set-settings-page.sr-set-settings-section{position:relative;left:auto;top:auto;transform:none;
  width:100%;max-width:none;box-shadow:none;border:0;background:transparent;
  padding:0;border-radius:0;max-height:none;
  /* Inside the Harness settings the page is embedded in a page that owns its
     own scrolling, so it lays out as a block. A flex column would give the
     body flex:1 = basis 0, and with an auto-height parent there is no free
     space to grow into, so the body collapsed to its padding and its content
     was clipped: the tab looked empty. */
  display:block;min-height:0}
.sr-set-settings-page.sr-set-settings-section .sr-set-settings-body{display:grid;
  grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px 20px;align-items:start;
  flex:none;overflow:visible;padding:16px 0}
/* A group is a block of related fields: the title separates it from the one
   above it, and the panel keeps the fields together. */
.sr-set-settings-page.sr-set-settings-section .sr-set-group{min-width:0}
.sr-set-settings-page.sr-set-settings-section .sr-set-group-title{margin:0 0 6px;padding-top:2px}
.sr-set-settings-page.sr-set-settings-section .sr-set-settings-head{position:sticky;top:0;z-index:2;
  background:var(--sr-bg);padding-left:0;padding-right:0}
.sr-set-settings-page.sr-set-settings-section .sr-set-tabs{position:sticky;top:44px;z-index:2;
  background:var(--sr-bg);padding-left:0;padding-right:0}
.sr-set-settings-page.sr-set-settings-section .sr-set-settings-head{padding-left:0;padding-right:0}
.sr-set-settings-page.sr-set-settings-section .sr-set-tabs{padding-left:0;padding-right:0}
.sr-set-settings-page.sr-set-settings-section .sr-set-settings-foot{background:transparent;
  border-top:0.5px solid var(--sr-line);padding-left:0;padding-right:0;margin-top:16px}
.sr-set-section{${READER_TOKENS}
  display:block;width:100%;min-width:0;box-sizing:border-box}
.sr-set-settings-page.sr-set-settings-sidebar{position:relative;left:auto;top:auto;transform:none;
  width:100%;max-width:none;height:100%;max-height:none;border:0;border-radius:0;box-shadow:none}
.sr-set-settings-page>*{min-width:0;max-width:100%}
/* The page title row: the same weight and height as the Harness settings. */
.sr-set-settings-head{display:flex;align-items:center;gap:8px;
  padding:14px 16px 10px;border-bottom:1px solid var(--sr-line);font-size:12px}
.sr-set-settings-head strong,
.sr-set-settings-head .sr-set-settings-title{flex:1;min-width:0;
  font-size:14px;font-weight:500;line-height:20px;color:var(--sr-ink);margin:0}
/* The close button sits at the far edge of every popup head, the way it does
   in the catalog, so the eye finds it in the same place. */
.sr-set-settings-head>.sr-btn{margin-left:auto;flex:none}
.sr-set-settings-body{flex:1;min-height:0;overflow:auto;padding:16px;
  display:flex;flex-direction:column;gap:28px}
/* An inactive tab is hidden with an inline style, which no stylesheet rule
   can outrank, so a tab can never be drawn underneath the active one. */
/* The footer is part of the frame, not the scrolling body. */
.sr-set-settings-foot{flex:none;display:flex;align-items:center;gap:8px;
  padding:10px 16px;border-top:1px solid var(--sr-line);background:var(--sr-bg2)}
.sr-set-foot-note{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;font-size:11px;color:var(--sr-muted)}
.sr-set-action-quiet{border-color:transparent;background:transparent;color:var(--sr-muted)}
.sr-set-action-quiet:hover{color:var(--sr-ink);border-color:var(--sr-line2)}
/* The tabs: one row that names the four subjects of this page, so a reader
   never scrolls past three topics to reach the fourth. */
.sr-set-tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--sr-line);
  overflow-x:auto;scrollbar-width:none;flex:none}
.sr-set-tabs::-webkit-scrollbar{display:none}
.sr-set-tab{flex:none;border:0;border-bottom:2px solid transparent;background:transparent;
  color:var(--sr-muted);font:inherit;font-size:12px;line-height:1;padding:9px 10px 8px;
  cursor:pointer;white-space:nowrap}
.sr-set-tab:hover{color:var(--sr-ink)}
.sr-set-tab.is-active{color:var(--sr-accent);border-bottom-color:var(--sr-accent);font-weight:500}
.sr-set-tab:focus-visible{outline:2px solid var(--sr-accent);outline-offset:-2px;border-radius:var(--dsw-radius-sm,8px)}
/* The website list: the stored sites, read-only, with the way in below. */
.sr-set-sites{display:flex;flex-direction:column;gap:2px}
.sr-set-site{display:flex;align-items:baseline;gap:8px;min-width:0;padding:4px 2px;font-size:12px}
.sr-set-site-name{flex:none;color:var(--sr-ink)}
.sr-set-site-origin{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;color:var(--sr-muted);font-size:11px}
/* One section: a title and its fields. Sections are told apart by spacing,
   the way the Harness settings tell them apart. */
.sr-set-group{display:flex;flex-direction:column;gap:6px;min-width:0}
.sr-set-group-title{margin:0 0 2px;font-size:14px;font-weight:600;letter-spacing:.01em;
  line-height:20px;color:var(--sr-ink)}
/* The fields of one section sit in one quiet panel. */
.sr-set-panel{border:0.5px solid var(--sr-line);border-radius:var(--dsw-radius-md,10px);
  background:var(--sr-bg2);overflow:hidden}
/* One field: a label, the control, and a hint under it. The label is the
   field's own line, so the control starts at the left edge of the panel. */
.sr-set-field{display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.sr-set-field+.sr-set-field{border-top:0.5px solid var(--sr-line)}
.sr-set-field-head{display:flex;align-items:center;gap:10px;min-width:0}
.sr-set-settings-label{flex:1 1 auto;min-width:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--sr-ink)}
.sr-set-settings-value{flex:none;font-size:12px;color:var(--sr-muted);
  font-variant-numeric:tabular-nums;min-width:44px;text-align:right}
.sr-set-hint{margin:0;font-size:11px;line-height:1.55;color:var(--sr-muted)}
/* The controls: the Harness height and radius, so they read as one system. */
.sr-set-settings-page input[type=range]{flex:1 1 auto;min-width:90px;width:100%;
  accent-color:var(--sr-accent);height:22px}
.sr-set-settings-page input[type=range]:focus-visible{outline:2px solid var(--sr-accent);outline-offset:2px}
.sr-set-choice-group{display:flex;gap:6px;flex:1 1 auto;flex-wrap:wrap}
.sr-set-cover{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.sr-set-text{box-sizing:border-box;width:100%;max-width:280px;padding:5px 9px;
  border:1px solid var(--sr-line);border-radius:var(--dsw-radius-sm,8px);
  background:var(--sr-bg);color:var(--sr-ink);font:inherit;font-size:12px}
.sr-set-text:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-set-choice{flex:none;border:0.5px solid var(--sr-line2);border-radius:var(--dsw-radius-sm,8px);
  background:var(--sr-bg);color:var(--sr-ink);font:inherit;font-size:12px;
  height:28px;padding:0 11px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center}
.sr-set-choice:hover{border-color:var(--sr-accent)}
.sr-set-choice.is-active{border-color:var(--sr-accent);color:var(--sr-accent);font-weight:500}
.sr-set-choice:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
/* The actions at the bottom of the page. */
.sr-set-settings-actions{display:flex;gap:8px;padding-top:4px}
.sr-set-action{flex:none;border:0.5px solid var(--sr-line2);border-radius:var(--dsw-radius-sm,8px);
  background:var(--sr-bg);color:var(--sr-ink);font:inherit;font-size:12px;
  height:30px;padding:0 12px;cursor:pointer}
.sr-set-action:hover{border-color:var(--sr-accent)}
.sr-set-action:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-set-advanced{border-top:1px solid var(--sr-line);padding-top:10px}
.sr-set-advanced-sum{cursor:pointer;color:var(--sr-muted);font-size:12px;line-height:1.6;user-select:none}
.sr-set-advanced-sum:focus-visible{outline:2px solid var(--sr-accent);outline-offset:2px}
.sr-set-advanced[open] .sr-set-advanced-sum{margin-bottom:8px}
.sr-set-row{display:flex;align-items:center;gap:8px;min-width:0}
.sr-set-input{flex:1 1 auto;min-width:0;height:30px;padding:0 10px;
  border:0.5px solid var(--sr-line2);border-radius:var(--dsw-radius-sm,8px);
  background:var(--sr-bg);color:var(--sr-ink);font:inherit;font-size:12px}
.sr-set-input:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
/* The shape switch sits on the same line as the section hint, at the end. */
.sr-set-shape-row{display:flex;align-items:center;gap:8px;min-width:0}
.sr-set-shape-row>span{flex:1 1 auto;min-width:0;margin:0;font-size:11px;line-height:1.5;
  color:var(--sr-muted)}
.sr-set-shape{flex:none;border:0.5px solid var(--sr-line2);border-radius:var(--dsw-radius-sm,8px);
  background:var(--sr-bg);color:var(--sr-ink);font:inherit;font-size:13px;line-height:1;
  width:30px;height:28px;cursor:pointer}
.sr-set-shape:hover{border-color:var(--sr-accent);color:var(--sr-accent)}
.sr-set-shape:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
/* The shelf: a quiet grid of book shapes drawn from the theme's own surfaces,
   so it sits inside the settings page instead of competing with it. */
/* No height cap and no inner scrollbar: the page already scrolls, and a nested
   scroller clipped the first row of shapes in half. */
.sr-set-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));
  gap:14px 10px;padding:2px}
.sr-set-spine-item{display:flex;flex-direction:column;gap:6px;min-width:0;position:relative}
/* The shape reads as a bound book: a slightly raised surface, a spine strip on
   the left and a hairline page edge on the right. All of it comes from the
   theme, so it belongs to the page in either theme. */
.sr-set-spine{position:relative;display:flex;align-items:center;justify-content:center;
  aspect-ratio:2/3;width:100%;padding:12px 8px 12px 12px;
  border:1px solid var(--sr-line2);border-radius:2px 3px 3px 2px;
  overflow:hidden;cursor:pointer;color:var(--sr-ink);font:inherit;
  background:var(--sr-bg);
  box-shadow:0 1px 1px rgba(0,0,0,.05),0 2px 6px -3px rgba(0,0,0,.12)}
.sr-set-spine::before{position:absolute;top:0;bottom:0;left:0;width:6px;content:"";
  background:var(--sr-line);border-right:1px solid var(--sr-line2)}
.sr-set-spine::after{position:absolute;top:0;bottom:0;right:0;width:2px;content:"";
  background:var(--sr-line);opacity:.7}
.sr-set-spine:hover{background:var(--sr-hover);border-color:var(--sr-accent)}
.sr-set-spine:focus-visible{outline:2px solid var(--sr-accent);outline-offset:2px}
.sr-set-spine-face{position:relative;display:flex;flex-direction:column;gap:5px;
  align-items:center;width:100%;text-align:center;pointer-events:none}
.sr-set-spine-title{font-size:11px;line-height:1.4;font-weight:600;letter-spacing:.01em;
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;
  word-break:break-word}
.sr-set-spine-author{font-size:9px;line-height:1.3;color:var(--sr-muted);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  word-break:break-word}
.sr-set-spine-cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sr-set-spine-mark{position:absolute;top:5px;left:8px;width:4px;height:4px;
  border-radius:50%;background:var(--sr-accent);opacity:.75}
.sr-set-spine-meta{display:block;font-size:10px;line-height:1.3;color:var(--sr-muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;
  font-variant-numeric:tabular-nums}
/* The cross on a shape: hidden until the shape is hovered or focused. It has to
   outrank the row rule further down, which also styles this same element. */
.sr-set-spine .sr-set-spine-remove,
.sr-set-spine-item .sr-set-spine-remove{position:absolute;top:6px;right:6px;z-index:2;
  background:var(--sr-bg);color:var(--sr-muted);border:0.5px solid var(--sr-line);
  border-radius:50%;width:16px;height:16px;padding:0;font-size:9px;line-height:14px;
  cursor:pointer;opacity:0;transition:opacity .12s}
.sr-set-spine-item:hover .sr-set-spine-remove,
.sr-set-spine-item:focus-within .sr-set-spine-remove{opacity:1}
.sr-set-spine-item .sr-set-spine-remove:hover{color:var(--sr-err);border-color:var(--sr-err);opacity:1}
.sr-set-spine-item .sr-set-spine-remove:focus-visible{opacity:1;outline:2px solid var(--sr-accent);outline-offset:1px}
/* The books: one quiet row each, the name and how long it is. */
.sr-set-books{display:flex;flex-direction:column;gap:2px;max-height:180px;overflow:auto;
  margin:0 -4px}
.sr-set-book-row{display:flex;align-items:center;gap:2px;min-width:0}
.sr-set-book{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;
  border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;
  color:var(--sr-ink);font:inherit;font-size:12px;padding:5px 6px;cursor:pointer;text-align:left}
.sr-set-book:hover{background:var(--sr-bg)}
.sr-set-book:focus-visible{outline:2px solid var(--sr-accent);outline-offset:-1px}
.sr-set-book-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-set-book-count{flex:none;font-size:11px;color:var(--sr-muted);font-variant-numeric:tabular-nums}
/* Removing a book: the cross asks, the label it turns into confirms. */
.sr-set-book-remove{flex:none;border:0;background:transparent;color:var(--sr-muted);
  font:inherit;font-size:11px;line-height:1;padding:4px 6px;border-radius:var(--dsw-radius-sm,8px);
  cursor:pointer;opacity:.5}
.sr-set-book-remove:hover{opacity:1;color:var(--sr-err)}
.sr-set-book-remove:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px;opacity:1}
.sr-set-book-confirm{flex:none;border:0.5px solid var(--sr-err);background:transparent;
  color:var(--sr-err);font:inherit;font-size:11px;padding:3px 8px;
  border-radius:var(--dsw-radius-sm,8px);cursor:pointer}
.sr-set-book-confirm:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-set-folders{display:flex;flex-direction:column;gap:2px;max-height:120px;overflow:auto}
.sr-set-folder{display:flex;align-items:center;gap:4px;min-width:0}
.sr-set-folder-path{flex:1 1 auto;min-width:0;font-size:11px;color:var(--sr-muted);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}
.sr-set-error{margin:0;font-size:11px;color:var(--sr-err)}
.sr-set-note{margin:0;font-size:11px;color:var(--sr-ok)}
.sr-set-choice:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-set-settings-actions{display:flex;align-items:center;gap:8px;padding-top:4px;border-top:1px solid var(--sr-line)}
.sr-set-settings-actions button{flex:none;border:1px solid var(--sr-line2);border-radius:7px;background:var(--sr-bg);
  color:var(--sr-ink);font-size:11px;padding:5px 10px;cursor:pointer}
.sr-set-settings-actions button:hover{border-color:var(--sr-accent)}
.sr-set-settings-actions button:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-set-settings-actions button[disabled]{opacity:.42;cursor:default}
.sr-set-save-state{margin:0;font-size:11px;color:var(--sr-muted)}
.sr-set-save-state.is-error{color:var(--sr-err)}
/* The sidebar variant fills the pane it was given, so it draws no frame of
   its own: the host's own pane is the frame. */
/* The side column gives the reader a pane, and the reader fills it. Without
   a height here the body cannot work out its own, and the text would not
   scroll at all. */
.sr-root.sr-root-sidebar{pointer-events:auto;position:static;inset:auto;
  display:flex;flex-direction:column;height:100%;min-height:0;width:100%}
.sr-panel-sidebar{position:relative;right:auto;bottom:auto;width:100%;max-width:none;min-width:0;
  height:100%;max-height:none;border:0;border-radius:0;box-shadow:none;background:transparent}
.sr-settings{flex:none;padding:8px 10px;border-bottom:1px solid var(--sr-line);
  display:flex;flex-direction:column;gap:7px;background:var(--sr-bg2)}
.sr-empty-btn:focus-visible,.sr-lib-file:focus-visible,.sr-lib-remove:focus-visible,.sr-lib-confirm:focus-visible,.sr-lib-row:focus-visible{
  outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-btn:disabled{opacity:.42;cursor:default}
.sr-tools{flex:none;padding:6px 10px;border-bottom:1px solid var(--sr-line);display:flex;flex-direction:column;gap:6px}
.sr-progress{height:3px;border-radius:2px;background:var(--sr-bg2);overflow:hidden;flex:none}
.sr-progress-fill{display:block;height:100%;background:var(--sr-accent);border-radius:2px;transition:width .15s}
.sr-tools .sr-row{gap:6px;flex-wrap:wrap;align-items:center}
.sr-tools input{flex:1 1 90px;min-width:0;width:auto;border:1px solid var(--sr-line2);border-radius:7px;
  padding:4px 7px;background:var(--sr-bg2);color:var(--sr-ink);font-size:11px;font-family:inherit}
.sr-tools input:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-tools input.sr-jump{flex:0 1 78px}
.sr-tools input.sr-search{flex:1 1 120px}
.sr-match-nav{flex:none;display:flex;align-items:center;gap:1px}
.sr-match-count{flex:none;font-size:11px;color:var(--sr-muted);font-variant-numeric:tabular-nums;padding:0 3px;min-width:44px;text-align:center}
.sr-match-btn{flex:none;border:1px solid var(--sr-line2);border-radius:6px;background:var(--sr-bg);
  color:var(--sr-muted);font-size:11px;line-height:1;padding:3px 6px;cursor:pointer}
.sr-match-btn:hover{border-color:var(--sr-accent);color:var(--sr-ink)}
.sr-match-btn:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
mark.sr-hit{background:var(--sr-warn);color:transparent;border-radius:2px;
  box-shadow:0 0 0 1px var(--sr-warn) inset;padding:0 1px}
.sr-panel[data-skin=diff] mark.sr-hit{background:var(--sr-diff-add);box-shadow:0 0 0 1px var(--sr-diff-add) inset}
.sr-panel[data-skin=terminal] mark.sr-hit{background:#8ce99a;box-shadow:0 0 0 1px #8ce99a inset}
/* The strip: a small quiet mark above the composer card that opens one or two
   lines of text. It never takes part in the composer's layout, so the input
   box never moves. The host's overlay anchor sits on the card's top edge with
   no height, so an entry positions itself against the card with bottom:100%
   and a gap — that is where the strip belongs, between the brand and the
   composer. It lives outside the panel, so it declares the tokens for itself. */
.sr-strip{${READER_TOKENS}
  /* The card row: the scale of the icons that live in it. */
  --sr-ibtn-size:22px;--sr-ibtn-glyph:13px;--sr-ibtn-radius:6px;
  /* The strip is one more card in the stack above the composer, so it takes
     the stack's own inset and tucks under the input card like its neighbours. */
  box-sizing:border-box;position:relative;flex:none;pointer-events:auto;
  width:calc(100% - var(--dsh-composer-side-clearance,0px) * 2 - var(--dsh-composer-dock-inset,12px) * 2);
  max-width:calc(var(--dsh-composer-card-max-width,860px) - var(--dsh-composer-dock-inset,12px) * 2);
  margin:0 auto calc(0px - var(--dsh-composer-stack-gap,6px) - 3px);
  padding:0 var(--dsh-composer-dock-inset,12px);
  font-family:var(--dsw-font-family,inherit)}
/* The folded card: one small round mark, so the text keeps the room. */
/* The folded bar: one row of the composer stack, built the way the Goal card
   builds its own, so the two read as members of the same family. */
/* The bar is one surface with its controls inside it, the way the Goal card
   carries its own: the surface spans the stack and the row fills it. */
.sr-strip.sr-strip-bar{box-sizing:border-box;display:flex;
  width:calc(100% - var(--dsh-composer-side-clearance,0px) * 2
    - var(--dsh-composer-dock-inset,12px) * 2);
  max-width:calc(var(--dsh-composer-card-max-width,860px) - var(--dsh-composer-dock-inset,12px) * 2);
  margin:0 auto calc(0px - var(--dsh-composer-stack-gap,6px))}
.sr-strip-bar-inner{--sr-ibtn-size:28px;--sr-ibtn-glyph:13px;--sr-ibtn-radius:999px;
  box-sizing:border-box;display:flex;align-items:center;gap:2px;
  width:100%;height:36px;padding:4px 5px 4px 12px;
  border-radius:var(--dsw-radius-md,10px);background:var(--dsw-specific-menu,var(--sr-bg));
  box-shadow:0 1px 2px rgba(0,0,0,.06)}
/* The two controls inside the bar: turn it back into the card, or close it. */
/* The folded bar lives in the composer, so its buttons take the composer's
   own round shape; the scale is stated on the row above. */
.sr-strip-bar-close:hover{color:var(--sr-err)}
.sr-strip-bar-row{box-sizing:border-box;display:flex;align-items:center;gap:9px;
  flex:1 1 auto;min-width:0;height:28px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--sr-ink);
  font:inherit;text-align:left;cursor:pointer;-webkit-app-region:no-drag}
.sr-strip-bar-row:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-strip-bar-lead{display:grid;flex:none;place-items:center;color:var(--sr-muted)}
.sr-strip-bar-lead svg{width:15px;height:15px;display:block}
/* The bar is one row with no dead space: the label takes what it needs, the
   progress fills the rest, and the percentage sits at the end of it. */
.sr-strip-bar-text{flex:0 1 auto;min-width:0;max-width:40%;font-size:13px;line-height:24px;
  font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-strip-bar-progress{flex:1 1 auto;min-width:40px;display:flex;align-items:center;gap:8px}
/* Without a progress line the row has no filler: the number sits right after
   the text and the rest of the row stays empty. */
.sr-strip-bar-progress.sr-strip-bar-progress-plain{flex:0 0 auto;min-width:0;gap:0}
.sr-strip-bar.sr-strip-bar-plain .sr-strip-bar-text{max-width:72%}
.sr-strip-bar-track{display:block;flex:1 1 auto;height:3px;border-radius:2px;
  background:var(--sr-line);overflow:hidden}
.sr-strip-bar-fill{display:block;height:100%;border-radius:2px;background:var(--sr-accent)}
.sr-strip-bar-percent{font-size:11px;line-height:1;color:var(--sr-muted);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.sr-strip-bar-open{flex:none;font-size:11px;line-height:1;color:var(--sr-accent)}
/* Native composer flow owns the entry space. The entry is an icon button of
   the composer's own size. */
.sr-strip.sr-strip-toolbar{display:inline-flex;align-items:center;width:auto;max-width:none;
  margin:0;padding:0;flex:none;--sr-ibtn-size:28px;--sr-ibtn-glyph:14px;--sr-ibtn-radius:6px}
.sr-strip-mark{position:relative;pointer-events:auto;box-shadow:none;
  transition:background-color .12s,color .12s}
.sr-strip-mark svg{opacity:.65}
.sr-strip-mark:hover svg,.sr-strip-mark:focus-visible svg{opacity:1}
/* The card surface, drawn the way the Queue card draws it: a rounded panel
   that sits under the input card. */
.sr-strip-panel{position:relative;isolation:isolate;overflow:hidden;width:100%;
  border-radius:var(--dsw-radius-lg,10px) var(--dsw-radius-lg,10px) 0 0}
.sr-strip-panel::before{position:absolute;z-index:-1;inset:0;border-radius:inherit;
  background:var(--dsw-specific-menu,var(--sr-bg));content:"";pointer-events:none}
/* The fold control, which sits at the end of the footer row. It is an icon
   button of the family like every other one. */
/* The body: the text, then the progress of the whole book, then the controls. */
/* The body is the text and one footer row. The title row and the progress row
   used to sit above it and cost two lines of reading height for nothing. */
.sr-strip-body{padding:9px 12px 6px}
.sr-strip-line{margin:0 0 5px;color:var(--sr-ink);line-height:var(--sr-line-height,1.65);
  /* The reading size the reader chose, capped for a card: the panel can carry
     26px, the card cannot, because it sits above the input box. */
  font-size:min(var(--sr-font,13px),var(--sr-strip-font-cap,18px));
  word-break:break-word;overflow-wrap:anywhere}
/* The progress belongs with the place: the chapter says where the reader is,
   the number says how far through the book that is. */
.sr-strip-foot-progress{flex:none;display:flex;align-items:center;gap:5px}
.sr-strip-progress-track{display:block;width:44px;height:3px;border-radius:2px;
  background:var(--sr-line);overflow:hidden}
.sr-strip-progress-fill{height:100%;border-radius:2px;background:var(--sr-accent);
  transition:width .18s}
.sr-strip-progress-text{flex:none;font-size:10px;line-height:1;color:var(--sr-muted);
  font-variant-numeric:tabular-nums}
.sr-strip-foot{display:flex;align-items:center;gap:5px;flex-wrap:nowrap;min-width:0}
/* The book's place, on the footer row instead of a line of its own. */
.sr-strip-foot-label{flex:0 1 auto;min-width:54px;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;font-size:10px;line-height:1;color:var(--sr-muted)}
.sr-strip-foot-error{flex:0 1 auto;min-width:0;max-width:50%;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;font-size:10px;line-height:1;color:var(--sr-err)}
/* The steps now sit among the other controls, so they look like them: no
   box of their own, only the glyph and the quiet colour. */
/* The steps are icon buttons of the family like every other one. */
.sr-strip-hint{flex:1;min-width:0;margin:0;color:var(--sr-muted);font-size:11px;line-height:1.5;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The search lives in the footer's own space, so the card keeps its height. */
/* The field is a small thing in the row, not a bar across it. */
/* The field takes the room the chapter label gives up, so a narrow card can
   still hold it: it shrinks before the row overflows. */
.sr-strip-search{flex:1 1 120px;width:auto;min-width:70px;max-width:240px;
  border:1px solid var(--sr-line);background:var(--sr-bg);
  color:var(--sr-ink);font:inherit;font-size:11px;line-height:1.4;padding:2px 7px;
  border-radius:var(--dsw-radius-sm,8px)}
.sr-strip-search:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-strip-search::placeholder{color:var(--sr-muted);opacity:1}
/* The icon buttons of the footer row are icon buttons of the family like
   every other one; only the primary one carries a colour of its own. */
/* One primary action, so "open the reader" is the obvious next step. */
.sr-strip-open-primary{color:var(--sr-accent)}
.sr-strip-open-primary:hover{background:var(--sr-bg2);color:var(--sr-accent)}
@media (prefers-reduced-motion:reduce){.sr-strip-btn,.sr-strip-mark,.sr-strip-progress-fill{transition:none}}
.sr-body{flex:1;min-height:0;overflow:auto;padding:12px 14px;font-size:var(--sr-font,15px);
  line-height:var(--sr-line-height,1.9);font-family:var(--sr-reading-font,inherit);
  word-break:break-word;overflow-wrap:anywhere;overscroll-behavior:contain;scrollbar-width:thin}
.sr-body p{margin:0 0 .85em}
/* The continuous column: the chapters follow each other in one scroll. */
.sr-chapter+.sr-chapter{margin-top:16px;padding-top:12px;border-top:1px solid var(--sr-line)}
.sr-chapter-mark{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--sr-muted);
  display:flex;align-items:center;gap:6px;letter-spacing:.02em}
.sr-chapter-mark::after{content:"";flex:1;height:1px;background:var(--sr-line)}
.sr-column-end{margin-top:14px;text-align:center}
.sr-column-note{margin:0;color:var(--sr-muted);font-size:11px;opacity:.85}
.sr-panel[data-skin=terminal] .sr-column-note{color:#6b7f8c}
.sr-panel[data-skin=log] .sr-chapter-mark{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sr-panel[data-skin=diff] .sr-chapter-mark{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sr-panel[data-skin=terminal] .sr-chapter-mark{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-chapter-mark::after{background:#1b2430}
.sr-panel[data-skin=terminal] .sr-chapter+.sr-chapter{border-color:#1b2430}
.sr-body p:last-child{margin-bottom:0}
.sr-foot{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--sr-line);
  font-size:11px;color:var(--sr-muted);flex:none}
.sr-foot .sr-hint{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-panel[data-skin=log] .sr-body{background:var(--sr-bg2);color:var(--sr-ink);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  /* The size and spacing are the reader's: a skin chooses the typeface,
     not how big the text is. This rule used to pin both, which is why the
     sliders measured as doing nothing on three of the four skins. */
  font-size:var(--sr-font,14px);line-height:var(--sr-line-height,1.75)}
.sr-panel[data-skin=log] .sr-body p::before{content:attr(data-t) " INFO  ";color:var(--sr-muted);opacity:.85}
.sr-panel[data-skin=log] .sr-body p[data-level="WARN"]::before{content:attr(data-t) " WARN  ";color:var(--sr-warn);opacity:1}
.sr-panel[data-skin=log] .sr-body p[data-level="ERROR"]::before{content:attr(data-t) " ERROR ";color:var(--sr-err);opacity:1}
.sr-panel[data-skin=terminal]{background:#0d1117;border-color:#1b2430;color:#8ce99a}
.sr-panel[data-skin=terminal] .sr-head{border-color:#1b2430;color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-head .sr-name{color:#8ce99a}
.sr-panel[data-skin=terminal] .sr-btn{color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-btn:hover{background:#161d26;color:#8ce99a}
.sr-panel[data-skin=terminal] .sr-foot{border-color:#1b2430;color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-body{background:#0d1117;color:#8ce99a;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:var(--sr-font,14px);line-height:var(--sr-line-height,1.7)}
.sr-panel[data-skin=terminal] .sr-body p::before{content:"$ ";color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-term-prompt{padding:6px 10px;color:#6b7f8c;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.sr-panel[data-skin=terminal] .sr-term-prompt::after{content:"\\2588";color:#8ce99a;margin-left:4px;
  animation:sr-cursor 1.1s steps(1) infinite}
@keyframes sr-cursor{0%,50%{opacity:1}51%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){
  .sr-panel[data-skin=terminal] .sr-term-prompt::after{animation:none}
  .sr-peek{transition:none}
}
.sr-panel[data-skin=diff] .sr-body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:var(--sr-font,14px);line-height:var(--sr-line-height,1.7);background:var(--sr-bg2)}
.sr-panel[data-skin=diff] .sr-diff-head{padding:4px 8px;color:var(--sr-muted);opacity:.85;
  border-bottom:1px solid var(--sr-line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sr-panel[data-skin=diff] .sr-body p{position:relative;padding:0 34px 0 26px}
.sr-panel[data-skin=diff] .sr-body p::before{content:attr(data-sign);position:absolute;left:8px;width:1ch;opacity:.9}
.sr-panel[data-skin=diff] .sr-body p::after{content:attr(data-line);position:absolute;right:8px;color:var(--sr-muted);
  opacity:.55;font-size:11px;font-variant-numeric:tabular-nums}
.sr-panel[data-skin=diff] .sr-body p[data-sign="+"]::before{color:var(--sr-diff-add)}
.sr-panel[data-skin=diff] .sr-body p[data-sign="-"]::before{color:var(--sr-diff-del)}
.sr-panel[data-skin=diff] .sr-body p[data-sign="+"] {background:var(--sr-diff-add-bg)}
.sr-panel[data-skin=diff] .sr-body p[data-sign="-"] {background:var(--sr-diff-del-bg)}
.sr-panel[data-skin=plain] .sr-body{font-family:var(--dsw-font-family,inherit)}
.sr-empty{display:flex;flex-direction:column;align-items:flex-start;gap:8px;color:var(--sr-muted)}
.sr-empty p{margin:0}
.sr-empty-btn{border:1px solid var(--sr-line2);border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--sr-ink);font:inherit;font-size:13px;padding:5px 12px;cursor:pointer}
.sr-empty-btn:hover{border-color:var(--sr-accent);background:var(--sr-bg2)}
.sr-empty-hint{font-size:11px;opacity:.8}
.sr-note{margin:0 0 .85em;padding:6px 8px;border-radius:8px;font-size:12px;line-height:1.6;
  color:var(--sr-muted);background:var(--sr-bg2);border:1px solid var(--sr-line)}
.sr-error{margin:0 0 .85em;padding:6px 8px;border-radius:8px;font-size:12px;line-height:1.6;
  color:var(--sr-err);background:color-mix(in srgb,var(--sr-err) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--sr-err) 28%,transparent)}
.sr-panel[data-skin=terminal] .sr-error{color:#ff7b72;background:#ff7b721a;border-color:#ff7b7240}
.sr-library{position:absolute;inset:0;min-width:0;max-width:100%;display:flex;flex-direction:column;
  background:var(--sr-bg);z-index:2;overflow:hidden}
.sr-library>*{min-width:0;max-width:100%}
.sr-library .sr-lib-head{display:flex;align-items:center;gap:6px;padding:11px 14px;border-bottom:1px solid var(--sr-line);font-size:12px}
.sr-library .sr-lib-head strong{flex:1;font-size:13px;font-weight:600}
.sr-lib-list{flex:1;min-height:0;overflow:auto;padding:8px}
.sr-lib-row{display:flex;align-items:center;gap:6px;border-radius:var(--dsw-radius-lg,10px);font-size:13px}
.sr-lib-row:hover{background:var(--sr-bg2)}
.sr-lib-open{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border:0;background:transparent;
  color:inherit;font:inherit;text-align:left;cursor:pointer;padding:9px 10px;border-radius:var(--dsw-radius-lg,10px)}
.sr-lib-open:focus-visible{outline:2px solid var(--sr-accent);outline-offset:-2px}
.sr-lib-row .sr-lib-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-lib-row .sr-lib-meta{flex:none;color:var(--sr-muted);font-size:11px;font-variant-numeric:tabular-nums}
.sr-lib-remove,.sr-lib-confirm{flex:none;border:0;background:transparent;color:var(--sr-muted);cursor:pointer;
  font-size:12px;padding:3px 7px;border-radius:var(--dsw-radius-sm,8px)}
.sr-lib-remove:hover,.sr-lib-confirm:hover{background:var(--sr-bg2);color:var(--sr-err)}
.sr-lib-confirm{color:var(--sr-err)}
.sr-lib-add{width:100%;border:1px dashed var(--sr-line2);border-radius:var(--dsw-radius-sm,8px);
  background:transparent;color:var(--sr-muted);font:inherit;font-size:12px;padding:7px;cursor:pointer}
.sr-lib-add:hover{border-color:var(--sr-accent);color:var(--sr-ink)}
.sr-lib-scanned{max-height:140px;overflow:auto;border-top:1px solid var(--sr-line);padding:6px}
.sr-lib-scanned-head{font-size:11px;color:var(--sr-muted);padding:2px 4px 4px}
.sr-lib-file{display:block;width:100%;text-align:left;border:0;background:transparent;color:var(--sr-ink);
  font:inherit;font-size:12px;padding:4px 6px;border-radius:var(--dsw-radius-sm,8px);cursor:pointer;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-lib-file:hover{background:var(--sr-bg2)}
.sr-lib-form{padding:10px;border-top:1px solid var(--sr-line);font-size:12px;display:flex;flex-direction:column;gap:6px}
.sr-lib-form input{width:100%;border:1px solid var(--sr-line2);border-radius:8px;padding:6px 8px;background:var(--sr-bg2);
  color:var(--sr-ink);font-size:12px;font-family:inherit}
.sr-lib-form input:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-lib-form .sr-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.sr-lib-form .sr-row input{flex:1 1 140px;min-width:0;width:auto}
.sr-lib-form .sr-row button{flex:none;white-space:nowrap;border:1px solid var(--sr-line2);border-radius:8px;background:var(--sr-bg2);
  color:var(--sr-ink);font-size:12px;padding:6px 10px;cursor:pointer}
.sr-lib-form .sr-row button:focus-visible{outline:2px solid var(--sr-accent);outline-offset:1px}
.sr-lib-form .sr-row button:hover{border-color:var(--sr-accent)}
.sr-lib-error{color:var(--sr-err);font-size:12px}
.sr-lib-empty{padding:16px 10px;color:var(--sr-muted);font-size:12px;text-align:center}
.sr-panel[data-skin=terminal] .sr-library{background:#0d1117}
.sr-panel[data-skin=terminal] .sr-library input{background:#161d26;border-color:#1b2430;color:#8ce99a}
.sr-panel[data-skin=terminal] .sr-lib-row:hover{background:#161d26}
.sr-panel[data-skin=terminal] .sr-lib-row button{color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-lib-head{border-color:#1b2430;color:#6b7f8c}
.sr-panel[data-skin=terminal] .sr-lib-form{border-color:#1b2430}
/* A page drawn beside the application's root floats above the modals the host
   owns — the settings panel among them. It is drawn there because the overlay
   layer lives inside the root, and a page inside it sits under every modal.
   The host's own rule makes a body child a no-drag area, which is what a
   floating page is anyway. */
.sr-float-page{position:fixed;z-index:1150}
`

    /**
     * Build a translator bound to the Harness locale service when possible.
     * @param {any} ctx - client context
     * @returns {(key: string) => string} translator
     */
    function makeTranslator(ctx) {
      let bound = null
      try {
        // The registration lives as long as the plugin run: a leftover
        // namespace would make the next load fail to register.
        ctx.effect(() => {
          const dispose = ctx.locale.register('stealth-reader', { en: EN, zh: ZH })
          const candidate = ctx.locale.bind('stealth-reader')
          if (typeof candidate === 'function') bound = candidate
          return typeof dispose === 'function' ? dispose : () => {}
        }, 'stealth-reader:locale')
      } catch {
        // The panel keeps its own dictionary when the locale service refuses.
      }
      const active = () => {
        try {
          const id = ctx.locale.getSnapshot().active
          return String(id || 'en').startsWith('zh') ? 'zh' : 'en'
        } catch {
          return 'en'
        }
      }
      return (key, params) => {
        let value = ''
        if (bound !== null) {
          try {
            const candidate = bound(key)
            if (typeof candidate === 'string' && candidate !== '') value = candidate
          } catch {
            // Fall through to the local dictionary.
          }
        }
        if (value === '') {
          const lang = active()
          value = (lang === 'zh' ? ZH : EN)[key] ?? EN[key] ?? key
        }
        // A placeholder lets one string carry a number.
        if (params === undefined || params === null) return value
        return value.replace(/\{(\w+)\}/g, (match, name) => {
          const replacement = params[name]
          return replacement === undefined || replacement === null ? match : String(replacement)
        })
      }
    }

    /**
     * Call the Host half over the local reader route.
     * @param {string} action - route action
     * @param {object} [payload] - action payload
     * @returns {Promise<object>} response body
     */
    function rawCall(action, payload) {
      return fetch('/stealth-reader/api', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(payload || {}) }),
      }).then(async (response) => {
        if (!response.ok) {
          const failure = new Error(`HTTP ${response.status}`)
          failure.code = 'failed'
          throw failure
        }
        const data = await response.json()
        if (data === null || typeof data !== 'object') {
          const failure = new Error('bad response')
          failure.code = 'failed'
          throw failure
        }
        if (data.ok === false) {
          const failure = new Error(data.error || 'failed')
          failure.code = data.code || 'failed'
          if (typeof data.format === 'string') failure.format = data.format
          if (data.need && typeof data.need === 'object') failure.need = data.need
          throw failure
        }
        return data
      }, () => {
        const failure = new Error('host unreachable')
        failure.code = 'failed'
        throw failure
      })
    }

    // The guest owns sign-in state. Only cleaned page snapshots cross to the
    // Host, and only when a reader explicitly requests a chapter or preview.
    let readerBrowser = null
    function browserForReader() {
      if (readerBrowser === null) {
        readerBrowser = createReaderBrowser({ onState: state => readerStore.set({ browserNav: state }) })
      }
      return readerBrowser
    }

    async function call(action, payload) {
      try {
        return await rawCall(action, payload)
      } catch (failure) {
        const need = failure && failure.need
        if (failure?.code !== 'browserRequired' || !need?.bookId
          || !['chapter', 'open', 'next', 'prev'].includes(action)) throw failure
        const state = await rawCall('state')
        const site = (state.sites || []).find(item => item.id === need.siteId)
        const browser = browserForReader()
        if (!site || !browser.supported) throw failure
        // The site's own isolated guest is opened here when it is not open
        // yet, so a website book is readable without visiting the website
        // library first. Nothing about a sign-in crosses a boundary: it stays
        // inside that guest, and only cleaned page HTML comes back.
        const page = await browser.ensureAndFetch(site, need.url)
        await rawCall('browser_cache', { bookId: need.bookId, url: page.url, html: page.html })
        return rawCall(action, payload)
      }
    }

    /**
     * The reader's shared state.
     *
     * The reader can be shown in three places — the floating panel, the right
     * sidebar and the strip above the composer — and only one of them is on
     * screen at a time. They still have to agree about what is being read and
     * about whether the panel is open, so that state lives here instead of
     * inside one component. A component that only reads it never re-renders
     * the others, and one that writes it publishes the change to all of them.
     *
     * The state is deliberately small: the text being read stays inside the
     * panel, because the panel is the only place that shows it.
     */
    const readerStore = (() => {
      const initial = () => ({
        /** Whether the reading panel is open. */
        visible: false,
        /**
         * Whether the reader has been put away entirely. The card in the
         * composer honours this; `visible` only decides whether the panel is
         * drawn, so closing the panel never removed the card.
         */
        hidden: false,
        /** Where the reader is shown: 'strip' or 'sidebar'. */
        placement: 'strip',
        /** The book being read, or null when nothing is open. */
        bookId: null,
        /** The title of the book being read, when the skin may show it. */
        bookTitle: '',
        /** The zero-based chapter being read. */
        index: 0,
        /** How many chapters the book has. */
        total: 0,
        /** The title of the chapter being read, when the skin may show it. */
        chapterTitle: '',
        /** Whether the settings page is open. */
        settingsOpen: false,
        /**
         * Whether the book catalog is open. It is its own page: the list of
         * books is a chooser, not a preference, and a reader wants it next
         * to the text rather than inside the settings.
         */
        pickerOpen: false,
        /**
         * Whether the catalog is a floating page.
         *
         * The Harness settings own a modal of their own, and a catalog drawn
         * inside the application sits under it. A catalog opened from there
         * floats above it instead, beside the application's root.
         */
        pickerFloating: false,
        /** The explicit, non-disguised website picker. Browser data stays out of sessions. */
        bookstoreOpen: false,
        /**
         * The list the composer card opened.
         *
         * The list is drawn in the overlay layer, because the composer cuts
         * off anything that grows out of it. The card publishes the list and
         * the place on the screen where the list should open. The list is
         * either the places a search found or the chapters of the book.
         */
        stripPopup: null,
        /**
         * A thing the reader picked out of that list, waiting for the card
         * to go there.
         */
        stripPick: null,
        sites: [],
        browserNav: { siteId: null, url: '', title: '', loading: false },
        /**
         * Whether the side column could not carry the reader, so the panel
         * falls back to the floating one. The reader must always be
         * reachable, whatever the surface was asked for.
         */
        sidebarUnavailable: false,
        /** The books the host knows about, or null before the first read. */
        books: null,
        /** The reading preferences, as the host holds them. */
        settings: {
          skin: 'log',
          fontSize: 15,
          width: 430,
          lineHeight: 1.9,
          font: 'sans',
          scrollMode: 'chapter',
          placement: 'strip',
        },
      })
      let state = initial()
      let placementIsExplicit = false
      const listeners = new Set()
      return {
        /** @returns {object} the current state */
        get: () => state,
        /**
         * Publish one change.
         * @param {object} patch - the fields to change
         * @returns {void}
         */
        set(patch) {
          const next = { ...state, ...patch }
          if (Object.prototype.hasOwnProperty.call(patch, 'placement')) placementIsExplicit = true
          // Host hydration can arrive after a manual tab open. Once the user
          // chose a surface this session, a stale settings response must not
          // move the reader back or trigger lifecycle work on the old surface.
          if (patch.settings && patch.settings.placement !== undefined) {
            if (!placementIsExplicit) {
              next.placement = PLACEMENTS.includes(patch.settings.placement)
                ? patch.settings.placement : 'strip'
            }
            next.settings = { ...patch.settings, placement: next.placement }
          }
          let changed = false
          for (const key of Object.keys(next)) {
            if (!Object.is(next[key], state[key])) { changed = true; break }
          }
          if (!changed) return
          state = next
          for (const listener of Array.from(listeners)) listener()
        },
        /**
         * Put the state back to its first shape.
         *
         * A plugin that is loaded again starts from the beginning, so the
         * shared state does too.
         *
         * @returns {void}
         */
        reset() {
          placementIsExplicit = false
          state = initial()
          for (const listener of Array.from(listeners)) listener()
        },
        /**
         * Watch for changes.
         * @param {() => void} listener - the callback
         * @returns {() => void} an unsubscribe function
         */
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      }
    })()

    /**
     * Read the shared reader state.
     *
     * The snapshot is the whole state object and it keeps its identity until
     * something changes, so React can compare it by reference.
     *
     * @returns {object} the shared state
     */
    function useReaderState() {
      return React.useSyncExternalStore(readerStore.subscribe, readerStore.get, readerStore.get)
    }

    /**
     * The reading preferences and the way they are stored.
     *
     * The preferences live beside the shared state rather than inside the
     * panel, because the settings page has to work in every placement — the
     * strip included, where no panel is mounted at all.
     */
    const settingsController = (() => {
      // A slider writes once, when the reader stops moving it; a switch is a
      // decision and is written at once.
      const IMMEDIATE = ['skin', 'font', 'scrollMode', 'placement']
      let pending = null
      let timer = null
      /**
       * Write one patch to the host.
       * @param {object} patch - the settings to write
       * @returns {Promise<void>} resolves when the host answered
       */
      const write = async (patch) => {
        const data = await call('settings', { patch })
        if (data && data.settings && typeof data.settings === 'object') {
          readerStore.set({ settings: { ...readerStore.get().settings, ...data.settings } })
        }
      }
      return {
        /**
         * Store one reading preference.
         * @param {string} key - the setting name
         * @param {number | string} value - the new value
         * @returns {Promise<void>} resolves when the setting is stored
         */
        async change(key, value) {
          const current = readerStore.get().settings
          readerStore.set({ settings: { ...current, [key]: value },
            ...(key === 'placement' ? { placement: value } : {}) })
          if (!IMMEDIATE.includes(key)) {
            pending = { ...(pending || {}), [key]: value }
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(() => {
              timer = null
              const patch = pending
              pending = null
              if (patch !== null) void write(patch)
            }, 400)
            return
          }
          await write({ [key]: value })
        },
        /**
         * Put every preference back to its shipped value.
         * @returns {Promise<void>} resolves when the host answered
         */
        async reset() {
          const data = await call('reset_settings')
          if (data && data.settings && typeof data.settings === 'object') {
            readerStore.set({ settings: { ...readerStore.get().settings, ...data.settings },
              ...(PLACEMENTS.includes(data.settings.placement) ? { placement: data.settings.placement } : {}) })
          }
        },
        /**
         * Write the preference that is still waiting, if there is one.
         *
         * The plugin may go while a slider is still moving, and a preference
         * that was never written is a preference that was never chosen.
         *
         * @returns {void}
         */
        flush() {
          if (timer !== null) {
            clearTimeout(timer)
            timer = null
          }
          const patch = pending
          pending = null
          if (patch !== null) void write(patch)
        },
      }
    })()

    /**
     * The sidebar service, when the profile has one.
     *
     * The service is optional, so it is asked for rather than assumed; the
     * reader keeps its other surfaces without it.
     */
    let sidebarService = null
    // A tab occurrence outlives a body render. Track its real AbortSignal,
    // rather than treating React unmount/visibility loss as a tab close.
    const sidebarTabs = new Map()
    let activeSidebarSignal = null

    function releaseSidebarTabs() {
      for (const entry of sidebarTabs.values()) entry.release()
      sidebarTabs.clear()
      activeSidebarSignal = null
    }

    function closeReadingTabs() {
      for (const entry of Array.from(sidebarTabs.values())) {
        const tab = entry.current
        if (!entry.mounted || !tab || tab.visible === false) continue
        if (tab.actions && typeof tab.actions.close === 'function') {
          try { tab.actions.close() } catch (failure) { reportFault('sidebar', failure) }
        }
      }
    }

    /**
     * Open the reader where the placement says it belongs.
     *
     * The sidebar is a tab, so opening the reader there means asking the
     * sidebar to open that tab. The overlay is a panel of this plugin's own,
     * so it is simply shown.
     *
     * @returns {void}
     */
    /**
     * Move the reader from one shape to the other.
     *
     * The two shapes are alternatives, so the reader is only ever in one of
     * them. The place is kept: the chapter and the line are already in the
     * shared store, so the shape that takes over opens where the other left
     * off.
     *
     * @param {string} where - 'strip' or 'sidebar'
     * @returns {Promise<void>} resolves when the reader is in that shape
     */
    async function placeReader(where) {
      if (!PLACEMENTS.includes(where)) return
      const at = readerStore.get().placement
      // Explicit commands own navigation and closing; ordinary tab visibility
      // changes never close a reader tab or move it back to the composer.
      readerStore.set({ placement: where, hidden: false, visible: false, stripPopup: null })
      if (where === 'strip') closeReadingTabs()
      if (where === 'sidebar') openReader()
      // Opening must not wait for a settings round trip, and repeating an
      // already-selected sidebar placement must still reveal its tab.
      const settledPlacement = readerStore.get().placement
      if (at !== settledPlacement) {
        try { await call('settings', { patch: { placement: settledPlacement } }) } catch {}
      }
    }

    function openReader() {
      if (readerStore.get().placement === 'sidebar') {
        if (sidebarService && typeof sidebarService.openTab === 'function') {
          try {
            readerStore.set({ hidden: false })
            sidebarService.openTab('stealth-reader')
            return
          } catch (failure) {
            reportFault('sidebar', failure)
          }
        }
        // The side column is not there, or it could not open the tab. The
        // reader falls back to the strip rather than disappearing: it is the
        // one shape that needs nothing but the composer. A closed reader has
        // to be brought back here too, or the fallback would land on a card
        // that is still hidden.
        readerStore.set({ sidebarUnavailable: true, placement: 'strip', hidden: false })
        return
      }
      readerStore.set({ visible: true, hidden: false })
    }

    /**
     * The layers of this plugin that answer Escape, topmost last.
     *
     * Three surfaces used to listen for Escape on their own: the website
     * library, the settings page and the reading card. One press then closed
     * several of them, which is how a reader lost the page and the panel in
     * the same keystroke. One stack answers the press, and only the topmost
     * layer acts on it.
     */
    const escapeLayers = (() => {
      const layers = []
      let installed = false
      const onKeyDown = (event) => {
        if (event.key !== 'Escape' || layers.length === 0) return
        const top = layers[layers.length - 1]
        event.preventDefault()
        event.stopPropagation()
        top()
      }
      return {
        /**
         * Answer Escape while this layer is the topmost one.
         * @param {() => void} close - what the layer does with the press
         * @returns {() => void} the layer leaves the stack
         */
        push(close) {
          if (typeof document === 'undefined') return () => {}
          if (!installed) {
            document.addEventListener('keydown', onKeyDown, true)
            installed = true
          }
          layers.push(close)
          return () => {
            const at = layers.lastIndexOf(close)
            if (at !== -1) layers.splice(at, 1)
            if (layers.length === 0 && installed) {
              document.removeEventListener('keydown', onKeyDown, true)
              installed = false
            }
          }
        },
      }
    })()

    /**
     * Map a host failure onto a localized message.
     * @param {unknown} failure - the rejected value
     * @param {(key: string) => string} t - translator
     * @returns {string} a message safe to show inside the panel
     */
    function describeFailure(failure, t, disguised) {
      const code = failure && typeof failure === 'object' && typeof failure.code === 'string'
        ? failure.code
        : ''
      // A website book opens its own site now, so this appears only when that
      // site refused the page: the reader finishes signing in there.
      if (['browserRequired', 'browserWrongSite', 'browserCaptureDenied', 'noSite'].includes(code)) {
        return t('shopBrowserNeeded')
      }
      if (['browserLoading', 'browserBusy'].includes(code)) return t('shopSlow')
      if (code === 'network') return t('errNetwork')
      if (code === 'notFound') return t('errNotFound')
      if (code === 'unknown') return t('errUnknown')
      if (code === 'httpError') return t('errHttp')
      if (code === 'noFile') return t('errNoFile')
      if (code === 'emptyChapter') return disguised ? t('errEmptyNeutral') : t('errEmpty')
      if (code === 'noBook') return t('noBook')
      if (code === 'badFormat') return t('errBadFormat')
      if (code === 'unsupportedFormat') {
        const format = failure && typeof failure.format === 'string' ? failure.format : ''
        if (format === '') return t('errUnsupported')
        // The advice names the reader's own formats, so a disguise keeps it out.
        return disguised ? t('errUnsupportedFormatNeutral', { format }) : t('errUnsupportedFormat', { format })
      }
      // The generic host failure must not name the reader in a disguise skin.
      return disguised ? t('errHostNeutral') : t('errHost')
    }

    /**
     * Ask the host for a folder through the workspace picker.
     * @returns {Promise<string | null>} the picked folder, or null
     */
    function pickFolder() {
      try {
        const workspace = clientCtx?.get?.('uiWorkspace')
        if (workspace && typeof workspace.pickDirectory === 'function') {
          return Promise.resolve(workspace.pickDirectory())
        }
      } catch {
        // The picker is optional; the path field remains the fallback.
      }
      return Promise.resolve(null)
    }

    /**
     * Format a stable fake timestamp for the log skin.
     * @param {number} index - paragraph index
     * @returns {string} timestamp text
     */
    /**
     * Mark the search term inside a line of text.
     *
     * @param {string} line - the line of text
     * @param {string} term - the search term
     * @returns {any[]} the line, with the matches marked
     */
    function highlight(line, term) {
      const text = String(line || '')
      const needle = String(term || '')
      if (needle === '') return [text]
      const parts = []
      const lower = text.toLowerCase()
      const wanted = needle.toLowerCase()
      let at = 0
      let found = lower.indexOf(wanted)
      while (found !== -1) {
        if (found > at) parts.push(text.slice(at, found))
        parts.push(h('mark', { key: `${found}`, className: 'sr-hit' }, text.slice(found, found + needle.length)))
        at = found + needle.length
        found = lower.indexOf(wanted, at)
      }
      if (at < text.length) parts.push(text.slice(at))
      return parts.length > 0 ? parts : [text]
    }

    /**
     * Flatten a search result into the places the term was found.
     *
     * Every hit carries the line it sits on, so a result names the exact
     * sentence and not only the chapter that holds it. An older host that
     * reports one place per chapter still works: its chapter becomes a
     * single hit.
     *
     * @param {any} result - the search result
     * @returns {any[]} the places, in reading order
     */
    function searchPlaces(result) {
      if (!result || !Array.isArray(result.matches)) return []
      const places = []
      for (const chapter of result.matches) {
        if (!chapter || typeof chapter !== 'object') continue
        const hits = Array.isArray(chapter.hits) && chapter.hits.length > 0
          ? chapter.hits
          : [{
            at: Number.isInteger(chapter.at) ? chapter.at : 0,
            line: Number.isInteger(chapter.line) ? chapter.line : 0,
            flow: Number.isInteger(chapter.flow) ? chapter.flow : 0,
            snippet: chapter.snippet,
          }]
        hits.forEach((hit, order) => {
          const safe = hit && typeof hit === 'object' ? hit : {}
          const at = Number.isInteger(safe.at) ? safe.at : 0
          places.push({
            key: `${chapter.index}:${at}`,
            index: chapter.index,
            title: chapter.title || '',
            count: Number.isInteger(chapter.count) ? chapter.count : hits.length,
            order: order + 1,
            of: hits.length,
            line: Number.isInteger(safe.line) ? safe.line : 0,
            flow: Number.isInteger(safe.flow) ? safe.flow : 0,
            snippet: safe.snippet === undefined ? chapter.snippet : safe.snippet,
          })
        })
      }
      return places
    }

    /**
     * Build the rows that list the chapters of a book.
     *
     * The panel and the card share the list, so a reader recognises the
     * same rows wherever the list was opened.
     *
     * @param {Array<object>} chapters - the chapters
     * @param {object} options - what the rows need
     * @returns {Array<any>} the rows
     */
    function chapterRows(chapters, options) {
      return chapters.map(entry => h('button', {
        key: entry.index,
        type: 'button',
        className: `sr-list-row${options.current === entry.index ? ' is-current' : ''}`,
        onClick: () => options.onPick(entry),
      },
      // The small fact on the left: where the chapter is in the book.
      h('span', { className: 'sr-list-where' }, options.t('sectionN', { n: entry.index + 1 })),
      // The text on the right. A disguise must not name the chapters: the
      // number is enough.
      h('span', { className: 'sr-list-text sr-list-text-clip' },
        options.disguised ? options.t('sectionN', { n: entry.index + 1 })
          : (entry.title !== '' ? entry.title : options.t('sectionN', { n: entry.index + 1 })))))
    }

    /**
     * Build the rows that list every place a word was found.
     *
     * The panel and the card share the list, so a reader recognises the
     * same rows wherever the search was made.
     *
     * @param {Array<object>} places - the places the word was found
     * @param {object} options - what the rows need
     * @returns {Array<any>} the rows
     */
    function searchHitRows(places, options) {
      const onPick = options.onPick
      const disguised = options.disguised === true
      const term = String(options.term || '').trim()
      return places.map(place => h('button', {
        key: place.key,
        type: 'button',
        className: 'sr-list-row sr-search-hit',
        onClick: () => onPick(place),
      },
      // Metadata goes above the excerpt, not in a narrow clipped side column.
      h('span', { className: 'sr-list-where' },
        h('span', { className: 'sr-search-chapter', title: disguised ? '' : place.title },
          disguised ? options.t('sectionN', { n: place.index + 1 })
            : (place.title !== '' ? place.title : options.t('sectionN', { n: place.index + 1 }))),
        h('span', { className: 'sr-search-location' }, options.t('lineN', { n: place.line + 1 }))),
      // The matched text is part of the book, so a disguise hides it.
      h('span', { className: 'sr-list-text' },
        disguised ? options.t('sectionN', { n: place.index + 1 })
          : highlight(String(place.snippet || ''), term))))
    }

    /**
     * Decide whether a chord may act right now.
     *
     * The chords use Control+Option, which is a real keystroke inside a text
     * field: on a US layout Option+N is a dead key, and Option+Left moves to
     * the previous word. Swallowing those would take the keys away from
     * whoever is typing, so a chord is ignored while a field outside the
     * panel has the focus. The panel's own fields keep the chords, because
     * there the reader is driving.
     *
     * @param {any} context - the shortcut service's context, when there is one
     * @param {any} target - the element that has the focus, when it is known
     * @returns {boolean} true when the chord may act
     */
    function chordAllowed(context, target) {
      const region = context && typeof context === 'object' ? context.region : undefined
      if (region === 'terminal') return false
      if (region !== 'editable') return true
      const element = target || (context && typeof context === 'object' ? context.target : undefined)
      if (element === null || element === undefined) return false
      // A field of the panel is ours, so the chord is ours too. A page that
      // floats beside the application's root is ours as well, and it carries
      // the same marker.
      if (typeof element.closest === 'function') {
        return element.closest('.sr-root, .sr-float') !== null
      }
      return false
    }

    function fakeTime(index) {
      const total = 9 * 3600 + 41 * 60 + index * 7
      const hours = Math.floor(total / 3600) % 24
      const minutes = Math.floor(total / 60) % 60
      const seconds = total % 60
      const pad = value => String(value).padStart(2, '0')
      return `[${pad(hours)}:${pad(minutes)}:${pad(seconds)}]`
    }


    /**
     * The reading panel.
     * @returns {any} React element
     */
    /**
     * Report a client fault to the Host so a blanked panel is explainable.
     * @param {string} where - the failure location
     * @param {unknown} error - the failure
     * @returns {void}
     */
    function reportFault(where, error) {
      const message = error instanceof Error ? error.message : String(error)
      // The route is the same channel the panel uses; a fault report must not
      // depend on the panel's own state.
      void fetch('/stealth-reader/api', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'fault', where, message: message.slice(0, 300) }),
      }).catch(() => {})
    }

    /**
     * The reading panel itself.
     *
     * The panel is mounted by whichever surface the reader is set to use: the
     * floating overlay or the right sidebar. Only one of them mounts it, so
     * there is one panel and one reader at a time.
     *
     * @param {{ variant?: string }} props - where the panel is mounted
     * @returns {any} React element
     */
    function ReaderRoot(props) {
      const variant = props && props.variant === 'sidebar' ? 'sidebar' : 'overlay'
      // The overlay draws a mark that brings the panel back when it is
      // hidden. The strip has its own mark, so it asks for none.
      const peek = props && props.peek === false ? false : true
      const shared = useReaderState()
      const visible = shared.visible
      const setVisible = React.useCallback((next) => {
        readerStore.set({ visible: typeof next === 'function' ? next(readerStore.get().visible) : next })
      }, [])
      const showSettings = shared.settingsOpen
      const setShowSettings = React.useCallback((next) => {
        readerStore.set({ settingsOpen: typeof next === 'function' ? next(readerStore.get().settingsOpen) : next })
      }, [])
      const [library, setLibrary] = React.useState(null)
      const [chapter, setChapterState] = React.useState(null)
      // The chapter is kept in the shared store as well, so the strip and the
      // panel never disagree about what is open.
      const setChapter = React.useCallback((next) => {
        setChapterState(next)
        readerStore.set({
          bookId: next && next.bookId ? next.bookId : null,
          bookTitle: next && typeof next.bookTitle === 'string' ? next.bookTitle : '',
          index: next && Number.isInteger(next.index) ? next.index : 0,
          total: next && Number.isInteger(next.total) ? next.total : 0,
          chapterTitle: next && typeof next.title === 'string' ? next.title : '',
        })
      }, [])
      const settings = shared.settings
      const setSettings = React.useCallback((updater) => {
        const current = readerStore.get().settings
        const next = typeof updater === 'function' ? updater(current) : updater
        readerStore.set({ settings: { ...current, ...next } })
      }, [])
      const [error, setError] = React.useState('')
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [jump, setJump] = React.useState('')
      const [toc, setToc] = React.useState(null)
      const tocListRef = React.useRef(null)
      const foundListRef = React.useRef(null)
      const tocButtonRef = React.useRef(null)
      const searchButtonRef = React.useRef(null)
      const searchInputRef = React.useRef(null)
      const [found, setFound] = React.useState(null)
      const [foundOpen, setFoundOpen] = React.useState(false)
      const [tocOpen, setTocOpen] = React.useState(false)
      const [search, setSearch] = React.useState('')
      const [activeHit, setActiveHit] = React.useState(-1)
      const bodyRef = React.useRef(null)
      // The body is unmounted whenever a list covers it and whenever the
      // panel is hidden, so the node is held in state: the scroll listener
      // has to follow the node that is really on screen.
      const [bodyNode, setBodyNode] = React.useState(null)
      // The index of the match the reader is on.
      const hitIndex = React.useRef(-1)
      // The chapter a step is heading for, while another step is in flight.
      const pendingStep = React.useRef(0)
      // The remembered scroll position of every chapter that was read.
      const scrollPositions = React.useRef({})
      // The line the reader has to be put back on, when a chapter arrives
      // with one.
      const pendingLineRef = React.useRef(null)
      // The exact line a search result pointed at. The text is on screen
      // only after the chapter arrives and the body is mounted, so the place
      // is kept until it can be shown.
      const [jumpTarget, setJumpTarget] = React.useState(null)
      // The timer that collects a burst of scrolls into one write.
      const positionTimerRef = React.useRef(null)
      // The scroll offset the host remembers for this chapter, used when the
      // panel is opened again and has no memory of its own.
      const pendingOffsetRef = React.useRef(null)
      // The chapters the continuous mode has loaded, in reading order.
      const [stream, setStream] = React.useState([])
      const streamRef = React.useRef([])
      // True while a chapter is being fetched, so only one runs at a time.
      const loadingRef = React.useRef(false)
      // The chapter that could not be loaded: it is not asked for again
      // on every scroll.
      const failedRef = React.useRef(-1)
      // The last position the host was told about, so a slow answer cannot
      // move the reader back.
      const positionSentRef = React.useRef(-1)
      // True while a chapter is being fetched, so the panel can say so.
      const [loadingMore, setLoadingMore] = React.useState(false)
      // The scroll change the next render has to apply, so the text under
      // the reader does not jump when the window grows or shrinks.
      const pendingScrollRef = React.useRef(null)
      // The scroll position of the continuous text, kept across a remount.
      const continuousTopRef = React.useRef(0)
      // The open chapter, read by the callbacks that must not close over a
      // stale value.
      const chapterRef = React.useRef(null)
      // The reading mode, read the same way.
      const continuousRef = React.useRef(false)
      const visibleRef = React.useRef(false)
      // The refresh callback has no dependencies, so it reads the current
      // disguise state from a ref rather than a stale closure.
      const disguisedRef = React.useRef(false)
      visibleRef.current = visible
      // The continuous mode scrolls on: the next chapter is fetched when
      // the reader reaches the end of the text.
      const continuous = settings.scrollMode === 'continuous'
      continuousRef.current = continuous
      chapterRef.current = chapter
      const t = React.useMemo(() => translator, [])
      const [, setLocaleTick] = React.useState(0)

      React.useEffect(() => {
        const unsubscribe = clientCtx?.locale?.subscribe?.(() => setLocaleTick(value => value + 1))
        return () => {
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, [])

      /**
       * Load the library snapshot and the current chapter.
       * @returns {Promise<void>} resolves when the panel holds fresh data
       */
      const refresh = React.useCallback(async () => {
        try {
          const data = await call('state')
          setSettings(state => ({ ...state, ...(data.settings || {}) }))
          setLibrary(data.books || [])
          // The library is shared, so every surface sees the same books.
          readerStore.set({ books: data.books || [] })
          if (data.current && data.current.bookId) {
            const next = await call('chapter', { bookId: data.current.bookId, index: data.current.index })
            setChapter(next.chapter)
            // The line the reader left the chapter on comes back with it.
            const remembered = data.positions && data.positions[data.current.bookId]
            pendingLineRef.current = remembered && Number.isInteger(remembered.line) ? remembered.line : null
            pendingOffsetRef.current = remembered && Number.isFinite(remembered.offset)
              ? remembered.offset
              : null
            setError('')
          } else {
            setChapter(null)
            // The old error belongs to a state that no longer exists.
            setError('')
          }
        } catch (failure) {
          setError(describeFailure(failure, t, disguisedRef.current))
        }
      }, [])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      // The place being read is shared too, so the strip can show it and the
      // panel can pick it up again after a placement change.
      React.useEffect(() => {
        readerStore.set({
          bookId: chapter === null ? null : chapter.bookId,
          index: chapter === null ? 0 : chapter.index,
          total: chapter === null ? 0 : chapter.total,
        })
      }, [chapter])

      /**
       * Load one chapter into the continuous window.
       *
       * The window is a sliding one: the text above the reader must not
       * move when a chapter is added in front of it or dropped behind it,
       * so the change is measured before and applied after the render.
       *
       * @param {number} index - the chapter index to load
       * @param {string} where - 'start' or 'end' of the window
       * @returns {Promise<object|null>} the chapter, or null when it could not be loaded
       */
      const loadChapterAt = React.useCallback(async (index, where) => {
        if (loadingRef.current) return null
        if (failedRef.current === index) return null
        const anchor = chapterRef.current
        if (anchor === null) return null
        loadingRef.current = true
        setLoadingMore(true)
        try {
          const data = await call('chapter', { bookId: anchor.bookId, index })
          const loaded = data.chapter
          if (loaded === null || loaded === undefined) return null
          const node = bodyRef.current
          const list = streamRef.current
          if (where === 'start') {
            // The text above the reader grows by the new chapter.
            pendingScrollRef.current = {
              beforeTop: node === null ? 0 : node.scrollTop,
              measure: loaded.index,
              sign: 1,
              gap: CHAPTER_GAP,
            }
          } else if (list.length + 1 > MAX_LOADED_CHAPTERS) {
            // The oldest chapter is dropped, so the text above shrinks.
            const dropped = list[0]
            let height = 0
            if (node !== null && node !== undefined && dropped !== undefined) {
              const block = findChapterBlock(node, dropped.index)
              if (block !== null && typeof block.getBoundingClientRect === 'function') {
                const rect = block.getBoundingClientRect()
                if (rect !== null && rect !== undefined) height = rect.height
              }
            }
            pendingScrollRef.current = {
              beforeTop: node === null ? 0 : node.scrollTop,
              delta: -(height + CHAPTER_GAP),
            }
          }
          const merged = mergeChapter(list, loaded, where, MAX_LOADED_CHAPTERS, anchor.index)
          streamRef.current = merged
          setStream(merged)
          return loaded
        } catch (failure) {
          failedRef.current = index
          setError(describeFailure(failure, t, disguisedRef.current))
          return null
        } finally {
          loadingRef.current = false
          setLoadingMore(false)
        }
      }, [call, t])

      /**
       * Put one chapter at the top of the view.
       * @param {number} index - the chapter index
       * @returns {void}
       */
      const scrollToChapter = React.useCallback((index) => {
        const node = bodyRef.current
        if (node === null || node === undefined) return
        const block = findChapterBlock(node, index)
        if (block === null) return
        // The body is moved by hand: scrollIntoView moves every scrollable
        // ancestor, and the chat view around the panel is one of them.
        if (typeof node.getBoundingClientRect === 'function'
          && typeof block.getBoundingClientRect === 'function') {
          const bodyRect = node.getBoundingClientRect()
          const blockRect = block.getBoundingClientRect()
          if (bodyRect !== null && bodyRect !== undefined && blockRect !== null && blockRect !== undefined) {
            node.scrollTop += (blockRect.top - bodyRect.top)
            return
          }
        }
        if (typeof block.scrollIntoView === 'function') {
          block.scrollIntoView({ block: 'start' })
        }
      }, [])

      /**
       * Move to the chapter next to the one being read.
       *
       * The continuous text keeps its place: the chapter is scrolled to,
       * not replaced, so the text above and below stays where it was.
       *
       * @param {number} delta - chapter step
       * @returns {Promise<void>} resolves when the chapter is in view
       */
      const goToChapter = React.useCallback(async (delta) => {
        const anchor = chapterRef.current
        if (anchor === null) return
        const target = anchor.index + delta
        if (target < 0 || target >= anchor.total) return
        // An explicit step asks again, even after a failure.
        failedRef.current = -1
        const list = streamRef.current
        const loaded = list.find(item => item.index === target)
        if (loaded !== undefined) {
          setChapter(loaded)
          scrollToChapter(target)
          return
        }
        const fresh = await loadChapterAt(target, delta > 0 ? 'end' : 'start')
        if (fresh === null) return
        setChapter(fresh)
        scrollToChapter(target)
      }, [loadChapterAt, scrollToChapter])

      /**
       * Follow the reader down the text.
       *
       * The next chapter is fetched before the end of the text is reached
       * and the previous one when the reader goes back up, so the text
       * never ends under the eye.
       *
       * @param {object} node - the scrolling body
       * @returns {void}
       */
      const onContinuousScroll = React.useCallback((node) => {
        const list = streamRef.current
        if (list.length === 0) return
        const top = node.scrollTop
        continuousTopRef.current = top
        const view = typeof node.clientHeight === 'number' ? node.clientHeight : 0
        const height = typeof node.scrollHeight === 'number' ? node.scrollHeight : 0
        if (height - top - view <= APPEND_THRESHOLD) {
          const last = list[list.length - 1]
          if (last !== undefined && last.index + 1 < last.total) {
            void loadChapterAt(last.index + 1, 'end')
          }
        }
        if (top <= PREPEND_THRESHOLD) {
          const first = list[0]
          if (first !== undefined && first.index > 0) {
            void loadChapterAt(first.index - 1, 'start')
          }
        }
        // The chapter at the top of the view is the one being read.
        const index = chapterAtTop(node)
        if (index === null) return
        const anchor = chapterRef.current
        if (anchor === null || anchor.index === index) return
        const found = list.find(item => item.index === index)
        if (found === undefined) return
        setChapter(found)
        // The host keeps the reading position, so the panel and the agent
        // tool agree on where the book is. Only the position travels: the
        // text is already here.
        if (found.index > positionSentRef.current) {
          positionSentRef.current = found.index
          void call('position', {
            bookId: found.bookId,
            index: found.index,
            total: found.total,
            mode: variant === 'sidebar' ? 'sidebar' : 'overlay',
          }).catch(() => {})
        }
      }, [loadChapterAt, call, variant])

      /**
       * Keep the host's idea of the reading place up to date.
       *
       * The place is a chapter, a line inside it and the surface it was
       * read on. A scroll is a burst, so the writes are collected and sent
       * once the reader stops moving.
       *
       * @returns {void}
       */
      const schedulePosition = React.useCallback(() => {
        if (positionTimerRef.current !== null) clearTimeout(positionTimerRef.current)
        positionTimerRef.current = setTimeout(() => {
          positionTimerRef.current = null
          const anchor = chapterRef.current
          if (anchor === null) return
          const node = bodyRef.current
          const offset = node !== null && node !== undefined ? node.scrollTop : 0
          // The line under the reader's eye is the line that is being read.
          const line = node !== null && node !== undefined ? lineAtTop(node) : 0
          void call('position', {
            bookId: anchor.bookId,
            index: anchor.index,
            total: anchor.total,
            offset,
            line,
            mode: variant === 'sidebar' ? 'sidebar' : 'overlay',
          }).catch(() => {})
        }, 500)
      }, [call, variant])

      /**
       * Move to another chapter.
       * @param {number} delta - chapter step
       * @returns {Promise<void>} resolves when the chapter is loaded
       */
      const step = React.useCallback(async (delta) => {
        // The continuous text keeps its place, so a step scrolls to the
        // neighbouring chapter instead of replacing the text.
        if (continuousRef.current) {
          await goToChapter(delta)
          return
        }
        // The panel's own position is the truth: the step sends an absolute
        // target, so a jump and a step can never disagree.
        const current = chapter
        if (current === null) return
        // A rapid second press must move one chapter further, not repeat the
        // same move, so the target accumulates while a step is in flight.
        const pending = pendingStep.current
        const base = pending !== 0 ? pending : current.index
        const target = base + delta
        if (target < 0 || target >= current.total) return
        pendingStep.current = target
        setBusy(true)
        try {
          const data = await call('open', { bookId: current.bookId, index: target })
          setChapter(data.chapter)
          pendingLineRef.current = Number.isInteger(data.line) && data.line > 0 ? data.line : null
          pendingOffsetRef.current = Number.isFinite(data.offset) && data.offset > 0 ? data.offset : null
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguisedRef.current))
          pendingStep.current = 0
        } finally {
          setBusy(false)
        }
      }, [chapter, t])

      /**
       * Store one reading preference.
       * @param {string} key - the setting name
       * @param {number | string} value - the new value
       * @returns {Promise<void>} resolves when the setting is stored
       */
      const changeSetting = React.useCallback(async (key, value) => {
        try {
          await settingsController.change(key, value)
        } catch (failure) {
          // A setting that is lost is work thrown away, so it is said out
          // loud instead of failing quietly.
          setError(describeFailure(failure, t, disguisedRef.current))
        }
      }, [t])

      /**
       * Jump to a chapter by number.
       *
       * A place inside the chapter can be named as well, which is what a
       * search result does: the reader lands on the sentence, not on the
       * first line of the chapter that holds it.
       *
       * @param {number} index - the zero-based chapter index
       * @param {number} [line] - the line inside the chapter
       * @param {number} [flow] - the place inside the chapter, in the card's
       *   own characters
       * @returns {Promise<void>} resolves when the chapter is loaded
       */
      const jumpTo = React.useCallback(async (index, line, flow) => {
        const current = chapter
        if (current === null) return
        const target = Math.min(Math.max(index, 0), current.total - 1)
        const wanted = Number.isInteger(line) && line >= 0 ? line : null
        const wantedFlow = Number.isInteger(flow) && flow >= 0 ? flow : null
        // The chapter that is on screen can still be asked for a place, so a
        // hit inside it moves the text instead of doing nothing.
        if (target === current.index && wanted === null) return
        setBusy(true)
        try {
          // 'open' moves the host's reading position as well; 'chapter' only
          // reads, and the next step would then start from a stale place.
          const payload = { bookId: current.bookId, index: target }
          if (wanted !== null) payload.line = wanted
          // The card counts the text in its own characters, so the same
          // result puts the card on the same sentence.
          if (wantedFlow !== null) payload.flow = wantedFlow
          const data = await call('open', payload)
          setChapter(data.chapter)
          // A chapter the strip had a line in comes back with that line, so
          // the two surfaces stay on the same line of the text.
          pendingLineRef.current = Number.isInteger(data.line) && data.line > 0 ? data.line : null
          pendingOffsetRef.current = Number.isFinite(data.offset) && data.offset > 0 ? data.offset : null
          if (wanted !== null) {
            // The place is put on the text as soon as the text is there.
            setJumpTarget({ line: wanted })
          }
          if (continuousRef.current) {
            // The continuous text starts over at the chapter that was picked.
            const only = [data.chapter]
            streamRef.current = only
            setStream(only)
            pendingScrollRef.current = { beforeTop: 0, delta: 0 }
          }
          pendingStep.current = 0
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguisedRef.current))
        } finally {
          setBusy(false)
        }
      }, [chapter, t])

      /**
       * Search the whole book, not only the chapter on screen.
       *
       * Every place the text was found is kept, so the list can name them
       * all and the reader can pick the one that was meant.
       *
       * @returns {Promise<void>} resolves when the results arrive
       */
      const searchBook = React.useCallback(async () => {
        const term = String(search || '').trim()
        if (term === '') {
          setFoundOpen(true)
          return
        }
        setBusy(true)
        try {
          // The search is about the book being read, so it is not left to
          // the host's own idea of what is open.
          const data = await call('search', { term, bookId: chapter ? chapter.bookId : undefined })
          setFound(data.result)
          setFoundOpen(true)
          // A search that worked must not leave the old error on screen.
          setError('')
          setNote('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguisedRef.current))
        } finally {
          setBusy(false)
        }
      }, [search, chapter, t])

      /**
       * Open the search page.
       *
       * The page is opened on the word that was last looked for, so the
       * reader can search again straight away.
       *
       * @returns {Promise<void>} resolves when the page is open
       */
      const openSearch = React.useCallback(async () => {
        setFoundOpen(true)
        setTocOpen(false)
        // The last search is repeated, so the list is never empty for no
        // reason: a reader who comes back sees what it found last time.
        if (String(search || '').trim() !== '') await searchBook()
      }, [search, searchBook])

      /**
       * Open the table of contents of the current book.
       * @returns {Promise<void>} resolves when the list is loaded
       */
      // Closing a list returns the focus to the control that opened it, so
      // the keyboard does not lose its place.
      const closeToc = React.useCallback(() => {
        setTocOpen(false)
        if (tocButtonRef.current !== null && tocButtonRef.current !== undefined) {
          tocButtonRef.current.focus()
        }
      }, [])
      const closeFound = React.useCallback(() => {
        setFoundOpen(false)
        if (searchButtonRef.current !== null && searchButtonRef.current !== undefined) {
          searchButtonRef.current.focus()
        }
      }, [])

      const openToc = React.useCallback(async () => {
        setTocOpen(true)
        try {
          const data = await call('toc', {})
          setToc(data.toc)
          // A table of contents that loaded must not leave the old error.
          setError('')
          setNote('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguisedRef.current))
          setTocOpen(false)
        }
      }, [t])

      /**
       * Scroll to one of the matches of the search term.
       * @param {number} direction - 1 for the next match, -1 for the previous
       * @returns {void}
       */
      const gotoMatch = React.useCallback((direction) => {
        const node = bodyRef.current
        if (node === null || node === undefined) return
        const hits = node.querySelectorAll('mark.sr-hit')
        if (hits.length === 0) return
        const current = Number(hitIndex.current)
        const next = (current + direction + hits.length) % hits.length
        hitIndex.current = next
        // The body is moved by hand, so the page around the panel stays.
        if (typeof node.getBoundingClientRect === 'function'
          && typeof hits[next].getBoundingClientRect === 'function') {
          const bodyRect = node.getBoundingClientRect()
          const hitRect = hits[next].getBoundingClientRect()
          if (bodyRect !== null && hitRect !== null) {
            node.scrollTop += (hitRect.top - bodyRect.top) - (node.clientHeight / 3)
          }
        } else if (typeof hits[next].scrollIntoView === 'function') {
          hits[next].scrollIntoView({ block: 'center' })
        }
        setActiveHit(next)
        // The marks are rebuilt on the next render, so the active one is
        // marked by position rather than by a class.
        const marks = node.querySelectorAll('mark.sr-hit')
        for (let index = 0; index < marks.length; index += 1) {
          marks[index].classList.toggle('is-active', index === next)
        }
      }, [])

      /**
       * Count the matches of the search term in the current chapter.
       * @param {string} term - the search term
       * @returns {number} the number of matches
       */
      const countMatches = React.useCallback((term) => {
        const needle = String(term || '').trim()
        if (needle === '') return 0
        // The host searches case-insensitively, so the count must too.
        const wanted = needle.toLowerCase()
        // The continuous text shows several chapters, and every one of them
        // is marked, so all of them are counted.
        const texts = continuous
          ? stream.map(item => (typeof item.text === 'string' ? item.text : ''))
          : (chapter && typeof chapter.text === 'string' ? [chapter.text] : [])
        let total = 0
        for (const text of texts) {
          const lower = text.toLowerCase()
          let at = lower.indexOf(wanted)
          while (at !== -1) {
            total += 1
            at = lower.indexOf(wanted, at + wanted.length)
          }
        }
        return total
      }, [chapter, stream, continuous])

      /**
       * Open one book from the library.
       * @param {string} bookId - book identifier
       * @returns {Promise<void>} resolves when the chapter is loaded
       */
      const openBook = React.useCallback(async (bookId) => {
        setBusy(true)
        try {
          // No index: the host restores the position saved for this book.
        const data = await call('open', { bookId })
          setChapter(data.chapter)
          if (continuousRef.current) {
            const only = [data.chapter]
            streamRef.current = only
            setStream(only)
            pendingScrollRef.current = { beforeTop: 0, delta: 0 }
          }
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguisedRef.current))
        } finally {
          setBusy(false)
        }
      }, [])

      /**
       * Switch between the single-chapter reading and the continuous one.
       * @returns {Promise<void>} resolves when the setting is stored
       */
      const toggleScrollMode = React.useCallback(async () => {
        const next = continuousRef.current ? 'chapter' : 'continuous'
        await changeSetting('scrollMode', next)
      }, [changeSetting])

      /**
       * Change the disguise skin.
       * @returns {Promise<void>} resolves when the setting is stored
       */
      const cycleSkin = React.useCallback(async () => {
        const next = SKINS[(SKINS.indexOf(settings.skin) + 1) % SKINS.length]
        try {
          await settingsController.change('skin', next)
        } catch {
          // A failed preference write only affects persistence.
        }
      }, [settings.skin])

      /**
       * Change the panel font size.
       * @param {number} delta - size step
       * @returns {Promise<void>} resolves when the setting is stored
       */
      const changeFont = React.useCallback(async (delta) => {
        const next = Math.min(26, Math.max(11, settings.fontSize + delta))
        try {
          await settingsController.change('fontSize', next)
        } catch {
          // A failed preference write only affects persistence.
        }
      }, [settings.fontSize])

      // The chords act on the panel, so they only run while it is open: a
      // hidden panel must never advance the document behind the user's back.
      const runChord = React.useCallback((action) => {
        if (action === 'place') {
          // The two shapes are alternatives, not neighbours: the chord moves
          // the reader from one to the other and keeps the place.
          const at = readerStore.get().placement
          const next = at === 'sidebar' ? 'strip' : 'sidebar'
          void placeReader(next)
          return
        }
        if (action === 'toggle') {
          // The sidebar owns closing its own tab, so there the chord only
          // opens the reader.
          if (readerStore.get().placement === 'sidebar') {
            openReader()
            return
          }
          setVisible(value => !value)
          return
        }
        if (!visibleRef.current) return
        if (action === 'next') void step(1)
        else if (action === 'prev') void step(-1)
        else if (action === 'skin') void cycleSkin()
        else if (action === 'larger') void changeFont(1)
        else if (action === 'smaller') void changeFont(-1)
      }, [step, cycleSkin, changeFont, openReader, placeReader])

      const reservedChords = React.useRef(false)

      React.useEffect(() => {
        // The panel owns its chords while it is open. The shortcuts service
        // reserves the keys, so they show up in the Harness shortcut list and
        // cannot collide with another command.
        const shortcuts = clientCtx && clientCtx.shortcuts
        if (shortcuts === undefined || shortcuts === null) return undefined
        if (shortcuts.runtime !== 'desktop') return undefined
        const bindings = [
          { action: 'toggle', code: 'KeyN' },
          { action: 'next', code: 'ArrowRight' },
          { action: 'prev', code: 'ArrowLeft' },
          { action: 'skin', code: 'KeyD' },
          { action: 'place', code: 'KeyL' },
          { action: 'larger', code: 'Equal' },
          { action: 'smaller', code: 'Minus' },
        ]
        const reservations = []
        const disposers = []
        reservedChords.current = false
        // A shortcut that cannot be reserved must never break the panel: the
        // registration is best effort, and the document fallback still works.
        try {
          for (const item of bindings) {
            const binding = { code: item.code, modifiers: ['control', 'alt'] }
            const described = shortcuts.describeBinding(binding)
            if (described.binding === null) continue
            reservations.push({ action: item.action, binding: described.binding })
            const dispose = shortcuts.registerFixed({
              id: `stealthReader.${item.action}`,
              label: () => t(`shortcut_${item.action}`),
              keys: described.keys,
              bindings: [described.binding],
              group: 'application',
            })
            if (typeof dispose === 'function') disposers.push(dispose)
            reservedChords.current = true
          }
        } catch (failure) {
          reportFault('shortcuts', failure)
        }
        let observe
        try {
          observe = shortcuts.observeFixedInput((input) => {
            if (input.type === 'reset') return
            const gesture = input.gesture
            if (gesture.composing || gesture.defaultPrevented || gesture.repeat) return
            // The chord must not take the keys away from someone who is
            // typing in a field outside the panel.
            if (!chordAllowed(input.context, input.context && input.context.target)) return
            const modifiers = ['control', 'alt', 'shift', 'meta']
            const matched = reservations.find(({ binding }) => binding.code === gesture.code
              && modifiers.every(modifier => gesture[modifier] === binding.modifiers.includes(modifier)))
            if (matched === undefined) return
            input.consume()
            runChord(matched.action)
          })
        } catch (failure) {
          reportFault('shortcuts', failure)
        }
        return () => {
          if (typeof observe === 'function') {
            try { observe() } catch { /* the disposer must not throw */ }
          }
          for (const dispose of disposers) {
            if (typeof dispose === 'function') {
              try { dispose() } catch { /* the disposer must not throw */ }
            }
          }
        }
      }, [runChord, t])

      React.useEffect(() => {
        // The shortcut service reads a macOS dead key as an input method
        // composition and drops the gesture. Option+N is one, so the toggle
        // chord never arrived that way. This listener takes the gestures the
        // reserved path dropped, and it is the whole shortcut where no chord
        // could be reserved at all.
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
          return undefined
        }
        const onKeyDown = (event) => {
          if (!event.ctrlKey || !event.altKey) return
          if (event.shiftKey || event.metaKey) return
          // The same rule as the reserved path: a field outside the panel
          // keeps its keys.
          const target = event.target
          const editable = target !== null && target !== undefined && typeof target.matches === 'function'
            && target.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
          if (editable && !chordAllowed({ region: 'editable' }, target)) return
          // An input method owns its own composition.
          if (event.isComposing) return
          // Where the chords are reserved, this listener only takes the
          // gestures the reserved path dropped, so no chord fires twice.
          if (reservedChords.current && event.key !== 'Dead') return
          // The physical key is read, not the character: Option+D produces
          // a character, so the character would not match the chord.
          const code = event.code
          if (code === 'KeyN') {
            event.preventDefault()
            runChord('toggle')
            return
          }
          if (code === 'ArrowRight') {
            event.preventDefault()
            runChord('next')
            return
          }
          if (code === 'ArrowLeft') {
            event.preventDefault()
            runChord('prev')
            return
          }
          if (code === 'KeyD') {
            event.preventDefault()
            runChord('skin')
            return
          }
          if (code === 'Equal') {
            event.preventDefault()
            runChord('larger')
            return
          }
          if (code === 'Minus') {
            event.preventDefault()
            runChord('smaller')
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [runChord])

      // The scroll position is remembered per chapter, so returning to a
      // chapter lands on the same place in the text.
      const scrollKey = chapter === null ? '' : `${chapter.bookId}:${chapter.index}`
      const scrollKeyRef = React.useRef('')
      scrollKeyRef.current = scrollKey
      // The body is unmounted while a list covers it, so the position is
      // restored when the body comes back, not only when the chapter changes.
      const attachBody = React.useCallback((node) => {
        bodyRef.current = node
        setBodyNode(node)
        if (node === null || node === undefined) return
        if (continuous) {
          // The continuous text is one column: it comes back where it was.
          node.scrollTop = continuousTopRef.current
          return
        }
        const remembered = scrollPositions.current[scrollKeyRef.current]
        if (remembered !== undefined) {
          node.scrollTop = remembered
        } else if (pendingOffsetRef.current !== null) {
          // The panel was closed and opened again: the host still knows how
          // far the reader had come.
          node.scrollTop = pendingOffsetRef.current
          pendingOffsetRef.current = null
        }
        // The line the reader left the chapter on wins over the remembered
        // scroll: the strip counts in lines, and the two must agree.
        const line = pendingLineRef.current
        if (line === null) return
        pendingLineRef.current = null
        const row = node.querySelector(`[data-row="${line}"]`)
        if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'start' })
      }, [continuous])
      // The body keeps the wheel as well: at the end of the text the wheel
      // belongs to the page, and the page must not move under the reader.
      const attachBodyWithWheel = React.useCallback((node) => {
        holdWheel(node)
        attachBody(node)
      }, [attachBody])
      React.useEffect(() => {
        // The continuous text owns its own position.
        if (continuous) return
        const node = bodyRef.current
        if (node === null || node === undefined) return
        const remembered = scrollPositions.current[scrollKey]
        node.scrollTop = remembered === undefined ? 0 : remembered
      }, [scrollKey, chapter, continuous])
      // A search result names a line, so the reader is put on it as soon as
      // the text is on screen. The body can arrive later than the result, so
      // the place is kept until it can be shown.
      React.useEffect(() => {
        if (jumpTarget === null) return
        const node = bodyRef.current
        if (node === null || node === undefined) return
        const row = node.querySelector(`[data-row="${jumpTarget.line}"]`)
        if (row === null || row === undefined) return
        if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'start' })
        setJumpTarget(null)
      }, [jumpTarget, chapter, bodyNode])
      // The marks are rebuilt whenever the body renders, so the active match
      // is marked again after each render.
      React.useEffect(() => {
        const node = bodyRef.current
        if (node === null || node === undefined) return
        const marks = node.querySelectorAll('mark.sr-hit')
        for (let index = 0; index < marks.length; index += 1) {
          marks[index].classList.toggle('is-active', index === activeHit)
        }
      }, [activeHit, search, chapter])

      // The table of contents opens at the chapter being read, and takes the
      // focus so the keyboard does not lose its place.
      React.useEffect(() => {
        if (!tocOpen) return
        const node = tocListRef.current
        if (node === null || node === undefined) return
        const current = node.querySelector('.sr-list-row.is-current')
        if (current !== null && typeof current.scrollIntoView === 'function') {
          current.scrollIntoView({ block: 'center' })
        }
        const first = node.querySelector('.sr-list-row')
        if (first !== null && typeof first.focus === 'function') first.focus()
      }, [tocOpen, toc])

      // The results list takes the focus too.
      React.useEffect(() => {
        if (!foundOpen) return
        const node = foundListRef.current
        if (node === null || node === undefined) return
        const first = node.querySelector('.sr-list-row')
        if (first !== null && typeof first.focus === 'function') first.focus()
      }, [foundOpen, found])

      // A setting that is still waiting is written when the plugin goes; the
      // controller owns the pending write, so it flushes it itself.


      React.useEffect(() => {
        if (bodyNode === null || bodyNode === undefined) return undefined
        const onScroll = () => {
          if (continuous) {
            onContinuousScroll(bodyNode)
            return
          }
          if (scrollKey === '') return
          scrollPositions.current[scrollKey] = bodyNode.scrollTop
          // The place inside the chapter is kept by the host, so the reader
          // comes back to the same line after a restart. The write is
          // debounced: a scroll is a burst, not a series of decisions.
          schedulePosition()
        }
        bodyNode.addEventListener('scroll', onScroll, { passive: true })
        return () => bodyNode.removeEventListener('scroll', onScroll)
      }, [bodyNode, scrollKey, continuous, onContinuousScroll, schedulePosition])

      // The window grew or shrank, so the text under the reader is put back
      // where it was.
      React.useEffect(() => {
        const pending = pendingScrollRef.current
        if (pending === null) return
        pendingScrollRef.current = null
        const node = bodyRef.current
        if (node === null || node === undefined) return
        let delta = typeof pending.delta === 'number' ? pending.delta : 0
        if (typeof pending.measure === 'number') {
          const block = findChapterBlock(node, pending.measure)
          if (block !== null && typeof block.getBoundingClientRect === 'function') {
            const rect = block.getBoundingClientRect()
            if (rect !== null && rect !== undefined) {
              delta = pending.sign * (rect.height + (pending.gap === undefined ? 0 : pending.gap))
            }
          }
        }
        node.scrollTop = pending.beforeTop + delta
        continuousTopRef.current = node.scrollTop
      }, [stream])

      // The continuous window starts at the open chapter, and it starts
      // over when the reading mode changes.
      const wasContinuousRef = React.useRef(false)
      React.useEffect(() => {
        if (!continuous) {
          if (!wasContinuousRef.current) return
          wasContinuousRef.current = false
          streamRef.current = []
          setStream([])
          pendingScrollRef.current = { beforeTop: 0, delta: 0 }
          return
        }
        wasContinuousRef.current = true
        const anchor = chapterRef.current
        if (anchor === null) return
        // The window already holds the open chapter: the reader is simply
        // further down the text.
        const list = streamRef.current
        if (list.length > 0 && list.some(item => item.index === anchor.index)) return
        const only = [anchor]
        streamRef.current = only
        setStream(only)
        // The place inside the chapter is kept, so switching the mode does
        // not send the reader back to the top of the text.
        const remembered = scrollPositions.current[`${anchor.bookId}:${anchor.index}`]
        pendingScrollRef.current = { beforeTop: 0, delta: remembered === undefined ? 0 : remembered }
      }, [continuous, chapter])

      const skin = settings.skin || 'log'
      const disguised = skin !== 'plain'
      disguisedRef.current = disguised
      const disguise = DISGUISE_TITLE[skin] || ''
      const paragraphs = chapter && typeof chapter.text === 'string'
        ? chapter.text.split('\n').filter(line => line.trim() !== '')
        : []

      // A disguise skin hides the identity, so its control names stay in-world.
      const label = (real, neutral) => (disguised ? neutral : real)
      const fontSize = Number(settings.fontSize) || 15
      const atStart = chapter !== null && chapter.index <= 0
      const atEnd = chapter !== null && chapter.index >= chapter.total - 1
      const header = h('div', { className: 'sr-head' },
        h('span', {
          className: 'sr-name',
          title: disguised ? undefined : (chapter ? chapter.bookTitle : ''),
        }, disguised ? disguise : (chapter ? chapter.bookTitle : t('noBook'))),
        chapter ? h('span', { className: 'sr-count' }, `${chapter.index + 1}/${chapter.total}`) : null,
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('prev'), t('neutralPrev')),
          'aria-label': label(t('prev'), t('neutralPrev')), disabled: atStart || chapter === null || busy, onClick: () => void step(-1),
        }, '‹'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('next'), t('neutralNext')),
          'aria-label': label(t('next'), t('neutralNext')), disabled: atEnd || chapter === null || busy, onClick: () => void step(1),
        }, '›'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('fontDown'), t('neutralZoomOut')),
          'aria-label': label(t('fontDown'), t('neutralZoomOut')),
          disabled: fontSize <= 11, onClick: () => void changeFont(-1),
        }, 'A-'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('fontUp'), t('neutralZoomUp')),
          'aria-label': label(t('fontUp'), t('neutralZoomUp')),
          disabled: fontSize >= 26, onClick: () => void changeFont(1),
        }, 'A+'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button',
          title: label(
            continuous ? t('modeContinuous') : t('modeChapter'),
            continuous ? t('neutralModeContinuous') : t('neutralModeSingle'),
          ),
          'aria-label': label(
            continuous ? t('modeContinuous') : t('modeChapter'),
            continuous ? t('neutralModeContinuous') : t('neutralModeSingle'),
          ),
          'aria-pressed': continuous,
          onClick: () => void toggleScrollMode(),
        }, continuous ? '⤓' : '▤'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button',
          // One button moves the reader between the two shapes, so the two
          // are never on screen together and the reader is never left with
          // neither.
          title: label(
            variant === 'sidebar' ? t('toStrip') : t('toSidebar'),
            variant === 'sidebar' ? t('neutralToStrip') : t('neutralToSidebar'),
          ),
          'aria-label': label(
            variant === 'sidebar' ? t('toStrip') : t('toSidebar'),
            variant === 'sidebar' ? t('neutralToStrip') : t('neutralToSidebar'),
          ),
          onClick: () => void placeReader(variant === 'sidebar' ? 'strip' : 'sidebar'),
        }, variant === 'sidebar' ? '⇱' : '⇲'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('skin'), t('neutralView')),
          'aria-label': label(t('skin'), t('neutralView')), onClick: () => void cycleSkin(),
        }, '◐'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('toc'), t('neutralList')),
          'aria-label': label(t('toc'), t('neutralList')),
          'aria-expanded': tocOpen,
          ref: tocButtonRef,
          onClick: () => void openToc(),
        }, '☷'),
        // The search in the book: a page of its own, so the text is not
        // covered by a result list.
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('search'), t('neutralSearch')),
          'aria-label': label(t('search'), t('neutralSearch')),
          'aria-expanded': foundOpen,
          ref: searchButtonRef,
          onClick: () => { if (foundOpen) closeFound(); else void openSearch() },
        }, h('span', { className: 'sr-lens' })),
        // The catalog of books is one page of its own, so one button, and it
        // is a toggle like the rest.
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('library'), t('neutralList')),
          'aria-label': label(t('library'), t('neutralList')),
          'aria-haspopup': 'dialog',
          'aria-expanded': shared.pickerOpen,
          onClick: () => togglePicker(),
        }, '☰'),
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('shop'), t('shopNeutral')),
          'aria-label': label(t('shop'), t('shopNeutral')),
          'aria-haspopup': 'dialog',
          'aria-expanded': shared.bookstoreOpen,
          onClick: () => { if (readerStore.get().bookstoreOpen) closeBookstore(); else openBookstore() },
        }, '⌕'),
        // Options is one page, so one button, and it is a toggle like the rest.
        h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('settings'), t('neutralSettings')),
          'aria-label': label(t('settings'), t('neutralSettings')),
          'aria-haspopup': 'dialog',
          'aria-expanded': showSettings,
          onClick: () => toggleSettings('reading'),
        }, '⚙'),
        // The sidebar has its own way to close a tab, so the panel does not
        // offer a second one that would leave an empty pane behind.
        variant === 'sidebar' ? null : h('button', {
          className: 'sr-ibtn sr-btn', type: 'button', title: label(t('hide'), t('neutralCollapse')),
          'aria-label': label(t('hide'), t('neutralCollapse')), onClick: () => setVisible(false),
        }, '✕'),
      )

      // The chapter stays mounted while a request runs; only the status strip
      // changes, so a chapter turn never blanks the page being read.
      // Each skin renders the same lines in its own idiom.
      const renderLine = (line, index, key) => {
        // The search term is marked, so the match buttons have something to
        // step through.
        const content = search.trim() === '' ? line : highlight(line, search.trim())
        // The key follows the line itself, not the running count: the
        // count moves when the window slides, and a moving key would
        // rebuild the whole column.
        const identity = key === undefined ? String(index) : key
        // The row is the line's place inside its chapter, so the reader can
        // be put back on the same line it was left on.
        const row = { 'data-row': String(index) }
        if (skin === 'log') {
          const level = index % 11 === 7 ? 'WARN' : (index % 17 === 5 ? 'ERROR' : 'INFO')
          return h('p', { key: identity, ...row, 'data-t': fakeTime(index), 'data-level': level }, content)
        }
        if (skin === 'diff') {
          return h('p', {
            key: identity,
            ...row,
            'data-sign': index % 4 === 3 ? '-' : '+',
            'data-line': String(index + 1),
          }, content)
        }
        if (skin === 'terminal') return h('p', { key: identity, ...row }, content)
        return h('p', { key: identity, ...row }, content)
      }

      // With no book open the panel shows what to do next instead of a bare label.
      const emptyState = h('div', { className: 'sr-empty' },
        h('p', null, disguised ? t('neutralEmpty') : t('noBook')),
        h('button', {
          className: 'sr-empty-btn',
          type: 'button',
          // The button says "add a document", so it opens the tab that adds
          // one instead of making the reader find it.
          onClick: () => openSettings('library'),
        }, t('addMenu')),
        h('p', { className: 'sr-empty-hint' }, t('shortcutHint')),
      )

      // The messages live above the body, so they stay visible while a list
      // covers the text.
      const messages = error !== '' || note !== ''
        ? h('div', { className: 'sr-messages' },
          error !== '' ? h('p', { className: 'sr-error', role: 'alert' }, error) : null,
          note !== '' ? h('p', { className: 'sr-note', role: 'status' }, note) : null)
        : null

      // The continuous column: the loaded chapters follow each other, so
      // the text reads as one long scroll.
      let streamBlocks = null
      if (continuous) {
        let offset = 0
        streamBlocks = stream.map(item => {
          const lines = typeof item.text === 'string'
            ? item.text.split('\n').filter(line => line.trim() !== '')
            : []
          const start = offset
          offset += lines.length
          return h('div', {
            className: 'sr-chapter',
            key: item.index,
            'data-chapter': item.index,
          },
            h('div', { className: 'sr-chapter-mark' },
              disguised
                ? t('sectionN', { n: item.index + 1 })
                : (item.title !== '' ? item.title : t('sectionN', { n: item.index + 1 }))),
            lines.map((line, lineIndex) => renderLine(line, start + lineIndex, `${item.index}:${lineIndex}`)))
        })
      }

      // The end of the column: the next chapter is on its way, or the book
      // ends here.
      const columnEnd = continuous && stream.length > 0
        ? h('div', { className: 'sr-column-end' },
          loadingMore ? h('p', { className: 'sr-column-note' }, t('loadingMore'))
            : (stream[stream.length - 1].index + 1 >= stream[stream.length - 1].total
              ? h('p', { className: 'sr-column-note' }, t('endOfBook'))
              : null))
        : null

      /**
       * Read the keys the reading area owns.
       *
       * The area has the focus while it is being read, so the keys a reader
       * reaches for work without a chord: the arrows scroll, a page key
       * pages, and a chapter edge turns the chapter.
       *
       * @param {any} event - the key event
       * @returns {void}
       */
      const onBodyKeyDown = (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const node = bodyRef.current
        if (node === null || node === undefined) return
        const page = Math.max(Math.floor(node.clientHeight * 0.9), 80)
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          node.scrollTop += 48
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          node.scrollTop -= 48
          return
        }
        if (event.key === 'PageDown' || event.key === ' ') {
          event.preventDefault()
          // The next chapter starts where this one ends, so a page key at
          // the bottom is a chapter turn rather than a dead stop.
          if (node.scrollTop + node.clientHeight >= node.scrollHeight - 4) {
            void step(1)
            return
          }
          node.scrollTop += page
          return
        }
        if (event.key === 'PageUp') {
          event.preventDefault()
          if (node.scrollTop <= 4) {
            void step(-1)
            return
          }
          node.scrollTop -= page
          return
        }
        if (event.key === 'Home') {
          event.preventDefault()
          node.scrollTop = 0
          return
        }
        if (event.key === 'End') {
          event.preventDefault()
          node.scrollTop = node.scrollHeight
        }
      }

      /**
       * Read a click on the reading area.
       *
       * A tap on the left third goes back and on the right third goes on,
       * the way a reader on a phone expects. The middle stays a text
       * selection, so nothing is taken from a reader who is copying a line.
       *
       * @param {any} event - the click event
       * @returns {void}
       */
      const onBodyClick = (event) => {
        const node = bodyRef.current
        if (node === null || node === undefined) return
        // A selection is a selection, not a page turn.
        const selection = typeof window !== 'undefined' && window.getSelection
          ? window.getSelection()
          : null
        if (selection !== null && selection !== undefined && String(selection) !== '') return
        const target = event && event.currentTarget ? event.currentTarget : node
        if (typeof target.getBoundingClientRect !== 'function') return
        const rect = target.getBoundingClientRect()
        if (rect === null || rect === undefined) return
        const width = rect.width
        if (!(width > 0)) return
        const x = event.clientX - rect.left
        if (x < width * 0.3) {
          void step(-1)
          return
        }
        if (x > width * 0.7) {
          void step(1)
        }
      }

      const body = h('div', {
        className: 'sr-body',
        ref: attachBodyWithWheel,
        tabIndex: 0,
        role: 'region',
        onKeyDown: onBodyKeyDown,
        onClick: onBodyClick,
        'aria-label': disguised ? t('neutralPane') : t('readingArea'),
      },
        busy && chapter === null ? h('p', null, t('loading'))
          : chapter === null ? emptyState
            : continuous
              ? (streamBlocks === null || streamBlocks.length === 0
                ? h('p', null, t('loading'))
                : h('div', { className: 'sr-column' }, streamBlocks, columnEnd))
              : paragraphs.length === 0 ? h('p', null, t('emptyChapter'))
                : paragraphs.map((line, lineIndex) => renderLine(line, lineIndex)),
      )

      // The progress bar is the reading position within the book.
      const progress = chapter !== null && chapter.total > 0
        ? ((chapter.index + 1) / chapter.total) * 100
        : 0
      const matches = countMatches(search)

      const readerTools = chapter !== null
        ? h('div', { className: 'sr-tools' },
          h('div', { className: 'sr-progress', role: 'progressbar', 'aria-valuenow': chapter.index + 1,
            'aria-valuemin': 1, 'aria-valuemax': chapter.total,
            'aria-label': label(t('progress'), t('neutralProgress')) },
            h('span', { className: 'sr-progress-fill', style: { width: `${progress}%` } })),
          h('div', { className: 'sr-row' },
            h('input', {
              type: 'text',
              className: 'sr-jump',
              value: jump,
              placeholder: label(t('jumpHint'), t('neutralJumpHint')),
              'aria-label': label(t('jumpTo'), t('neutralJump')),
              onChange: (event) => setJump(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const wanted = Number.parseInt(String(jump).trim(), 10)
                if (Number.isInteger(wanted)) void jumpTo(wanted - 1)
                setJump('')
              },
            }),
            // The matches of the word being looked for are stepped through
            // here, in the chapter on screen. The list of every place in the
            // book is a page of its own, behind the search button.
            search.trim() !== '' && !foundOpen
              ? h('span', { className: 'sr-match-nav' },
                h('button', {
                  type: 'button', className: 'sr-match-btn',
                  title: label(t('prevMatch'), t('neutralPrevMatch')),
                  'aria-label': label(t('prevMatch'), t('neutralPrevMatch')),
                  onClick: () => gotoMatch(-1),
                }, '‹'),
                h('span', { className: 'sr-match-count' },
                  matches === 0 ? t('noMatch') : t('matches', { n: matches })),
                h('button', {
                  type: 'button', className: 'sr-match-btn',
                  title: label(t('nextMatch'), t('neutralNextMatch')),
                  'aria-label': label(t('nextMatch'), t('neutralNextMatch')),
                  onClick: () => gotoMatch(1),
                }, '›'))
              : null),
        )
        : null

      // The reading preferences live in their own page, so they are chosen
      // once and stay chosen.

      // The table of contents: every chapter of the book, in order.
      const tocView = tocOpen
        ? h('div', { className: 'sr-toc', ref: tocListRef },
          h('div', { className: 'sr-list-head' },
            h('strong', null, label(t('toc'), t('neutralList'))),
            toc === null
              ? null
              : h('span', { className: 'sr-match-count' }, t('sectionsN', { n: toc.chapters.length })),
            h('button', {
              className: 'sr-ibtn sr-btn', type: 'button', title: t('close'), 'aria-label': t('close'),
              onClick: closeToc,
            }, '✕')),
          toc === null
            ? h('div', { className: 'sr-lib-empty' }, t('loading'))
            : h('div', { className: 'sr-list-body', ref: holdWheelRef },
              chapterRows(toc.chapters, {
                onPick: (entry) => {
                  setTocOpen(false)
                  void jumpTo(entry.index)
                },
                current: chapter === null ? -1 : chapter.index,
                disguised,
                t,
              })),
        )
        : null

      // The search page: the field of its own, and every place the term was
      // found, listed with the line it was found on.
      const places = searchPlaces(found)
      const foundView = foundOpen
        ? h('div', { className: 'sr-search-page', ref: foundListRef },
          h('div', { className: 'sr-list-tools' },
            h('input', {
              type: 'search',
              className: 'sr-search-field',
              value: search,
              placeholder: label(t('searchHint'), t('neutralSearchHint')),
              'aria-label': label(t('search'), t('neutralSearch')),
              title: label(t('searchAllHint'), t('neutralSearchHint')),
              ref: searchInputRef,
              autoFocus: true,
              onChange: (event) => {
                setSearch(event.target.value)
                hitIndex.current = -1
                setActiveHit(-1)
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void searchBook()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeFound()
                }
              },
            })),
          h('div', { className: 'sr-list-head' },
            h('strong', null, label(t('searchResults'), t('neutralResults'))),
            h('span', { className: 'sr-match-count' },
              places.length === 0 && found === null
                ? ''
                : t('matches', { n: found && Number.isInteger(found.total) ? found.total : places.length })),
            h('button', {
              className: 'sr-ibtn sr-btn', type: 'button', title: t('close'), 'aria-label': t('close'),
              onClick: closeFound,
            }, '✕')),
          found !== null && places.length === 0
            ? h('div', { className: 'sr-lib-empty' }, t('noResults'))
            : h('div', { className: 'sr-list-body', ref: holdWheelRef },
              found !== null && found.truncated === true
                ? h('div', { className: 'sr-list-note' },
                  t('showingFirst', { n: places.length, m: found.total }))
                : null,
              places.map((place, order) => searchHitRows([place], {
                onPick: (picked) => {
                  setFoundOpen(false)
                  // The place inside the chapter comes with the result, so
                  // the reader lands on the sentence and not on the chapter
                  // that holds it.
                  void jumpTo(picked.index, picked.line, picked.flow)
                },
                disguised,
                term: search.trim(),
                t,
              })[0]))
        )
        : null

      const skinHeader = skin === 'diff'
        ? h('div', { className: 'sr-diff-head' }, `@@ -1,${paragraphs.length} +1,${paragraphs.length} @@`)
        : skin === 'terminal'
          ? h('div', { className: 'sr-term-prompt' }, 'session@local:~$')
          : null

      const foot = h('div', { className: 'sr-foot' },
        h('span', { className: 'sr-hint' }, disguised
          ? `[${fakeTime(0).slice(1, -1)}] loaded ${paragraphs.length} chunk${paragraphs.length === 1 ? '' : 's'}`
          : (chapter ? (chapter.title || t('sectionN', { n: (chapter.index ?? 0) + 1 })) : t('shortcutHint'))),
      )

      // The panel itself. The overlay floats above the page; the sidebar
      // variant fills the pane it was given, so only the frame differs.
      const panelContent = h('div', {
        className: variant === 'sidebar' ? 'sr-panel sr-panel-sidebar' : 'sr-panel',
        'data-skin': skin,
        style: {
          '--sr-width': `${Number(settings.width) || 430}px`,
          '--sr-font': `${Number(settings.fontSize) || 15}px`,
          '--sr-line-height': `${Number(settings.lineHeight) || 1.9}`,
          '--sr-reading-font': READING_FONTS[settings.font] || READING_FONTS.sans,
        },
      },
        header,
        skinHeader,
        readerTools,
        messages,
        tocOpen ? tocView : null,
        foundOpen ? foundView : null,
        tocOpen || foundOpen ? null : body,
        foot)

      // The settings are a page of their own, in the place the panel was:
      // the reader shows either the text or the settings, never both.
      if (showSettings) {
        return h('div', { className: variant === 'sidebar' ? 'sr-root sr-root-sidebar' : 'sr-root' },
          h('style', null, CSS),
          h(SettingsPage, { variant }))
      }

      // The catalog is a page of its own as well: it is drawn where the text
      // was, so picking a book puts the text back.
      if (shared.pickerOpen) {
        return h('div', { className: variant === 'sidebar' ? 'sr-root sr-root-sidebar' : 'sr-root' },
          h('style', null, CSS),
          h(BookPicker, { variant }))
      }

      if (variant === 'sidebar') {
        // The sidebar is a surface the reader does not own, so it fills the
        // pane and never draws a floating frame of its own.
        return h('div', { className: 'sr-root sr-root-sidebar sr-float' },
          h('style', null, CSS),
          panelContent)
      }

      // There are two shapes and neither floats in the window's corner:
      // the strip opens the reader, and the side column shows it.
      return h('div', { className: 'sr-root sr-float' },
        h('style', null, CSS),
        visible ? panelContent : null)
    }

    /**
     * The reading preferences, on a page of their own.
     *
     * The choices are made once and stay: the page writes them to the host,
     * so the next time the reader appears it already looks the way it was
     * left. The page is a surface of its own, so it is not tied to the
     * panel: it opens from wherever the reader is shown.
     *
     * @returns {any} React element
     */
    function SettingsPage(props) {
      const asked = props && typeof props.variant === 'string' ? props.variant : 'overlay'
      // A section of the Harness settings owns its own page, so it draws no
      // frame of its own and has nothing to close.
      const section = asked === 'section'
      const variant = asked === 'sidebar' ? 'sidebar' : (section ? 'section' : 'overlay')
      const shared = useReaderState()
      const settings = shared.settings
      const skin = settings.skin || 'log'
      // A disguise must not name a book, so the list numbers them instead.
      const disguised = skin !== 'plain'
      const [error, setError] = React.useState('')
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      // The two ways to add a book, held here so the page owns the library.
      const [addPath, setAddPath] = React.useState('')
      const [addUrl, setAddUrl] = React.useState('')
      // The selectors a site may need, when the automatic reader cannot work
      // out where the chapters and the text are.
      const [addChapterSelector, setAddChapterSelector] = React.useState('')
      const [addContentSelector, setAddContentSelector] = React.useState('')
      // The book a remove is being asked about, so removing takes two steps.
      const [removeId, setRemoveId] = React.useState(null)
      // Adding a site is rare, so its form is behind a button.
      const [addOpen, setAddOpen] = React.useState(false)
      // One page, four tabs: the reader picks a subject instead of scrolling
      // a page that mixes reading, looks, books and websites together.
      const [tab, setTab] = React.useState(settingsTabRequested)
      // Covers are fetched once each and kept for this page's lifetime; the
      // library read stays small because it carries only hasCover.
      const [coverCache, setCoverCache] = React.useState(() => new Map())
      const shelfShapeWanted = settings.libraryShape === 'shelf'
      const tabRefs = React.useRef({})
      const rootRef = React.useRef(null)
      const firstRef = React.useRef(null)
      const t = React.useMemo(() => translator, [])

      /**
       * Stop scanning one folder.
       *
       * The books already imported stay: the folder is where new ones come
       * from, not where the library lives.
       *
       * @param {string} dir - the folder to drop
       * @returns {Promise<void>} resolves when the folder is gone
       */
      const dropFolder = React.useCallback(async (dir) => {
        const known = Array.isArray(settings.libraryDirs) ? settings.libraryDirs : []
        const next = known.filter(item => item !== dir)
        setError('')
        try {
          await call('settings', { patch: { libraryDirs: next } })
          readerStore.set({ settings: { ...readerStore.get().settings, libraryDirs: next } })
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        }
      }, [settings.libraryDirs, t])

      /**
       * Remove one book from the library.
       * @param {string} bookId - the book to remove
       * @returns {Promise<void>} resolves when the book is gone
       */
      const removeBook = React.useCallback(async (bookId) => {
        setError('')
        try {
          await call('remove', { bookId })
          await loadLibrary()
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        }
      }, [t])

      /**
       * Read the library from the host and publish it to every surface.
       * @returns {Promise<void>} resolves when the list is fresh
       */
      const loadLibrary = React.useCallback(async () => {
        const data = await call('state')
        // The books and the sites are the two lists this page draws, so both
        // are published: the page may be the only surface that was opened.
        readerStore.set({ books: data.books || [], sites: data.sites || [] })
      }, [])

      // The shelf asks for a cover only when a book claims one, and only once
      // per book per page lifetime.
      React.useEffect(() => {
        if (settings.libraryShape !== 'shelf') return
        const wanted = (shared.books || []).filter(book => book.hasCover === true && !coverCache.has(book.id))
        if (wanted.length === 0) return
        let alive = true
        void (async () => {
          const found = new Map()
          for (const book of wanted.slice(0, 60)) {
            try {
              const data = await call('cover', { bookId: book.id })
              if (data.cover && typeof data.cover.data === 'string') found.set(book.id, data.cover.data)
            } catch {
              // A missing image falls back to the drawn spine.
            }
          }
          if (alive && found.size > 0) setCoverCache(previous => new Map([...previous, ...found]))
        })()
        return () => { alive = false }
      }, [settings.libraryShape, shared.books, coverCache])

      // A page opened from the Harness settings has no panel above it to load
      // the library first, so the page loads it itself.
      React.useEffect(() => {
        void loadLibrary().catch(() => {
          // The host may not be ready yet; the page still renders its fields.
        })
      }, [loadLibrary])

      /**
       * Open one book and show the reader.
       * @param {string} bookId - the book to open
       * @returns {Promise<void>} resolves when the book is open
       */
      const openBookFrom = React.useCallback(async (bookId) => {
        readerStore.set({ bookId, settingsOpen: false })
        try {
          const data = await call('open', { bookId })
          readerStore.set({
            index: data.chapter.index,
            total: data.chapter.total,
            bookTitle: data.chapter.bookTitle || '',
            chapterTitle: data.chapter.title || '',
          })
          await placeReader(readerStore.get().placement === 'sidebar' ? 'sidebar' : 'strip')
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        }
      }, [t])

      /**
       * Add one book from a local path and refresh the list.
       * @returns {Promise<void>} resolves when the book is in
       */
      const addLocal = React.useCallback(async () => {
        const path = addPath.trim()
        if (path === '' || busy) return
        setBusy(true)
        setError('')
        try {
          await call('add_local', { path })
          setAddPath('')
          setNote(t('importedOne'))
          await loadLibrary()
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        } finally {
          setBusy(false)
        }
      }, [addPath, busy, t])

      /**
       * Add one web novel from its catalog page.
       * @returns {Promise<void>} resolves when the book is in
       */
      const addWeb = React.useCallback(async () => {
        const url = addUrl.trim()
        if (url === '' || busy) return
        setBusy(true)
        setError('')
        try {
          await call('add_web', {
            url,
            chapterSelector: addChapterSelector.trim() === '' ? undefined : addChapterSelector.trim(),
            contentSelector: addContentSelector.trim() === '' ? undefined : addContentSelector.trim(),
          })
          setAddUrl('')
          setNote(t('importedOne'))
          await loadLibrary()
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        } finally {
          setBusy(false)
        }
      }, [addUrl, busy, t])

      /**
       * Add every novel in a folder the reader picks.
       * @returns {Promise<void>} resolves when the folder is in
       */
      const addFolder = React.useCallback(async () => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          const picked = await pickFolder()
          if (picked === null) return
          let offset = 0
          let total = 0
          for (;;) {
            const result = await call('import_dir', { dir: picked, offset, limit: 5 })
            total = result.total
            offset += result.count
            if (result.count === 0 || offset >= total) break
          }
          setNote(t('importedN', { n: total }))
          await loadLibrary()
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        } finally {
          setBusy(false)
        }
      }, [busy, t])

      React.useEffect(() => {
        if (firstRef.current) firstRef.current.focus()
      }, [])

      /**
       * Close the page and give the focus back to whatever opened it.
       * @returns {void}
       */
      const close = React.useCallback(() => {
        readerStore.set({ settingsOpen: false })
        const active = typeof document !== 'undefined' ? document.activeElement : null
        if (active && typeof active.focus === 'function') active.focus()
      }, [])

      // Escape closes the page, the way the host's own overlays do, and the
      // press stops there: the panel underneath must not also close, or one
      // keystroke would throw away both the page and the reader. A settings
      // section belongs to the Harness settings, which owns Escape.
      React.useEffect(() => (section ? undefined : escapeLayers.push(close)), [close, section])
      // The page is closed by a click on the empty area around it, the way
      // every other surface of the reader is. A section belongs to the
      // Harness settings, which owns the area around it.
      React.useEffect(() => {
        if (section) return undefined
        const node = rootRef.current
        if (node === null || node === undefined) return undefined
        return closeOnOutside(node, close)
      }, [close, section])

      /**
       * Store one reading preference and say so when it could not be kept.
       * @param {string} key - the setting name
       * @param {number | string} value - the new value
       * @returns {Promise<void>} resolves when the setting is stored
       */
      const change = React.useCallback(async (key, value) => {
        setError('')
        try {
          await settingsController.change(key, value)
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        }
      }, [t])

      /**
       * Put every preference back to its shipped value.
       * @returns {Promise<void>} resolves when the host answered
       */
      const restore = React.useCallback(async () => {
        setBusy(true)
        setError('')
        setNote('')
        try {
          await settingsController.reset()
          setNote(t('defaultsRestored'))
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        } finally {
          setBusy(false)
        }
      }, [t])

      const continuous = settings.scrollMode === 'continuous'
      const placement = PLACEMENTS.includes(settings.placement) ? settings.placement : 'strip'

      /**
       * One field: a label, its control, and a hint under it.
       *
       * @param {string} label - the field's name
       * @param {string | null} hint - one line under the control
       * @param {any} control - the control itself
       * @returns {any} React element
       */
      const field = (label, hint, control) => h('div', { className: 'sr-set-field' },
        h('div', { className: 'sr-set-field-head' },
          h('span', { className: 'sr-set-settings-label' }, label)),
        control,
        hint === null ? null : h('p', { className: 'sr-set-hint' }, hint))

      /**
       * A range control with its value beside it.
       *
       * @param {number} min - the smallest value
       * @param {number} max - the largest value
       * @param {number} step - the increment
       * @param {number} value - the current value
       * @param {string} label - the control's accessible name
       * @param {(value: number) => void} onChange - called with the new value
       * @param {string} [text] - the value as text, when it is not the number
       * @returns {any} React element
       */
      const slider = (min, max, step, value, label, onChange, text) => h('div', { className: 'sr-set-field-head' },
        h('input', {
          type: 'range', min: String(min), max: String(max), step: String(step),
          value: String(value),
          'aria-label': label,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        h('span', { className: 'sr-set-settings-value' }, text === undefined ? String(value) : text))

      // A book without a stored cover gets a spine derived from its own name:
      // the hue is stable, so the same book always looks the same.
      const coverOf = (book) => {
        if (book.hasCover !== true) return null
        return coverCache.get(book.id) || null
      }
      // A file name often carries the author after the title. The shelf shows
      // the book's name, so the author is split off instead of being clipped.
      const spineName = (book) => {
        const raw = String(book.title || '').trim()
        if (raw === '') return book.id
        const split = raw.split(/\s*作者[：:]\s*/u)
        return (split[0] || raw).trim()
      }
      const spineAuthor = (book) => {
        const raw = String(book.title || '')
        const split = raw.split(/\s*作者[：:]\s*/u)
        return split.length > 1 ? split[1].trim() : ''
      }
      const shelfShape = (shared.books || []).length === 0
        ? h('p', { className: 'sr-set-hint' }, t('neutralEmptyList'))
        : h('div', { className: 'sr-set-shelf' }, (shared.books || []).map((book, at) => {
          const stored = coverOf(book)
          const name = disguised ? t('docN', { n: at + 1 }) : spineName(book)
          const author = disguised ? '' : spineAuthor(book)
          const fromWeb = book.origin === 'web'
          const cached = Number(book.cached) || 0
          const total = Number(book.chapters) || 0
          // One line under the shape: where the book lives and how much of it
          // is on disk. A disguise drops it, because it names the origin.
          const meta = disguised ? ''
            : fromWeb
              ? t('shelfWebMeta', { cached, total })
              : t('shelfLocalMeta', { n: total })
          return h('div', { key: book.id, className: 'sr-set-spine-item' },
            h('button', {
              type: 'button',
              className: 'sr-set-spine',
              title: disguised ? t('docN', { n: at + 1 }) : book.title,
              'aria-label': name,
              onClick: () => void openBookFrom(book.id),
            },
            // The name sits in the shape like a cover. It is drawn even when a
            // stored image is present, so a cover that fails to load still
            // leaves the book named.
            h('span', { className: 'sr-set-spine-face' },
              h('span', { className: 'sr-set-spine-title' }, name),
              author === '' ? null : h('span', { className: 'sr-set-spine-author' }, author)),
            stored === null
              ? null
              : h('img', {
                className: 'sr-set-spine-cover',
                src: stored,
                alt: '',
                loading: 'lazy',
                onError: (event) => { event.currentTarget.style.display = 'none' },
              }),
            // A thin mark says the book came from a website without shouting.
            fromWeb && !disguised
              ? h('span', { className: 'sr-set-spine-mark', title: t('shelfWeb'), 'aria-hidden': true })
              : null),
            meta === ''
              ? null
              : h('span', { className: 'sr-set-spine-meta' }, meta),
            removeId === book.id
              ? h('button', {
                type: 'button', className: 'sr-set-book-confirm sr-set-spine-remove',
                'aria-label': t('remove'),
                onClick: () => { setRemoveId(null); void removeBook(book.id) },
              }, t('confirmRemove'))
              : h('button', {
                type: 'button', className: 'sr-set-book-remove sr-set-spine-remove',
                'aria-label': t('remove'),
                onClick: () => setRemoveId(book.id),
              }, '✕'))
        }))

      // The library, as a list of books the reader can open.
      const bookList = (shared.books || []).length === 0
        ? h('p', { className: 'sr-set-hint' }, t('neutralEmptyList'))
        : h('div', { className: 'sr-set-books' }, (shared.books || []).map((book, at) => h('div', {
          key: book.id,
          className: 'sr-set-book-row',
        },
        h('button', {
          type: 'button',
          className: 'sr-set-book',
          title: disguised ? undefined : book.title,
          onClick: () => void openBookFrom(book.id),
        },
        h('span', { className: 'sr-set-book-name' },
          disguised ? t('docN', { n: at + 1 }) : book.title),
        h('span', { className: 'sr-set-book-count' }, String(book.chapters))),
        // Removing a book is two steps, the way the drawer did it: the cross
        // asks, and the label it turns into confirms.
        removeId === book.id
          ? h('button', {
            type: 'button',
            className: 'sr-set-book-confirm',
            'aria-label': t('remove'),
            onClick: () => {
              setRemoveId(null)
              void removeBook(book.id)
            },
          }, t('confirmRemove'))
          : h('button', {
            type: 'button',
            className: 'sr-set-book-remove',
            'aria-label': t('remove'),
            onClick: () => setRemoveId(book.id),
          }, '✕'))))

      // A settings section is a page of the Harness settings, so it is
      // ordinary content there: no frame, no dialog role, no fixed corner.
      // The page that floats over the window carries the tokens of the
      // reader's surfaces with it, because it is drawn outside the reader's
      // own root.
      const rootClass = section
        ? 'sr-set-settings-page sr-set-settings-section'
        : (variant === 'sidebar'
          ? 'sr-set-settings-page sr-set-settings-sidebar'
          : 'sr-set-settings-page sr-float sr-float-page')

      return h('div', {
        className: rootClass,
        ref: rootRef,
        role: section ? 'group' : 'dialog',
        'aria-modal': section ? undefined : 'false',
        'aria-label': t('settings'),
        style: { '--sr-width': `${Number(settings.width) || 430}px` },
      },
        h('div', { className: 'sr-set-settings-head' },
          h('h2', { className: 'sr-set-settings-title', tabIndex: -1, ref: firstRef }, t('settings')),
          h('button', {
            className: 'sr-ibtn sr-btn', type: 'button', title: t('close'), 'aria-label': t('close'),
            onClick: close,
          }, '✕')),
        h('div', { className: 'sr-set-tabs', role: 'tablist', 'aria-label': t('settings') },
          ['reading', 'appearance', 'library', 'sites'].map((name, at, all) => h('button', {
            key: name,
            type: 'button',
            className: `sr-set-tab${tab === name ? ' is-active' : ''}`,
            role: 'tab',
            'aria-selected': tab === name,
            tabIndex: tab === name ? 0 : -1,
            ref: node => { tabRefs.current[name] = node },
            onClick: () => setTab(name),
            onKeyDown: (event) => {
              const step = event.key === 'ArrowRight' ? 1 : (event.key === 'ArrowLeft' ? -1 : 0)
              if (step === 0) return
              event.preventDefault()
              const next = all[(at + step + all.length) % all.length]
              setTab(next)
              const node = tabRefs.current[next]
              if (node && typeof node.focus === 'function') node.focus()
            },
          }, t(`setTab_${name}`)))),
        h('div', { className: 'sr-set-settings-body' },
          // Reading: what the text looks like and how it moves.
          h('section', { className: 'sr-set-group', 'data-tab': 'reading', style: tab === 'reading' ? undefined : { display: 'none' } },
            h('h3', { className: 'sr-set-group-title' }, t('setReading')),
            h('div', { className: 'sr-set-panel' },
              field(t('setPlacement'), t('setPlacementHint'),
                h('div', { className: 'sr-set-choice-group', role: 'radiogroup', 'aria-label': t('setPlacement') },
                  PLACEMENTS.map(option => h('button', {
                    key: option,
                    type: 'button',
                    className: `sr-set-choice${placement === option ? ' is-active' : ''}`,
                    role: 'radio',
                    'aria-checked': placement === option,
                    onClick: () => void change('placement', option),
                  }, t(`placement${option.charAt(0).toUpperCase()}${option.slice(1)}`))))),
              field(t('setFontSize'), null,
                slider(11, 26, 1, Number(settings.fontSize) || 15, t('setFontSize'),
                  (value) => void change('fontSize', value))),
              field(t('setLineHeight'), null,
                slider(13, 26, 1, Math.round((Number(settings.lineHeight) || 1.9) * 10), t('setLineHeight'),
                  (value) => void change('lineHeight', value / 10),
                  String(((Number(settings.lineHeight) || 1.9)).toFixed(1)))),
              // The typeface is part of the disguise: the log, terminal and
              // diff skins are monospace on purpose, so a chosen typeface
              // only reaches the plain skin. The hint says so rather than
              // letting the reader pick one and see nothing change.
              field(t('setReadingFont'), t('setReadingFontHint'),
                h('div', { className: 'sr-set-choice-group' },
                  Object.keys(READING_FONTS).map(key => h('button', {
                    key,
                    type: 'button',
                    className: `sr-set-choice${(settings.font || 'sans') === key ? ' is-active' : ''}`,
                    'aria-pressed': (settings.font || 'sans') === key,
                    style: { fontFamily: READING_FONTS[key] },
                    onClick: () => void change('font', key),
                  }, t(`font_${key}`)))),
              field(t('setReadingMode'), null,
                h('div', { className: 'sr-set-choice-group' },
                  h('button', {
                    type: 'button',
                    className: `sr-set-choice${continuous ? '' : ' is-active'}`,
                    'aria-pressed': !continuous,
                    onClick: () => void change('scrollMode', 'chapter'),
                  }, t('modeChapter')),
                  h('button', {
                    type: 'button',
                    className: `sr-set-choice${continuous ? ' is-active' : ''}`,
                    'aria-pressed': continuous,
                    onClick: () => void change('scrollMode', 'continuous'),
                  }, t('modeContinuous'))))))),
          // The card above the input: its own size, because the card is small.
          h('section', { className: 'sr-set-group', 'data-tab': 'reading', style: tab === 'reading' ? undefined : { display: 'none' } },
            h('h3', { className: 'sr-set-group-title' }, t('setCard')),
            h('div', { className: 'sr-set-panel' },
              // The page is a number of lines. There is no character count:
              // two controls for one page would fight, and a character count
              // can end mid-line.
              field(t('setStripLines'), t('setStripLinesHint'),
                slider(1, 8, 1, Number(settings.stripLines) || DEFAULT_LINES, t('setStripLines'),
                  (value) => void change('stripLines', value))),
              // What the card's first line says: the book, the progress, or a
              // neutral line for a disguise.
              field(t('setCardHead'), t('setCardHeadHint'),
                h('div', { className: 'sr-set-choice-group' },
                  ['book', 'progress', 'neutral'].map(key => h('button', {
                    key,
                    type: 'button',
                    className: `sr-set-choice${(settings.cardHead || 'book') === key ? ' is-active' : ''}`,
                    'aria-pressed': (settings.cardHead || 'book') === key,
                    onClick: () => void change('cardHead', key),
                  }, t(`cardHead_${key}`))))),
              // Whether the card may fold at all, which is a different choice
              // from when it folds itself.
              field(t('setCardFoldable'), t('setCardFoldableHint'),
                h('div', { className: 'sr-set-choice-group' },
                  [['yes', true], ['no', false]].map(([key, value]) => h('button', {
                    key,
                    type: 'button',
                    className: `sr-set-choice${(settings.cardFoldable !== false) === value ? ' is-active' : ''}`,
                    'aria-pressed': (settings.cardFoldable !== false) === value,
                    onClick: () => void change('cardFoldable', value),
                  }, t(`cardFoldable_${key}`))))),
              // When the card puts itself away: only on request, when the
              // pointer leaves, or never. It only applies while folding is on.
              (settings.cardFoldable === false)
                ? null
                : field(t('setCardFoldMode'), t('setCardFoldModeHint'),
                h('div', { className: 'sr-set-choice-group' },
                  ['manual', 'auto', 'never'].map(key => h('button', {
                    key,
                    type: 'button',
                    className: `sr-set-choice${(settings.cardFoldMode || 'manual') === key ? ' is-active' : ''}`,
                    'aria-pressed': (settings.cardFoldMode || 'manual') === key,
                    onClick: () => void change('cardFoldMode', key),
                  }, t(`cardFoldMode_${key}`))))),

              // A card that lingers over the text is in the way, so the wait is
              // the reader's own choice.
              (settings.cardFoldMode || 'manual') !== 'auto'
                ? null
                : field(t('setCardFoldDelay'), t('setCardFoldDelayHint'),
                  slider(MIN_FOLD_DELAY, MAX_FOLD_DELAY, 20, Number(settings.cardFoldDelay) || DEFAULT_FOLD_DELAY, t('setCardFoldDelay'),
                    (value) => void change('cardFoldDelay', value),
                    `${Number(settings.cardFoldDelay) || 260}ms`)),
              // What a folded card looks like: a round mark, or a one-line bar
              // in the composer stack.
              (settings.cardFoldable === false)
                ? null
                : field(t('setCardFoldedShape'), t('setCardFoldedShapeHint'),
                  h('div', { className: 'sr-set-choice-group' },
                    ['mark', 'bar'].map(key => h('button', {
                      key,
                      type: 'button',
                      className: `sr-set-choice${(settings.cardFoldedShape || 'mark') === key ? ' is-active' : ''}`,
                      'aria-pressed': (settings.cardFoldedShape || 'mark') === key,
                      onClick: () => void change('cardFoldedShape', key),
                    }, t(`cardFoldedShape_${key}`))))),
              // What the bar says in its middle, and the cover story it can
              // carry instead of the book.
              (settings.cardFoldable === false || (settings.cardFoldedShape || 'mark') !== 'bar')
                ? null
                : field(t('setBarLabel'), t('setBarLabelHint'),
                  h('div', { className: 'sr-set-choice-group' },
                    ['head', 'chapter', 'cover'].map(key => h('button', {
                      key,
                      type: 'button',
                      className: `sr-set-choice${(settings.barLabel || 'head') === key ? ' is-active' : ''}`,
                      'aria-pressed': (settings.barLabel || 'head') === key,
                      onClick: () => void change('barLabel', key),
                    }, t(`barLabel_${key}`))))),
              (settings.cardFoldable === false || (settings.cardFoldedShape || 'mark') !== 'bar'
                || (settings.barLabel || 'head') !== 'cover')
                ? null
                : field(t('setBarCoverText'), t('setBarCoverTextHint'),
                  h('div', { className: 'sr-set-cover' },
                    // A few ready-made cover stories, so a disguise does not
                    // need the reader to invent a line under pressure.
                    h('div', { className: 'sr-set-choice-group' },
                      ['notes', 'log', 'draft', 'sync'].map(key => h('button', {
                        key,
                        type: 'button',
                        className: `sr-set-choice${coverStory(settings.barCoverText) === t(`barCover_${key}`) ? ' is-active' : ''}`,
                        'aria-pressed': coverStory(settings.barCoverText) === t(`barCover_${key}`),
                        onClick: () => void change('barCoverText', t(`barCover_${key}`)),
                      }, t(`barCover_${key}`)))),
                    h('input', {
                      type: 'text',
                      className: 'sr-set-text',
                      value: String(settings.barCoverText || ''),
                      maxLength: 40,
                      placeholder: t('setBarCoverTextHint'),
                      'aria-label': t('setBarCoverText'),
                      onChange: (event) => void change('barCoverText', event.target.value),
                    }))),
              // How much of the book's progress the folded bar shows. The
              // number alone is enough for most readers, and the line is
              // long enough to take the row's space.
              (settings.cardFoldable === false || (settings.cardFoldedShape || 'mark') !== 'bar')
                ? null
                : field(t('setBarProgress'), t('setBarProgressHint'),
                  h('div', { className: 'sr-set-choice-group' },
                    ['percent', 'track', 'both', 'none'].map(key => h('button', {
                      key,
                      type: 'button',
                      className: `sr-set-choice${(settings.barProgress || 'percent') === key ? ' is-active' : ''}`,
                      'aria-pressed': (settings.barProgress || 'percent') === key,
                      onClick: () => void change('barProgress', key),
                    }, t(`barProgress_${key}`))))),
              )),
          // The look: the disguise and the width of the panel.
          h('section', { className: 'sr-set-group', 'data-tab': 'appearance', style: tab === 'appearance' ? undefined : { display: 'none' } },
            h('h3', { className: 'sr-set-group-title' }, t('setAppearance')),
            h('div', { className: 'sr-set-panel' },
              field(t('setSkin'), t('setSkinHint'),
                h('div', { className: 'sr-set-choice-group' },
                  SKINS.map(key => h('button', {
                    key,
                    type: 'button',
                    className: `sr-set-choice${skin === key ? ' is-active' : ''}`,
                    'aria-pressed': skin === key,
                    onClick: () => void change('skin', key),
                  }, t(`skin_${key}`))))),
              field(t('setPanelWidth'), null,
                slider(320, 720, 10, Number(settings.width) || 430, t('setPanelWidth'),
                  (value) => void change('width', value))))),
          // The library: the books themselves, so adding and removing one is
          // a preference and not a detour through the reading surface.
          h('section', { className: 'sr-set-group', 'data-tab': 'library', style: tab === 'library' ? undefined : { display: 'none' } },
            h('h3', { className: 'sr-set-group-title' }, t('setLibrary')),
            h('div', { className: 'sr-set-panel' },
              // One list, two shapes: a row per book, or a shelf of covers.
              field(t('setLibraryList'),
                h('div', { className: 'sr-set-shape-row' },
                  h('span', null, t('setLibraryListHint')),
                  h('button', {
                    type: 'button',
                    className: 'sr-set-shape',
                    'aria-pressed': shelfShapeWanted,
                    title: shelfShapeWanted ? t('setShapeList') : t('setShapeShelf'),
                    'aria-label': shelfShapeWanted ? t('setShapeList') : t('setShapeShelf'),
                    onClick: () => void change('libraryShape', shelfShapeWanted ? 'list' : 'shelf'),
                  }, shelfShapeWanted ? '☰' : '▤')),
                shelfShapeWanted ? shelfShape : bookList),
              field(t('shopTitle'), t('shopSettingsHint'),
                h('div', { className: 'sr-set-row' },
                  h('button', { type: 'button', className: 'sr-set-action', onClick: openBookstore }, t('shop')),
                  // The catalog is the list of books with one click on a book,
                  // so it is one door away from here as well. In the Harness
                  // settings it floats, because the panel they live in is a
                  // modal of its own and would hide a catalog drawn inside.
                  h('button', {
                    type: 'button', className: 'sr-set-action',
                    onClick: section ? openFloatingPicker : togglePicker,
                  }, t('pickerTitle')))),
              field(t('setAddLocal'), t('setAddLocalHint'),
                h('div', { className: 'sr-set-row' },
                  h('input', {
                    type: 'text', className: 'sr-set-input',
                    value: addPath, placeholder: t('neutralPath'),
                    'aria-label': t('setAddLocal'),
                    onChange: (event) => setAddPath(event.target.value),
                  }),
                  h('button', {
                    type: 'button', className: 'sr-set-action',
                    disabled: busy || addPath.trim() === '',
                    onClick: () => void addLocal(),
                  }, t('addLocal')))),
              field(t('setAddWeb'), t('setAddWebHint'),
                h('div', { className: 'sr-set-row' },
                  h('input', {
                    type: 'text', className: 'sr-set-input',
                    value: addUrl, placeholder: t('neutralUrl'),
                    'aria-label': t('setAddWeb'),
                    onChange: (event) => setAddUrl(event.target.value),
                  }),
                  h('button', {
                    type: 'button', className: 'sr-set-action',
                    disabled: busy || addUrl.trim() === '',
                    onClick: () => void addWeb(),
                  }, t('addWeb')))),
              // The repair selectors are a troubleshooting affordance, not an
              // everyday field: they are closed until the reader asks for
              // them, so the add form stays two rows long.
              h('details', { className: 'sr-set-advanced' },
                h('summary', { className: 'sr-set-advanced-sum' }, t('setAdvanced')),
                field(t('setSelectors'), t('setSelectorsHint'),
                  h('div', { className: 'sr-set-row' },
                    h('input', {
                      type: 'text', className: 'sr-set-input',
                      value: addChapterSelector, placeholder: t('setChapterSelector'),
                      'aria-label': t('setChapterSelector'),
                      onChange: (event) => setAddChapterSelector(event.target.value),
                    }),
                    h('input', {
                      type: 'text', className: 'sr-set-input',
                      value: addContentSelector, placeholder: t('setContentSelector'),
                      'aria-label': t('setContentSelector'),
                      onChange: (event) => setAddContentSelector(event.target.value),
                    })))),
              field(t('setAddFolder'), t('setAddFolderHint'),
                h('button', {
                  type: 'button', className: 'sr-set-action', disabled: busy,
                  onClick: () => void addFolder(),
                }, t('chooseFolder'))),
              (settings.libraryDirs || []).length === 0
                ? null
                : field(t('setFolders'), t('setFoldersHint'),
                  h('div', { className: 'sr-set-folders' },
                    (settings.libraryDirs || []).map((dir, at) => h('div', {
                      key: dir,
                      className: 'sr-set-folder',
                    },
                    h('span', { className: 'sr-set-folder-path', title: disguised ? undefined : dir },
                      disguised ? t('docN', { n: at + 1 }) : dir),
                    h('button', {
                      type: 'button', className: 'sr-set-book-remove',
                      'aria-label': t('setRemoveFolder'),
                      onClick: () => void dropFolder(dir),
                    }, '✕'))))))),
          h('section', { className: 'sr-set-group', 'data-tab': 'sites', style: tab === 'sites' ? undefined : { display: 'none' } },
            h('h3', { className: 'sr-set-group-title' }, t('setTab_sites')),
            h('div', { className: 'sr-set-panel' },
              field(t('shopSites'), t('shopSettingsHint'),
                (shared.sites || []).length === 0
                  ? h('p', { className: 'sr-set-hint' }, t('shopNoSites'))
                  : h('div', { className: 'sr-set-sites' },
                    (shared.sites || []).map(site => h('div', { key: site.id, className: 'sr-set-site' },
                      h('span', { className: 'sr-set-site-name' }, site.title),
                      h('span', { className: 'sr-set-site-origin' }, site.origin))))),
              field(t('shopTitle'), null,
                h('button', { type: 'button', className: 'sr-set-action', onClick: openBookstore }, t('shop'))))),
          error !== '' ? h('p', { className: 'sr-set-error', role: 'alert' }, error) : null),
        // The footer is part of the frame, so the way out never scrolls away
        // with a long book list, and it does not repeat the cross above.
        h('div', { className: 'sr-set-settings-foot' },
          // The reader can be closed from its own bar, and then the card that
          // would reopen it is gone. This is the way back that does not depend
          // on the reader being on screen.
          h('button', {
            className: 'sr-set-action', type: 'button',
            onClick: () => {
              // Recover the composer card even if the last placement was the
              // sidebar. Do not open the separate reading panel over it.
              void placeReader('strip')
              readerStore.set({ visible: false, settingsOpen: false })
            },
          }, t('openReaderNow')),
          h('button', {
            className: 'sr-set-action sr-set-action-quiet', type: 'button', disabled: busy,
            onClick: () => void restore(),
          }, t('restoreDefaults')),
          h('span', { className: 'sr-set-foot-note', role: 'status' }, note)))
    }

    /** Explicit website workspace. Its guest DOM remains mounted while hidden. */
    function BookstoreSurface() {
      const shared = useReaderState()
      const visible = shared.bookstoreOpen
      const nav = shared.browserNav || {}
      const sites = shared.sites || []
      const t = translator
      // The skin decides how much of a book may be named. Reading an
      // undeclared name here would throw on the first preview render.
      const disguised = (shared.settings.skin || 'log') !== 'plain'
      const [siteUrl, setSiteUrl] = React.useState('')
      const [siteName, setSiteName] = React.useState('')
      const [address, setAddress] = React.useState('')
      // How much the page is shrunk inside the pane. 1 is the page's own size.
      const zoom = nav.zoom || 1
      const [error, setError] = React.useState('')
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [preview, setPreview] = React.useState(null)
      const [added, setAdded] = React.useState(null)
      const [removeId, setRemoveId] = React.useState(null)
      // Adding a site is rare, so its form is behind a button.
      const [addOpen, setAddOpen] = React.useState(false)
      const [forgetId, setForgetId] = React.useState(null)
      const container = React.useRef(null)
      const closeButton = React.useRef(null)
      const shopRef = React.useRef(null)
      const operation = React.useRef(0)
      const alive = React.useRef(true)
      const browser = browserForReader()
      const selected = sites.find(site => site.id === nav.siteId)
      const refresh = React.useCallback(async () => {
        const data = await rawCall('state')
        if (alive.current) readerStore.set({ sites: data.sites || [], books: data.books || [] })
      }, [])
      const close = React.useCallback(() => {
        operation.current += 1
        setBusy(false)
        setPreview(null)
        closeBookstore()
      }, [])
      /**
       * Shrink or grow the page inside the pane.
       *
       * @param {number} wanted - the factor, 1 being the page's own size
       * @returns {Promise<void>} resolves when the page took it
       */
      const applyZoom = React.useCallback(async (wanted) => {
        const next = Math.min(Math.max(Math.round(wanted * 10) / 10, 0.4), 1.6)
        try { browser.setZoom(next) } catch { setError(t('shopBrowserError')) }
      }, [browser])
      React.useEffect(() => {
        alive.current = true
        // The container stays mounted for the guest's whole life: an attached
        // Electron webview cannot be moved or re-attached to another parent.
        if (browser.supported) {
          try { browser.mount(container.current) } catch { setError(t('shopBrowserError')) }
        }
        return () => { alive.current = false; operation.current += 1 }
      }, [])
      React.useEffect(() => {
        if (!visible) { operation.current += 1; setBusy(false); setPreview(null); return }
        void refresh().catch(() => setError(t('errHost')))
        closeButton.current?.focus?.()
      }, [visible, refresh])
      // A reader who opens this page wants to look at a site, not at an empty
      // pane: the first saved site opens by itself. Only the first one, only
      // when nothing is open, and only once per opening, so switching sites
      // or coming back to the page never pulls the reader off the site they
      // chose.
      const openedDefault = React.useRef(false)
      React.useEffect(() => {
        if (!visible) { openedDefault.current = false; return }
        if (openedDefault.current) return
        if (sites.length === 0) return
        if (nav.siteId !== null && nav.siteId !== undefined && nav.siteId !== '') { openedDefault.current = true; return }
        openedDefault.current = true
        void openSite(sites[0])
      }, [visible, sites.length === 0 ? '' : sites[0].id, nav.siteId])
      // The shelf is closed by a click on the empty area around it, the way
      // every other surface of the reader is.
      React.useEffect(() => {
        if (!visible) return undefined
        const node = shopRef.current
        if (node === null || node === undefined) return undefined
        return closeOnOutside(node, close)
      }, [visible, close])
      React.useEffect(() => {
        setAddress(nav.url || '')
        operation.current += 1
        setBusy(false)
        setPreview(null)
        setAdded(null)
      }, [nav.url, nav.siteId])
      React.useEffect(() => {
        if (!visible) return undefined
        return escapeLayers.push(() => {
          // Escape in the address bar reverts the address, not the workspace.
          const target = typeof document === 'undefined' ? null : document.activeElement
          if (target && typeof target.closest === 'function' && target.closest('.sr-shop-toolbar')) {
            setAddress(nav.url || '')
            return
          }
          close()
        })
      }, [visible, nav.url, close])
      const fail = failure => setError(shopFailure(failure, t))
      const openSite = async site => {
        operation.current += 1
        setPreview(null); setError(''); setNote(''); setAdded(null); setForgetId(null)
        try {
          if (!browser.supported) {
            readerStore.set({ browserNav: { siteId: site.id, url: site.url, loading: false } })
            return
          }
          await browser.open(site)
        } catch (failure) { fail(failure) }
      }
      const addSite = async event => {
        event.preventDefault()
        if (busy || siteUrl.trim() === '') return
        setBusy(true); setError('')
        try {
          await rawCall('site_add', { url: siteUrl.trim(), title: siteName.trim() })
          setSiteUrl(''); setSiteName(''); await refresh()
        } catch (failure) { fail(failure) } finally { setBusy(false) }
      }
      const removeSite = async site => {
        setBusy(true); setError('')
        try {
          // Removing the site also drops its temporary sign-in session, so
          // the confirmation text says both.
          await browser.forget(site.id)
          await rawCall('site_remove', { siteId: site.id })
          setRemoveId(null); setPreview(null); await refresh()
        } catch (failure) { fail(failure) } finally { setBusy(false) }
      }
      const disconnect = async () => {
        if (!selected) return
        setBusy(true); setError(''); setPreview(null)
        try {
          await browser.forget(selected.id)
          setForgetId(null); setNote(t('shopDisconnected'))
        } catch (failure) { fail(failure) } finally { setBusy(false) }
      }
      const navigate = event => {
        event.preventDefault(); setError(''); setPreview(null)
        try { Promise.resolve(browser.navigate(address)).catch(fail) } catch (failure) { fail(failure) }
      }
      const identify = async () => {
        if (!selected || busy || nav.loading || !browser.supported) return
        const stamp = ++operation.current
        const valid = () => alive.current && operation.current === stamp && readerStore.get().bookstoreOpen
        setBusy(true); setError(''); setNote(''); setPreview(null); setAdded(null)
        try {
          const first = await browser.capture()
          const pages = [first]
          for (let count = 0; count < 4; count += 1) {
            if (!valid()) return
            const result = await rawCall('web_preview', { siteId: selected.id, url: first.url, pages })
            if (!valid()) return
            if (result.preview) { setPreview(result.preview); return }
            if (!result.needs || pages.length >= 3 || pages.some(page => page.url === result.needs.url)) {
              throw { code: 'noCatalog' }
            }
            const page = await browser.fetchPage(selected, result.needs.url)
            if (!valid()) return
            pages.push(page)
          }
          throw { code: 'noCatalog' }
        } catch (failure) { if (valid()) fail(failure) }
        finally { if (valid()) setBusy(false) }
      }
      const confirm = async () => {
        if (!preview || busy) return
        setBusy(true); setError('')
        try {
          const result = await rawCall('web_confirm', { previewId: preview.previewId })
          await refresh()
          setAdded(result.book); setPreview(null); setNote(t('shopAdded'))
        } catch (failure) {
          // The token is single-use, so a failed confirm cannot be retried:
          // drop the preview and let the reader identify the book again.
          setPreview(null)
          fail(failure)
        } finally { setBusy(false) }
      }
      const readAdded = async () => {
        if (!added || busy) return
        setBusy(true); setError('')
        try {
          const data = await call('open', { bookId: added.id })
          readerStore.set({ bookId: added.id, index: data.chapter.index, total: data.chapter.total,
            bookTitle: data.chapter.bookTitle || '', chapterTitle: data.chapter.title || '',
            settingsOpen: false, bookstoreOpen: false })
          openReader()
        } catch (failure) { fail(failure) } finally { setBusy(false) }
      }
      const control = (label, fn, disabled, text) => h('button', { type: 'button', className: 'sr-set-action',
        title: label, 'aria-label': label, disabled, onClick: fn }, text || label)
      const safeNavigate = fn => () => { try { Promise.resolve(fn()).catch(fail) } catch (failure) { fail(failure) } }
      // The shelf is a page of its own and floats above the modals the host
      // owns, so it carries the tokens of the reader's surfaces with it.
      const shopClass = visible ? 'sr-shop is-open' : 'sr-shop'
      return h('div', { className: `${shopClass} sr-float sr-float-page`, ref: shopRef,
        role: visible ? 'dialog' : undefined,
        'aria-modal': visible ? true : undefined, 'aria-label': t('shopTitle'),
        // Hidden, not unmounted: an attached guest cannot be re-attached, and a
        // suspended guest cannot answer a chapter request from the reader.
        style: visible ? undefined : { visibility: 'hidden', pointerEvents: 'none' } },
        h('div', { className: 'sr-shop-head' }, h('strong', null, t('shopTitle')),
          h('button', { type: 'button', className: 'sr-ibtn sr-btn', ref: closeButton,
            'aria-label': t('close'), onClick: close }, '✕')),
        h('p', { className: 'sr-shop-lead' }, t('shopHint')),
        h('div', { className: 'sr-shop-layout' },
          // The sites are tabs across the top, not a column beside the page:
          // a column took half the window and left the embedded page unreadable.
          // With no site yet there is nothing to be a tab, and the line above
          // already says what to do: an empty strip of tabs is a row of
          // nothing above the page.
          sites.length === 0
            ? null
            : h('div', { className: 'sr-shop-tabs', role: 'tablist', 'aria-label': t('shopSites') },
              sites.map(site => h('div', { key: site.id, className: 'sr-shop-tab' },
                h('button', { type: 'button', className: 'sr-shop-visit', disabled: busy,
                  role: 'tab', 'aria-selected': selected?.id === site.id,
                  'aria-pressed': selected?.id === site.id,
                  title: site.origin, 'aria-label': `${site.title} ${site.origin}`,
                  onClick: () => void openSite(site) },
                  h('strong', null, site.title),
                  h('span', { className: 'sr-shop-tab-origin' }, site.origin)),
                removeId === site.id
                  ? control(t('shopRemoveHint'), () => void removeSite(site), busy, t('confirmRemove'))
                  : control(t('remove'), () => setRemoveId(site.id), busy, '✕')))),
          // Adding a site is a rare act, so it lives behind a button instead of
          // a form that is always on screen.
          h('div', { className: 'sr-shop-addrow' },
            h('button', { type: 'button', className: 'sr-set-action',
              'aria-expanded': addOpen, onClick: () => setAddOpen(open => !open) },
              addOpen ? t('shopCancel') : t('shopAddSite')),
            h('form', { className: 'sr-shop-add', onSubmit: addSite, hidden: !addOpen },
              h('label', null, t('shopSiteUrl'), h('input', { className: 'sr-set-input', type: 'url',
                required: true, value: siteUrl, placeholder: 'https://example.com', maxLength: 2000,
                'aria-label': t('shopSiteUrl'), onChange: event => setSiteUrl(event.target.value) })),
              h('label', null, t('shopSiteName'), h('input', { className: 'sr-set-input', value: siteName,
                maxLength: 80, 'aria-label': t('shopSiteName'), onChange: event => setSiteName(event.target.value) })),
              h('button', { type: 'submit', className: 'sr-set-action', disabled: busy || siteUrl.trim() === '' }, t('shopAddSite')))),
          h('main', { className: 'sr-shop-main' },
            // This page is the way to a book that is not here yet: the
            // library of books already held is the catalog, one button away,
            // and repeating it here made a page that was two pages at once.
            h('form', { className: 'sr-shop-toolbar', onSubmit: navigate },
              control(t('shopBack'), safeNavigate(() => browser.back()), !browser.supported || !nav.canGoBack, '‹'),
              control(t('shopForward'), safeNavigate(() => browser.forward()), !browser.supported || !nav.canGoForward, '›'),
              control(t('shopReload'), safeNavigate(() => browser.reload()), !browser.supported || !selected, '↻'),
              h('input', { className: 'sr-set-input', type: 'url', value: address,
                'aria-label': t('shopAddress'), disabled: !browser.supported || !selected,
                onChange: event => setAddress(event.target.value) }),
              h('button', { type: 'submit', className: 'sr-set-action', disabled: !browser.supported || !selected }, t('shopGo')),
              // A page built for a wide screen is cut off here, and reading a
              // paragraph by scrolling sideways is not reading.
              control(t('shopZoomOut'), () => void applyZoom(zoom - 0.1),
                !browser.supported || !selected || zoom <= 0.4, '−'),
              control(t('shopZoomReset'), () => void applyZoom(1), !browser.supported || !selected,
                `${Math.round(zoom * 100)}%`),
              control(t('shopZoomIn'), () => void applyZoom(zoom + 0.1),
                !browser.supported || !selected || zoom >= 1.6, '+'),
              control(t('shopFit'), () => void browser.fitToWidth().catch(() => setError(t('shopBrowserError'))),
                !browser.supported || !selected || nav.loading, t('shopFit'))),
            h('div', { className: 'sr-shop-guest', ref: container }),
            !selected ? h('p', { className: 'sr-set-hint' }, t('shopSelect')) : null,
            !browser.supported ? h('div', { className: 'sr-note' }, t('shopDesktopOnly'),
              selected ? h('p', null, h('a', { href: selected.url, target: '_blank', rel: 'noopener noreferrer' }, t('shopOpenExternal'))) : null) : null,
            h('div', { className: 'sr-shop-actions' },
              control(t('shopIdentify'), () => void identify(), !selected || !browser.supported || busy || nav.loading),
              selected && browser.supported
                ? control(forgetId === selected.id ? t('shopForgetHint') : t('shopForget'),
                  () => forgetId === selected.id ? void disconnect() : setForgetId(selected.id), busy) : null),
            busy ? h('p', { role: 'status', className: 'sr-set-hint' }, t('shopIdentifying')) : null,
            error ? h('p', { role: 'alert', className: 'sr-set-error' }, error) : null,
            nav.error ? h('p', { role: 'alert', className: 'sr-set-error' }, t('shopBrowserError')) : null,
            note ? h('p', { role: 'status', className: 'sr-set-note' }, note) : null,
            added ? control(t('shopRead'), () => void readAdded(), busy) : null,
            preview ? h('section', { className: 'sr-shop-preview', 'aria-label': t('shopPreview') },
              h('h3', null, t('shopPreview')),
              h('strong', null, disguised ? t('shopPreviewNeutral') : preview.title),
              h('p', { className: 'sr-set-hint' }, t('chapters', { n: preview.chapterCount })),
              h('ol', null, (preview.sampleChapters || []).slice(0, 3).map((chapter, index) => h('li', { key: index },
                disguised ? t('sectionN', { n: index + 1 }) : chapter.title))),
              h('h4', null, t('shopSample')),
              // The sample is real chapter text: a disguise keeps it out of
              // the page and only says that a sample was checked.
              h('p', { className: 'sr-shop-sample' },
                disguised ? t('shopSampleNeutral') : (preview.sample || '')),
              (preview.warnings || []).length ? h('p', { className: 'sr-set-hint' }, t('shopRestricted')) : null,
              h('div', { className: 'sr-shop-actions' },
                control(t('shopConfirm'), () => void confirm(), busy),
                control(t('shopCancel'), () => setPreview(null), busy))) : null)),
        h('p', { className: 'sr-shop-privacy' }, t('shopPrivacy')))
    }

    // A page-local tab choice shared by every door into the settings: the
    // caller names the tab, so the page opens where the button promised. The
    // choice is deliberately not remembered: a button that says "books" and
    // then opens "reading" would be the same confusion in a new place.
    let settingsTabRequested = 'reading'
    function openSettings(tab) {
      if (typeof tab === 'string') settingsTabRequested = tab
      readerStore.set({ settingsOpen: true })
    }
    /**
     * Open the settings, or close them when they are already open.
     * @param {string} tab - the subject to open on
     * @returns {void}
     */
    function toggleSettings(tab) {
      if (readerStore.get().settingsOpen) readerStore.set({ settingsOpen: false })
      else openSettings(tab)
    }
    /**
     * Open one book and put the text back in front of the reader.
     *
     * Every door to a book ends here, so opening one always leaves the reader
     * on the text, in the shape it was in.
     *
     * @param {string} bookId - the book to read
     * @param {number} [index] - the chapter to open at
     * @returns {Promise<void>} resolves when the book is open
     */
    async function openBookById(bookId, index) {
      const ask = { bookId }
      if (Number.isInteger(index)) ask.index = index
      const data = await call('open', ask)
      const chapter = (data && data.chapter) || {}
      readerStore.set({
        bookId,
        index: Number(chapter.index) || 0,
        total: Number(chapter.total) || 0,
        bookTitle: chapter.bookTitle || '',
        chapterTitle: chapter.title || '',
        pickerOpen: false,
        settingsOpen: false,
        bookstoreOpen: false,
      })
      await placeReader(readerStore.get().placement === 'sidebar' ? 'sidebar' : 'strip')
    }

    /**
     * The list of books, with the chapters of each one.
     *
     * A book is opened by clicking its name, and its chapters are read by
     * opening the list beside it: a reader who knows which chapter they
     * want should not have to open the book and hunt for it.
     *
     * @param {{ books?: any[], compact?: boolean }} props - the books to draw
     * @returns {any} React element
     */
    function BookDirectory(props) {
      const books = Array.isArray(props && props.books) ? props.books : []
      const compact = !!(props && props.compact)
      const shared = useReaderState()
      const t = translator
      const [expanded, setExpanded] = React.useState(null)
      const [toc, setToc] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const disguised = shared.settings.skin !== 'plain'

      /**
       * The name of one book, the way the reader will see it.
       * @param {object} book - the book's record
       * @returns {string} the title
       */
      const titleOf = (book) => {
        const raw = String(book.title || '').trim()
        if (raw === '') return book.id
        const split = raw.split(/\s*作者[：:]\s*/u)
        return (split[0] || raw).trim()
      }
      /**
       * The author of one book, when the name carries one.
       * @param {object} book - the book's record
       * @returns {string} the author
       */
      const authorOf = (book) => {
        const split = String(book.title || '').split(/\s*作者[：:]\s*/u)
        return split.length > 1 ? split[1].trim() : ''
      }

      /**
       * Show or hide the chapters of one book.
       * @param {string} bookId - the book to list
       * @returns {Promise<void>} resolves when the list is known
       */
      const toggleToc = async (bookId) => {
        if (expanded === bookId) {
          setExpanded(null)
          setToc(null)
          return
        }
        setBusy(true)
        setError('')
        try {
          const data = await call('toc', { bookId })
          setToc((data && data.toc) || null)
          setExpanded(bookId)
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        } finally {
          setBusy(false)
        }
      }

      /**
       * Open one book, at one chapter if the reader named one.
       * @param {string} bookId - the book to read
       * @param {number} [index] - the chapter to open at
       * @returns {Promise<void>} resolves when the book is open
       */
      const open = async (bookId, index) => {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          await openBookById(bookId, index)
        } catch (failure) {
          setError(describeFailure(failure, t, false))
        } finally {
          setBusy(false)
        }
      }

      const rows = books.map((book, at) => {
        const title = disguised ? t('docN', { n: at + 1 }) : titleOf(book)
        const author = disguised ? '' : authorOf(book)
        const total = Number(book.chapters) || 0
        const fromWeb = book.origin === 'web'
        const openToc = expanded === book.id
        const chapters = openToc && toc && toc.bookId === book.id ? toc.chapters || [] : []
        return h('div', { key: book.id, className: 'sr-pick-book' },
          h('div', { className: 'sr-pick-row' },
            h('button', {
              type: 'button',
              className: 'sr-list-row sr-pick-open',
              title: disguised ? undefined : String(book.title || ''),
              'aria-label': title,
              disabled: busy,
              onClick: () => void open(book.id),
            },
              // The small facts on the left: who wrote it, how long it is.
              h('span', { className: 'sr-list-where' },
                author === '' ? null : h('span', null, author),
                total > 0 ? h('span', null, t('pickerChapters', { n: total })) : null,
                fromWeb && !disguised ? h('span', { className: 'sr-pick-web' }, t('shelfWeb')) : null),
              // The name on the right.
              h('span', { className: 'sr-list-text sr-list-text-clip' }, title)),
            // The chapters are one click from the book: a reader who knows
            // the chapter does not have to open the book to find it.
            total > 0 ? h('button', {
              type: 'button',
              className: 'sr-pick-toc',
              'aria-expanded': openToc,
              'aria-label': t('pickerContents'),
              title: t('pickerContents'),
              disabled: busy,
              onClick: () => void toggleToc(book.id),
            }, openToc ? '▴' : '▾') : null,
            h('span', { className: 'sr-pick-go' }, '›')),
          openToc ? h('ol', { className: 'sr-pick-chapters' }, chapters.map((entry) => h('li', {
            key: entry.index,
          },
          h('button', {
            type: 'button',
            className: 'sr-list-row sr-pick-chapter',
            disabled: busy,
            onClick: () => void open(book.id, entry.index),
          },
            h('span', { className: 'sr-list-where' }, t('sectionN', { n: entry.index + 1 })),
            h('span', { className: 'sr-list-text sr-list-text-clip' },
              disguised ? t('sectionN', { n: entry.index + 1 })
                : (entry.title !== '' ? entry.title : t('sectionN', { n: entry.index + 1 }))))))) : null)
      })

      return h('div', { className: compact ? 'sr-pick-directory sr-pick-directory-compact' : 'sr-pick-directory' },
        books.length === 0
          ? h('p', { className: 'sr-pick-empty' }, t('pickerEmpty'))
          : h('div', { className: 'sr-list-body sr-pick-list', ref: holdWheelRef }, rows),
        error === '' ? null : h('p', { role: 'alert', className: 'sr-set-error' }, error))
    }

    /**
     * The book catalog: the list of books, with a search, and one click to
     * read one.
     *
     * It is drawn in the place of the text, so it is a page of its own: the
     * reader opens it, picks a book, and the text is back. The list is read
     * from the host when the page opens, so it is the library itself and not
     * a copy that can go stale.
     *
     * @param {{ variant?: string }} props - where the page is mounted
     * @returns {any} React element
     */
    function BookPicker(props) {
      const variant = props && props.variant === 'sidebar' ? 'sidebar' : 'overlay'
      const shared = useReaderState()
      const t = translator
      const [term, setTerm] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const disguised = shared.settings.skin !== 'plain'
      const books = shared.books || []
      const pickerRef = React.useRef(null)
      // The overlay is closed by a click on the empty area around it, the
      // way every other surface of the reader is.
      React.useEffect(() => {
        if (variant === 'sidebar') return undefined
        const node = pickerRef.current
        if (node === null || node === undefined) return undefined
        return closeOnOutside(node, closePicker)
      }, [variant])
      // Escape closes the catalog, and it closes only the catalog: the panel
      // underneath must not go with it, or one keystroke would throw away the
      // page and the settings at once. The press is caught before the host
      // owns it, so the panel stays until the catalog is gone.
      React.useEffect(() => (variant === 'sidebar' ? undefined : escapeLayers.push(closePicker)), [variant])

      // The page reads the library itself: it may be the only surface that is
      // open, and a stale list would be a chooser that cannot choose.
      React.useEffect(() => {
        let alive = true
        void call('state').then((data) => {
          if (!alive) return
          readerStore.set({ books: (data && data.books) || [] })
        }).catch(() => {})
        return () => { alive = false }
      }, [])

      /**
       * The name of one book, the way the reader will see it.
       * @param {object} book - the book's record
       * @returns {string} the title
       */
      const titleOf = (book) => {
        const raw = String(book.title || '').trim()
        if (raw === '') return book.id
        const split = raw.split(/\s*作者[：:]\s*/u)
        return (split[0] || raw).trim()
      }
      /**
       * The author of one book, when the name carries one.
       * @param {object} book - the book's record
       * @returns {string} the author
       */
      const authorOf = (book) => {
        const raw = String(book.title || '')
        const split = raw.split(/\s*作者[：:]\s*/u)
        return split.length > 1 ? split[1].trim() : ''
      }

      const needle = term.trim().toLowerCase()
      const shown = needle === ''
        ? books
        : books.filter((book) => `${titleOf(book)} ${authorOf(book)}`.toLowerCase().includes(needle))

      return h('div', {
        className: variant === 'sidebar'
          ? 'sr-picker sr-picker-sidebar'
          : 'sr-picker sr-float sr-float-page',
        ref: pickerRef,
        role: 'dialog',
        'aria-label': t('pickerTitle'),
      },
        h('style', null, CSS),
        h('div', { className: 'sr-list-head sr-pick-head' },
          h('strong', null, t('pickerTitle')),
          // One book is not "1 books".
          h('span', { className: 'sr-match-count' },
            t(books.length === 1 ? 'booksOne' : 'booksN', { n: books.length })),
          h('button', {
            type: 'button', className: 'sr-ibtn sr-btn', 'aria-label': t('close'),
            onClick: closePicker,
          }, '✕')),
        h('p', { className: 'sr-pick-hint' }, t('pickerHint')),
        h('div', { className: 'sr-list-tools sr-pick-tools' },
          h('input', {
            type: 'search', className: 'sr-set-input', value: term,
            placeholder: t('pickerSearch'), 'aria-label': t('pickerSearch'),
            onChange: (event) => setTerm(event.target.value),
          }),
          h('button', {
            type: 'button', className: 'sr-set-action',
            onClick: () => { closePicker(); openSettings('library') },
          }, t('pickerAdd'))),
        books.length === 0
          ? h('p', { className: 'sr-pick-empty' }, t('pickerEmpty'))
          : (shown.length === 0
            ? h('p', { className: 'sr-pick-empty' }, t('pickerNoMatch'))
            : h(BookDirectory, { books: shown })))
    }

    /**
     * Open the book catalog, or close it when it is already open.
     *
     * The catalog is a page of its own: a reader who wants a different book
     * should not have to walk through the settings to find one.
     *
     * @returns {void}
     */
    function togglePicker() {
      if (readerStore.get().pickerOpen) readerStore.set({ pickerOpen: false })
      else readerStore.set({ pickerOpen: true, pickerFloating: false, settingsOpen: false })
    }

    /**
     * Close the catalog, wherever it is drawn.
     *
     * @returns {void}
     */
    function closePicker() {
      readerStore.set({ pickerOpen: false, pickerFloating: false })
    }

    /**
     * Open the catalog as a page that floats above the window.
     *
     * The Harness settings live in a modal of their own, and a catalog drawn
     * inside the application sits under that modal. Opened from there, the
     * catalog floats above it instead, so the settings stay where they are.
     *
     * @returns {void}
     */
    function openFloatingPicker() {
      readerStore.set({ pickerFloating: true, pickerOpen: false, settingsOpen: false })
    }

    let bookstoreTrigger = null
    function openBookstore() {
      bookstoreTrigger = typeof document === 'undefined' ? null : document.activeElement
      readerStore.set({ bookstoreOpen: true })
    }
    function closeBookstore() {
      readerStore.set({ bookstoreOpen: false })
      // The trigger may have been in a panel that is no longer mounted.
      const trigger = bookstoreTrigger
      bookstoreTrigger = null
      if (trigger && typeof trigger.focus === 'function' && trigger.isConnected !== false) trigger.focus()
    }
    function shopFailure(failure, t) {
      const code = failure && typeof failure.code === 'string' ? failure.code : ''
      // Codes are grouped by what the reader can do next, not by where they
      // were raised: sign in again, return to the site, retry, or stop.
      if (['browserRequired', 'browserWrongSite', 'browserCaptureDenied', 'noSite', 'siteOrigin',
        'browserUnsafeLoginURL', 'browserLoading'].includes(code)) return t('shopBrowserNeeded')
      if (['browserUnsupported', 'browserContainerRequired', 'browserMountConflict', 'browserDisposed',
        'browserCaptureUnsupported', 'browserNavigationUnsupported', 'browserSecureRandomRequired'].includes(code)) {
        return t('shopDesktopOnly')
      }
      if (['browserBusy', 'browserExecutionTimeout', 'browserAttachFailed', 'browserAcquireFailed',
        'browserInvalidReservation', 'browserNavigationFailed', 'browserInvalidSnapshot'].includes(code)) return t('shopBrowserError')
      if (['browserCancelled'].includes(code)) return t('shopFailed')
      if (['browserInvalidURL', 'browserSensitiveURL', 'invalidSite', 'invalidSiteUrl', 'invalidUrl',
        'unsafeCredential', 'siteCookie'].includes(code)) return t('shopUnsafe')
      if (['emptyChapter', 'unreadablePage', 'httpError', 'unknownChapter', 'pageTooLarge', 'invalidPages'].includes(code)) {
        return t('shopRestricted')
      }
      if (['noCatalog', 'notFound'].includes(code)) return t('shopFailed')
      if (['previewExpired'].includes(code)) return t('shopExpired')
      if (code === 'network') return t('errNetwork')
      return t('shopFailed')
    }

    /**
     * The overlay surface: the settings page, and the panel when the reader
     * is set to float.
     *
     * The settings page is drawn above everything else, so it is available
     * from every placement.
     *
     * @returns {any} React element
     */
    /**
     * The list the composer card opened, drawn over the window.
     *
     * The composer cuts off anything that grows out of it, so the list is
     * drawn in the overlay layer, over the card that opened it. The list is
     * either the places a search found or the chapters of the book, and the
     * reader picks the one that was meant; the card goes there.
     *
     * @returns {any} React element
     */
    function StripPopup() {
      const shared = useReaderState()
      const t = React.useMemo(() => translator, [])
      // The hooks are taken before anything is returned, the way React
      // asks: a component that took one hook once and two hooks another
      // time would break the tree it belongs to.
      const boxRef = React.useRef(null)
      const state = shared.stripPopup
      React.useEffect(() => {
        const node = boxRef.current
        if (node === null || node === undefined) return
        if (typeof node.focus === 'function') node.focus()
        // A click anywhere else closes the list, so it never sits over the
        // page after the reader has moved on.
        return closeOnOutside(node, () => readerStore.set({ stripPopup: null }))
      }, [state])
      // Escape closes the list, the way it closes every other layer.
      React.useEffect(() => {
        if (state === null || state === undefined) return undefined
        return escapeLayers.push(() => readerStore.set({ stripPopup: null }))
      }, [state])
      // The list of the chapters opens at the chapter being read, and takes
      // the focus so the keyboard does not lose its place.
      React.useEffect(() => {
        if (state === null || state === undefined || state.kind !== 'toc') return
        const node = boxRef.current
        if (node === null || node === undefined) return
        const current = node.querySelector('.sr-list-row.is-current')
        if (current !== null && typeof current.scrollIntoView === 'function') {
          current.scrollIntoView({ block: 'center' })
        }
        const first = node.querySelector('.sr-list-row')
        if (first !== null && typeof first.focus === 'function') first.focus()
      }, [state])
      if (state === null || state === undefined) return null
      const disguised = (shared.settings.skin || 'log') !== 'plain'
      const label = (real, neutral) => (disguised ? neutral : real)
      // The frame is the shared one, so no geometry is computed here: the
      // stylesheet puts every popup on the same line at the same width. The
      // rect the card measured is no longer needed for placement.
      const close = () => readerStore.set({ stripPopup: null })
      const title = state.kind === 'toc'
        ? label(t('toc'), t('neutralList'))
        : label(t('searchResults'), t('neutralResults'))
      const list = state.kind === 'toc'
        ? h('div', { className: 'sr-list-body', ref: holdWheelRef },
          chapterRows(state.chapters, {
            onPick: (entry) => {
              close()
              readerStore.set({ stripPick: { kind: 'toc', index: entry.index } })
            },
            current: state.current,
            disguised,
            t,
          }))
        : h('div', { className: 'sr-list-body', ref: holdWheelRef },
          searchHitRows(state.places, {
            onPick: (place) => {
              close()
              // The card goes to the place the reader picked.
              readerStore.set({ stripPick: { kind: 'search', place } })
            },
            disguised,
            term: state.term,
            t,
          }))
      return h('div', {
        className: 'sr-strip-popup',
        ref: boxRef,
        tabIndex: -1,
        role: 'dialog',
        'aria-label': title,
      },
        h('div', { className: 'sr-list-head' },
          h('strong', null, title),
          state.kind === 'toc'
            ? h('span', { className: 'sr-match-count' }, t('sectionsN', { n: state.chapters.length }))
            : h('span', { className: 'sr-match-count' }, t('matches', { n: state.places.length })),
          h('button', {
            className: 'sr-ibtn sr-btn', type: 'button',
            title: t('close'), 'aria-label': t('close'),
            onClick: close,
          }, '✕')),
        list)
    }
    function OverlaySurface() {
      const shared = useReaderState()
      // The placement decides which surface the reader is drawn on, so it has
      // to be known even when the panel is not mounted here. The overlay is
      // the one surface that is always there, so it is the one that asks.
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const data = await call('state')
            if (!alive) return
            if (data.settings && typeof data.settings === 'object') {
              readerStore.set({ settings: { ...readerStore.get().settings, ...data.settings } })
            }
            // The panel mounted and answered, so the faults of an earlier
            // build are stale. A build that works leaves no fault behind.
            void call('clearFaults').catch(() => {})
          } catch {
            // The host may not be ready yet; the panel asks again.
          }
        }
        void load()
        return () => { alive = false }
      }, [])
      // Two shapes only: the side column and the composer strip. The
      // overlay carries nothing but the settings page, which every shape
      // opens.
      // The pages that float above the window are drawn beside the
      // application's root: the overlay layer lives inside the root, and a
      // page inside it sits under every modal the host owns — the settings
      // panel among them. The list the composer opened stays in the layer,
      // because the composer is what it belongs to.
      return h('div', { className: 'sr-root sr-float' },
        h('style', null, CSS),
        // The panel draws the settings itself whenever it is on screen, so the
        // overlay only covers the case where no panel is mounted.
        shared.settingsOpen && !shared.visible && shared.placement !== 'sidebar'
          ? floatAbove(h(SettingsPage, { variant: 'overlay' }))
          : null,
        // The catalog is a page of its own too, and it belongs next to the
        // text rather than inside the settings. A catalog opened from the
        // Harness settings belongs to that panel, and the panel draws it.
        shared.pickerOpen && !shared.visible && shared.placement !== 'sidebar'
          ? floatAbove(h(BookPicker, { variant: 'overlay' }))
          : null,
        // The list the composer card opened: the places a search found, or
        // the chapters of the book. It is drawn here, over the window,
        // because the composer cuts off anything that grows out of it.
        h(StripPopup),
        floatAbove(h(BookstoreSurface)))
    }

    /**
     * The sidebar surface: the panel, when the reader is set to the sidebar.
     *
     * The sidebar draws the tab itself, so the body only has to carry the
     * reading surface.
     *
     * @returns {any} React element
     */
    function SidebarSurface(props) {
      const shared = useReaderState()
      // Slot runtime exposes the current occurrence through useTabInfo. Its
      // close action targets this tab/session, unlike closing the whole bar.
      const info = props && typeof props.useTabInfo === 'function' ? props.useTabInfo() : null
      const tab = info && info.tab
      const occurrence = React.useRef(null)
      const signal = tab && tab.signal
      if (!occurrence.current) occurrence.current = { current: tab, mounted: true, release: () => {} }
      occurrence.current.current = tab
      React.useEffect(() => {
        const key = signal || occurrence.current
        let entry = sidebarTabs.get(key)
        if (!entry) {
          entry = occurrence.current
          sidebarTabs.set(key, entry)
          const onClosed = () => {
            sidebarTabs.delete(key)
            // A signal ends when the actual tab record disappears, not when
            // another tab is selected or this React body is temporarily gone.
            if (activeSidebarSignal !== signal || readerStore.get().placement !== 'sidebar') return
            activeSidebarSignal = null
            readerStore.set({ placement: 'strip', hidden: false })
            void call('settings', { patch: { placement: 'strip' } }).catch(() => {})
          }
          entry.release = () => signal?.removeEventListener('abort', onClosed)
          if (signal && !signal.aborted) signal.addEventListener('abort', onClosed, { once: true })
        }
        entry.current = tab
        entry.mounted = true
        occurrence.current = entry
        return () => {
          // Hiding/unmounting is not closing. Keep the real lifetime listener
          // until abort or plugin disposal, including while a tab is inactive.
          entry.mounted = false
          if (!signal) sidebarTabs.delete(key)
        }
      }, [signal])
      React.useEffect(() => {
        // A manual open/re-navigation is an explicit request for this surface.
        // There is deliberately no placement->close watcher here.
        if (tab && (tab.visible === false || signal?.aborted)) return
        activeSidebarSignal = signal || null
        readerStore.set({ placement: 'sidebar', hidden: false, visible: false })
        void call('settings', { patch: { placement: 'sidebar' } }).catch(() => {})
      }, [tab && tab.visible, tab && tab.navigation && tab.navigation.revision, signal])
      // A retained/inactive tab can outlive the switch or close request. Never
      // leave its reading contents visible alongside the composer card.
      return h('div', {
        className: 'sr-sidebar-surface',
        hidden: shared.placement !== 'sidebar',
        style: { display: shared.placement === 'sidebar' ? 'flex' : 'none', height: '100%', minHeight: 0, flexDirection: 'column' },
      }, h(ReaderRoot, { variant: 'sidebar' }))
    }

    /**
     * The lines of one chapter.
     *
     * The host sends the chapter as one block of text, so the lines are cut
     * here — the same way the panel cuts them, so the strip and the panel
     * count the same lines.
     *
     * @param {any} chapter - the chapter payload
     * @returns {string[]} the lines of the chapter
     */
    /**
     * Close a surface when the reader clicks outside it.
     *
     * The ✕ is one way out of a surface, and it is not the only one: a click
     * on the empty area around a surface says the same thing. Every surface
     * of the reader is closed this way, so the reader learns it once.
     *
     * The press is read on the document, in the capture phase, so it is
     * heard before the surface's own buttons act on it.
     *
     * @param {any} element - the surface
     * @param {() => void} close - what closes the surface
     * @returns {() => void} the listener leaves the document
     */
    function closeOnOutside(element, close) {
      if (element === null || element === undefined) return () => {}
      if (typeof document === 'undefined' || !document.addEventListener) return () => {}
      const onDown = (event) => {
        const target = event && event.target
        if (target && typeof element.contains === 'function' && element.contains(target)) return
        close()
      }
      document.addEventListener('mousedown', onDown, true)
      return () => document.removeEventListener('mousedown', onDown, true)
    }

    /**
     * Draw a surface beside the application's root.
     *
     * The frame's overlay layer lives inside the root, so a surface in it
     * sits under every modal the host owns — the settings panel among them.
     * A surface that has to float above such a modal is drawn beside the
     * root instead, the way the host draws its own modals.
     *
     * @param {any} node - the surface
     * @returns {any} the node, drawn beside the root when the renderer allows it
     */
    function floatAbove(node) {
      if (ReactDOM === null || typeof ReactDOM.createPortal !== 'function') return node
      if (typeof document === 'undefined' || !document.body) return node
      try { return ReactDOM.createPortal(node, document.body) } catch { return node }
    }

    /**
     * Keep the wheel inside a list, and the page still.
     *
     * A list that has reached its end hands the wheel to the page behind
     * it, and the page scrolls away under a surface that is still open. The
     * wheel is taken at the end of the list, so the page stays where it is.
     *
     * The listener is not passive, because a passive listener cannot keep
     * the wheel.
     *
     * @param {any} node - the list
     * @returns {void}
     */
    function holdWheel(node) {
      if (node === null || node === undefined) return
      if (typeof node.addEventListener !== 'function') return
      const handler = (event) => {
        const delta = event.deltaY > 0 ? 1 : -1
        const atEnd = delta > 0
          ? node.scrollTop + node.clientHeight >= node.scrollHeight - 1
          : node.scrollTop <= 0
        if (!atEnd) return
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
      }
      node.addEventListener('wheel', handler, { passive: false })
    }

    /**
     * Take the node of a list and keep the wheel inside it.
     *
     * @param {any} node - the list
     * @returns {void}
     */
    function holdWheelRef(node) {
      holdWheel(node)
    }

    function chapterLines(chapter) {
      if (!chapter || typeof chapter.text !== 'string') return []
      return chapter.text.split('\n').filter(line => line.trim() !== '')
    }

    /**
     * The chapter as one flow of text.
     *
     * The card is narrow, so a line of the file is not a line on the screen.
     * The text is joined into one paragraph that wraps to the width it is
     * given, which is what makes it fill the card instead of leaving ragged
     * gaps at the end of every file line.
     *
     * @param {any} chapter - the chapter payload
     * @returns {string} the chapter as one paragraph
     */
    /**
     * How many rendered lines a run of text takes at the card's width.
     *
     * The card wraps one paragraph, so a line of the file is not a line on
     * screen. This measures the real box the browser gives the text, which is
     * the only way a page can end exactly where the last visible line ends.
     *
     * @param {HTMLElement | null} element - the text node's element
     * @param {string} text - the run to measure
     * @returns {number} wrapped line count, or 0 when it cannot be measured
     */
    function renderedLines(element, text) {
      if (element === null || typeof element.getClientRects !== 'function') return 0
      if (typeof text !== 'string' || text === '') return 0
      const probe = element.cloneNode(false)
      // The probe is laid out at the same width but kept out of the flow, so
      // measuring never moves what the reader is looking at.
      probe.textContent = text
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.pointerEvents = 'none'
      probe.style.left = '-9999px'
      probe.style.top = '0'
      probe.style.width = `${element.clientWidth}px`
      probe.style.height = 'auto'
      probe.style.webkitLineClamp = 'unset'
      probe.style.overflow = 'visible'
      probe.style.margin = '0'
      const parent = element.parentNode
      if (parent === null) return 0
      parent.appendChild(probe)
      let lines = 0
      try {
        const style = window.getComputedStyle(probe)
        const height = probe.getBoundingClientRect().height
        // `line-height: normal` computes to the string "normal", which parses
        // to NaN. Treating that as "cannot measure" made the caller take the
        // whole chapter as one page, so a single wheel notch jumped to the end
        // of it. The font size is a usable stand-in: normal is about 1.2 of it.
        const declared = Number.parseFloat(style.lineHeight)
        const fontSize = Number.parseFloat(style.fontSize)
        const lineHeight = declared > 0
          ? declared
          : (fontSize > 0 ? fontSize * 1.2 : 0)
        lines = lineHeight > 0 ? Math.round(height / lineHeight) : 0
      } catch {
        // A failed measurement leaves the caller on its fallback.
        lines = 0
      } finally {
        probe.remove()
      }
      return lines > 0 ? lines : 0
    }

    /**
     * The character offset that ends exactly one page of rendered lines.
     *
     * A page must hold the whole of its last visible line, so the reader never
     * loses the end of a line between pages. The search is a binary search on
     * the rendered line count, which is monotonic in the prefix length.
     *
     * @param {HTMLElement | null} element - the text node's element
     * @param {string} text - the whole flow
     * @param {number} start - where the page starts
     * @param {number} lines - how many lines a page holds
     * @returns {number} end offset, or -1 when it cannot be measured
     */
    /**
     * The page end for one exact situation, remembered.
     *
     * A page turn re-renders the card more than once, and the binary search
     * below forces a layout on every step. Eleven forced layouts per render
     * is felt as a stutter on the wheel, so the answer is kept for as long as
     * everything it depends on stays the same: the text, the place, the line
     * count and the width it was measured at.
     *
     * @type {{key: string, value: number} | null}
     */
    let pageEndCache = null

    function pageEnd(element, text, start, lines) {
      if (element === null || lines <= 0) return -1
      // An element that cannot be measured at all leaves the step to the
      // caller's own fallback.
      if (typeof element.getClientRects !== 'function') return -1
      // Everything the answer depends on. The text is identified by its
      // length and a sample, so a different chapter never hits this.
      const width = element.clientWidth
      // The typography moves every line without changing the text, the place
      // or the width, so it belongs in the key.
      const style = window.getComputedStyle(element)
      const key = `${lines}|${width}|${start}|${text.length}|${style.fontSize}|${style.lineHeight}|${text.slice(start, start + 24)}`
      if (pageEndCache !== null && pageEndCache.key === key) return pageEndCache.value
      const remember = (value) => {
        pageEndCache = { key, value }
        return value
      }
      if (renderedLines(element, text.slice(start)) <= lines) return remember(text.length)
      let low = 0
      let high = text.length - start
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        const count = renderedLines(element, text.slice(start, start + middle))
        if (count <= lines) low = middle
        else high = middle - 1
      }
      return remember(start + low)
    }

    function chapterFlow(chapter) {
      const lines = chapterLines(chapter)
      return lines.map(line => line.trim()).filter(line => line !== '').join(' ')
    }

    /**
     * The strip: a small quiet mark above the composer card that opens one
     * or two lines of the text.
     *
     * The strip is the reader's own surface: the text is read here, a line at
     * a time, with the wheel. It stays out of the way — the mark is low
     * contrast and small — and it never takes part in the composer's layout,
     * so the input box never moves.
     *
     * @returns {any} React element
     */
    const stripToolbarRef = { current: null }
    function StripToolbarEntry() {
      const shared = useReaderState()
      if (shared.placement !== 'strip' || shared.hidden) return null
      const open = () => readerStore.set({ stripOpenRequest: (readerStore.get().stripOpenRequest || 0) + 1 })
      return h('span', { className: 'sr-strip sr-strip-toolbar' },
        h('style', null, CSS),
        h('button', { type: 'button', className: 'sr-ibtn sr-strip-mark', ref: stripToolbarRef,
          title: translator('stripHint'), 'aria-label': translator('stripExpand'),
          onClick: open,
        }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        }, h('path', { d: 'M5 7h14M5 12h14M5 17h9' }))))
    }

    function StripEntry() {
      const shared = useReaderState()
      const [expanded, setExpanded] = React.useState(true)
      const [documentNumber, setDocumentNumber] = React.useState(0)
      const [chapter, setChapterState] = React.useState(null)
      // Three things can be true at once, and the card says a different
      // thing for each: the library has not answered yet, the library has
      // no book at all, or a book is open and its text is on its way.
      const [libraryState, setLibraryState] = React.useState('loading')
      const [line, setLine] = React.useState(0)
      // Where the page ends, as it was measured the last time the text was on
      // screen. The card folds by unmounting its text, so the element the
      // measurement needs is gone while the card is away; the measurement is
      // kept, and the text is measured again as soon as the card is back.
      const [pageEndAt, setPageEndAt] = React.useState(null)
      // The shared reader is the one source of truth, so the card reloads
      // when the panel turns a chapter or opens another book.
      const sharedIndex = shared.index
      const sharedBook = shared.bookId
      const sharedTotal = shared.total
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      // The card itself, so the list of the places can be opened over it.
      const rootRef = React.useRef(null)
      // The search in the book: the card can be put on any place the term
      // was found, so a reader who remembers a line finds it again.
      const [searchOpen, setSearchOpen] = React.useState(false)
      const [term, setTerm] = React.useState('')
      // The places the last search found, kept outside the state so the
      // list can be opened again without waiting for a render.
      const searchRef = React.useRef({ term: '', places: [] })
      const buttonRef = React.useRef(null)
      const searchInputRef = React.useRef(null)
      const returnFocusRef = React.useRef(false)
      // The footer row is drawn in one of four shapes, and the shape follows
      // the width the row is actually given.
      const footRef = React.useRef(null)
      const footObserverRef = React.useRef(null)
      const [rowTier, setRowTier] = React.useState('wide')
      const foldByUser = React.useCallback(() => {
        returnFocusRef.current = true
        setExpanded(false)
      }, [])
      // The row measures itself, so the card keeps every control it can hold
      // and moves the rest into the overflow button. The observer follows the
      // row itself: folding the card replaces the row, and the new row has to
      // be measured as well.
      const observeFoot = React.useCallback(node => {
        if (footObserverRef.current !== null) {
          footObserverRef.current.disconnect()
          footObserverRef.current = null
        }
        footRef.current = node
        if (node === null || node === undefined) return
        if (typeof ResizeObserver !== 'function') return
        const observer = new ResizeObserver(() => {
          const tier = rowTierFor(node.clientWidth)
          setRowTier(previous => (previous === tier ? previous : tier))
        })
        observer.observe(node)
        footObserverRef.current = observer
      }, [])

      // A search that was open when the card became too narrow for it closes
      // itself, so the row never has to hold a field it cannot fit.
      React.useEffect(() => {
        if (rowTier === 'micro' && searchOpen) setSearchOpen(false)
      }, [rowTier, searchOpen])

      // The search field takes the focus as soon as it opens, so the reader can
      // type right away instead of clicking the field first.
      React.useEffect(() => {
        if (!searchOpen) return
        const node = searchInputRef.current
        if (node === null || node === undefined) return
        if (typeof node.focus === 'function') node.focus()
        if (typeof node.select === 'function') node.select()
      }, [searchOpen])

      React.useEffect(() => {
        if (expanded || !returnFocusRef.current || shared.placement !== 'strip' || shared.hidden) return
        returnFocusRef.current = false
        // The bar ref does not exist until the folded render has committed.
        const trigger = shared.settings.cardFoldedShape === 'bar' ? buttonRef.current : stripToolbarRef.current
        if (trigger?.isConnected !== false && typeof trigger?.focus === 'function') trigger.focus()
      }, [expanded, shared.placement, shared.hidden, shared.settings.cardFoldedShape])
      // The text element, so a page can be measured against the width it is
      // actually drawn at.
      const lineRef = React.useRef(null)
      const hideTimerRef = React.useRef(null)
      const editingRef = React.useRef(false)
      // The frame a wheel turn is waiting for, and the notches gathered
      // while it waits.
      const wheelFrameRef = React.useRef(null)
      const wheelDirRef = React.useRef(0)
      const t = React.useMemo(() => translator, [])

      // A disguise must not name the book, the chapter or the text, so the
      // strip shows a number instead of a title.
      const disguised = shared.settings.skin !== 'plain'
      // A disguise skin hides the identity, so its control names stay
      // in-world.
      const label = (real, neutral) => (disguised ? neutral : real)

      const show = React.useCallback(() => {
        if (hideTimerRef.current !== null) {
          clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
        setExpanded(true)
      }, [])
      React.useEffect(() => {
        if (shared.stripOpenRequest) show()
      }, [shared.stripOpenRequest, show])

      /**
       * Fold the card away once the pointer has left it.
       *
       * The wait is short: a card that lingers over the text is in the way,
       * and the reader who wants it back moves the pointer over the mark.
       *
       * @returns {void}
       */
      const scheduleHide = React.useCallback(() => {
        if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current)
        // A card that may not fold never schedules a fold, so a switch turned
        // off mid-wait does not fold it a moment later.
        if (shared.settings.cardFoldable === false) return
        // Leaving with the mouse must not collapse a search field being edited.
        if (editingRef.current) return
        // The list of the places is drawn over the card, so the card stays
        // open while the reader is choosing one.
        if (readerStore.get().stripPopup !== null) return
        // Only an auto card puts itself away. A manual card waits for its fold
        // button, and a never card stays open until the reader closes it.
        const mode = ['manual', 'auto', 'never'].includes(shared.settings.cardFoldMode)
          ? shared.settings.cardFoldMode
          : 'manual'
        if (mode !== 'auto') return
        const wanted = Number(shared.settings.cardFoldDelay)
        const wait = Number.isFinite(wanted)
          ? Math.min(Math.max(wanted, MIN_FOLD_DELAY), MAX_FOLD_DELAY)
          : DEFAULT_FOLD_DELAY
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null
          const live = readerStore.get()
          if (editingRef.current || live.stripPopup !== null || live.settings.cardFoldable === false
            || live.settings.cardFoldMode !== 'auto') return
          setExpanded(false)
        }, wait)
      }, [shared.settings.cardFoldMode, shared.settings.cardFoldDelay, shared.settings.cardFoldable])
      React.useEffect(() => {
        if (hideTimerRef.current !== null) {
          clearTimeout(hideTimerRef.current)
          hideTimerRef.current = null
        }
      }, [shared.settings.cardFoldMode, shared.settings.cardFoldDelay, shared.settings.cardFoldable])

      React.useEffect(() => () => {
        if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current)
        // A turn waiting for a frame must not run after the card is gone.
        if (wheelFrameRef.current !== null) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wheelFrameRef.current)
          else clearTimeout(wheelFrameRef.current)
          wheelFrameRef.current = null
        }
      }, [])

      // How many lines a page holds is the reader's choice. It is read here,
      // above the callbacks that page with it, and above the early returns
      // below: a folded card returns before the body is drawn, but its move
      // and its wheel are still on record and still reach for this number. A
      // `const` declared after the return was never initialised on those
      // renders, so the first wheel over a card that had been folded threw
      // "Cannot access 'visibleLines' before initialization" and neither the
      // wheel nor the arrow keys could turn a page again.
      const visibleLines = Number(shared.settings.stripLines) > 0
        ? Math.min(Math.max(Math.round(Number(shared.settings.stripLines)), 1), 8)
        : DEFAULT_LINES

      // Measure the page as soon as the card is on screen.
      //
      // The card is drawn from the text that is already there, so the first
      // frame after the card comes back has no measurement to draw from: the
      // text would be the whole remainder of the chapter, and the clamp would
      // cut it in the middle of a line. The measurement is taken before the
      // browser paints, so the reader sees the page and not the cut.
      useLayout(() => {
        if (!expanded) return
        const text = chapterFlow(chapter)
        const start = placeIn(text, line)
        const end = pageEnd(lineRef.current, text, start, visibleLines)
        if (end < 0) return
        setPageEndAt(previous => {
          if (previous && previous.start === start && previous.length === text.length
            && previous.lines === visibleLines && previous.value === end) return previous
          return { start, length: text.length, lines: visibleLines, value: end }
        })
      }, [expanded, chapter, line, visibleLines])

      /**
       * Load the book the reader is on, and the text of the chapter it is
       * in.
       *
       * @returns {Promise<void>} resolves when the strip holds the text
       */
      const load = React.useCallback(async () => {
        try {
          const data = await call('state')
          const current = data.current
          if (!current || !current.bookId) {
            setDocumentNumber(0)
            setChapterState(null)
            setLibraryState('empty')
            return
          }
          // A disguise numbers the documents the way the library does: by
          // their place in the list, never by their name.
          const at = (data.books || []).findIndex(item => item.id === current.bookId)
          setDocumentNumber(at + 1)
          setLibraryState('open')
          const remembered = data.positions && data.positions[current.bookId]
          const next = await call('chapter', { bookId: current.bookId, index: current.index })
          setChapterState(next.chapter)
          // The card counts the text in its own characters, so it reads its
          // own place and not the panel's line. A place belongs to the
          // chapter it was measured in, so a place from another chapter is
          // not a place here: the card would open in the middle of a
          // sentence that was never there.
          const sameChapter = remembered !== null && remembered !== undefined
            && Number.isInteger(remembered.index) && remembered.index === current.index
          setLine(sameChapter && Number.isInteger(remembered.flow) ? remembered.flow : 0)
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguised))
        }
      }, [t, disguised])

      React.useEffect(() => {
        void load()
      }, [load, sharedBook, sharedIndex, sharedTotal])

      /**
       * The place inside the chapter, held inside the text.
       *
       * The place is a number of characters in one chapter. A place that
       * was measured in another chapter can be past the end of this one, and
       * a place past the end makes a page turn backwards instead of
       * forwards: the reader cannot move on.
       *
       * @param {string} flow - the whole text of the chapter
       * @param {number} line - the place
       * @returns {number} the place, inside the text
       */
      const placeIn = React.useCallback((flow, line) => {
        const at = Number.isInteger(line) ? line : 0
        if (at <= 0) return 0
        if (at > flow.length) return flow.length
        return at
      }, [])

      /**
       * Move the reader one line forward or back.
       *
       * A line past the end of the chapter is the first line of the next
       * chapter, and a line before the first is the last line of the one
       * before, so the text never stops at a chapter edge.
       *
       * @param {number} delta - the direction
       * @returns {Promise<void>} resolves when the new place is known
       */
      // The page is a number of rendered lines, not a number of characters:
      // a character count can end in the middle of a line, and the rest of
      // that line was then skipped. What is drawn is what a page holds.
      const step = 0

      const move = React.useCallback(async (delta) => {
        if (chapter === null || busy) return
        // The text is one flow, so the place in it is a character offset.
        // The step is one screenful of the card, so the text fills the card
        // and a step is what the reader actually sees.
        const flow = chapterFlow(chapter)
        // The place is held inside the chapter, so a place from another
        // chapter cannot leave the reader past the end of this one.
        const here = placeIn(flow, line)
        // The page is measured, so one step is exactly one screen of text: the
        // next page starts at the character after the last one drawn. A step
        // is at least one character, so the end of a chapter is not a dead
        // end and the wheel can always go back.
        const pageSize = pageEnd(lineRef.current, flow, here, visibleLines)
        const span = pageSize >= 0 ? Math.max(pageSize - here, 1) : Math.max(step, 1)
        const target = here + delta * span
        if (target >= 0 && target < flow.length) {
          setLine(target)
          void call('position', {
            bookId: chapter.bookId,
            index: chapter.index,
            total: chapter.total,
            flow: target,
            mode: 'strip',
          }).catch(() => {})
          return
        }
        // The chapter ran out: the next chapter starts where this one ended.
        const index = chapter.index + (delta > 0 ? 1 : -1)
        if (index < 0 || index >= chapter.total) return
        setBusy(true)
        try {
          const data = await call('open', { bookId: chapter.bookId, index })
          setChapterState(data.chapter)
          const next = chapterFlow(data.chapter)
          // Going back lands at the end of the chapter before, so a step
          // back from the start is the last screenful of that chapter.
          // Going back lands at the end of the chapter before, so a step back
          // from the start is the last screenful of that chapter. It lands
          // inside the chapter, because a place past the end is a place
          // that cannot be read from.
          setLine(delta > 0 ? 0 : Math.max(next.length - 1, 0))
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguised))
        } finally {
          setBusy(false)
        }
      }, [chapter, line, busy, t, disguised, step, placeIn])

      /**
       * Read the wheel over the strip.
       *
       * The wheel moves the text instead of the conversation, so it is taken
       * away from the page — but only over the strip, and only while there is
       * text left to move to.
       *
       * The listener is attached by hand and is not passive, because React
       * listens for the wheel at its own root and does so passively: a
       * React wheel event cannot take the wheel away from the page, and the
       * conversation scrolled away under the card while the card was read.
       *
       * @param {any} event - the wheel event
       * @returns {void}
       */
      const onWheel = React.useCallback((event) => {
        if (chapter === null) return
        // A folded card is a small mark, not a reading surface: the wheel
        // belongs to the conversation.
        if (!expanded) return
        // A frame does at most one turn, and the notches that arrive inside
        // that frame are folded together instead of dropped: dropping them is
        // what made a trackpad flick feel like a stutter.
        if (wheelFrameRef.current !== null) {
          wheelDirRef.current += event.deltaY > 0 ? 1 : -1
          if (typeof event.preventDefault === 'function') event.preventDefault()
          if (typeof event.stopPropagation === 'function') event.stopPropagation()
          return
        }
        // The card counts the text in characters, so the end of the chapter
        // is a character count and not a count of lines: comparing the two
        // released the wheel while there was still a whole chapter to read,
        // and the conversation scrolled away under the card.
        const flow = chapterFlow(chapter)
        const delta = event.deltaY > 0 ? 1 : -1
        // The place is held inside the chapter, and a step is at least one
        // character, so the wheel always moves the reader somewhere.
        const here = placeIn(flow, line)
        const pageSize = pageEnd(lineRef.current, flow, here, visibleLines)
        const span = pageSize >= 0 ? Math.max(pageSize - here, 1) : Math.max(step, 1)
        const target = here + delta * span
        // At the ends the wheel is left alone, so the conversation can be
        // scrolled as usual.
        if (target < 0 || target >= flow.length) {
          if (delta > 0 && chapter.index + 1 >= chapter.total) return
          if (delta < 0 && chapter.index <= 0) return
        }
        if (typeof event.preventDefault === 'function') event.preventDefault()
        if (typeof event.stopPropagation === 'function') event.stopPropagation()
        // Hold the wheel for one frame so the turn it starts cannot be
        // overtaken by the next notch.
        const schedule = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (fn) => setTimeout(fn, 16)
        wheelDirRef.current = delta
        wheelFrameRef.current = schedule(() => {
          wheelFrameRef.current = null
          const step2 = wheelDirRef.current
          wheelDirRef.current = 0
          void move(step2 === 0 ? delta : step2)
        })
        return
      }, [chapter, line, move, expanded, placeIn])

      // The wheel is taken away from the page by a listener of the card's
      // own, which is not passive. React listens for the wheel at its own
      // root and does so passively, so a React wheel event cannot stop the
      // conversation from scrolling away under the card.
      const wheelRef = React.useRef(null)
      wheelRef.current = onWheel
      const wheelNodeRef = React.useRef(null)
      const wheelHandlerRef = React.useRef(null)
      /**
       * Take the card, and with it the wheel.
       *
       * @param {any} node - the card, or null when it goes away
       * @returns {void}
       */
      const attachRoot = React.useCallback((node) => {
        rootRef.current = node
        const old = wheelNodeRef.current
        if (old !== null && old !== undefined && typeof old.removeEventListener === 'function') {
          old.removeEventListener('wheel', wheelHandlerRef.current)
        }
        wheelNodeRef.current = node
        if (node === null || node === undefined || typeof node.addEventListener !== 'function') return
        const handler = (event) => {
          const read = wheelRef.current
          if (typeof read === 'function') read(event)
        }
        wheelHandlerRef.current = handler
        // Not passive: this listener is the one that keeps the wheel.
        node.addEventListener('wheel', handler, { passive: false })
      }, [])

      /**
       * Put the card on a place the term was found.
       *
       * The search is about the book being read, and every place the term
       * was found is a place the reader can be put on. The places are
       * listed, and the reader picks the one that was meant.
       *
       * The list is drawn over the whole window, because the composer cuts
       * off anything that grows out of it.
       *
       * @returns {Promise<void>} resolves when the list is open
       */
      const runSearch = React.useCallback(async () => {
        const wanted = String(term || '').trim()
        if (wanted === '') return
        if (chapter === null) return
        setBusy(true)
        // The list of the last search is replaced by this one.
        readerStore.set({ stripPopup: null })
        try {
          const session = searchRef.current
          if (session.term !== wanted || session.places.length === 0) {
            const data = await call('search', { term: wanted, bookId: chapter.bookId })
            session.term = wanted
            session.places = searchPlaces(data.result)
          }
          if (session.places.length === 0) {
            setError(t('noResults'))
            setSearchOpen(false)
            return
          }
          // The list opens where the card is, so it is measured first.
          const node = rootRef.current
          const rect = node !== null && node !== undefined && typeof node.getBoundingClientRect === 'function'
            ? node.getBoundingClientRect()
            : null
          readerStore.set({
            stripPopup: {
              kind: 'search',
              places: session.places,
              term: wanted,
              rect: rect === null ? null : {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
              },
            },
          })
          setError('')
          // The field has done its work and closes, so the row is as it was.
          setSearchOpen(false)
        } catch (failure) {
          setError(describeFailure(failure, t, disguised))
          setSearchOpen(false)
        } finally {
          setBusy(false)
        }
      }, [term, chapter, t, disguised])

      /**
       * Go to a place the reader picked out of the list.
       *
       * @param {object} pick - the thing that was picked
       * @returns {Promise<void>} resolves when the card is on the place
       */
      const goToPick = React.useCallback(async (pick) => {
        if (pick === null || pick === undefined || chapter === null) return
        // A chapter from the list of the book: the card opens it at the top.
        if (pick.kind === 'toc') {
          setBusy(true)
          try {
            const data = await call('open', { bookId: chapter.bookId, index: pick.index })
            setChapterState(data.chapter)
            setLine(0)
            setError('')
          } catch (failure) {
            setError(describeFailure(failure, t, disguised))
          } finally {
            setBusy(false)
          }
          return
        }
        const place = pick.place
        if (place === null || place === undefined) return
        setBusy(true)
        try {
          // The card counts the text in its own characters, so the place it
          // is given is the one it can show.
          const data = await call('open', {
            bookId: chapter.bookId,
            index: place.index,
            flow: place.flow,
          })
          setChapterState(data.chapter)
          setLine(place.flow)
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguised))
        } finally {
          setBusy(false)
        }
      }, [chapter, t, disguised])

      // The list is drawn over the window, so the choice comes back here.
      React.useEffect(() => {
        const pick = shared.stripPick
        if (pick === null || pick === undefined) return
        readerStore.set({ stripPick: null })
        void goToPick(pick)
      }, [shared.stripPick, goToPick])

      /**
       * Open the list of the chapters of the book.
       *
       * The list is drawn over the window, over the card that opened it.
       *
       * @returns {Promise<void>} resolves when the list is open
       */
      const openToc = React.useCallback(async () => {
        if (chapter === null) return
        setBusy(true)
        // The list of the last search is replaced by this one.
        readerStore.set({ stripPopup: null })
        try {
          const data = await call('toc', { bookId: chapter.bookId })
          const chapters = data.toc && Array.isArray(data.toc.chapters) ? data.toc.chapters : []
          if (chapters.length === 0) {
            setError(t('noResults'))
            return
          }
          const node = rootRef.current
          const rect = node !== null && node !== undefined && typeof node.getBoundingClientRect === 'function'
            ? node.getBoundingClientRect()
            : null
          readerStore.set({
            stripPopup: {
              kind: 'toc',
              chapters,
              current: chapter.index,
              rect: rect === null ? null : {
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
              },
            },
          })
          setError('')
        } catch (failure) {
          setError(describeFailure(failure, t, disguised))
        } finally {
          setBusy(false)
        }
      }, [chapter, t, disguised])

      /**
       * Read the keys over the card.
       *
       * The card is the one place the reader's keys act, so they never take
       * a key from the composer.
       *
       * @param {any} event - the key event
       * @returns {void}
       */
      const onKeyDown = React.useCallback((event) => {
        if (chapter === null) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          void move(event.key === 'ArrowDown' ? 1 : -1)
          return
        }
        if (event.key === 'PageDown' || event.key === 'PageUp') {
          event.preventDefault()
          event.stopPropagation()
          void move(event.key === 'PageDown' ? 5 : -5)
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          foldByUser()
        }
      }, [chapter, move, foldByUser])

      // Escape puts the strip away and gives the focus back to the mark. It is
      // one layer of the shared stack, so it takes the press before the page or
      // the panel underneath can act on the same keystroke.
      React.useEffect(() => {
        if (!expanded) return undefined
        return escapeLayers.push(foldByUser)
      }, [expanded, foldByUser])

      // The two shapes are alternatives, so the card is only drawn while the
      // reader is in the card. With the reader in the side column this is not
      // on screen at all, which is the point of choosing that shape.
      if (shared.placement !== 'strip') return null
      // A closed reader leaves nothing in the composer: no card, no bar.
      if (shared.hidden) return null

      // The chapter as one flow: the card wraps it to its own width, so the
      // text fills the card instead of leaving gaps at the end of every line
      // of the file. How much of it a step shows is the reader's choice.
      const flow = chapterFlow(chapter)
      // The page ends where the last drawn line ends, so the next page starts
      // with the very next word. The measurement needs the text that is on
      // screen, and the card takes its text away while it is folded, so the
      // last measurement is kept and used until the text can be measured
      // again: a reader who moves the pointer away and comes back finds the
      // same page, and not a page cut in the middle of a line.
      const here = placeIn(flow, line)
      const measured = pageEnd(lineRef.current, flow, here, visibleLines)
      const remembered = pageEndAt !== null && pageEndAt.start === here
        && pageEndAt.length === flow.length && pageEndAt.lines === visibleLines
        ? pageEndAt.value
        : -1
      const end = measured >= 0 ? measured : remembered
      const lead = flow.slice(here, end >= 0 ? end : flow.length)
      // A disguise numbers the documents; the plain skin may name them, which
      // is the whole point of choosing it.
      const head = ['book', 'progress', 'neutral'].includes(shared.settings.cardHead)
        ? shared.settings.cardHead
        : 'book'
      // How far through the book the reader is, as a percentage. The card's
      // own text is one chapter, so the number describes the whole book.
      const chapterIndex = chapter === null ? 0 : chapter.index
      const chapterTotal = chapter === null ? 0 : chapter.total
      const percent = chapterTotal > 0
        ? Math.min(100, Math.max(0, Math.round(((chapterIndex + 1) / chapterTotal) * 100)))
        : 0
      const bookName = chapter !== null && typeof chapter.bookTitle === 'string' ? chapter.bookTitle : ''
      const neutralHead = t('stripNeutralHead', { n: documentNumber })
      const bookHead = documentNumber <= 0
        ? t('stripNoBook')
        : (disguised || head === 'neutral')
          ? neutralHead
          : (bookName !== '' ? bookName : t('stripPosition', {
            n: documentNumber, m: chapterIndex + 1, total: chapterTotal,
          }))
      const progressHead = chapterTotal > 0
        ? t('stripProgressHead', { percent, m: chapterIndex + 1, total: chapterTotal })
        : t('stripNoBook')
      // The first line shows the chosen subject; the second stays the place.
      // Progress is a number, not a name, so a disguise does not suppress it:
      // only the presets that would name the book fall back to the neutral
      // line, which bookHead already handles.
      const position = head === 'progress' ? progressHead : bookHead
      // The disguise numbers its documents from one, so a document that is
      // not there cannot be numbered zero: the line says so instead.
      const neutralPosition = documentNumber > 0
        ? t('stripNeutralPosition', { n: documentNumber, m: chapterIndex + 1 })
        : t('stripNeutralEmpty')
      const subline = documentNumber <= 0
        ? ''
        : (disguised || head === 'neutral')
          ? neutralPosition
          : t('stripNamed', { book: bookName === '' ? t('docN', { n: documentNumber }) : bookName,
            m: chapterIndex + 1, total: chapterTotal })


      // A card that may not fold is always the full card: the switch is
      // separate from the fold mode, which only decides when it folds itself.
      const foldable = shared.settings.cardFoldable !== false

      // Folded, the card is either one small round mark or a one-line bar in
      // the composer stack, the way the Goal card reads. Both leave the text
      // alone until the reader reaches for them.
      if (foldable && !expanded) {
        const shape = shared.settings.cardFoldedShape === 'bar' ? 'bar' : 'mark'
        if (shape === 'bar') {
          // What the bar says in its middle is its own choice: the card's first
          // line, the chapter position, or a cover story for a disguise.
          const barLabel = ['head', 'chapter', 'cover'].includes(shared.settings.barLabel)
            ? shared.settings.barLabel
            : 'head'
          const cover = coverStory(shared.settings.barCoverText)
          const barText = barLabel === 'cover' && cover !== ''
            ? cover
            : (barLabel === 'chapter'
              ? neutralPosition
              : position)
          // The bar carries the same first line as the open card, so a reader
          // who folds it can still see where they are. It is one row of the
          // composer stack, so it takes the stack's own inset.
          // The row is one button that opens the card, and the two controls sit
          // beside it rather than inside it: a button cannot hold a button.
          // The bar is one surface, and its controls live inside it, the way
          // the Goal card carries its own: the row is the part that opens the
          // card, and the two buttons sit at its end.
          const barProgress = ['percent', 'track', 'both', 'none'].includes(shared.settings.barProgress)
            ? shared.settings.barProgress
            : 'percent'
          const barShowsTrack = barProgress === 'track' || barProgress === 'both'
          const barShowsPercent = barProgress === 'percent' || barProgress === 'both'
          return h('div', {
            className: `sr-strip sr-strip-bar${barShowsTrack ? '' : ' sr-strip-bar-plain'}`,
          },
            h('style', null, CSS),
            h('div', { className: 'sr-strip-bar-inner' },
              h('button', {
                ref: buttonRef,
                type: 'button',
                className: 'sr-strip-bar-row',
                title: t('stripHint'),
                'aria-label': t('stripExpand'),
                'aria-expanded': false,
                onMouseEnter: show,
                onClick: show,
              },
                h('span', { className: 'sr-strip-bar-lead' }, h('svg', {
                  viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false,
                  fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
                }, h('path', { d: 'M5 8h14M5 12h14M5 16h14' }))),
                h('span', { className: 'sr-strip-bar-text' }, barText),
                // How much of the book's progress the bar shows is the
                // reader's choice: a percent, a line, both, or nothing.
                // A long line used to eat the row; the default is the number.
                chapterTotal > 0 && (barShowsTrack || barShowsPercent)
                  ? h('span', {
                    className: `sr-strip-bar-progress${barShowsTrack ? '' : ' sr-strip-bar-progress-plain'}`,
                  },
                    barShowsTrack
                      ? h('span', { className: 'sr-strip-bar-track', role: 'progressbar',
                        'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100,
                        'aria-label': t('progress') },
                        h('span', { className: 'sr-strip-bar-fill', style: { width: `${percent}%` } }))
                      : null,
                    barShowsPercent
                      ? h('span', { className: 'sr-strip-bar-percent' }, `${percent}%`)
                      : null)
                  : null),
              // One press turns the bar back into the card, which is the shape a
              // reader can actually work in.
              h('button', {
                type: 'button',
                className: 'sr-ibtn sr-strip-bar-btn',
                title: t('stripToCard'), 'aria-label': t('stripToCard'),
                onClick: show,
              }, '\u2921'),
              // And one press closes the reader for good.
              h('button', {
                type: 'button',
                className: 'sr-ibtn sr-strip-bar-btn sr-strip-bar-close',
                title: t('hide'), 'aria-label': t('hide'),
                // Closing puts the reader away for good: the card leaves the
                // composer, not just the panel.
                onClick: () => readerStore.set({ hidden: true, visible: false, stripPopup: null }),
              }, '\u00d7')))
        }
        // The native toolbar owns the folded entry; the dock has no node,
        // so it cannot reserve a row or overlap the composer's border.
        return null
      }

      return h('div', {
        className: 'sr-strip is-open',
        ref: attachRoot,
        onMouseEnter: show,
        onMouseLeave: scheduleHide,
        onFocusCapture: event => {
          editingRef.current = ['INPUT', 'TEXTAREA'].includes(event.target?.tagName)
          if (editingRef.current) show()
        },
        onBlurCapture: event => {
          const next = event.relatedTarget
          editingRef.current = !!(next && event.currentTarget?.contains?.(next)
            && ['INPUT', 'TEXTAREA'].includes(next.tagName))
          if (!editingRef.current && !event.currentTarget?.matches?.(':hover')) scheduleHide()
        },
        onKeyDown,
        // The card reads the same two numbers the side column reads, so the
        // text size and line spacing the reader chose are not a property of
        // one shape only. The card's own cap keeps it from outgrowing the
        // thing it sits above.
        style: {
          '--sr-font': `${Number(shared.settings.fontSize) || 15}px`,
          '--sr-line-height': `${Number(shared.settings.lineHeight) || 1.9}`,
        },
      },
        h('style', null, CSS),
        h('div', { className: 'sr-strip-panel' },
          h('div', { className: 'sr-strip-body' },
            h('p', { className: 'sr-strip-line', ref: lineRef,
              // The chosen line count is a hard clamp, so a bigger step cannot
              // make the card taller than the reader asked for.
              style: { display: '-webkit-box', WebkitLineClamp: String(visibleLines),
                WebkitBoxOrient: 'vertical', overflow: 'hidden' } },
              // A reader who has no book yet is not a reader who is waiting
              // for one: the card said "Loading…" for ever, which is the first
              // thing a new install shows. It now says what to do instead.
              //
              // "No book" and "the text is on its way" are two different
              // things: the first is told by the library, the second only by
              // the chapter that has not arrived yet.
              disguised
                ? neutralPosition
                : (lead !== '' ? lead
                  : (libraryState === 'empty' ? t('stripEmptyCard') : t('loading')))),
            // One row under the text: the controls, the book's progress, and the
            // way out. The title and the progress bar used to take a line each,
            // which cost the text two lines of height for no reading value.
            h('div', { className: 'sr-strip-foot', ref: observeFoot },
              // The book's place, small and quiet: the card no longer gives it
              // a row of its own. A search leaves no trace here: the card is
              // simply on the place that was found. The label gives its room
              // to the search field while the reader is typing.
              subline === '' || searchOpen || rowTier === 'tiny' || rowTier === 'micro'
                ? null
                : h('span', { className: 'sr-strip-foot-label', title: subline }, subline),
              // How far through the book the reader is, next to the place the
              // chapter names: the two say the same thing from two sides, so
              // they belong together. At the far end of the row the number
              // stood alone, cut off from the chapter it belongs to.
              // The hairline is the first thing to go: the number is the part
              // that carries the meaning.
              chapterTotal > 0 && rowTier !== 'micro'
                ? h('span', { className: 'sr-strip-foot-progress' },
                  rowTier === 'wide'
                    ? h('span', { className: 'sr-strip-progress-track', role: 'progressbar',
                      'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100,
                      'aria-label': t('progress') },
                      h('span', { className: 'sr-strip-progress-fill', style: { width: `${percent}%` } }))
                    : null,
                  h('span', { className: 'sr-strip-progress-text' }, `${percent}%`))
                : null,
              error !== '' ? h('span', { className: 'sr-strip-foot-error' }, error) : null,
              h('span', { className: 'sr-strip-hint' }),
              // The steps lead the controls: the row reads as the place in
              // the book on the left and the ways to act on it on the right.
              h('button', {
                type: 'button', className: 'sr-ibtn sr-strip-step',
                title: t('stripBack'), 'aria-label': t('stripBack'),
                onClick: () => void move(-1),
              }, '‹'),
              h('button', {
                type: 'button', className: 'sr-ibtn sr-strip-step',
                title: t('stripForward'), 'aria-label': t('stripForward'),
                onClick: () => void move(1),
              }, '›'),
              // The search field is a small thing in the footer's own space:
              // it is used once and then closes, so it never sits in the row
              // as a bar.
              searchOpen
                ? h('input', {
                  type: 'search',
                  className: 'sr-strip-search',
                  ref: searchInputRef,
                  autoFocus: true,
                  value: term,
                  placeholder: label(t('searchHint'), t('neutralSearchHint')),
                  'aria-label': label(t('search'), t('neutralSearch')),
                  title: label(t('searchAllHint'), t('neutralSearchHint')),
                  onChange: (event) => setTerm(event.target.value),
                  // The field is used once and then closes: leaving it gives
                  // the row its icon back, and so does a finished search.
                  onBlur: () => setSearchOpen(false),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.stopPropagation()
                      setSearchOpen(false)
                      void runSearch()
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      setSearchOpen(false)
                      setTerm('')
                    }
                  },
                })
                : null,
              // The search in the book: one click away from the text. It is
              // the first thing the narrowest card gives up, because a field
              // needs room that a card of that size does not have.
              searchOpen
                ? null
                : rowTier === 'micro'
                  ? null
                  : h('button', {
                    type: 'button', className: 'sr-ibtn sr-strip-open',
                    title: label(t('search'), t('neutralSearch')),
                    'aria-label': label(t('search'), t('neutralSearch')),
                    onClick: () => setSearchOpen(true),
                  }, h('span', { className: 'sr-lens' })),
              // The table of contents of the book being read: its own list,
              // apart from the catalog of the books. It is a reading act, so
              // it stays in the row as long as the row can hold it.
              rowTier === 'wide' || rowTier === 'medium'
                ? h('button', {
                  type: 'button', className: 'sr-ibtn sr-strip-open',
                  title: label(t('toc'), t('neutralList')),
                  'aria-label': label(t('toc'), t('neutralList')),
                  'aria-haspopup': 'dialog',
                  onClick: () => void openToc(),
                }, '☷')
                : null,
              // The catalog of books: one click away from the text. It is a
              // rare action, so a narrow card leaves it out before it leaves
              // out anything the reader needs while reading.
              rowTier === 'wide'
                ? h('button', {
                  type: 'button', className: 'sr-ibtn sr-strip-open',
                  title: t('library'), 'aria-label': t('library'),
                  'aria-haspopup': 'dialog',
                  onClick: () => togglePicker(),
                }, '☰')
                : null,
              rowTier === 'wide'
                ? h('button', {
                  type: 'button', className: 'sr-lbtn sr-strip-open',
                  title: disguised ? t('shopNeutral') : t('shop'),
                  'aria-label': disguised ? t('shopNeutral') : t('shop'),
                  onClick: openBookstore,
                }, disguised ? t('shopNeutral') : t('shop'))
                : null,
              rowTier === 'wide'
                ? h('button', {
                  type: 'button', className: 'sr-ibtn sr-strip-open',
                  title: t('toSidebar'), 'aria-label': t('toSidebar'),
                  onClick: () => void placeReader('sidebar'),
                }, '⇲')
                : null,
              // Folding lives here now that the title row is gone.
              foldable
                ? h('button', {
                  type: 'button', className: 'sr-ibtn sr-strip-fold',
                  title: t('stripFold'), 'aria-label': t('stripFold'),
                  'aria-expanded': true,
                  onClick: foldByUser,
                }, '\u2303')
                : null))))
    }

    /**
     * How the footer row fits the width it is given.
     *
     * The row holds a reading flow, some rare management actions and a
     * progress number. When the row is wide enough for all of them, they are
     * all in the row. When it is not, the rare actions move into one overflow
     * button, and the decorative parts go first: the progress bar, then the
     * chapter label, then the table of contents. What stays in the row is
     * always what a reader needs while reading: the steps, the search, the
     * overflow, the way out and the number.
     *
     * The widths come from measuring the real row in a real browser.
     *
     * @param {number} width - the width of the footer row
     * @returns {string} the tier the row is drawn in
     */
    function rowTierFor(width) {
      if (width >= 400) return 'wide'
      if (width >= 232) return 'medium'
      if (width >= 196) return 'narrow'
      if (width >= 126) return 'tiny'
      return 'micro'
    }

    /**
     * The reader's preferences, as one page of the Harness settings.
     *
     * The reading surface stays a reading surface: changing a preference is
     * not something to do in the middle of a chapter, so the page lives in
     * the Harness settings with every other preference.
     *
     * @returns {any} React element
     */
    function SettingsSection() {
      const shared = useReaderState()
      // The catalog is a floating page of its own, drawn above the settings
      // panel, so the settings stay where they are while it is open. Drawing
      // a second copy inside the panel would give the reader two catalogs,
      // and the hidden one would close the visible one on the next click.
      //
      // The floating catalog belongs to this section: the Harness settings
      // own the modal and its Escape, so a catalog that outlived the panel
      // would be left floating over a window that no longer asked for it.
      React.useEffect(() => () => { readerStore.set({ pickerFloating: false }) }, [])
      return h('div', { className: 'sr-set-section' },
        h(SettingsPage, { variant: 'section' }),
        // The catalog floats over the panel while the settings stay where
        // they are, so closing it brings the reader back to the page they
        // came from.
        shared.pickerFloating
          ? floatAbove(h(BookPicker, { variant: 'overlay' }))
          : null)
    }

    /**
     * The library drawer inside the panel.
     * @param {any} props - component props
     * @returns {any} React element
     */

    let translator = (key) => EN[key] ?? key
    let clientCtx = null

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'shortcuts'],
      apply(ctx) {
        clientCtx = ctx
        translator = makeTranslator(ctx)
        // A plugin that is loaded again starts from the beginning, so the
        // shared state does too.
        releaseSidebarTabs()
        readerStore.reset()
        ctx.effect(() => releaseSidebarTabs, 'stealth-reader:sidebar-lifetimes')
        // A fault inside this panel must not leave the panel unexplained, and
        // only this panel's faults count: a page-wide listener would report
        // every other plugin's errors as ours.
        ctx.effect(() => {
          if (typeof window === 'undefined' || !window.addEventListener) return () => {}
          const onError = (event) => {
            const target = event && event.target
            // An error event with a target is a resource failure, not a fault
            // in this panel's code.
            if (target && target !== window) return
            const source = event && event.filename ? String(event.filename) : ''
            if (source && !source.includes('stealth-reader')) return
            reportFault('window', event && event.error ? event.error : event && event.message)
          }
          const onRejection = (event) => {
            const reason = event && event.reason
            const text = reason instanceof Error ? reason.message : String(reason || '')
            if (!text.includes('stealth-reader') && !text.includes('/stealth-reader/api')) return
            reportFault('promise', reason)
          }
          window.addEventListener('error', onError)
          window.addEventListener('unhandledrejection', onRejection)
          return () => {
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onRejection)
            // A preference that was still waiting is written on the way out.
            settingsController.flush()
          }
        }, 'stealth-reader:faults')
        ctx.effect(() => () => readerBrowser?.dispose(), 'stealth-reader:site-browser')
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'stealth-reader',
          order: 95,
        }, OverlaySurface))
        // The strip lives inside the composer's card, so it never takes part
        // in the composer's layout and the input box never moves.
        // The strip is one more card in the stack above the composer, next
        // to Todo and Goal, so it reads as part of the conversation rather
        // than as something floating over it.
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'stealth-reader.entry',
          order: 10,
        }, StripToolbarEntry))
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'stealth-reader.strip',
          order: 15,
        }, StripEntry))
        // The reader's preferences are a page of the Harness settings, so
        // changing them is never a detour through the reading surface. The
        // settings shell is optional: without it the reader keeps its own
        // page, and the registration waits instead of failing the plugin.
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'stealth-reader',
          order: 60,
          label: () => translator('peek'),
          locale: 'stealth-reader',
        }, SettingsSection))
        // The sidebar is optional: without it the reader keeps the surfaces
        // it always has, so the whole registration waits for the service
        // instead of failing the plugin.
        if (typeof ctx.inject === 'function') {
          ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scoped) => {
            sidebarService = scoped.sidebarRight
            scoped.effect(() => scoped.sidebarRightTabs.register({
              id: 'dsh-plugin-stealth-reader',
              kind: 'stealth-reader',
              // A type from outside the product: it ranks as an extension and
              // never takes a kind the Harness ships.
              priority: 'extension',
              title: () => translator('peek'),
              guide: [{
                id: 'reader',
                order: 30,
                title: () => translator('peek'),
                description: () => translator('sidebarHint'),
              }],
            }), 'stealth-reader:sidebar-type')
            // The body is registered under the definition's own id, which is
            // how the sidebar finds it.
            scoped.effect(() => scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
              name: 'sidebar.right.pane.tab',
              key: 'dsh-plugin-stealth-reader',
              locale: 'stealth-reader',
            }, SidebarSurface)), 'stealth-reader:sidebar-body')
          })
        }
      },
    }
  },
})
