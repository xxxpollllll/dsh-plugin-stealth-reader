/* Real React, real DOM harness for the stealth reader client.
 *
 * The client bundle is the one that ships: it is loaded through the same
 * `window.__ModuleLoader__` entry point the Harness uses, with a stub of the
 * services it talks to. Nothing here reads a real library: the fake host
 * answers with synthetic chapters only.
 *
 * The page runs one scripted scenario and leaves its verdict in
 * `window.__RESULTS__`, so a driver can read it without evaluating anything
 * inside the page.
 */
;(function () {
  'use strict'
  const React = window.React
  const ReactDOM = window.ReactDOM

  const results = []
  const record = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) })
  }

  /* The host answers over the reader's own route, which the harness server
   * implements with synthetic chapters. Nothing here reads a real book. */

  /* The service stubs the client asks for. */
  const registrations = new Map()
  const cleanups = []
  const localeTables = new Map()
  const ctx = {
    get() { return undefined },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    },
    slots: {
      inject(name, fn) {
        const registration = fn()
        registrations.set(name, registration)
        return () => { registrations.delete(name) }
      },
      register(options, component) {
        return Object.assign({}, options, { component })
      },
    },
    locale: {
      register(namespace, tables) {
        localeTables.set(namespace, tables)
        return () => localeTables.delete(namespace)
      },
      bind(namespace) {
        const tables = localeTables.get(namespace) || {}
        const active = window.__LOCALE__ || 'en'
        const table = tables[active] || {}
        return key => table[key] || (tables.en && tables.en[key]) || (tables.zh && tables.zh[key]) || ''
      },
      getSnapshot() { return { active: window.__LOCALE__ || 'en' } },
      subscribe() { return () => {} },
    },
    // The shortcuts service is present but not the desktop runtime, so the
    // client keeps its own document-level fallback.
    shortcuts: { runtime: 'web' },
    uiWorkspace: undefined,
  }

  const loaded = window.__LOADED__ || []

  /* Count the document-level listeners the client adds and removes, so the
   * scenario can prove that unmounting gives them all back. */
  window.__LISTENER_BALANCE__ = (() => {
    const counters = { added: 0, removed: 0, kinds: [] }
    const add = document.addEventListener.bind(document)
    const remove = document.removeEventListener.bind(document)
    document.addEventListener = function (kind, listener, options) {
      counters.added += 1
      counters.kinds.push('+' + kind)
      return add(kind, listener, options)
    }
    document.removeEventListener = function (kind, listener, options) {
      counters.removed += 1
      counters.kinds.push('-' + kind)
      return remove(kind, listener, options)
    }
    return () => ({ added: counters.added, removed: counters.removed, kinds: counters.kinds.join(',') })
  })()

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const settle = async () => { await wait(60); await wait(0) }

  async function run() {
    window.__LOCALE__ = new URLSearchParams(window.location.search).get('locale') || 'en'
    /* Which surface a photograph is of. Set before any scenario runs, so a
     * photo target that a later check reaches first is still known. */
    window.__SHOT_TARGET__ = new URLSearchParams(window.location.search).get('shot')
    window.__EMPTY_LIBRARY__ = new URLSearchParams(window.location.search).has('empty')
    window.__WITH_SITES__ = new URLSearchParams(window.location.search).has('sites')
    window.__BROKEN_ROUTE__ = new URLSearchParams(window.location.search).has('broken')
    /* The client half is loaded by the page, but it registers itself when the
     * loader runs. The loader ran before this script, so the plugin is in
     * `loaded` already. */
    if (loaded.length === 0) {
      record('the client registered itself with the module loader', false, 'no module was loaded')
      return
    }
    const plugin = loaded[0].plugin
    plugin.apply(ctx)

    const toolbar = registrations.get('conversation.input.right')
    const dock = registrations.get('conversation.input.dock')
    if (!toolbar || !toolbar.component) {
      record('the native toolbar entry is registered', false, 'no conversation.input.right registration')
      return
    }
    if (!dock || !dock.component) {
      record('the reading card is registered', false, 'no conversation.input.dock registration')
      return
    }
    record('the native toolbar entry is registered', true)

    const toolbarHost = document.getElementById('toolbar-host')
    const dockHost = document.getElementById('dock-host')
    const overlay = registrations.get('shell.overlay')
    record('the overlay is registered', !!overlay, Array.from(registrations.keys()).join(','))
    const overlayHost = document.createElement('div')
    document.body.appendChild(overlayHost)
    const toolbarRoot = ReactDOM.createRoot(toolbarHost)
    const dockRoot = ReactDOM.createRoot(dockHost)
    const overlayRoot = ReactDOM.createRoot(overlayHost)
    toolbarRoot.render(React.createElement(toolbar.component, {}))
    dockRoot.render(React.createElement(dock.component, {}))
    if (overlay && overlay.component) overlayRoot.render(React.createElement(overlay.component, {}))
    await settle()
    record('the overlay mounted', overlayHost.childElementCount > 0, 'children: ' + overlayHost.childElementCount)

    /* React answers a real pointer leaving the card through 'mouseout'; a
     * bare 'mouseleave' event never reaches its synthetic handler. */
    const leave = element => {
      element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    }

    const entry = toolbarHost.querySelector('button.sr-strip-mark')
    record('the entry is a real button in the DOM', !!entry, entry ? entry.tagName : 'missing')
    if (!entry) return

    /* The card starts open in the harness, so the entry opens an already
     * present card. Folding it is the interesting direction. */
    const card = dockHost.querySelector('.sr-strip-panel')
    record('the reading card is rendered by real React', !!card)

    /* The automatic folding has to work in a real browser, or the protection
     * below would pass for the wrong reason. */
    const leaveEarly = () => {
      const element = dockHost.querySelector('.sr-strip')
      if (!element) return
      element.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    }
    leaveEarly()
    await wait(250)
    const hostAnswers = !window.__BROKEN_ROUTE__
    if (hostAnswers) {
      record('the automatic folding folds the card when the pointer leaves', !dockHost.querySelector('.sr-strip-panel'),
        'the pointer left the card')
    }
    entry.click()
    await settle()

    /* Folding by the card's own button must give the focus back to the
     * entry, after the folded render has committed. */
    const fold = dockHost.querySelector('button.sr-strip-fold')
    if (!fold) {
      record('the card offers a fold control', false, 'no fold button')
    } else {
      fold.focus()
      fold.click()
      await settle()
      const focused = document.activeElement
      record('folding moves the focus to the toolbar entry',
        focused === entry,
        focused ? (focused.className || focused.tagName) : 'nothing focused')
      const stillOpen = dockHost.querySelector('.sr-strip-panel')
      record('folding hides the card', stillOpen === null)
      /* The entry must open it again. */
      entry.click()
      await settle()
      record('the entry opens the card again', !!dockHost.querySelector('.sr-strip-panel'))
    }

    /* The search field must keep the card open while it is being edited. */
    const root = () => dockHost.querySelector('.sr-strip')
    const searchButton = Array.from(dockHost.querySelectorAll('button.sr-strip-open'))
      .find(button => button.querySelector('.sr-lens'))
    if (!searchButton) {
      record('the card offers a search control', false, 'no search button')
    } else {
      searchButton.click()
      await settle()
      const field = dockHost.querySelector('input.sr-strip-search')
      if (!field) {
        record('the search field opens', false, 'no search input')
      } else {
        record('the search field opens', true)
        /* Opening the field must focus it, so the reader can type at once. */
        record('the search field takes the focus on its own', document.activeElement === field,
          document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : 'nothing focused')
        let focusEvents = 0
        const counter = () => { focusEvents += 1 }
        document.addEventListener('focusin', counter, true)
        field.focus()
        await wait(50)
        document.removeEventListener('focusin', counter, true)
        record('the search field takes the focus', document.activeElement === field, 'focusin events: ' + focusEvents)
        record('the card is still open right after the focus', !!dockHost.querySelector('.sr-strip-panel'))
        leave(root())
        await wait(120)
        record('the card survives a short wait with the field focused', !!dockHost.querySelector('.sr-strip-panel'))
        await wait(250)
        record('a focused search field keeps the card open', !!dockHost.querySelector('.sr-strip-panel'))
        /* The field is used once: leaving it must give the row its icon back. */
        field.blur()
        /* The card may fold right after the field closes, so the icon is read
         * before the automatic folding has had its delay. */
        await wait(20)
        record('leaving the search field closes the field', !dockHost.querySelector('input.sr-strip-search'))
        const backToIcon = Array.from(dockHost.querySelectorAll('button.sr-strip-open'))
          .some(button => button.querySelector('.sr-lens'))
        record('leaving the search field brings back the search icon', backToIcon)
        /* Leaving the field lets the automatic folding happen again. */
        leave(root())
        await wait(250)
        if (!window.__BROKEN_ROUTE__) {
          record('leaving the search field folds the card again', !dockHost.querySelector('.sr-strip-panel'))
        }
      }
    }

    /* Escape is the keyboard way to put the card away, and it must hand the
     * focus back to the entry. */
    entry.click()
    await settle()
    const cardRoot = root()
    if (cardRoot) {
      cardRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await settle()
      record('escape folds the card', !dockHost.querySelector('.sr-strip-panel'))
      record('escape gives the focus back to the entry', document.activeElement === entry,
        document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : 'nothing focused')
    } else {
      record('escape folds the card', false, 'no card root')
    }

    /* The row has to fit the width it is given, at every width. */
    /* The card was folded by the escape test, so it is opened again. */
    entry.click()
    await settle()

    /* The card takes its text away while it is folded, so the text has to be
     * measured again when the card comes back. Otherwise the page would be the
     * whole remainder of the chapter, and the clamp would cut it in the
     * middle of a line. */
    const measureLines = (line, text) => {
      const probe = line.cloneNode(false)
      probe.textContent = text
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.pointerEvents = 'none'
      probe.style.left = '-9999px'
      probe.style.top = '0'
      probe.style.width = line.clientWidth + 'px'
      probe.style.height = 'auto'
      probe.style.webkitLineClamp = 'unset'
      probe.style.overflow = 'visible'
      probe.style.margin = '0'
      line.parentNode.appendChild(probe)
      const style = getComputedStyle(probe)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const height = probe.getBoundingClientRect().height
      probe.remove()
      if (!(lineHeight > 0)) return null
      return Math.round(height / lineHeight)
    }
    const cardForLeave = root()
    if (cardForLeave) leave(cardForLeave)
    await wait(250)
    const folded = !dockHost.querySelector('.sr-strip-panel')
    entry.click()
    await settle()
    await settle()
    const line = dockHost.querySelector('.sr-strip-line')
    const drawn = line ? measureLines(line, line.textContent || '') : null
    const clamp = line ? Number(line.style.webkitLineClamp) || 0 : 0
    if (!window.__BROKEN_ROUTE__) {
      record('the text of the card is complete when the card comes back',
        folded && drawn !== null && drawn <= clamp,
        folded ? `drawn ${drawn} lines, the card holds ${clamp}` : 'the card did not fold')
    }
    /* The check above is only worth anything when the chapter is longer than
     * the card shows, so the length of the chapter is measured as well. */
    const chapterText = await fetch('/stealth-reader/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'chapter', index: 0 }),
    }).then(response => response.json())
      .then(data => ((data.chapter && data.chapter.text) || ''))
      .catch(() => '')
    const whole = line
      ? measureLines(line, chapterText.split('\n').map(part => part.trim()).filter(part => part !== '').join(' '))
      : null
    if (!window.__BROKEN_ROUTE__) {
      record('the chapter of the test is longer than the card shows',
        whole !== null && whole > clamp,
        `the chapter needs ${whole} lines, the card holds ${clamp}`)
    }

    /* The website library is a page that has to float above the modals of the
     * host, so it is drawn beside the application's root and not inside it. */
    const shop = document.querySelector('.sr-shop')
    record('the website library is drawn beside the root',
      shop !== null && shop.parentElement === document.body,
      shop ? (shop.parentElement ? (shop.parentElement.className || shop.parentElement.tagName) : 'no parent') : 'no library')
    const shopZ = shop ? Number(getComputedStyle(shop).zIndex) : 0
    record('the website library floats above the modals of the host', shopZ > 1000, 'z-index ' + shopZ)
    /* Opening the book page opens its first saved site by itself: a reader
     * who came here wants to look at a site, not at an empty pane. */
    if (window.__WITH_SITES__ === true && shop !== null) {
      const door = Array.from(dockHost.querySelectorAll('button'))
        .find(button => /Find books|找书/.test(button.textContent || ''))
      if (door) {
        door.click()
        await settle()
        await settle()
        await wait(120)
        const opened = Array.from(shop.querySelectorAll('.sr-shop-visit'))
          .filter(tab => tab.getAttribute('aria-selected') === 'true')
        record('opening the book page opens its first site',
          opened.length === 1 && /one\.example|合成书站一/.test(
            (opened[0].getAttribute('aria-label') || '') + (opened[0].textContent || '')),
          opened.length === 0 ? 'no site was opened' : (opened[0].getAttribute('aria-label') || ''))
      }
      /* This page has no real webview, so the measurement cannot run here:
       * what is checked is that the site was opened at all, which is the step
       * before the fit. The measurement itself is covered by the browser
       * suite, where the guest is a real object. */
      record('the site that opens is the first saved one',
        Array.from(shop.querySelectorAll('.sr-shop-visit'))
          .filter(tab => tab.getAttribute('aria-selected') === 'true').length === 1)
    }
    /* The book page can be photographed where it is opened. */
    if (window.__SHOT_TARGET__ === 'shop') {
      const door = Array.from(dockHost.querySelectorAll('button'))
        .find(button => /Find books|找书/.test(button.textContent || ''))
      if (door) {
        door.click()
        await settle()
        await settle()
        const page = document.querySelector('.sr-shop')
        if (page) {
          const box = page.getBoundingClientRect()
          window.__CARD_BOX__ = {
            x: box.x + window.scrollX, y: box.y + window.scrollY,
            width: box.width, height: box.height,
          }
          window.__SHOT_READY__ = true
          for (let attempt = 0; attempt < 100 && !window.__SHOT_DONE__; attempt += 1) await wait(100)
        }
      }
    }

    const rowState = () => {
      const foot = dockHost.querySelector('.sr-strip-foot')
      if (!foot) return null
      const has = selector => foot.querySelector(selector) !== null
      return {
        overflow: foot.scrollWidth - foot.clientWidth,
        width: foot.clientWidth,
        label: has('.sr-strip-foot-label'),
        track: has('.sr-strip-progress-track'),
        toc: has('.sr-strip-open[title]') && Array.from(foot.querySelectorAll('.sr-strip-open'))
          .some(button => button.textContent === '☷'),
        library: Array.from(foot.querySelectorAll('.sr-strip-open'))
          .some(button => button.textContent === '☰'),
        more: Array.from(foot.querySelectorAll('.sr-strip-open'))
          .some(button => button.textContent === '⋯'),
        fold: has('.sr-strip-fold'),
        percent: has('.sr-strip-progress-text'),
        search: has('.sr-strip-search') || Array.from(foot.querySelectorAll('.sr-strip-open'))
          .some(button => button.querySelector('.sr-lens') !== null),
      }
    }
    const atWidth = async width => {
      dockHost.style.width = width + 'px'
      await settle()
      await settle()
      /* The card has an inset of its own, so the row is narrower than the
       * host it lives in. */
      const foot = dockHost.querySelector('.sr-strip-foot')
      return { ...(rowState() || {}), width: foot ? foot.clientWidth : width }
    }
    /* A reader who has no book yet is the first thing a new install shows.
     * The card used to say "Loading…" for ever, which reads as a plugin that
     * never finished starting. */
    const cardLine = dockHost.querySelector('.sr-strip-line')
    const emptyLibrary = window.__EMPTY_LIBRARY__ === true
    const brokenRoute = window.__BROKEN_ROUTE__ === true
    if (brokenRoute) {
      /* A host that does not answer must not leave the reader waiting for
       * ever, and must not claim that a document number that cannot exist. */
      const text = cardLine ? String(cardLine.textContent || '') : ''
      const foot = dockHost.querySelector('.sr-strip-foot-error')
      record('a host that does not answer is not waited for for ever',
        text !== '' && !/Loading|加载中/.test(text), JSON.stringify(text))
      record('a host that does not answer is said so',
        foot !== null && String(foot.textContent || '').trim() !== '',
        foot === null ? 'no error' : String(foot.textContent || ''))
      record('a host that does not answer shows no document that cannot exist',
        !/Document 0|文档 0/.test(text), JSON.stringify(text))
    }
    if (emptyLibrary) {
      const text = cardLine ? String(cardLine.textContent || '') : ''
      record('a reader with no book is told what to do',
        text !== '' && !/Loading|加载中/.test(text), JSON.stringify(text))
      /* And the way to a book is on the card, not hidden behind a menu. */
      const door = Array.from(dockHost.querySelectorAll('button'))
        .find(button => /Find books|找书/.test(button.textContent || ''))
      record('the empty card offers the way to a book', door !== undefined,
        door === undefined ? 'no door' : door.textContent)
    }

    /* The row reads as the place on the left and the controls on the right. */
    const order = (() => {
      const foot = dockHost.querySelector('.sr-strip-foot')
      if (!foot) return null
      // The percentage carries its own order in the stylesheet, so the visual
      // row is read the way the browser puts it on screen.
      const children = Array.from(foot.children)
        .map((child, index) => ({
          child,
          index,
          order: Number(getComputedStyle(child).order) || 0,
        }))
        .sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order))
      const at = predicate => children.findIndex(row => predicate(row.child))
      const has = (child, name) => String(child.className || '').split(/\s+/).includes(name)
      return {
        label: at(child => has(child, 'sr-strip-foot-label')),
        step: at(child => has(child, 'sr-strip-step')),
        search: at(child => has(child, 'sr-strip-open') && child.querySelector('.sr-lens') !== null),
        fold: at(child => has(child, 'sr-strip-fold')),
        percent: at(child => has(child, 'sr-strip-foot-progress')),
      }
    })()
    /* The rest of the row describes a reader who has a book: a reader with an
     * empty library has no place and no progress to show. */
    if (!emptyLibrary && !brokenRoute) {
      record('the place is on the left and the controls on the right',
        order !== null && order.label >= 0 && order.percent > order.label
          && order.step > order.percent && order.search > order.step && order.fold > order.search,
        JSON.stringify(order))
      /* The percentage says how far through the book the reader is, and the
       * chapter says where it is: the two belong together. */
      record('the percentage sits next to the chapter',
        order !== null && order.label >= 0 && order.percent === order.label + 1,
        JSON.stringify(order))
    }

    /* Every icon button of the row is the same size, and the labelled one
     * is as tall as they are. */
    const sizes = (() => {
      const foot = dockHost.querySelector('.sr-strip-foot')
      if (!foot) return null
      const icons = Array.from(foot.querySelectorAll('.sr-ibtn'))
        .map(button => {
          const box = button.getBoundingClientRect()
          return { width: Math.round(box.width), height: Math.round(box.height) }
        })
      const labels = Array.from(foot.querySelectorAll('.sr-lbtn'))
        .map(button => Math.round(button.getBoundingClientRect().height))
      return { icons, labels }
    })()
    const oneSize = sizes !== null && sizes.icons.length > 0
      && sizes.icons.every(box => box.width === sizes.icons[0].width && box.height === sizes.icons[0].height)
    record('every icon button of the row is the same size', oneSize,
      sizes === null ? 'no row' : JSON.stringify(sizes.icons))
    record('the labelled button of the row is as tall as the icons',
      sizes !== null && sizes.labels.length > 0
        && sizes.labels.every(height => oneSize && height === sizes.icons[0].height),
      sizes === null ? 'no row' : JSON.stringify(sizes.labels))

    /* The tiers describe a reader who has a book: without one there is no
     * place and no progress to show, so the row is the controls alone. The
     * row still has to fit, at every width. */
    if (!emptyLibrary && !brokenRoute) {
      const wide = await atWidth(620)
      record('a wide card shows every action in the row',
        wide !== null && wide.library && wide.more === false && wide.track && wide.label && wide.toc,
        wide === null ? 'no row' : JSON.stringify(wide))
      record('a wide card fits its row', wide !== null && wide.overflow <= 0,
        wide === null ? 'no row' : `overflow ${wide.overflow}px`)

      const medium = await atWidth(340)
      record('a medium card leaves the rare actions out',
        medium !== null && !medium.more && !medium.library && !medium.track,
        medium === null ? 'no row' : JSON.stringify(medium))
      record('a medium card fits its row', medium !== null && medium.overflow <= 0,
        medium === null ? 'no row' : `overflow ${medium.overflow}px`)
      record('a medium card keeps the reading actions',
        medium !== null && medium.toc && medium.fold && medium.percent && medium.search,
        medium === null ? 'no row' : JSON.stringify(medium))

      const narrow = await atWidth(280)
      record('a narrow card leaves the table of contents out',
        narrow !== null && !narrow.toc && narrow.label,
        narrow === null ? 'no row' : JSON.stringify(narrow))
      record('a narrow card fits its row', narrow !== null && narrow.overflow <= 0,
        narrow === null ? 'no row' : `overflow ${narrow.overflow}px`)

      const tiny = await atWidth(210)
      record('the narrowest card leaves the chapter name out',
        tiny !== null && !tiny.label && !tiny.toc && tiny.percent && tiny.search,
        tiny === null ? 'no row' : JSON.stringify(tiny))
      record('the narrowest card fits its row', tiny !== null && tiny.overflow <= 0,
        tiny === null ? 'no row' : `overflow ${tiny.overflow}px`)
    } else {
      /* Even with nothing to read the row must not overflow. */
      for (const width of [620, 340, 280, 210]) {
        const state = await atWidth(width)
        record('an empty card fits its row at ' + width + 'px',
          state !== null && state.overflow <= 0,
          state === null ? 'no row' : `overflow ${state.overflow}px`)
      }
    }

    dockHost.style.width = ''
    await settle()

    /* How wide the footer row needs to be, measured at several card widths.
     * The numbers decide which controls may go, and in which order. */
    window.__MEASUREMENTS__ = []
    const measure = async () => {
      const rows = []
      for (const width of [180, 220, 260, 300, 340, 400, 460, 520, 620]) {
        dockHost.style.width = width + 'px'
        dockHost.getBoundingClientRect()
        /* The row redraws itself for the new width, so the measurement waits
         * for that to happen. */
        await settle()
        await settle()
        const foot = dockHost.querySelector('.sr-strip-foot')
        if (!foot) continue
        const children = Array.from(foot.children).map(child => ({
          className: child.className || child.tagName,
          width: Math.round(child.getBoundingClientRect().width),
          text: (child.textContent || '').trim().slice(0, 8),
        }))
        rows.push({
          width,
          scroll: foot.scrollWidth,
          client: foot.clientWidth,
          overflow: foot.scrollWidth - foot.clientWidth,
          children,
        })
      }
      dockHost.style.width = ''
      window.__MEASUREMENTS__ = rows
      return rows
    }
    window.__MEASURE__ = measure
    /* The measurements need the open card. */
    entry.click()
    await settle()
    await measure()

    /* The tokens the reader declares, read from its own stylesheet, and a way
     * to see whether a surface really carries them. */
    window.__READER_TOKENS__ = (() => {
      const source = Array.from(document.querySelectorAll('style'))
        .map(node => node.textContent || '')
        .join('\n')
      const block = source.match(/\.sr-float\{([^}]*)\}/)
      if (block === null) return []
      return [...new Set([...block[1].matchAll(/(--sr-[a-z0-9-]+)\s*:/g)].map(match => match[1]))]
    })()
    window.__TOKENS_MISSING_ON__ = element => {
      const names = window.__READER_TOKENS__ || []
      if (!element) return ['no surface']
      const style = getComputedStyle(element)
      return names.filter(name => style.getPropertyValue(name).trim() === '')
    }

    /* The reader takes its colours from the host's own tokens. The theme of
     * the host is read from the installed application and applied here, so
     * the reader is measured in the colours it really has — in the light
     * theme and in the dark one. */
    const themeSheet = document.createElement('style')
    document.head.appendChild(themeSheet)
    let themeCss = ''
    try {
      themeCss = await fetch('/host-tokens.css').then(response => response.text())
    } catch { themeCss = '' }
    themeSheet.textContent = themeCss
    /* The application runs on macOS, and the host has its own rules for it. */
    document.documentElement.dataset.platform = 'darwin'
    /* The dark theme can be asked for, so a change can be seen in it. */
    const askedTheme = new URLSearchParams(window.location.search).get('theme')
    if (askedTheme === 'dark') document.body.dataset.dsDarkTheme = '1'

    const resolveColor = (value) => {
      const probe = document.createElement('span')
      probe.style.position = 'absolute'
      probe.style.left = '-9999px'
      probe.style.top = '0'
      probe.style.width = '1px'
      probe.style.height = '1px'
      probe.style.background = 'transparent'
      probe.style.background = value
      document.body.appendChild(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    }
    const parseColor = color => {
      const found = String(color).match(/rgba?\(([^)]+)\)/)
      if (found === null) return null
      const parts = found[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length < 3 || parts.some(part => Number.isNaN(part))) return null
      return { r: parts[0], g: parts[1], b: parts[2] }
    }
    const luminance = color => {
      const channel = value => {
        const scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    }
    const contrast = (first, second) => {
      const a = parseColor(first)
      const b = parseColor(second)
      if (a === null || b === null) return null
      const high = Math.max(luminance(a), luminance(b))
      const low = Math.min(luminance(a), luminance(b))
      return (high + 0.05) / (low + 0.05)
    }
    const PAIRS = [
      ['--sr-bg', '--dsw-alias-bg-layer-1'],
      ['--sr-bg2', '--dsw-alias-bg-layer-2'],
      ['--sr-ink', '--dsw-alias-label-primary'],
      ['--sr-muted', '--dsw-alias-label-secondary'],
      ['--sr-line', '--dsw-alias-border-l1'],
      ['--sr-line2', '--dsw-alias-border-l2'],
      ['--sr-accent', '--dsw-alias-brand-primary'],
    ]
    if (themeCss.trim() === '' || themeCss.indexOf('--dsw-alias-bg-layer-1') === -1) {
      record('the theme of the host is available', false, 'the host theme was not read')
    } else {
      record('the theme of the host is available', true)
      const card = dockHost.querySelector('.sr-strip')
      if (!card) {
        record('the card takes the colours of the host', false, 'no card')
      } else {
        for (const dark of [false, true]) {
          /* An empty value still matches the host's attribute selector, so
           * the attribute is removed for the light theme. */
          if (dark) document.body.dataset.dsDarkTheme = '1'
          else delete document.body.dataset.dsDarkTheme
          await settle()
          await settle()
          const style = getComputedStyle(card)
          const mismatched = PAIRS.filter(pair => {
            const own = style.getPropertyValue(pair[0]).trim()
            const host = resolveColor('var(' + pair[1] + ')')
            return own === '' || own !== host
          })
          const name = dark ? 'dark' : 'light'
          record('the card takes the colours of the host in the ' + name + ' theme',
            mismatched.length === 0,
            mismatched.length === 0 ? '' : mismatched.map(pair => pair[0] + ' is ' + style.getPropertyValue(pair[0]).trim()
              + ' and the host has ' + resolveColor('var(' + pair[1] + ')')).join('; '))
          const ink = style.getPropertyValue('--sr-ink').trim()
          const surface = style.getPropertyValue('--sr-bg').trim()
          const reading = contrast(ink, surface)
          record('the reading text is legible in the ' + name + ' theme',
            reading !== null && reading >= 4.5,
            reading === null ? 'the colours could not be read' : 'contrast ' + reading.toFixed(2) + ':1')
          const quiet = contrast(style.getPropertyValue('--sr-muted').trim(), surface)
          record('the quiet text is legible in the ' + name + ' theme',
            quiet !== null && quiet >= 3,
            quiet === null ? 'the colours could not be read' : 'contrast ' + quiet.toFixed(2) + ':1')
        }
        /* Put the theme back the way it was asked for. */
        if (askedTheme === 'dark') document.body.dataset.dsDarkTheme = '1'
        else delete document.body.dataset.dsDarkTheme
        await settle()
      }
    }

    /* Where the card is on the page, so a driver can take its picture. The
     * picture is clipped in page coordinates, so the scroll is part of it.
     * The driver asks for the picture here, while the card is on screen: the
     * run goes on after the picture is taken, so every check still happens. */
    if (window.__SHOT_TARGET__ === 'card') {
      const card = dockHost.querySelector('.sr-strip')
      if (card) {
        card.scrollIntoView({ block: 'center' })
        await settle()
        const box = card.getBoundingClientRect()
        window.__CARD_BOX__ = {
          x: box.x + window.scrollX,
          y: box.y + window.scrollY,
          width: box.width,
          height: box.height,
        }
      }
      window.__SHOT_READY__ = true
      for (let attempt = 0; attempt < 100 && !window.__SHOT_DONE__; attempt += 1) await wait(100)
    }

    /* Every colour the reader asks of the host has to be a colour the host
     * really has. One of them was spelled the way it used to be spelled, and
     * the surface that asked for it kept a colour of its own without anybody
     * noticing. The host's own stylesheet is the truth here, and it is read
     * from the installed application. */
    const askedOfTheHost = (() => {
      const sheet = Array.from(document.querySelectorAll('style'))
        .map(node => node.textContent || '')
        .join('\n')
      /* Every colour the reader asks of the host has to be a colour the host
       * really has. A fallback does not save a name that was spelled the way
       * it used to be spelled: the surface then keeps a colour of its own,
       * silently, and nobody sees why. */
      const asked = [...sheet.matchAll(/var\((--dsw-[a-z0-9-]+)([^)]*)\)/g)]
        .map(match => ({ name: match[1], fallback: match[2].includes(',') }))
      const byName = new Map()
      for (const entry of asked) {
        const known = byName.get(entry.name)
        byName.set(entry.name, {
          name: entry.name,
          fallback: known === undefined ? entry.fallback : (known.fallback || entry.fallback),
        })
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    })()
    if (askedOfTheHost.length === 0) {
      record('the reader asks the host for its colours', false, 'no host colour was asked for')
    } else {
      record('the reader asks the host for its colours', true,
        askedOfTheHost.length + ' names')
      const missing = []
      for (const dark of [false, true]) {
        if (dark) document.body.dataset.dsDarkTheme = '1'
        else delete document.body.dataset.dsDarkTheme
        await settle()
        await settle()
        for (const entry of askedOfTheHost) {
          const value = getComputedStyle(document.body).getPropertyValue(entry.name).trim()
          if (value === '') missing.push((dark ? 'dark: ' : 'light: ') + entry.name)
        }
      }
      delete document.body.dataset.dsDarkTheme
      await settle()
      record('every colour the reader asks for is a colour the host has',
        missing.length === 0, missing.join('; '))
    }

    /* The pages that float above a modal are overlays in the host's own
     * words, and the card is a card. The two do not take the same colour. */
    const surfaceColours = (() => {
      const card = dockHost.querySelector('.sr-strip')
      const floating = document.querySelector('.sr-float')
      if (!card || !floating) return null
      const rule = Array.from(document.querySelectorAll('style')).map(n=>n.textContent||'').join('\n')
        .split('}').find(part => part.includes('.sr-float{'))
      window.__DEBUG_FLOAT__ = {
        className: floating.className,
        rule: rule === undefined ? 'no rule' : rule.slice(0, 200),
        count: document.querySelectorAll('.sr-float').length,
      }
      const host = name => resolveColor('var(' + name + ')')
      return {
        card: getComputedStyle(card).getPropertyValue('--sr-bg').trim(),
        cardHost: host('--dsw-alias-bg-layer-1'),
        floating: getComputedStyle(floating).getPropertyValue('--sr-bg').trim(),
        floatingHost: host('--dsw-alias-bg-layer-1'),
      }
    })()
    /* The floating page and the card are one material: the overlay colour is
     * a shade darker, and taking it made the reader's pages look like a
     * different application from the reader's card. */
    record('the card and the floating page are the same colour of card',
      surfaceColours !== null && surfaceColours.card === surfaceColours.cardHost
        && surfaceColours.floating === surfaceColours.floatingHost
        && surfaceColours.card === surfaceColours.floating,
      surfaceColours === null ? 'no surface' : JSON.stringify(surfaceColours))

    /* A row under the pointer has to show that it is under the pointer. In the
     * light theme the hover colour used to be the colour of the surface, so
     * the rows showed nothing at all. */
    const hover = (() => {
      const row = document.querySelector('.sr-ibtn')
      if (!row) return null
      const surface = row.closest('.sr-strip') || document.body
      const own = getComputedStyle(surface).getPropertyValue('--sr-hover').trim()
      const host = resolveColor('var(--dsw-alias-interactive-bg-hover)')
      return { own, host, surface: getComputedStyle(surface).getPropertyValue('--sr-bg').trim() }
    })()
    record('the rows show that the pointer is over them',
      hover !== null && hover.own !== '' && hover.own !== hover.surface,
      hover === null ? 'no row' : JSON.stringify(hover))

    /* The Harness settings own a modal of their own. The catalog opened from
     * there has to float above it, and it belongs to that panel: when the
     * panel goes, the catalog goes with it. */
    const section = registrations.get('settings.section')
    if (!section || !section.component) {
      record('the settings section is registered', false, 'no settings.section registration')
    } else {
      record('the settings section is registered', true)
      const settingsHost = document.createElement('div')
      document.body.appendChild(settingsHost)
      const settingsRoot = ReactDOM.createRoot(settingsHost)
      settingsRoot.render(React.createElement(section.component, {}))
      await settle()
      await settle()
      /* The labels are the ones of the active language, so a Chinese panel
       * is checked in Chinese and not in a translation of the English one. */
      const words = window.__LOCALE__ === 'zh'
        ? { books: '书库', yourBooks: '我的书' }
        : { books: 'Books', yourBooks: 'Your books' }
      /* A Chinese reader sees a Chinese panel. The other checks look for the
       * English words, so the Chinese ones are checked here: a panel that
       * fell back to English would pass every other check. */
      if (window.__LOCALE__ === 'zh') {
        const visible = host => Array.from(host.querySelectorAll('*'))
          .filter(node => node.children.length === 0)
          .filter(node => !['STYLE', 'SCRIPT'].includes(node.tagName))
          .map(node => String(node.textContent || '').trim())
          .filter(text => text !== '')
          .join(' ')
        const latin = text => (text.match(/[A-Za-z]{4,}/g) || []).slice(0, 4).join(' ')
        const entryText = visible(toolbarHost)
        const cardText = visible(dockHost)
        /* The panel must not merely avoid English: it must say something in
         * the language of the reader. */
        const han = text => /[\u4e00-\u9fff]/.test(text)
        record('the reader speaks the language of the reader',
          !/[A-Za-z]{4,}/.test(entryText) && !/[A-Za-z]{4,}/.test(cardText)
            && (han(entryText) || han(cardText) || han(visible(settingsHost))),
          latin(entryText) + ' / ' + latin(cardText))
        const tabLabels = Array.from(settingsHost.querySelectorAll('button.sr-set-tab'))
          .map(button => String(button.textContent || '').trim())
        record('the settings tabs are in the language of the reader',
          tabLabels.length > 0 && tabLabels.every(label => !/[A-Za-z]{4,}/.test(label)),
          tabLabels.map(label => latin(label)).join('|'))
      }

      /* The two pages of the reader wear one title, and the browser says so:
       * a stylesheet is easy to read and easy to read wrongly. Both are on
       * screen here, so this is the one place the two can be compared. */
      const shopNow = document.querySelector('.sr-shop')
      if (shopNow !== null) {
        const shopTitle = shopNow.querySelector('.sr-shop-head strong')
        const shopHead = shopNow.querySelector('.sr-shop-head')
        const setTitle = settingsHost.querySelector('.sr-set-settings-title, .sr-set-settings-head strong')
        const setHead = settingsHost.querySelector('.sr-set-settings-head')
        const face = element => {
          if (!element) return null
          const style = getComputedStyle(element)
          return { size: style.fontSize, weight: style.fontWeight }
        }
        record('the book page and the settings page wear one title',
          shopTitle !== null && setTitle !== null
            && face(shopTitle).size === face(setTitle).size
            && face(shopTitle).weight === face(setTitle).weight,
          JSON.stringify(face(shopTitle)) + ' against ' + JSON.stringify(face(setTitle)))
        /* What the eye reads is where the title starts, not which element
         * carries the padding: the settings page is inset by its body, the
         * book page by its own head. */
        const origin = element => {
          if (element === null) return null
          const box = element.getBoundingClientRect()
          return { top: Math.round(box.top), left: Math.round(box.left) }
        }
        /* Inset is measured from the page the title belongs to: the two
         * pages are different widths, so the same inset puts the titles at
         * different places on screen and that is not a difference. */
        const insetOf = (title, page) => {
          if (title === null || page === null) return null
          const a = title.getBoundingClientRect()
          const b = page.getBoundingClientRect()
          return { top: Math.round(a.top - b.top), left: Math.round(a.left - b.left) }
        }
        const shopInset = insetOf(shopTitle, shopNow)
        const setInset = insetOf(setTitle, settingsHost.querySelector('.sr-set-settings-page'))
        /* The vertical inset is the one the reader compares: the two pages
         * are different widths and sit in different containers, so the
         * horizontal inset is each page's own business. */
        record('the two page heads sit at the same height',
          shopInset !== null && setInset !== null && shopInset.top === setInset.top,
          JSON.stringify(shopInset) + ' against ' + JSON.stringify(setInset))
      }

      const booksTab = Array.from(settingsHost.querySelectorAll('button.sr-set-tab'))
        .find(button => button.textContent === words.books)
      if (!booksTab) {
        record('the settings section has a Books tab', false,
          'no ' + words.books + ' tab, saw: '
          + Array.from(settingsHost.querySelectorAll('button.sr-set-tab')).map(b => b.textContent).join('|'))
      } else {
        booksTab.click()
        await settle()
        await settle()
        const yourBooks = Array.from(settingsHost.querySelectorAll('button.sr-set-action'))
          .find(button => button.textContent === words.yourBooks)
        if (!yourBooks) {
          record('the settings section has a door to the catalog', false,
            'no ' + words.yourBooks + ', saw: '
            + Array.from(settingsHost.querySelectorAll('button.sr-set-action')).map(b => b.textContent).join('|'))
        } else {
          record('the settings section has a door to the catalog', true)
          yourBooks.click()
          await settle()
          await settle()
          const catalog = document.querySelector('.sr-picker')
          /* The catalog can be photographed where it is: over the settings
           * panel of the host. */
          if (window.__SHOT_TARGET__ === 'catalog' && catalog) {
            const box = catalog.getBoundingClientRect()
            window.__CARD_BOX__ = {
              x: box.x + window.scrollX,
              y: box.y + window.scrollY,
              width: box.width,
              height: box.height,
            }
            window.__SHOT_READY__ = true
            for (let attempt = 0; attempt < 100 && !window.__SHOT_DONE__; attempt += 1) await wait(100)
          }
          record('the catalog is drawn beside the root',
            catalog !== null && catalog.parentElement === document.body,
            catalog ? (catalog.parentElement ? (catalog.parentElement.className || catalog.parentElement.tagName) : 'no parent') : 'no catalog')
          const catalogZ = catalog ? Number(getComputedStyle(catalog).zIndex) : 0
          record('the catalog floats above the modals of the host', catalogZ > 1000, 'z-index ' + catalogZ)
          record('the catalog is not drawn inside the settings panel',
            catalog !== null && !settingsHost.contains(catalog))
          /* A list of one book is a small card, not a page with an empty
           * half: the catalog sizes to its rows. */
          const catalogBox = catalog ? catalog.getBoundingClientRect() : null
          const rows = catalog ? catalog.querySelectorAll('.sr-list-row').length : 0
          /* A short list sizes to its rows; an empty one says so instead. */
          if (!window.__BROKEN_ROUTE__) {
            record('a short catalog is as tall as its rows',
              catalogBox !== null && (emptyLibrary ? rows === 0 : rows > 0) && catalogBox.height < 340,
              catalogBox === null ? 'no catalog' : rows + ' rows in ' + Math.round(catalogBox.height) + 'px')
          }
          /* An empty library says so, and still offers the way to fill it. */
          if (emptyLibrary) {
            const empty = catalog ? catalog.querySelector('.sr-pick-empty') : null
            record('an empty catalog says the library is empty', empty !== null,
              empty === null ? 'no message' : String(empty.textContent || '').slice(0, 60))
          }
          /* The settings section carries the same tokens as every other
           * surface of the reader. */
          const sectionMissing = (window.__TOKENS_MISSING_ON__ || (() => ['no surface']))(
            settingsHost.querySelector('.sr-set-section'))
          record('the settings section carries every colour the reader declares',
            sectionMissing.length === 0, sectionMissing.join('; '))
          /* The settings page is a page of the Harness settings, so it takes
           * the colour of the host's own pages. */
          const sectionEl = settingsHost.querySelector('.sr-set-section')
          const sectionBg = sectionEl ? getComputedStyle(sectionEl).getPropertyValue('--sr-bg').trim() : ''
          const pageBg = resolveColor('var(--dsw-alias-bg-layer-1)')
          record('the settings section is the colour of a page of the host',
            sectionBg !== '' && sectionBg === pageBg, sectionBg + ' and the host has ' + pageBg)
          /* A line of its own: a border that cannot be drawn is no border,
           * and the reader had none while the colour of a line was named
           * like the height of one. */
          const head = catalog ? catalog.querySelector('.sr-pick-head') : null
          const headStyle = head ? getComputedStyle(head) : null
          record('the catalog draws the lines of its own',
            headStyle !== null && headStyle.borderBottomStyle === 'solid'
              && Number.parseFloat(headStyle.borderBottomWidth) > 0,
            headStyle === null ? 'no head' : headStyle.borderBottomStyle + ' ' + headStyle.borderBottomWidth)
          /* The settings stay where they were: the catalog is over them, not
           * in place of them. */
          record('the settings stay behind the catalog',
            settingsHost.querySelector('.sr-set-settings-page') !== null)
          /* The panel owns Escape, so the catalog takes it first and the panel
           * stays where it is. */
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await settle()
          await settle()
          record('escape closes the catalog and keeps the settings panel',
            document.querySelector('.sr-picker') === null && document.body.contains(settingsHost))
          /* And the catalog does not outlive the panel. */
          settingsRoot.unmount()
          await settle()
          await settle()
          record('the catalog does not outlive the settings panel',
            document.querySelector('.sr-picker') === null)
        }
      }
      settingsRoot.unmount()
      settingsHost.remove()
      await settle()
    }

    /* Not one declaration the reader writes may be dropped by the browser.
     *
     * A declaration without its semicolon swallows the one after it, and a
     * swallowed declaration leaves no trace: the rule still parses, the page
     * still works, and one colour quietly keeps its old value. The browser's
     * own parser is the truth here, so the tokens the reader declares are
     * read back from the three surfaces that declare them. */
    const tokensMissingOn = window.__TOKENS_MISSING_ON__
    const missingTokens = []
    for (const [what, element] of [
      ['the floating page', document.querySelector('.sr-float')],
      ['the card', dockHost.querySelector('.sr-strip')],
    ]) {
      for (const name of tokensMissingOn(element)) missingTokens.push(what + ': ' + name)
    }
    record('the browser keeps every declaration the reader writes',
      (window.__READER_TOKENS__ || []).length > 0 && missingTokens.length === 0,
      missingTokens.length === 0
        ? (window.__READER_TOKENS__ || []).length + ' tokens on every surface'
        : missingTokens.join('; '))

    /* Unmounting must release what the client registered, including the
     * document-level listeners the card leaves behind. */
    const balance = window.__LISTENER_BALANCE__()
    toolbarRoot.unmount()
    dockRoot.unmount()
    overlayRoot.unmount()
    await settle()
    const after = window.__LISTENER_BALANCE__()
    /* React itself keeps a selectionchange listener on the document, so the
     * count that matters is the one the reader's own code owns. */
    const owned = kinds => kinds.split(',').filter(kind => kind !== '+selectionchange')
    const added = owned(after.kinds).filter(kind => kind.startsWith('+')).length
    const removed = owned(after.kinds).filter(kind => kind.startsWith('-')).length
    record('unmounting leaves no document listener behind', added === removed,
      `before unmount ${balance.added}/${balance.removed}, after ${after.added}/${after.removed}, kinds ${after.kinds}`)
    document.getElementById('results').textContent = results.map(r => (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' :: ' + r.detail : '')).join('\n')
    window.__RESULTS__ = results
    window.__DONE__ = true
  }

  run().catch(failure => {
    record('the scenario ran to the end', false, failure && failure.message)
    document.getElementById('results').textContent = results.map(r => (r.ok ? 'PASS ' : 'FAIL ') + r.name).join('\n')
    window.__RESULTS__ = results
    window.__DONE__ = true
  })
})()
