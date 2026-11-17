/**
 * Runtime crash probe for the reader's Client half.
 *
 * It imports the real client bundle against a minimal React stand-in and
 * drives the panel through the states a user can reach, including the ones
 * behind the "add" button. The probe reports thrown exceptions; it renders
 * nothing and asserts nothing about appearance.
 */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const CLIENT = './dsh-plugin-stealth-reader/lib/client.js'
const results = []

/**
 * Record one probe result.
 * @param {string} name - the probe name
 * @param {() => void} body - the probe body
 * @returns {void}
 */
const pendingProbes = []
function probe(name, body) {
  // The probes run one after the other, so a probe that changes what the
  // host answers cannot disturb the next one.
  pendingProbes.push(async () => {
    try {
      await body()
      results.push(`PASS  ${name}`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (process.env.DSH_PROBE_TRACE) console.log('TRACE', name, error && error.stack)
      results.push(`FAIL  ${name}: ${detail}`)
    }
  })
}

/**
 * Compare two dependency lists the way React does.
 * @param {Array} [left] - the old dependencies
 * @param {Array} [right] - the new dependencies
 * @returns {boolean} true when the lists differ
 */
function sameDeps(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false
  }
  return true
}

/**
 * Build a stand-in for a DOM node.
 *
 * It records the listeners that are attached to it, and it measures
 * nothing: a node that cannot be measured leaves the reader's own
 * fallbacks in charge.
 *
 * @returns {object} the node
 */
function makeFakeNode() {
  const listeners = []
  const node = {
    listeners,
    scrollTop: 0,
    clientHeight: 0,
    scrollWidth: 0,
    // The card measures its own row, so a probe can tell the row how wide it
    // is and watch the row redraw itself.
    clientWidth: 0,
    scrollHeight: 0,
    addEventListener(kind, listener, options) {
      listeners.push({ kind, listener, options })
    },
    removeEventListener(kind, listener) {
      const at = listeners.findIndex(row => row.kind === kind && row.listener === listener)
      if (at !== -1) listeners.splice(at, 1)
    },
    getBoundingClientRect() {
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
    },
    focus() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    // The probe says whether the click landed inside the node.
    contains() { return node.inside === true },
  }
  return node
}

/**
 * The node a callback ref was given, so a later render keeps it.
 *
 * @type {WeakMap<object, object>}
 */
const refNodes = new WeakMap()

/** Minimal React stand-in: enough to run the component and catch throws. */
function makeReact() {
  let index = 0
  let cells = []
  // Ref records for the component that is rendering right now: the ones this
  // pass creates, and the ones the previous pass created. React keeps the same
  // element across a re-render, so a callback whose identity changed still
  // receives that element.
  let refOut = []
  let refIn = []
  const effects = []
  // Each component instance owns its own hook slots, like React.
  const slotCache = new Map()
  const createElement = (type, props, ...children) => {
    if (type === undefined || type === null) {
      throw new Error('createElement received an undefined type (React.Fragment is not part of the Client contract)')
    }
    // A function type is a component: render it, so the probe reaches the
    // code behind every panel state.
    if (typeof type === 'function') {
      // Render the child with hook slots that persist for the same component
      // type, the way React reuses a mounted component's state.
      const own = slotCache.get(type) || { index: 0, cells: [], refs: [], hooks: undefined }
      slotCache.set(type, own)
      const saved = cells
      const savedIndex = index
      const savedOut = refOut
      const savedIn = refIn
      cells = own.cells
      index = own.index
      const previousRefs = own.refs
      own.refs = []
      refOut = own.refs
      refIn = previousRefs
      let result
      let used = 0
      const before = index
      try {
        result = type(props || {}, ...children)
        used = index - before
      } finally {
        // Keep the child's cursor so its next render continues in place.
        own.index = index
        cells = saved
        index = savedIndex
        refOut = savedOut
        refIn = savedIn
      }
      // React refuses a component that takes a different number of hooks
      // from one render to the next, so the probe refuses it too.
      if (own.hooks !== undefined && used !== own.hooks) {
        const name = typeof type.name === 'string' && type.name !== '' ? type.name : 'a component'
        throw new Error(`the component ${name} took ${used} hooks this time and ${own.hooks} last time`)
      }
      own.hooks = used
      return result
    }
    const propsOf = props || {}
    // A ref is given a node, the way React gives it one. The node is a
    // stand-in: it records the listeners that are attached to it, so a
    // probe can drive the surfaces that listen for the wheel or for a
    // click outside them.
    const ref = propsOf.ref
    if (ref !== undefined && ref !== null) {
      if (typeof ref === 'function') {
        const slot = refOut.length
        const previous = refIn[slot]
        const node = previous !== undefined
          ? previous.node
          : (refNodes.get(ref) || makeFakeNode())
        refOut[slot] = { callback: ref, node }
        if (previous !== undefined && previous.callback !== ref) {
          // React detaches the old callback, then attaches the new one to the
          // same element. A callback that ignores null cannot break a render.
          try { previous.callback(null) } catch { /* A detaching ref must not throw. */ }
        }
        if (previous === undefined || previous.callback !== ref) {
          refNodes.set(ref, node)
          ref(node)
        }
      } else if (typeof ref === 'object') {
        if (ref.current === null || ref.current === undefined) ref.current = makeFakeNode()
      }
    }
    return {
      type: typeof type === 'string' ? type : (type.$$typeof ? 'fragment' : String(type)),
      props: propsOf,
      children: children.flat(Infinity).filter(child => child !== undefined && child !== null && child !== false),
    }
  }
  return {
    React: {
      createElement,
      // Deliberately absent: Fragment. The Client builtin contract does not
      // promise it, so the client must not depend on it.
      useState(initial) {
        const slot = index++
        // Bind the slot array and index now: the module-level `cells` is
        // swapped while a child renders, so the setter must not read it later.
        const own = cells
        if (!own[slot]) own[slot] = { has: false, value: undefined }
        if (!own[slot].has) {
          own[slot].has = true
          own[slot].value = typeof initial === 'function' ? initial() : initial
        }
        const set = (next) => {
          own[slot].value = typeof next === 'function' ? next(own[slot].value) : next
        }
        return [own[slot].value, set]
      },
      useRef(initial) {
        const slot = index++
        if (!cells[slot]) cells[slot] = { has: false, ref: { current: initial } }
        if (!cells[slot].has) {
          cells[slot].has = true
          cells[slot].ref = { current: initial }
        }
        return cells[slot].ref
      },
      useEffect(effect, deps) {
        const slot = index++
        const own = cells
        if (!own[slot]) own[slot] = { has: false, deps: undefined, cleanup: undefined }
        // React runs an effect again only when its dependencies change.
        const changed = own[slot].deps === undefined || deps === undefined
          || !sameDeps(own[slot].deps, deps)
        own[slot].deps = deps
        if (!changed) return
        // React cleans the previous effect up before it runs the new one, so a
        // re-subscribing effect never leaves its old listener registered.
        const previous = own[slot].cleanup
        if (typeof previous === 'function') {
          effects.push(async () => {
            own[slot].cleanup = undefined
            cleanups.delete(previous)
            const outcome = previous()
            if (outcome && typeof outcome.then === 'function') await outcome
          })
        }
        effects.push(async () => {
          const outcome = effect()
          if (typeof outcome === 'function') {
            own[slot].cleanup = outcome
            cleanups.add(outcome)
          } else if (outcome && typeof outcome.then === 'function') await outcome
        })
      },
      // The layout effect runs before the browser paints. The double runs it
      // with the other effects: the order of the paint is not what the probe
      // is about, and the effect itself is the same either way.
      useLayoutEffect(effect, deps) {
        react.React.useEffect(effect, deps)
      },
      useMemo(factory, deps) {
        const slot = index++
        const own = cells
        if (!own[slot]) own[slot] = { has: false, value: undefined, deps: undefined }
        const changed = own[slot].deps === undefined || deps === undefined
          || !sameDeps(own[slot].deps, deps)
        own[slot].deps = deps
        if (!own[slot].has || changed) {
          own[slot].has = true
          own[slot].value = factory()
        }
        return own[slot].value
      },
      useCallback(fn, deps) {
        const slot = index++
        const own = cells
        if (!own[slot]) own[slot] = { has: false, value: undefined, deps: undefined }
        const changed = own[slot].deps === undefined || deps === undefined
          || !sameDeps(own[slot].deps, deps)
        own[slot].deps = deps
        if (!own[slot].has || changed) {
          own[slot].has = true
          own[slot].value = fn
        }
        return own[slot].value
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        // The snapshot is read on every render, the way React re-reads it.
        // A store change re-renders the component in React, so the probe
        // records the subscription and marks the tree dirty when it fires.
        const slot = index++
        const own = cells
        if (!own[slot]) own[slot] = { has: false }
        if (!own[slot].has) {
          own[slot].has = true
          effects.push(() => subscribe(() => { pendingStoreChange = true }))
        }
        return getSnapshot()
      },
    },
    reset() {
      index = 0
      cells = []
      effects.length = 0
      cleanups.clear()
      slotCache.clear()
    },
    // React restarts every component's hook cursor on each render pass.
    beginRender() {
      index = 0
      for (const own of slotCache.values()) own.index = 0
    },
    slotCache,
    /**
     * Hand the double a node for one callback ref.
     *
     * A probe that drives a body needs the very element the component holds,
     * not a copy of it: a listener on a copy never sees the probe's scroll.
     *
     * @param {Function} callback - the callback ref
     * @param {object} node - the element it stands for
     * @returns {object} the adopted node
     */
    adoptRefNode(callback, node) {
      refNodes.set(callback, node)
      // A record that already holds this callback keeps the adopted node, so a
      // later callback identity change reuses the element the probe drives.
      for (const own of slotCache.values()) {
        for (const record of own.refs) {
          if (record.callback === callback) record.node = node
        }
      }
      return node
    },
    /**
     * Render a root component with slots of its own.
     *
     * A root component that is called directly has no parent to give it
     * slots, so two roots would share one set of slots and the second one
     * would read the first one's state. Each root keeps its own, the way
     * two mounted components do.
     *
     * @param {Function} component - the component
     * @param {object} [props] - its props
     * @returns {any} the rendered element
     */
    mount(component, props) {
      const own = slotCache.get(component) || { index: 0, cells: [], refs: [], hooks: undefined }
      slotCache.set(component, own)
      const saved = cells
      const savedIndex = index
      const savedOut = refOut
      const savedIn = refIn
      cells = own.cells
      index = own.index
      const previousRefs = own.refs
      own.refs = []
      refOut = own.refs
      refIn = previousRefs
      let result
      const before = index
      try {
        result = component(props || {})
      } finally {
        own.index = index
        cells = saved
        index = savedIndex
        refOut = savedOut
        refIn = savedIn
      }
      const used = own.index - before
      if (own.hooks !== undefined && used !== own.hooks) {
        const name = typeof component.name === 'string' ? component.name : 'a component'
        throw new Error(`the component ${name} took ${used} hooks this time and ${own.hooks} last time`)
      }
      own.hooks = used
      return result
    },
    effects,
    // Run the collected effects, the way React runs them after a commit,
    // keeping the cleanups React would run when the component unmounts.
    async flushEffects() {
      const pending = effects.splice(0, effects.length)
      for (const effect of pending) {
        const outcome = effect()
        if (typeof outcome === 'function') cleanups.add(outcome)
        else if (outcome && typeof outcome.then === 'function') await outcome
      }
    },
    // Unmount: React runs every cleanup it collected, which is how a probe
    // sees what a component does when its surface goes away.
    cleanupCount() { return cleanups.size },
    async unmount() {
      const pending = [...cleanups]
      cleanups.clear()
      for (const cleanup of pending) {
        const outcome = cleanup()
        if (outcome && typeof outcome.then === 'function') await outcome
      }
    },
  }
}

// An unhandled rejection in an asynchronous handler is a real defect; the
// probe must report it rather than dying silently.
const unhandled = []
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason instanceof Error ? reason.message : String(reason))
})

const react = makeReact()

/**
 * The host stub.
 *
 * It answers the actions the panel makes, so the probe reaches the reading
 * surface: the progress bar, the search field and the chapter list.
 *
 * @param {string} url - the requested URL
 * @param {object} options - the request options
 * @returns {Promise<object>} a response with a JSON body
 */
async function hostFetch(url, options = {}) {
  let action = 'state'
  let payload = {}
  try {
    payload = JSON.parse(options.body || '{}')
    action = payload.action || 'state'
  } catch {
    action = 'state'
  }
  hostCalls.push({ action, payload })
  // The chapter a request asks for, defaulting to the one that is open.
  const asked = Number.isInteger(payload.index)
    ? payload.index
    : (hostState.current ? hostState.current.index : 0)
  /** Build the chapter the host would answer with. @param {number} at - index @returns {object} the chapter */
  const chapterOf = (at) => ({
    bookId: 'book-1',
    bookTitle: '测试小说',
    title: at === 0 ? '第一章 启程' : `第${at + 1}章 继续`,
    index: at,
    total: hostBook.total,
    text: `第一段文字。\n第二段文字。\n第三段文字。`,
  })
  const chapter = chapterOf(asked)
  const bodies = {
    state: { ok: true, get settings() { return { ...hostSettings } }, get books() { return hostBooks }, get sites() { return hostSites }, get current() { return hostState.current }, get positions() { return hostPositions } },
    chapter: { ok: true, chapter },
    get open() {
      // The host remembers where the reader is, so the next state read says
      // the same chapter.
      hostState.current = { bookId: 'book-1', index: asked }
      return { ok: true, chapter: chapterOf(asked) }
    },
    next: { ok: true, chapter },
    prev: { ok: true, chapter },
    toc: { ok: true, toc: { bookId: 'book-1', total: 3, index: 0, chapters: [{ index: 0, title: '第一章 启程' }, { index: 1, title: '第二章 远行' }, { index: 2, title: '第三章 归来' }] } },
    get search() {
      // The host answers with every place the term was found, and each place
      // carries the line it sits on, so the reader can be put on it.
      const term = String(payload.term || '文字')
      const text = chapter.text
      const lower = text.toLowerCase()
      const needle = term.toLowerCase()
      const hits = []
      let at = lower.indexOf(needle)
      while (at !== -1 && hits.length < 20) {
        const lines = text.slice(0, at).split('\n').filter(line => line.trim() !== '')
        hits.push({
          at,
          line: lines.length,
          flow: at,
          snippet: text.slice(Math.max(0, at - 4), at + needle.length + 4),
        })
        at = lower.indexOf(needle, at + needle.length)
      }
      return {
        ok: true,
        result: {
          term,
          total: hits.length,
          shown: hits.length,
          truncated: false,
          matches: hits.length === 0 ? [] : [{
            index: asked,
            title: chapter.title,
            count: hits.length,
            at: hits[0].at,
            line: hits[0].line,
            flow: hits[0].flow,
            snippet: hits[0].snippet,
            hits,
          }],
        },
      }
    },
    settings: { ok: true, skin: 'plain' },
    get cover() { return hostFetchCover(payload.bookId) },
  }
  const body = bodies[action] || { ok: true }
  return {
    ok: true,
    status: 200,
    async json() { return body },
  }
}

// Every request the panel made, so a probe can see what it asked for.
const hostCalls = []

// What the host reports as the open book, so a probe can take it away.
const hostState = { current: { bookId: 'book-1', index: 0 } }

// The cover answer; a probe watches which books ask for one.
let hostFetchCover = () => ({ ok: true, cover: null })

// The books the host reports; a probe may swap in a whole shelf.
let hostBooks = [{ id: 'book-1', kind: 'txt', title: '测试小说', source: 'n.txt', chapters: 5 }]

// The websites the host reports, so a probe can see the website library.
let hostSites = [{ id: 'site-1', title: '示例书站', url: 'https://books.example/', origin: 'https://books.example' }]

// The settings the host reports, so a probe can choose a reading mode.
const hostSettings = { skin: 'plain', fontSize: 15, width: 430, placement: 'sidebar', libraryShape: 'list' }
// The places the host remembers, one per book.
const hostPositions = {}

// How many chapters the book has.
const hostBook = { total: 5 }

// The client half calls the host through fetch.
globalThis.fetch = hostFetch
let factory = null

// A document stand-in, so the panel's own key listener can be exercised.
const documentListeners = []
const documentOutsideListeners = []
globalThis.document = {
  addEventListener(kind, listener) {
    if (kind === 'keydown') documentListeners.push(listener)
    else documentOutsideListeners.push(listener)
  },
  removeEventListener(kind, listener) {
    const at = documentListeners.indexOf(listener)
    if (at !== -1) documentListeners.splice(at, 1)
    const outsideAt = documentOutsideListeners.indexOf(listener)
    if (outsideAt !== -1) documentOutsideListeners.splice(outsideAt, 1)
  },
}

/**
 * Click on the page, outside any surface.
 *
 * @param {object} [target] - what was clicked
 * @returns {number} how many listeners heard the click
 */
function clickOutside(target = {}) {
  const listeners = [...documentOutsideListeners]
  for (const listener of listeners) listener({ target })
  return listeners.length
}

/**
 * The node an element was given, the way React gives it one.
 *
 * @param {any} element - the element
 * @returns {object} the node, or null when there is none
 */
function nodeOf(element) {
  if (element === null || element === undefined) return null
  const ref = element.props.ref
  if (typeof ref === 'function') return refNodes.get(ref) || null
  if (ref !== null && ref !== undefined && typeof ref === 'object') return ref.current || null
  return null
}

/**
 * Send one key event to the panel's document listener.
 * @param {object} event - the key event fields
 * @returns {boolean} true when a listener took the event
 */
function pressKey(event) {
  let taken = false
  for (const listener of [...documentListeners]) {
    let prevented = false
    listener({
      ...event,
      preventDefault() { prevented = true },
      isComposing: false,
    })
    if (prevented) taken = true
  }
  return taken
}

// A size observer stand-in: the card watches its own row, and a probe tells
// the observer how wide that row is.
const sizeObservers = []
globalThis.ResizeObserver = class {
  constructor(callback) {
    this.callback = callback
    this.target = null
    sizeObservers.push(this)
  }

  observe(target) { this.target = target }

  unobserve() {}

  disconnect() { this.target = null }
}

/**
 * Give every watched row a new width, the way a browser does.
 * @param {number} width - the new width of the row
 * @returns {number} how many rows were told
 */
function resizeRows(width) {
  let told = 0
  for (const observer of sizeObservers) {
    if (observer.target === null || observer.target === undefined) continue
    observer.target.clientWidth = width
    observer.callback([{ target: observer.target, contentRect: { width } }], observer)
    told += 1
  }
  return told
}

globalThis.window = {
  __ModuleLoader__: {
    load(options) {
      factory = options.factory
      return options
    },
  },
}

// The bundle requires 'react'; hand it the stand-in.
globalThis.require = () => ({ react: react.React })

const moduleSource = readFileSync(CLIENT, 'utf8')
const moduleUrl = process.env.DSH_PROBE_FILE === '1'
  ? 'file://' + CLIENT
  : 'data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64')
await import(moduleUrl)

if (factory === null) throw new Error('the client bundle did not call window.__ModuleLoader__.load')

const client = factory((name) => {
  if (name === 'react') return react.React
  throw new Error(`the client half requires an unexpected module: ${name}`)
})

/**
 * Build a Cordis-like client context for the probe.
 * @param {object} [options] - probe options
 * @returns {object} the fake context
 */
function makeContext(options = {}) {
  const registered = []
  const slots = {
    inject: (_slot, register) => {
      // The callback returns the slot registration, whose component renders.
      const entry = register()
      registered.push(entry)
      return () => {}
    },
    register: (options, component) => ({ options, component }),
  }
  const locale = { register: () => () => {}, bind: () => {}, subscribe: () => () => {} }
  const uiWorkspace = { pickDirectory: async () => options.pickedDirectory ?? null }
  // The shortcuts service, modelled on the real one: describeBinding
  // normalises a combination, registerFixed reserves it, and
  // observeFixedInput hands the owner the gesture.
  const shortcuts = {
    runtime: 'desktop',
    platform: 'macos',
    registered: [],
    listeners: [],
    describeBinding(binding) {
      if (binding === undefined || binding === null) return { binding: null, keys: [], issue: null, conflicts: [] }
      const modifiers = (binding.modifiers || []).slice().sort()
      return {
        binding: { code: binding.code, modifiers },
        keys: [...modifiers, binding.code].join('+'),
        issue: null,
        conflicts: [],
      }
    },
    registerFixed(command) {
      shortcuts.registered.push(command)
      return () => {
        shortcuts.registered = shortcuts.registered.filter(entry => entry !== command)
      }
    },
    observeFixedInput(listener) {
      shortcuts.listeners.push(listener)
      return () => {
        shortcuts.listeners = shortcuts.listeners.filter(entry => entry !== listener)
      }
    },
  }
  const sidebarRightTabs = {
    registered: [],
    register(definition) {
      sidebarRightTabs.registered.push(definition)
      return () => {
        sidebarRightTabs.registered = sidebarRightTabs.registered.filter(entry => entry !== definition)
      }
    },
  }
  const ctx = {
    slots,
    locale,
    uiWorkspace,
    shortcuts,
    sidebarRight: {
      openTab() {},
      openTabs: { getSnapshot: () => [], subscribe: () => () => {} },
    },
    sidebarRightTabs,
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      if (name === 'uiWorkspace') return uiWorkspace
      if (name === 'shortcuts') return shortcuts
      if (name === 'sidebarRight') return ctx.sidebarRight
      if (name === 'sidebarRightTabs') return ctx.sidebarRightTabs
      return undefined
    },
    on: () => () => {},
    provide: () => () => {},
    // The effect runs its function straight away, the way the real one does.
    effect(fn) {
      const dispose = typeof fn === 'function' ? fn() : undefined
      return typeof dispose === 'function' ? dispose : () => {}
    },
    // An optional service is present, so the callback runs at once.
    inject(_names, callback) {
      callback(ctx)
      return () => {}
    },
  }
  return { ctx, registered, shortcuts }
}

probe('the shortcuts service registers the panel chords without throwing', async () => {
  react.reset()
  const { ctx, registered, shortcuts } = makeContext()
  client.apply(ctx)
  if (registered.length === 0) throw new Error('the panel slot was not registered')
  // The host says which shape the reader is in, then the panel is driven on
  // the same client so its effects run against that state.
  const overlay = componentOf(registered, 'shell.overlay')
  react.beginRender()
  overlay()
  await react.flushEffects()
  await settle()
  const tree = componentOf(registered, 'sidebar.right.pane.tab')({})
  if (tree === undefined) throw new Error('the panel rendered nothing')
  await react.flushEffects()
  if (shortcuts.registered.length === 0) {
    throw new Error('no chord was reserved with the shortcuts service')
  }
  for (const command of shortcuts.registered) {
    if (typeof command.id !== 'string' || command.id === '') throw new Error('a chord has no id')
    if (typeof command.label !== 'function') throw new Error('a chord has no label')
    if (!Array.isArray(command.bindings) || command.bindings.length === 0) throw new Error('a chord reserves no key')
  }
  // A gesture that matches a chord must reach the action.
  let consumed = false
  const listener = shortcuts.listeners[shortcuts.listeners.length - 1]
  if (typeof listener !== 'function') throw new Error('no chord listener was installed')
  listener({
    type: 'keydown',
    gesture: { code: 'ArrowRight', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'page', modal: null, target: null },
    consume() { consumed = true },
  })
  if (!consumed) throw new Error('a matching chord was not consumed')
  // A gesture that does not match must be left alone.
  let stray = false
  listener({
    type: 'keydown',
    gesture: { code: 'KeyQ', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'page', modal: null, target: null },
    consume() { stray = true },
  })
  if (stray) throw new Error('an unrelated chord was consumed')
})

probe('a chord never takes the keys away from a field outside the panel', async () => {
  const { ctx, registered, shortcuts } = makeContext()
  client.apply(ctx)
  componentOf(registered, 'sidebar.right.pane.tab')({})
  await react.flushEffects()
  const listener = shortcuts.listeners[shortcuts.listeners.length - 1]
  if (typeof listener !== 'function') throw new Error('no chord listener was installed')

  // A field outside the panel has the focus: the chord must be left alone.
  const outsideField = {
    matches: (selector) => selector.includes('input'),
    closest: (selector) => (selector === '.sr-root' ? null : null),
  }
  let eaten = false
  listener({
    type: 'keydown',
    gesture: { code: 'KeyN', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'editable', modal: null, target: outsideField },
    consume() { eaten = true },
  })
  if (eaten) throw new Error('a chord took the key from a field outside the panel')

  // A terminal keeps its keys too.
  eaten = false
  listener({
    type: 'keydown',
    gesture: { code: 'KeyN', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'terminal', modal: null, target: null },
    consume() { eaten = true },
  })
  if (eaten) throw new Error('a chord took the key from the terminal')

  // A field of the panel is ours: the chord still works there.
  eaten = false
  const panelField = {
    matches: (selector) => selector.includes('input'),
    closest: (selector) => (selector.includes('.sr-root') ? { tagName: 'DIV' } : null),
  }
  listener({
    type: 'keydown',
    gesture: { code: 'KeyN', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'editable', modal: null, target: panelField },
    consume() { eaten = true },
  })
  if (!eaten) throw new Error('a chord did not work inside the panel')
})

probe('the loader factory returns a client half', () => {
  if (client === null || typeof client !== 'object') throw new Error('no client half')
  if (typeof client.apply !== 'function') throw new Error('no apply function')
})

probe('apply registers the shell.overlay slot without throwing', () => {
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
  if (!overlay) throw new Error('the overlay slot was not registered')
  if (overlay.options.id !== 'stealth-reader') throw new Error('the slot id changed')
  // The strip is one more card in the stack above the composer, next to
  // Todo and Goal, so it reads as part of the conversation.
  const strip = registered.find(entry => entry.options.name === 'conversation.input.dock')
  if (!strip) throw new Error('the strip slot was not registered')
  if (strip.options.id !== 'stealth-reader.strip') throw new Error('the strip slot id changed')
})

/**
 * Render the panel in its open state.
 *
 * The stub's state setter does not schedule a re-render, so the probe clicks
 * the peek button and re-renders the component itself.
 * @returns {any} the rendered tree
 */
function openPanel(options = {}) {
  // The reader lives in its tab now, so rendering it is opening it.
  return render(options)
}

/**
 * Render the panel once with the given state and return the element tree.
 * @param {object} [options] - probe options
 * @returns {any} the rendered tree
 */
let component = null
/**
 * Start a fresh component instance so each probe runs from the same state.
 * @returns {void}
 */
let lastShortcuts = null
/**
 * Pick the component one slot registered.
 * @param {Array<object>} registered - every slot registration
 * @param {string} name - the slot name
 * @returns {Function} the component
 */
let toolbarForProbe = null
function nativeMark() {
  if (!toolbarForProbe) return null
  return find(react.mount(toolbarForProbe), node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-mark'))
}
function componentOf(registered, name) {
  toolbarForProbe = registered.find(item => item.options?.name === 'conversation.input.right')?.component || null
  const entry = registered.find(item => item.options && item.options.name === name)
  if (entry === undefined) throw new Error('the ' + name + ' slot was not registered')
  return entry.component
}

/**
 * Mount the client and wait until it knows which shape the reader is in.
 *
 * The two shapes are alternatives, so a probe has to wait for the host's
 * placement before it can ask for the surface it means to test.
 *
 * @returns {Promise<void>} resolves when the shared reader is ready
 */
async function settlePlacement() {
  const overlay = lastRegistered.find(entry => entry.options.name === 'shell.overlay')
  if (overlay === undefined) return
  react.beginRender()
  overlay.component()
  await react.flushEffects()
  await settle()
  react.beginRender()
  overlay.component()
  await react.flushEffects()
  await settle()
}

let lastRegistered = []

/**
 * Mount the client and let the host say which shape the reader is in.
 *
 * The two shapes are alternatives, so a probe says which one it means to
 * test before it renders anything.
 *
 * @returns {Promise<void>} resolves when the shared reader is ready
 */
async function resetComponentAndSettle() {
  resetComponent()
  const overlay = lastRegistered.find(entry => entry.options.name === 'shell.overlay')
  if (overlay === undefined) return
  react.beginRender()
  overlay.component()
  await react.flushEffects()
  await settle()
}

/**
 * Mount one client, let the host say which shape the reader is in, and hand
 * the registrations back so the probe can drive that same client.
 *
 * @returns {Promise<{ctx: object, registered: Array<object>, shortcuts: object}>} the mounted client
 */
/**
 * Open the settings page of the reader and return its tree.
 *
 * The library lives in the settings now, so the probes that used to drive the
 * drawer drive this page instead.
 *
 * @returns {Promise<any>} the rendered settings page
 */
async function openSettingsPage() {
  const tab = componentOf(lastRegistered, 'sidebar.right.pane.tab')
  let tree = ''
  for (let round = 0; round < 6; round += 1) {
    react.beginRender()
    tree = tab()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
    const gear = find(tree, node => node.type === 'button' && node.children.includes('⚙'))
    if (gear !== null) gear.props.onClick()
    await settle()
  }
  return tree
}

async function mountAndSettle() {
  react.reset()
  const { ctx, registered, shortcuts } = makeContext()
  client.apply(ctx)
  lastRegistered = registered
  lastShortcuts = shortcuts
  const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
  if (overlay !== undefined) {
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
  }
  return { ctx, registered, shortcuts }
}

function resetComponent() {
  react.reset()
  // The listeners that watch for a click outside a surface belong to the
  // surface that put them there, so a new probe starts without them.
  documentOutsideListeners.length = 0
  const { ctx, registered, shortcuts } = makeContext()
  client.apply(ctx)
  lastRegistered = registered
  // The two shapes are alternatives, so a probe says which one it means to
  // test before it renders.
  component = componentOf(registered, 'sidebar.right.pane.tab')
  lastShortcuts = shortcuts
}
let pendingStoreChange = false
// The cleanups React would run when a component unmounts.
const cleanups = new Set()

function render(options = {}) {
  if (component === null) resetComponent()
  react.beginRender()
  return component()
}

/**
 * Walk a rendered tree and collect every element type.
 * @param {any} node - a tree node
 * @param {string[]} [out] - accumulator
 * @returns {string[]} the element types
 */
function types(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) types(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  out.push(node.type)
  types(node.children, out)
  return out
}

probe('the collapsed panel renders without throwing', async () => {
  await resetComponentAndSettle()
  const tree = render()
  const list = types(tree)
  if (!list.includes('button')) throw new Error('the collapsed state has no button')
})

probe('the expanded panel renders without throwing', async () => {
  const { registered } = await mountAndSettle()
  const Component = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const element = Component()
  await react.flushEffects()
  if (element === null || element === undefined) throw new Error('the reader rendered nothing on the second pass')
  // The tab is the reader: the library opens from the panel itself.
  const library = find(element, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-btn'))
  if (library === null) throw new Error('the panel has no toolbar')
})

probe('the empty state sends the reader to the settings, where books are added', async () => {
  await resetComponentAndSettle()
  // No book is open, so the panel shows what to do next.
  hostState.current = null
  try {
    let tree = ''
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      tree = componentOf(lastRegistered, 'sidebar.right.pane.tab')()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-empty'))) break
    }
    const empty = find(tree, node => node.props && hasClass(node.props.className, 'sr-empty'))
    if (empty === null) throw new Error('the empty state was not rendered')
    const button = find(empty, node => node.type === 'button')
    if (button === null) throw new Error('the empty state has no button')
    // Pressing it opens the settings page: the library lives there now, so
    // this is the one path a new reader takes.
    button.props.onClick()
    await settle()
    react.beginRender()
    const after = componentOf(lastRegistered, 'sidebar.right.pane.tab')()
    await react.flushEffects()
    await settle()
    const page = find(after, node => node.props && hasClass(node.props.className, 'sr-set-settings-page'))
    if (page === null) throw new Error('the empty state did not open the settings')
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    if (body === null) throw new Error('the settings it opened has no body')
    if (!JSON.stringify(body).includes('Documents')) {
      throw new Error('the settings it opened has no documents section')
    }
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the library renders in the settings page without throwing', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (body === null) throw new Error('the settings page has no body')
  // The books are listed here, which is what the drawer used to do.
  const list = find(body, node => node.props && hasClass(node.props.className, 'sr-set-books'))
  if (list === null) throw new Error('the settings page does not list the books')
})

probe('the add controls render in the settings page without throwing', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  const text = JSON.stringify(body)
  for (const wanted of ['Add a file', 'Add a web novel', 'Add a folder']) {
    if (!text.includes(wanted)) throw new Error('the settings page does not offer ' + wanted)
  }
  // The two text fields carry their own names, or the page is unusable.
  const inputs = []
  collect(body, node => {
    if (node.type === 'input' && node.props && node.props.type === 'text') inputs.push(node)
  })
  if (inputs.length < 2) throw new Error('the add controls are missing: ' + inputs.length)
  for (const input of inputs) {
    if (input.props['aria-label'] === undefined) throw new Error('an add input has no aria-label')
  }
})

probe('the add controls are wired to the host', async () => {
  await resetComponentAndSettle()
  hostCalls.length = 0
  const page = await openSettingsPage()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  // Typing a path enables the button beside it, and pressing it asks the
  // host to add the book.
  const inputs = []
  collect(body, node => {
    if (node.type === 'input' && node.props && node.props.type === 'text') inputs.push(node)
  })
  const first = inputs[0]
  if (first === undefined) throw new Error('the page has no path field')
  first.props.onChange({ target: { value: '/tmp/一本书.txt' } })
  await settle()
  // The page is rendered again on the same client, so the field it just
  // filled is the field it shows.
  const tab = componentOf(lastRegistered, 'sidebar.right.pane.tab')
  react.beginRender()
  const again = tab()
  await react.flushEffects()
  await settle()
  const button = find(again, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-set-action')
    && node.children && node.children[0] === 'Add a local file')
  if (button === null) {
    const seen = []
    collect(again, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-set-action')) {
        seen.push(JSON.stringify(node.children))
      }
    })
    throw new Error('the add button was not rendered; actions: ' + seen.join(' | '))
  }
  if (button.props.disabled === true) throw new Error('the add button stayed disabled')
  button.props.onClick()
  await settle()
  if (!hostCalls.some(call => call.action === 'add_local')) {
    throw new Error('the add button did not ask the host')
  }
})

/**
 * Find the first node matching a predicate.
 * @param {any} node - a tree node
 * @param {(node: any) => boolean} predicate - the matcher
 * @returns {any} the matching node, or null
 */
/**
 * Whether a className holds one class.
 * @param {unknown} className - the element's className
 * @param {string} name - the class to look for
 * @returns {boolean} true when the element has the class
 */
/**
 * Open the reading card from its folded mark and return the open tree.
 *
 * The card starts folded to one small round mark, so every probe that looks at
 * the card's contents has to open it first, the way a reader does.
 *
 * @param {any} component - the card component
 * @returns {Promise<any>} the open tree
 */
async function openCard(component) {
  react.beginRender()
  let tree = component()
  await react.flushEffects()
  await settle()
  for (let round = 0; round < 4; round += 1) {
    // Already open: the card starts that way now, and this helper only has to
    // make sure the body is there.
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel')) !== null) break
    const mark = find(tree, node => node.type === 'button'
      && node.props && hasClass(node.props.className, 'sr-strip-mark')) || nativeMark()
    if (mark === null) break
    mark.props.onClick()
    await settle()
    react.beginRender()
    tree = component()
    await react.flushEffects()
    await settle()
  }
  return tree
}

/**
 * Fold the card with its own fold button and return the folded tree.
 * @param {any} component - the card component
 * @returns {Promise<any>} the folded tree
 */
async function foldCard(component) {
  let tree = ''
  let fold = null
  // The card reads its chapter itself, so it is rendered until the open card
  // is on screen; only then does it have a fold button.
  for (let round = 0; round < 8; round += 1) {
    react.beginRender()
    tree = component()
    await react.flushEffects()
    await settle()
    const buttons = []
    collect(tree, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-strip-fold')) buttons.push(node)
    })
    fold = buttons[0] || null
    if (fold !== null) break
  }
  if (fold === null) throw new Error('the open card has no fold button')
  fold.props.onClick()
  await settle()
  react.beginRender()
  tree = component()
  await react.flushEffects()
  await settle()
  return tree
}

function hasClass(className, name) {
  if (typeof className !== 'string') return false
  return className.split(/\s+/).includes(name)
}

/**
 * Open the search page and hand back its field.
 *
 * The search is a page of its own, so a probe has to open it before it can
 * type into it.
 *
 * @returns {Promise<any>} the search field
 */
async function openSearchPage() {
  const button = find(render(), node => node.type === 'button' && node.props
    && Array.isArray(node.children)
    && node.children.some(child => child !== null && child !== undefined
      && child.props !== undefined && child.props !== null
      && child.props.className === 'sr-lens'))
  if (button === null) throw new Error('the panel has no search button')
  await button.props.onClick()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  const field = find(render(), node => node.type === 'input' && node.props
    && node.props.className === 'sr-search-field')
  if (field === null) throw new Error('the search page has no field')
  return field
}

/**
 * Type a word into the search page and ask for the results.
 *
 * @param {string} word - the word to look for
 * @returns {Promise<void>} resolves when the results are in
 */
async function searchInPage(word) {
  let field = await openSearchPage()
  field.props.onChange({ target: { value: word } })
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  field = find(render(), node => node.type === 'input' && node.props
    && node.props.className === 'sr-search-field')
  field.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} })
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
}

/**
 * Collect every search hit the page is showing.
 *
 * @returns {Array<any>} the hit rows
 */
function searchHits() {
  const rows = []
  collect(render(), node => {
    if (node.type === 'button' && node.props && typeof node.props.className === 'string'
      && node.props.className.startsWith('sr-list-row')) rows.push(node)
  })
  return rows
}

function find(node, predicate) {
  let found = null
  collect(node, (candidate) => {
    if (found === null && predicate(candidate)) found = candidate
  })
  return found
}

/**
 * Collect every node in a tree that matches.
 * @param {any} node - a tree node
 * @param {(node: any) => boolean} predicate - what to look for
 * @returns {any[]} the matching nodes
 */
function findAll(node, predicate) {
  const found = []
  collect(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate)
  })
  return found
}

/**
 * Visit every node in a tree.
 * @param {any} node - a tree node
 * @param {(node: any) => void} visit - the visitor
 * @returns {void}
 */
function collect(node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) collect(child, visit)
    return
  }
  if (typeof node !== 'object') return
  visit(node)
  collect(node.children, visit)
}

/**
 * Collect the text a rendered tree shows.
 * @param {any} node - a tree node
 * @param {string[]} [out] - accumulator
 * @returns {string} the joined text
 */
function textOf(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out.join(' ')
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out.join(' ')
  }
  if (typeof node === 'object') {
    if (typeof node.props === 'object' && node.props !== null) {
      for (const key of ['children', 'title', 'aria-label', 'placeholder']) {
        const value = node.props[key]
        if (typeof value === 'string') out.push(value)
      }
    }
    textOf(node.children, out)
  }
  return out.join(' ')
}

probe('every button in the expanded panel runs without throwing', async () => {
  resetComponent()
  const tree = openPanel()
  const buttons = []
  collect(tree, node => {
    if (node.type === 'button' && typeof node.props.onClick === 'function') buttons.push(node)
  })
  if (buttons.length === 0) throw new Error('the panel has no buttons')
  const pending = []
  for (const button of buttons) {
    try {
      const outcome = button.props.onClick()
      if (outcome && typeof outcome.then === 'function') pending.push(outcome)
    } catch (error) {
      throw new Error(`a button threw: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  await Promise.allSettled(pending)
  // Let the handlers' own microtasks run before the check.
  await new Promise(resolve => setTimeout(resolve, 0))
})

probe('every control in the settings page runs without throwing', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const buttons = []
  collect(page, node => {
    if (node.type === 'button' && typeof node.props.onClick === 'function') buttons.push(node)
  })
  if (buttons.length === 0) throw new Error('the settings page has no buttons')
  // A button that throws on press would leave the page broken with no way
  // back, so each one is pressed with the host answering.
  for (const button of buttons) {
    if (button.props.disabled === true) continue
    button.props.onClick()
    await settle()
  }
})

if (unhandled.length > 0) {
  results.push(`FAIL  an asynchronous handler rejected: ${unhandled[0]}`)
}
probe('the search term marks the matches inside the body', async () => {
  resetComponent()
  let tree = openPanel()
  // The panel loads the open book from the host, so the reading surface
  // appears after the host answers.
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  // The search field is in the reader tools.
  const searchInput = find(tree, node => node.type === 'input' && node.props && node.props['aria-label'])
  assert.ok(searchInput !== null, 'the search field is missing')
  const labels = []
  collect(tree, node => { if (node.type === 'input' && node.props && node.props['aria-label']) labels.push(node.props['aria-label']) })
  assert.ok(labels.length > 0, 'the search field has no accessible name')
})

probe('the chapter list and the search results do not break the panel', async () => {
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const Component = registered[0].component
  resetComponent()
  Component({})
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  resetComponent()
  let tree = openPanel()

  // The buttons that open a list carry the expanded state.
  const buttons = []
  collect(tree, (node) => { if (node.type === 'button' && node.props) buttons.push(node) })
  const listButtons = buttons.filter(button => button.props['aria-expanded'] !== undefined)
  assert.ok(listButtons.length >= 2, 'the list buttons are missing: found ' + listButtons.length)

  // Open the table of contents and re-render: the panel must still work.
  // The re-render keeps the state, the way React does.
  await listButtons[0].props.onClick()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  tree = render()
  if (tree === undefined) throw new Error('the panel broke with the list open')
  const rows = []
  collect(tree, (node) => {
    // The current chapter's row carries an extra class.
    if (node.type === 'button' && node.props && typeof node.props.className === 'string'
      && node.props.className.startsWith('sr-list-row')) rows.push(node)
  })
  if (rows.length !== 3) {
    const names = listButtons.map(b => String(b.props['aria-label'] || b.props.title || '?')).join(' / ')
    const texts = rows.map(r => JSON.stringify(r.children)).join(' | ')
    throw new Error('the table of contents did not list the chapters: ' + rows.length + ' | the buttons were: ' + names + ' | the rows: ' + texts)
  }
  // Clicking a chapter must not throw.
  await rows[1].props.onClick()
  await react.flushEffects()
  // The search results must open too, and the panel must survive them.
  const searchField = await openSearchPage()
  assert.ok(searchField !== null, 'the search field is missing')
  searchField.props.onChange({ target: { value: '文字' } })
  await react.flushEffects()
  const searchButton = find(render(), node => node.type === 'input' && node.props
    && node.props.className === 'sr-search-field')
  assert.ok(searchButton !== null, 'the search field vanished')
})

/**
 * Build a body node for the continuous mode.
 *
 * It holds the numbers the scroll logic reads and hands back the chapter
 * blocks the panel rendered. It is a logic stand-in, not a layout.
 *
 * @returns {object} the node
 */
function makeBodyNode() {
  const listeners = []
  const wheelListeners = []
  const node = {
    scrollTop: 0,
    clientHeight: 600,
    blocks: [],
    get scrollHeight() { return Math.max(3000, node.blocks.length * 200) },
    listeners,
    wheelListeners,
    addEventListener(kind, listener, options) {
      if (kind === 'scroll') listeners.push(listener)
      else wheelListeners.push({ kind, listener, options })
    },
    removeEventListener(kind, listener) {
      const at = listeners.indexOf(listener)
      if (at !== -1) listeners.splice(at, 1)
      const wheelAt = wheelListeners.findIndex(row => row.kind === kind && row.listener === listener)
      if (wheelAt !== -1) wheelListeners.splice(wheelAt, 1)
    },
    scroll() {
      for (const listener of [...listeners]) listener()
    },
    querySelectorAll(selector) {
      if (selector !== '[data-chapter]') return []
      // The blocks stand in a column, so they move up as the reader scrolls.
      return node.blocks.map((block, at) => ({
        getAttribute: (name) => block.props[name],
        getBoundingClientRect: () => ({ top: at * 200 - node.scrollTop, height: 200 }),
      }))
    },
    querySelector(selector) {
      const match = /^\[data-chapter="(\d+)"\]$/.exec(selector)
      if (match === null) return null
      const index = Number(match[1])
      const block = node.blocks.find(item => item.props['data-chapter'] === index)
      if (block === undefined) return null
      return {
        getAttribute: (name) => block.props[name],
        getBoundingClientRect: () => ({ top: block.props.top, height: 200 }),
        scrollIntoView() {},
      }
    },
    getBoundingClientRect: () => ({ top: 0, height: node.clientHeight }),
  }
  return node
}

/**
 * Find the body element in a rendered tree.
 * @param {any} node - a tree node
 * @returns {object|null} the element, or null when it is not there
 */
function findBody(node) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findBody(child)
      if (found !== null) return found
    }
    return null
  }
  if (node.props !== undefined && node.props.className === 'sr-body') return node
  return findBody(node.children)
}

/**
 * Find every chapter block in a rendered tree.
 * @param {any} node - a tree node
 * @param {Array} [out] - accumulator
 * @returns {Array} the blocks
 */
function findChapterBlocks(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findChapterBlocks(child, out)
    return out
  }
  if (node.props !== undefined && node.props['data-chapter'] !== undefined) out.push(node)
  findChapterBlocks(node.children, out)
  return out
}

probe('a disguise skin names neither the book nor the chapters', async () => {
  hostSettings.skin = 'log'
  resetComponent()
  let tree = openPanel()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  // The table of contents is the place where a chapter would be named.
  const buttons = []
  collect(tree, (node) => {
    if (node.type === 'button' && node.props && node.props['aria-expanded'] !== undefined) buttons.push(node)
  })
  if (buttons.length >= 2) {
    await buttons[0].props.onClick()
    await react.flushEffects()
    await new Promise(resolve => setTimeout(resolve, 0))
    tree = render()
  }
  const shown = textOf(tree)
  if (process.env.DBG) {
    console.log('HOSTSETTINGS:', JSON.stringify(hostSettings))
    console.log('SHOWN:', JSON.stringify(shown.slice(0, 120)))
  }
  if (shown.includes('测试小说')) throw new Error('the disguise names the book')
  if (shown.includes('第一章 启程')) throw new Error('the disguise names the chapter')
})

probe('the search term is marked in the body, so the match buttons work', async () => {
  hostSettings.skin = 'plain'
  // The probes share one book, so the chapter that is open is named here.
  hostState.current = { bookId: 'book-1', index: 0 }
  resetComponent()
  let tree = openPanel()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  await searchInPage('文字')
  const rows = searchHits()
  assert.ok(rows.length > 0, 'the results name no place')
  // Picking a place puts the reader on it, and the word is still marked in
  // the text, so the reader can step through the matches of that chapter.
  rows[0].props.onClick()
  await settle()
  tree = render()
  const marks = []
  collect(tree, (node) => { if (node.type === 'mark') marks.push(node) })
  assert.ok(marks.length > 0, 'the search term is not marked in the body')
})

probe('a macOS dead key still reaches the panel', async () => {
  const { ctx, registered, shortcuts } = makeContext()
  client.apply(ctx)
  componentOf(registered, 'sidebar.right.pane.tab')({})
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()

  if (shortcuts.registered.length === 0) throw new Error('no chord was reserved')
  // The reserved path is live, so the document listener only takes the
  // gestures the reserved path dropped.
  const reserved = shortcuts.listeners[shortcuts.listeners.length - 1]
  if (typeof reserved !== 'function') throw new Error('no reserved listener')

  // Option+N is a dead key on macOS: the shortcut service reads it as an
  // input method composition and drops it. The document listener has to
  // take it, or the toggle chord never works.
  let reservedTook = false
  reserved({
    type: 'keydown',
    gesture: { code: 'KeyN', control: true, alt: true, shift: false, meta: false, repeat: false, composing: true, defaultPrevented: false },
    context: { region: 'page', modal: null, target: null },
    consume() { reservedTook = true },
  })
  if (reservedTook) throw new Error('the reserved path took a gesture it should have dropped')

  const taken = pressKey({
    key: 'Dead',
    code: 'KeyN',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
    target: null,
  })
  if (!taken) throw new Error('a dead key did not reach the panel')

  // A live chord that the reserved path already handles must not fire twice.
  let reservedFired = false
  reserved({
    type: 'keydown',
    gesture: { code: 'KeyD', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'page', modal: null, target: null },
    consume() { reservedFired = true },
  })
  const twice = pressKey({
    key: '\u2202',
    code: 'KeyD',
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
    target: null,
  })
  if (!reservedFired) throw new Error('the reserved path did not take a live chord')
  if (twice) throw new Error('a live chord fired twice')
})

/**
 * Open the panel with a body node attached.
 *
 * The node is a logic stand-in for the scrolling body: it holds the
 * numbers the scroll logic reads and the chapter blocks the panel
 * rendered. It is not a layout.
 *
 * @returns {Promise<object>} the body node
 */
async function openWithBody() {
  resetComponent()
  let tree = openPanel()
  const body = findBody(tree)
  if (body === null) throw new Error('the panel has no body')
  const node = makeBodyNode()
  // The double must hold this very node, or the scroll listener would live on
  // a copy the probe never scrolls.
  react.adoptRefNode(body.props.ref, node)
  body.props.ref(node)
  // The host answers with the settings and the chapter in its own time, so
  // the panel is rendered a few times before it holds the book.
  for (let round = 0; round < 5; round += 1) {
    tree = render()
    await react.flushEffects()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  node.blocks = findChapterBlocks(tree)
  return node
}

/**
 * Let every pending request settle.
 * @returns {Promise<void>} resolves when the panel is idle
 */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
}

probe('the search results open without breaking the panel', async () => {
  resetComponent()
  let tree = openPanel()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  const field = await openSearchPage()
  assert.ok(field !== null, 'the search field is missing')
  field.props.onChange({ target: { value: '文字' } })
  await react.flushEffects()
  tree = render()
  const field2 = find(tree, node => node.type === 'input' && node.props
    && node.props.className === 'sr-search-field')
  assert.ok(field2 !== null, 'the search field went away')
  field2.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {} })
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = render()
  assert.ok(tree !== undefined, 'the panel broke with the results open')
  const results = find(tree, node => node.type === 'div' && node.props
    && node.props.className === 'sr-search-page')
  assert.ok(results !== null, 'the search results did not open')
})

probe('every list in the reader is built the same way', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 5; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))) break
    }
    for (let round = 0; round < 4; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
    }
    const overlay = componentOf(registered, 'shell.overlay')
    // The list of the chapters.
    const tocButton = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-open')
      && node.children[0] === '☷')
    assert.ok(tocButton !== null, 'the card has no table-of-contents button')
    react.beginRender()
    overlay()
    await react.flushEffects()
    tocButton.props.onClick()
    await settle()
    react.beginRender()
    let popup = overlay()
    await react.flushEffects()
    const kinds = new Set()
    collect(popup, node => {
      if (node.type === 'button' && node.props && typeof node.props.className === 'string'
        && node.props.className.includes('sr-list-row')) kinds.add(node.props.className.split(' ')[0])
    })
    assert.ok(kinds.size === 1, 'the list of the chapters is not built like every other list')
    // The list of the places a search found.
    const lensButton = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-open')
      && Array.isArray(node.children)
      && node.children.some(child => child !== null && child !== undefined
        && child.props !== undefined && child.props !== null
        && child.props.className === 'sr-lens'))
    assert.ok(lensButton !== null, 'the card has no search button')
    react.beginRender()
    tree = card()
    await react.flushEffects()
    lensButton.props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    const field = find(tree, node => node.type === 'input'
      && hasClass(node.props.className, 'sr-strip-search'))
    assert.ok(field !== null, 'the search field is missing')
    field.props.onChange({ target: { value: '文字' } })
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    const field2 = find(tree, node => node.type === 'input'
      && hasClass(node.props.className, 'sr-strip-search'))
    field2.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} })
    await settle()
    react.beginRender()
    popup = overlay()
    await react.flushEffects()
    const kinds2 = new Set()
    collect(popup, node => {
      if (node.type === 'button' && node.props && typeof node.props.className === 'string'
        && node.props.className.includes('sr-list-row')) kinds2.add(node.props.className.split(' ')[0])
    })
    assert.ok(kinds2.size === 1, 'the list of the places is not built like every other list')
    assert.deepEqual([...kinds], [...kinds2],
      'the two lists of the card are not built the same way')
    // The list in the side column is the same list.
    resetComponent()
    hostSettings.placement = 'sidebar'
    hostSettings.skin = 'plain'
    hostState.current = { bookId: 'book-1', index: 0 }
    await searchInPage('文字')
    const rowsOfColumn = []
    collect(render(), node => {
      if (node.type === 'button' && node.props && typeof node.props.className === 'string'
        && node.props.className.includes('sr-list-row')) rowsOfColumn.push(node.props.className.split(' ')[0])
    })
    assert.ok(rowsOfColumn.length > 0, 'the side column has no list of its own')
    assert.deepEqual([...new Set(rowsOfColumn)], [...kinds],
      'the list of the side column is not built like every other list')
  } finally {
    hostSettings.placement = 'strip'
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('a search result names every place the term was found', async () => {
  hostSettings.skin = 'plain'
  // The probes share one book, so the chapter that is open is named here.
  hostState.current = { bookId: 'book-1', index: 0 }
  resetComponent()
  let tree = openPanel()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  await searchInPage('文字')
  const rows = searchHits()
  // The chapter holds the term on three lines, so the list names the three
  // places and not only the chapter.
  assert.equal(rows.length, 3, 'the results name ' + rows.length + ' places')
  // The search is about the book that is being read.
  const asked = hostCalls.filter(call => call.action === 'search')
  assert.ok(asked.length > 0, 'the search was not asked for')
  assert.equal(asked[asked.length - 1].payload.bookId, 'book-1', 'the search was not about the open book')
})

probe('a search result puts the reader on the exact line', async () => {
  hostSettings.skin = 'plain'
  // The probes share one book, so the chapter that is open is named here.
  hostState.current = { bookId: 'book-1', index: 0 }
  resetComponent()
  let tree = openPanel()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  await searchInPage('第二段')
  const rows = searchHits()
  assert.ok(rows.length > 0, 'the results name no place')
  hostCalls.length = 0
  rows[0].props.onClick()
  await settle()
  const opened = hostCalls.filter(call => call.action === 'open')
  assert.ok(opened.length > 0, 'the result did not open the book')
  // The line is the one the term was found on, so the reader lands on the
  // sentence and not on the top of the chapter.
  assert.equal(opened[opened.length - 1].payload.line, 1, 'the result did not name the line')
  assert.ok(Number.isInteger(opened[opened.length - 1].payload.flow), 'the result did not name the card place')
})

probe('a hit in the chapter on screen still moves the text', async () => {
  hostSettings.skin = 'plain'
  // The probes share one book, so the chapter that is open is named here.
  hostState.current = { bookId: 'book-1', index: 0 }
  resetComponent()
  let tree = openPanel()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  tree = openPanel()
  await searchInPage('第三段')
  const rows = searchHits()
  assert.ok(rows.length > 0, 'the results name no place')
  hostCalls.length = 0
  rows[0].props.onClick()
  await settle()
  const opened = hostCalls.filter(call => call.action === 'open')
  assert.ok(opened.length > 0, 'the hit in the open chapter did nothing')
  // The chapter is the one on screen, so only the place inside it changed.
  assert.equal(opened[opened.length - 1].payload.index, 0, 'the hit moved to another chapter')
  assert.equal(opened[opened.length - 1].payload.line, 2, 'the hit did not name the line')
})

probe('the scroll listener follows the body when the panel is hidden and shown', async () => {
  hostSettings.scrollMode = 'continuous'
  hostCalls.length = 0
  const node = await openWithBody()
  // The panel is hidden and shown again, so the body is a new node. The
  // listener has to move with it, or the scroll does nothing.
  const first = findBody(render())
  if (first === null) throw new Error('the panel has no body')
  first.props.ref(null)
  render()
  await react.flushEffects()
  const second = makeBodyNode()
  const again = findBody(render())
  if (again === null) throw new Error('the panel has no body')
  again.props.ref(second)
  render()
  await react.flushEffects()
  await new Promise(resolve => setTimeout(resolve, 0))
  await react.flushEffects()
  second.scrollTop = second.scrollHeight - second.clientHeight
  second.scroll()
  await settle()
  const asked = hostCalls.filter(call => call.action === 'chapter' && call.payload.index === 1)
  if (asked.length === 0) throw new Error('the new body did not follow the scroll')
})

probe('the continuous mode fetches the next chapter at the end of the text', async () => {
  hostSettings.scrollMode = 'continuous'
  hostCalls.length = 0
  const node = await openWithBody()
  if (hostCalls.find(call => call.action === 'chapter') === undefined) {
    throw new Error('the panel asked for no chapter')
  }
  // The reader reaches the end of the text.
  node.scrollTop = node.scrollHeight - node.clientHeight
  node.scroll()
  await settle()
  const asked = hostCalls.filter(call => call.action === 'chapter' && call.payload.index === 1)
  if (asked.length === 0) {
    throw new Error('the next chapter was not fetched at the end of the text '
      + `(scroll listeners on the body: ${node.listeners.length})`)
  }
})

probe('the continuous mode does not fetch past the last chapter', async () => {
  hostSettings.scrollMode = 'continuous'
  hostCalls.length = 0
  const node = await openWithBody()
  // The window holds the last chapter of the book.
  node.scrollTop = node.scrollHeight - node.clientHeight
  node.scroll()
  await settle()
  const beyond = hostCalls.filter(call => call.action === 'chapter' && call.payload.index > 4)
  if (beyond.length > 0) throw new Error('the panel fetched a chapter past the end of the book')
})

probe('the continuous mode does not fetch before the first chapter', async () => {
  hostSettings.scrollMode = 'continuous'
  hostCalls.length = 0
  const node = await openWithBody()
  // The reader goes back to the top of the text.
  node.scrollTop = 0
  node.scroll()
  await settle()
  const before = hostCalls.filter(call => call.action === 'chapter' && call.payload.index < 0)
  if (before.length > 0) throw new Error('the panel fetched a chapter before the first one')
})

probe('the single-chapter mode does not fetch chapters while scrolling', async () => {
  hostSettings.scrollMode = 'chapter'
  hostCalls.length = 0
  const node = await openWithBody()
  const before = hostCalls.length
  node.scrollTop = node.scrollHeight - node.clientHeight
  node.scroll()
  await settle()
  if (hostCalls.length !== before) {
    throw new Error('the single-chapter mode fetched a chapter while scrolling')
  }
})

probe('the continuous mode renders every loaded chapter in one column', async () => {
  hostSettings.scrollMode = 'continuous'
  hostCalls.length = 0
  const node = await openWithBody()
  const tree = render()
  const blocks = findChapterBlocks(tree)
  if (blocks.length === 0) throw new Error('the continuous mode rendered no chapter block')
  for (const block of blocks) {
    if (typeof block.props['data-chapter'] !== 'number') {
      throw new Error('a chapter block carries no chapter number')
    }
  }
})

probe('the continuous window keeps the chapters in order and without a gap', async () => {
  hostSettings.scrollMode = 'continuous'
  hostBook.total = 30
  hostCalls.length = 0
  const node = await openWithBody()
  // The reader walks down the whole book, so the window fills up and the
  // oldest chapters are dropped.
  for (let round = 0; round < 20; round += 1) {
    node.scrollTop = node.scrollHeight
    node.scroll()
    await settle()
    node.blocks = findChapterBlocks(render())
  }
  const indices = node.blocks.map(block => block.props['data-chapter'])
  if (indices.length === 0) throw new Error('the window holds no chapter')
  for (let at = 1; at < indices.length; at += 1) {
    if (indices[at] !== indices[at - 1] + 1) {
      throw new Error(`the window skips a chapter: ${indices[at - 1]} then ${indices[at]}`)
    }
  }
  // The reader goes back to the top, so a chapter is added in front.
  node.scrollTop = 0
  node.scroll()
  await settle()
  node.blocks = findChapterBlocks(render())
  const after = node.blocks.map(block => block.props['data-chapter'])
  for (let at = 1; at < after.length; at += 1) {
    if (after[at] !== after[at - 1] + 1) {
      throw new Error(`the window skips a chapter: ${after[at - 1]} then ${after[at]}`)
    }
  }
  // The chapter being read is still in the window, so a step forward
  // cannot skip one.
  const asked = hostCalls.filter(call => call.action === 'open').map(call => call.payload.index)
  // The reader is never moved over a chapter: every forward step is one
  // chapter, so nothing is skipped.
  for (let at = 1; at < asked.length; at += 1) {
    if (asked[at] - asked[at - 1] > 1) {
      throw new Error(`the reader skipped from chapter ${asked[at - 1]} to ${asked[at]}`)
    }
  }
  // A step forward after the reader went back up must land on the very
  // next chapter, so the window cannot lose one in between.
  const listener = lastShortcuts.listeners[lastShortcuts.listeners.length - 1]
  if (typeof listener === 'function') {
    listener({
      type: 'keydown',
      gesture: { code: 'ArrowRight', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
      context: { region: 'page', modal: null, target: null },
      consume() {},
    })
    await settle()
    node.blocks = findChapterBlocks(render())
  }
  const stepped = node.blocks.map(block => block.props['data-chapter'])
  for (let at = 1; at < stepped.length; at += 1) {
    if (stepped[at] !== stepped[at - 1] + 1) {
      throw new Error(`the window skips a chapter after a step: ${stepped[at - 1]} then ${stepped[at]}`)
    }
  }
})

probe('the single-chapter mode renders one chapter and no block', async () => {
  hostSettings.scrollMode = 'chapter'
  hostCalls.length = 0
  await openWithBody()
  const tree = render()
  const blocks = findChapterBlocks(tree)
  if (blocks.length > 0) throw new Error('the single-chapter mode rendered a chapter block')
})

probe('the closed card is one quiet line, and the hint waits for it to open', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 8; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      const shown = find(tree, node => node.props && typeof node.props.className === 'string'
        && node.props.className.includes('sr-strip-count'))
      if (shown !== null && JSON.stringify(shown.children) !== '["No document open"]') break
    }
    // The card starts open, so it is folded first: one mark and nothing else,
    // so the text keeps its room.
    tree = await foldCard(card)
    const mark = find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-mark')) || nativeMark()
    if (mark === null) throw new Error('the folded card has no mark')
    const body = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-body'))
    if (body !== null) {
      throw new Error('the reading lines are rendered while the card is closed')
    }
    const panel = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel'))
    if (panel !== null) throw new Error('the closed card still draws its panel')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('a site that needs selectors gets them, and a site that does not sends none', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  hostCalls.length = 0
  const { registered } = await mountAndSettle()
  const page = await openSettingsPage()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  const text = JSON.stringify(body)
  // The two selectors are offered, but only for the sites that need them.
  if (!text.includes('Chapter link selector')) throw new Error('the page does not offer a chapter selector')
  if (!text.includes('Text selector')) throw new Error('the page does not offer a text selector')
  // Filling them and pressing add sends both to the host.
  const inputs = []
  collect(body, node => {
    if (node.type === 'input' && node.props && node.props.type === 'text') inputs.push(node)
  })
  const urlField = inputs.find(input => input.props['aria-label'] === 'Add a web novel')
  const chapterField = inputs.find(input => input.props['aria-label'] === 'Chapter link selector')
  const contentField = inputs.find(input => input.props['aria-label'] === 'Text selector')
  if (urlField === undefined || chapterField === undefined || contentField === undefined) {
    throw new Error('the fields are missing')
  }
  urlField.props.onChange({ target: { value: 'https://example.test/book/1/' } })
  chapterField.props.onChange({ target: { value: '.list a' } })
  contentField.props.onChange({ target: { value: '#content' } })
  await settle()
  const tab = componentOf(lastRegistered, 'sidebar.right.pane.tab')
  react.beginRender()
  const again = tab()
  await react.flushEffects()
  await settle()
  const add = find(again, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-set-action')
    && node.children && node.children[0] === 'Add a web novel')
  if (add === null) throw new Error('the add button is missing')
  if (add.props.disabled === true) throw new Error('the add button stayed disabled')
  add.props.onClick()
  await settle()
  const sent = hostCalls.filter(call => call.action === 'add_web')
  if (sent.length === 0) throw new Error('the add button did not ask the host')
  const payload = sent[sent.length - 1].payload
  if (payload.chapterSelector !== '.list a') throw new Error('the chapter selector was not sent')
  if (payload.contentSelector !== '#content') throw new Error('the text selector was not sent')
})

probe('the settings page shows the folders it scans, and can stop scanning one', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  hostSettings.libraryDirs = ['/tmp/书库一', '/tmp/书库二']
  hostCalls.length = 0
  try {
    const { registered } = await mountAndSettle()
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    if (body === null) throw new Error('the settings page has no body')
    // The folders the reader scans are visible, so the library is not a
    // mystery about where books come from.
    const folders = find(body, node => node.props && hasClass(node.props.className, 'sr-set-folders'))
    if (folders === null) throw new Error('the settings page does not show the folders')
    if (!JSON.stringify(folders).includes('/tmp/书库一')) {
      throw new Error('the folder path was not shown')
    }
    // Stopping one writes the remaining folders back.
    const remove = find(folders, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-set-book-remove'))
    if (remove === null) throw new Error('a folder cannot be dropped')
    remove.props.onClick()
    await settle()
    const written = hostCalls.filter(call => call.action === 'settings'
      && call.payload.patch && call.payload.patch.libraryDirs)
    if (written.length === 0) throw new Error('dropping a folder wrote nothing')
    const patch = written[written.length - 1].payload.patch
    if (patch.libraryDirs.includes('/tmp/书库一')) throw new Error('the dropped folder is still there')
    if (!patch.libraryDirs.includes('/tmp/书库二')) throw new Error('the kept folder was dropped too')
  } finally {
    delete hostSettings.libraryDirs
  }
})

probe('a book is removed from the settings page, in two steps', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  hostCalls.length = 0
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const tree = tab()
  await react.flushEffects()
  await settle()
  const gear = find(tree, node => node.type === 'button' && node.children.includes('⚙'))
  gear.props.onClick()
  await settle()
  react.beginRender()
  const page = tab()
  await react.flushEffects()
  await settle()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (body === null) throw new Error('the settings page has no body')
  // The cross only asks: removing a book is not one click.
  const cross = find(body, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-set-book-remove'))
  if (cross === null) throw new Error('the settings page cannot remove a book')
  cross.props.onClick()
  await settle()
  if (hostCalls.some(call => call.action === 'remove')) {
    throw new Error('one click removed the book')
  }
  // The label that appears is what removes it.
  react.beginRender()
  const asked = tab()
  await react.flushEffects()
  await settle()
  const confirm = find(asked, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-set-book-confirm'))
  if (confirm === null) throw new Error('the page did not ask before removing')
  confirm.props.onClick()
  await settle()
  if (!hostCalls.some(call => call.action === 'remove')) {
    throw new Error('the confirm did not remove the book')
  }
})

probe('the library button opens the catalog, which lists the books', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const tree = tab()
  await react.flushEffects()
  await settle()
  // The catalog is a page of its own: the books are a chooser, and a reader
  // wants it beside the text rather than inside the settings.
  const library = find(tree, node => node.type === 'button'
    && node.props['aria-label'] === 'Library')
  if (library === null) throw new Error('the panel has no library button')
  library.props.onClick()
  await settle()
  react.beginRender()
  const page = tab()
  await react.flushEffects()
  await settle()
  const picker = find(page, node => node.props && hasClass(node.props.className, 'sr-picker'))
  if (picker === null) throw new Error('the library button did not open the catalog')
  // The catalog has a search and the books themselves.
  const search = find(picker, node => node.type === 'input')
  if (search === null) throw new Error('the catalog has no search field')
  const rows = find(picker, node => node.props && hasClass(node.props.className, 'sr-pick-list'))
  if (rows === null) throw new Error('the catalog lists no books')
  // Adding a book is still a preference, so the catalog's own door opens the
  // settings on the documents tab.
  const add = find(picker, node => node.type === 'button'
    && node.children && node.children[0] === 'Add a book')
  if (add === null) throw new Error('the catalog has no door to the settings')
  add.props.onClick()
  await settle()
  react.beginRender()
  const after = tab()
  await react.flushEffects()
  await settle()
  const settings = find(after, node => node.props && hasClass(node.props.className, 'sr-set-settings-page'))
  if (settings === null) throw new Error('the catalog did not open the settings')
  const body = find(after, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  const text = JSON.stringify(body)
  if (!text.includes('Documents')) throw new Error('the settings the catalog opened has no documents section')
})

probe('a book in the catalog opens and the text comes back', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const opened = find(tab(), node => node.type === 'button'
    && node.props['aria-label'] === 'Library')
  if (opened === null) throw new Error('the panel has no library button')
  opened.props.onClick()
  await settle()
  let tree = null
  let open = null
  for (let round = 0; round < 6; round += 1) {
    react.beginRender()
    tree = tab()
    await react.flushEffects()
    await settle()
    open = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-pick-open'))
    if (open !== null) break
  }
  if (open === null) throw new Error('the catalog has no book to open')
  open.props.onClick()
  await settle()
  react.beginRender()
  const after = tab()
  await react.flushEffects()
  await settle()
  // The catalog is closed and the panel shows the text again.
  if (find(after, node => node.props && hasClass(node.props.className, 'sr-picker')) !== null) {
    throw new Error('the catalog stayed open after the book was chosen')
  }
  if (find(after, node => node.props && hasClass(node.props.className, 'sr-body')) === null) {
    throw new Error('the text did not come back after the book was chosen')
  }
  const asked = hostCalls.filter(call => call.action === 'open')
  if (asked.length === 0) throw new Error('the book was not opened on the host')
})

probe('the library lives in the settings page, so adding a book is a preference', async () => {
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const tree = tab()
  await react.flushEffects()
  await settle()
  const gear = find(tree, node => node.type === 'button' && node.children.includes('⚙'))
  gear.props.onClick()
  await settle()
  react.beginRender()
  const page = tab()
  await react.flushEffects()
  await settle()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (body === null) throw new Error('the settings page has no body')
  const text = JSON.stringify(body)
  // The library is a section of the settings, not a drawer of the reader.
  for (const wanted of ['Documents', 'Add a file', 'Add a web novel', 'Add a folder']) {
    if (!text.includes(wanted)) throw new Error('the settings page does not offer ' + wanted)
  }
  // The books themselves are listed, so one can be picked from here.
  const list = find(body, node => node.props && hasClass(node.props.className, 'sr-set-books'))
  if (list === null) throw new Error('the settings page does not list the books')
})

probe('the settings page offers the card size, and it is stored', async () => {
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostCalls.length = 0
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const tree = tab()
  await react.flushEffects()
  await settle()
  // The settings button opens the page.
  const gear = find(tree, node => node.type === 'button' && node.children.includes('⚙'))
  if (gear === null) throw new Error('the panel has no settings button')
  gear.props.onClick()
  await settle()
  react.beginRender()
  const page = tab()
  await react.flushEffects()
  await settle()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (body === null) throw new Error('the settings page has no body')
  const text = JSON.stringify(body)
  // The card's page size is the line count. A character step would be a second
  // control for the same page, and it could end mid-line, so it is not offered.
  if (!text.includes('Lines shown')) throw new Error('the page does not offer Lines shown')
  if (text.includes('Characters per step')) throw new Error('the page still offers a character step')
  // A slider writes the choice to the host.
  const sliders = []
  ;(function walk(n) {
    if (!n || typeof n !== 'object') return
    if (n.type === 'input' && n.props && n.props.type === 'range') sliders.push(n)
    for (const c of n.children || []) walk(c)
  })(body)
  if (sliders.length < 3) throw new Error('the page offers too few sliders: ' + sliders.length)
  sliders[sliders.length - 1].props.onChange({ target: { value: '400' } })
  // A slider writes once the reader stops moving it, so the probe waits for
  // that write.
  for (let round = 0; round < 8; round += 1) {
    await settle()
    await new Promise(resolve => setTimeout(resolve, 60))
    if (hostCalls.some(call => call.action === 'settings')) break
  }
  const written = hostCalls.filter(call => call.action === 'settings')
  if (written.length === 0) throw new Error('the slider wrote nothing')
})

probe('the card shows one flow of text, not the lines of the file', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  const { registered } = await mountAndSettle()
  const card = componentOf(registered, 'conversation.input.dock')
  let tree = ''
  for (let round = 0; round < 8; round += 1) {
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    const shown = find(tree, node => node.props && typeof node.props.className === 'string'
      && node.props.className.includes('sr-strip-count'))
    if (shown !== null && JSON.stringify(shown.children) !== '["No document open"]') break
  }
  // The card starts open, so its controls are already there.
  if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel')) === null) {
    throw new Error('the card is not open')
  }
  react.beginRender()
  tree = card()
  await react.flushEffects()
  await settle()
  const line = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-line'))
  if (line === null) throw new Error('the card has no text')
  const shown = String(line.children[0] || '')
  // The file is three lines of text. The card must not show them as three
  // separate lines: it shows one flow that wraps to its own width.
  if (shown.includes('\n')) throw new Error('the card kept the lines of the file')
  if (!shown.includes('第一段文字') || !shown.includes('第二段文字')) {
    throw new Error('the card did not show a flow of the text')
  }
})

probe('the card also carries the button that moves the reader to the column', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 8; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      const shown = find(tree, node => node.props && typeof node.props.className === 'string'
        && node.props.className.includes('sr-strip-count'))
      if (shown !== null && JSON.stringify(shown.children) !== '["No document open"]') break
    }
    // The card starts open, so its controls are already there.
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    const toSide = find(tree, node => node.type === 'button'
      && node.props['aria-label'] === 'Move to the side column')
    if (toSide === null) throw new Error('the card has no button that moves the reader to the column')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('a button in the toolbar moves the reader to the other shape', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  hostCalls.length = 0
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const tree = tab()
  await react.flushEffects()
  await settle()
  // The toolbar carries the button, so the reader does not need a chord.
  const toCard = find(tree, node => node.type === 'button'
    && node.props['aria-label'] === 'Move to the card above the input')
  if (toCard === null) throw new Error('the toolbar has no button that moves the reader to the card')
  toCard.props.onClick()
  await settle()
  // The other shape was written down, so the reader really moved.
  const written = hostCalls.filter(call => call.action === 'settings')
  if (written.length === 0) throw new Error('the button did nothing')
  const patch = written[written.length - 1].payload.patch || {}
  if (patch.placement !== 'strip') throw new Error('the button did not move the reader to the card')
})

probe('closing the side column hands the reader back to the card', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  hostCalls.length = 0
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  const card = componentOf(registered, 'conversation.input.dock')
  // Mount the tab with its own hook cells, not the overlay root's cells.
  react.reset()
  // The column is open, so the card is not drawn.
  react.beginRender()
  const lifetime = new AbortController()
  const tabTree = tab({ useTabInfo: () => ({ tab: { visible: true, signal: lifetime.signal,
    navigation: { revision: 1 }, actions: { close() {} } } }) })
  await react.flushEffects()
  await settle()
  if (tabTree === null || tabTree === undefined) throw new Error('the column rendered nothing')
  react.beginRender()
  const whileOpen = card()
  await react.flushEffects()
  await settle()
  if (whileOpen !== null && whileOpen !== undefined) {
    throw new Error('the card is drawn while the column is open')
  }
  // React unmount alone is not a tab close. The real record lifetime ends
  // independently, including when a hidden tab is closed from its chrome.
  await react.unmount()
  lifetime.abort()
  await settle()
  let back = null
  for (let round = 0; round < 5; round += 1) {
    react.beginRender()
    back = card()
    await react.flushEffects()
    await settle()
    if (back !== null && back !== undefined) break
  }
  if ((back === null || back === undefined) && nativeMark() === null) {
    throw new Error('the card did not come back after the column was closed')
  }
  // The shape was written down, so a reload keeps it.
  const written = hostCalls.filter(call => call.action === 'settings')
  if (written.length === 0) throw new Error('the shape was not written back')
  const patch = written[written.length - 1].payload.patch || {}
  if (patch.placement !== 'strip') throw new Error('the shape was not handed back to the card')
})

probe('the card is not on screen while the reader is in the side column', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const card = componentOf(registered, 'conversation.input.dock')
  react.beginRender()
  const tree = card()
  await react.flushEffects()
  await settle()
  // The card is the other shape, so it is not drawn here at all: no second
  // reading surface next to the side column.
  if (tree !== null && tree !== undefined) {
    throw new Error('the card is still on screen while the reader is in the side column')
  }
})

probe('only one shape is on screen at a time', async () => {
  resetComponent()
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  const card = componentOf(registered, 'conversation.input.dock')
  // In the side column the card must be gone: that is the point of the
  // shape, not a second reading surface.
  react.beginRender()
  tab({})
  await react.flushEffects()
  await settle()
  react.beginRender()
  const inSidebar = card()
  await react.flushEffects()
  await settle()
  if (inSidebar !== null && inSidebar !== undefined) {
    throw new Error('the card is still on screen while the reader is in the side column')
  }
  // Back in the card, the card is drawn again.
  hostSettings.placement = 'strip'
  resetComponent()
  const { ctx: ctx2, registered: reg2 } = makeContext()
  client.apply(ctx2)
  const card2 = componentOf(reg2, 'conversation.input.dock')
  react.beginRender()
  card2()
  await react.flushEffects()
  await settle()
  react.beginRender()
  const inCard = card2()
  await react.flushEffects()
  await settle()
  if (inCard === null || inCard === undefined) {
    throw new Error('the card is not drawn while the reader is in the card')
  }
})

probe('one chord moves the reader between the two shapes', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostCalls.length = 0
  const { ctx, registered, shortcuts } = makeContext()
  client.apply(ctx)
  componentOf(registered, 'sidebar.right.pane.tab')({ useTabInfo: () => ({ tab: { visible: false } }) })
  await react.flushEffects()
  await settle()
  // The chord is reserved, so it shows up in the Harness shortcut list.
  const place = shortcuts.registered.find(entry => entry.id === 'stealthReader.place')
  if (place === undefined) throw new Error('no chord moves the reader between the shapes')
  const listener = shortcuts.listeners[shortcuts.listeners.length - 1]
  if (typeof listener !== 'function') throw new Error('no chord listener was installed')
  listener({
    type: 'keydown',
    gesture: { code: 'KeyL', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'page', modal: null, target: null },
    consume() {},
  })
  await settle()
  // The shape was written to the host, so the reader is in the side column
  // from now on.
  const written = hostCalls.filter(call => call.action === 'settings')
  if (written.length === 0) throw new Error('the new shape was not written')
  const patch = written[written.length - 1].payload.patch || {}
  if (patch.placement !== 'sidebar') throw new Error('the chord did not move to the side column')
})

probe('the side column gives the reader a height, so the text can scroll', async () => {
  const source = readFileSync(CLIENT, 'utf8')
  // The chain that makes the body scrollable: the root fills the pane, the
  // panel fills the root, and the body takes what is left.
  const root = source.match(/\.sr-root\.sr-root-sidebar\{[^}]*\}/)
  if (root === null) throw new Error('the sidebar root has no rule')
  if (!/height:100%/.test(root[0])) throw new Error('the sidebar root has no height, so nothing scrolls')
  if (!/flex-direction:column/.test(root[0])) throw new Error('the sidebar root does not stack its children')
  const panel = source.match(/\.sr-panel-sidebar\{[^}]*\}/)
  if (panel === null) throw new Error('the sidebar panel has no rule')
  if (!/height:100%/.test(panel[0])) throw new Error('the sidebar panel does not fill the pane')
  const body = source.match(/\.sr-body\{[^}]*\}/)
  if (body === null) throw new Error('the body has no rule')
  if (!/overflow:auto/.test(body[0])) throw new Error('the body cannot scroll')
  if (!/min-height:0/.test(body[0])) throw new Error('the body cannot shrink, so it would not scroll')
})

probe('the reading area scrolls with the keys a reader reaches for', async () => {
  hostSettings.scrollMode = 'chapter'
  hostSettings.placement = 'sidebar'
  const node = await openWithBody()
  const body = findBody(render())
  if (body === null) throw new Error('the panel has no body')
  if (typeof body.props.onKeyDown !== 'function') throw new Error('the reading area does not read the keys')
  // A page key scrolls the text.
  node.scrollTop = 0
  let prevented = false
  body.props.onKeyDown({
    key: 'PageDown', altKey: false, ctrlKey: false, metaKey: false,
    preventDefault() { prevented = true },
  })
  if (!prevented) throw new Error('the page key was left to the page')
  if (node.scrollTop <= 0) throw new Error('the page key did not scroll the text')
  // A chord is the panel's, not the area's: the area must leave it alone.
  let took = false
  body.props.onKeyDown({
    key: 'ArrowRight', altKey: true, ctrlKey: true, metaKey: false,
    preventDefault() { took = true },
  })
  if (took) throw new Error('the area took a chord from the panel')
})

probe('a tap on a side of the text turns the page, and the middle does not', async () => {
  hostSettings.scrollMode = 'chapter'
  hostSettings.placement = 'sidebar'
  // The reader is put in the middle of the book: at the first chapter there
  // is nothing behind it, so a tap back would have nothing to do.
  hostState.current = { bookId: 'book-1', index: 2 }
  const node = await openWithBody()
  const body = findBody(render())
  if (body === null) throw new Error('the panel has no body')
  if (typeof body.props.onClick !== 'function') throw new Error('the reading area ignores a tap')
  const rect = { left: 0, width: 300, top: 0, height: 600 }
  const tap = (clientX) => {
    const before = hostCalls.length
    body.props.onClick({ clientX, currentTarget: { getBoundingClientRect: () => rect } })
    return hostCalls.length - before
  }
  // A tap on the left third goes back.
  if (tap(30) === 0) throw new Error('a tap on the left did nothing')
  if (tap(280) === 0) throw new Error('a tap on the right did nothing')
  // The middle is a text selection, so it must not turn the page.
  if (tap(150) !== 0) throw new Error('a tap in the middle turned the page')
})

probe('the preferences are a page of the Harness settings, not of the reader', async () => {
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const section = registered.find(entry => entry.options.name === 'settings.section')
  if (section === undefined) throw new Error('no settings section was registered')
  if (section.options.id !== 'stealth-reader') throw new Error('the section id changed')
  if (typeof section.options.label !== 'function') throw new Error('the section has no label')
  // The section draws ordinary content: no dialog, no fixed corner.
  react.beginRender()
  const tree = section.component({})
  await react.flushEffects()
  await settle()
  const page = find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-page'))
  if (page === null) throw new Error('the section rendered no page')
  if (page.props.role === 'dialog') throw new Error('the section is a dialog, not a page')
  if (!hasClass(page.props.className, 'sr-set-settings-section')) {
    throw new Error('the section draws the reader frame')
  }
  // The preferences themselves are all there.
  const groups = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (groups === null) throw new Error('the section has no settings')
})

probe('the settings page is a page of its own and offers the placements', async () => {
  resetComponent()
  hostSettings.placement = 'sidebar'
  const tree = openPanel()
  const gear = find(tree, node => node.type === 'button' && node.children.includes('⚙'))
  if (gear === null) throw new Error('the settings button was not rendered')
  gear.props.onClick()
  // The settings page is drawn where the reader was, so the tab renders it.
  // The store publishes the change, so the render has to follow it.
  await settle()
  const page = render()
  const dialog = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-page'))
  if (dialog === null) throw new Error('the settings page was not rendered')
  const choices = find(page, node => node.props && node.props.className === 'sr-set-choice-group')
  if (choices === null) throw new Error('the placement choices were not rendered')
  const names = choices.children.map(child => child.children[0])
  for (const wanted of ['Line above the box', 'Side column']) {
    if (!names.includes(wanted)) throw new Error(`the placement choice ${wanted} is missing`)
  }
  // The floating panel is gone, so the page must not offer it.
  if (names.includes('Floating panel')) throw new Error('the removed floating panel is still offered')
})

probe('choosing a placement writes it to the host', async () => {
  resetComponent()
  hostSettings.placement = 'overlay'
  hostCalls.length = 0
  const tree = openPanel()
  find(tree, node => node.type === 'button' && node.children.includes('⚙')).props.onClick()
  const page = render()
  const choices = find(page, node => node.props && node.props.className === 'sr-set-choice-group')
  const sidebar = choices.children.find(child => child.children[0] === 'Side column')
  if (sidebar === null) throw new Error('the sidebar choice is missing')
  sidebar.props.onClick()
  await settle()
  const write = hostCalls.find(call => call.action === 'settings')
  if (write === undefined) throw new Error('the placement was not written')
  if (write.payload.patch.placement !== 'sidebar') throw new Error('the placement was written wrong')
})

probe('the settings page restores the defaults', async () => {
  resetComponent()
  hostSettings.placement = 'sidebar'
  hostCalls.length = 0
  const tree = openPanel()
  find(tree, node => node.type === 'button' && node.children.includes('⚙')).props.onClick()
  const page = render()
  const restore = find(page, node => node.type === 'button' && node.children.includes('Restore defaults'))
  if (restore === null) throw new Error('the restore button was not rendered')
  restore.props.onClick()
  await settle()
  const reset = hostCalls.find(call => call.action === 'reset_settings')
  if (reset === undefined) throw new Error('the defaults were not restored')
})

/**
 * Render the strip with the placement already known.
 *
 * The strip reads the placement from the shared state, and the overlay
 * surface is the one that asks the host for it, so the overlay is rendered
 * first — the way the two surfaces meet in the running app.
 *
 * @returns {any} the rendered strip tree
 */
async function renderStrip() {
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
  react.beginRender()
  overlay.component()
  await react.flushEffects()
  await settle()
  const strip = registered.find(entry => entry.options.name === 'conversation.input.dock')
  const component = strip.component
  // The strip loads the text itself, so its effect runs before the tree is
  // read.
  react.beginRender()
  component()
  await react.flushEffects()
  await settle()
  // The card starts folded to one mark; these probes look at its contents, so
  // it is opened the way a reader opens it.
  return openCard(component)
}

probe('the strip carries the sheet that gives it its own geometry', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const tree = await renderStrip()
  // Without its sheet the strip is a bare paragraph in the composer's flow,
  // which is exactly what it looked like when it could not be used.
  const sheet = find(tree, node => node.type === 'style'
    && typeof node.children[0] === 'string'
    && node.children[0].includes('.sr-strip{'))
  if (sheet === null) throw new Error('the strip rendered without its stylesheet')
  const text = sheet.children[0]
  // The head row is gone: the card is the text plus one footer row.
  for (const rule of ['.sr-strip{', '.sr-strip-panel{', '.sr-strip-foot{', '.sr-strip-line{']) {
    if (!text.includes(rule)) throw new Error('the sheet is missing ' + rule)
  }
  // The geometry that makes it one card of the composer stack.
  if (!/\.sr-strip\{(?:\$\{[^}]*\}|[^}])*margin:0 auto calc/.test(text)) {
    throw new Error('the sheet does not tuck the strip under the input card')
  }
})

probe('the strip is there even before a book is open, so there is a way in', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  // The host says no book is open.
  const saved = hostState.current
  hostState.current = null
  try {
    const tree = await renderStrip()
    const card = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))
    if (card === null) throw new Error('the strip vanished with no book open, so there is no way in')
    // renderStrip opens the card, so the way in is the open card's own
    // controls. Folding it again must leave a mark behind.
    const fold = find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-fold'))
    if (fold === null) throw new Error('the open card has no fold control')
  } finally {
    hostState.current = saved
  }
})

probe('the strip names the book in the plain skin, and numbers it in a disguise', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const plainTree = await renderStrip()
  const plainText = JSON.stringify(plainTree)
  if (!plainText.includes('测试小说')) {
    throw new Error('the plain skin did not name the book')
  }
  // A disguise must not name it, or the skin would give the reader away.
  resetComponent()
  hostSettings.skin = 'log'
  const maskedTree = await renderStrip()
  const maskedText = JSON.stringify(maskedTree)
  if (maskedText.includes('测试小说')) {
    throw new Error('the disguise named the book')
  }
})

probe('the strip follows the chapter the panel turned to', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    // The panel and the card are mounted together, the way they are in the
    // window: the panel is the one that turns chapters.
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const panelBody = componentOf(registered, 'sidebar.right.pane.tab')
    // This retained body must not claim the sidebar while testing shared
    // chapter updates to the card.
    const panel = () => panelBody({ useTabInfo: () => ({ tab: { visible: false } }) })
    const card = componentOf(registered, 'conversation.input.dock')
    react.beginRender()
    panel({})
    await react.flushEffects()
    await settle()
    // The card reads the book itself, so it is opened and rendered until it
    // holds the chapter. A folded card shows no text at all, by design.
    let before = ''
    for (let round = 0; round < 5; round += 1) {
      react.beginRender()
      card()
      await react.flushEffects()
      await settle()
      react.beginRender()
      before = JSON.stringify(await openCard(card))
      if (before.includes('1/5')) break
    }
    if (!before.includes('1/5')) {
      const labels = []
      ;(function walk(n) {
        if (!n || typeof n !== 'object') return
        if (n.props && typeof n.props.className === 'string'
          && (n.props.className.includes('sr-strip-count') || n.props.className.includes('sr-strip-line'))) {
          labels.push(n.props.className + '=' + JSON.stringify(n.children))
        }
        for (const c of n.children || []) walk(c)
      })(JSON.parse(before))
      throw new Error('the card did not show the open chapter: ' + labels.join(' | '))
    }

    // The reader turns a chapter in the panel.
    react.beginRender()
    const tree = panel({})
    await react.flushEffects()
    const next = find(tree, node => node.type === 'button'
      && typeof node.props['aria-label'] === 'string'
      && node.props['aria-label'] === 'Next chapter')
    if (next === null) throw new Error('the panel has no next-chapter button')
    next.props.onClick()
    await settle()

    // A store change re-renders the card in React, so the card is rendered
    // again here, the way the window would.
    let after = ''
    for (let round = 0; round < 5; round += 1) {
      react.beginRender()
      after = JSON.stringify(card())
      await react.flushEffects()
      await settle()
      if (after.includes('2/5')) break
    }
    if (after === before) throw new Error('the card kept the chapter it was mounted on')
    if (!after.includes('2/5')) throw new Error('the card did not follow the reader to chapter 2')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card has buttons that move the text without a wheel', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 5; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))) break
    }
    // The card starts open, so its controls are already rendered.
    for (let round = 0; round < 4; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
    }
    const forward = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-step')
      && node.children[0] === '›')
    if (forward === null) throw new Error('the card has no next button')
    const back = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-step')
      && node.children[0] === '‹')
    if (back === null) throw new Error('the card has no previous button')
    // The buttons move the text, so pressing one is a real step.
    const before = hostCalls.length
    forward.props.onClick()
    await settle()
    if (hostCalls.length === before) throw new Error('the next button did nothing')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card can search the book and land on the place', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 5; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))) break
    }
    for (let round = 0; round < 4; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
    }
    // The overlay is drawn before the search, so the list is seen the way it
    // grows: empty, then full.
    const overlay = componentOf(registered, 'shell.overlay')
    react.beginRender()
    overlay()
    await react.flushEffects()
    // The search is one click away from the text.
    const searchButton = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-open')
      && Array.isArray(node.children)
      && node.children.some(child => child !== null && child !== undefined
        && child.props !== undefined && child.props !== null
        && child.props.className === 'sr-lens'))
    if (searchButton === null) throw new Error('the card has no search button')
    searchButton.props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    const field = find(tree, node => node.type === 'input'
      && hasClass(node.props.className, 'sr-strip-search'))
    if (field === null) throw new Error('the card has no search field')
    field.props.onChange({ target: { value: '第二段' } })
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    const field2 = find(tree, node => node.type === 'input'
      && hasClass(node.props.className, 'sr-strip-search'))
    hostCalls.length = 0
    field2.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} })
    await settle()
    // The search is done: the field closes and the row is as it was.
    react.beginRender()
    tree = card()
    await react.flushEffects()
    const left = find(tree, node => node.type === 'input'
      && hasClass(node.props.className, 'sr-strip-search'))
    assert.equal(left, null, 'the search field stayed open')
    const label = find(tree, node => node.type === 'span'
      && hasClass(node.props.className, 'sr-strip-foot-label'))
    assert.ok(label === null || !String(label.children[0] || '').includes('匹配'),
      'the count of the matches stayed in the row')
    // The places are listed over the window, because the composer cuts off
    // anything that grows out of it.
    react.beginRender()
    const popup = overlay()
    await react.flushEffects()
    const rows = []
    collect(popup, node => {
      if (node.type === 'button' && node.props && typeof node.props.className === 'string'
        && node.props.className.startsWith('sr-list-row')) rows.push(node)
    })
    assert.ok(rows.length > 0, 'the list of the places is empty')
    // Picking a place puts the card on it.
    hostCalls.length = 0
    rows[0].props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    const opened = hostCalls.filter(call => call.action === 'open')
    assert.ok(opened.length > 0, 'the place was not opened')
    // The card counts the text in its own characters, so it is given the
    // place it can show.
    assert.ok(Number.isInteger(opened[opened.length - 1].payload.flow), 'the card was given no place')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card lists the chapters of the book, apart from the catalog', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 5; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))) break
    }
    for (let round = 0; round < 4; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
    }
    // The list of the chapters and the catalog of the books are two doors.
    const tocButton = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-open')
      && node.children[0] === '☷')
    assert.ok(tocButton !== null, 'the card has no table-of-contents button')
    const libraryButton = find(tree, node => node.type === 'button'
      && hasClass(node.props.className, 'sr-strip-open')
      && node.children[0] === '☰')
    assert.ok(libraryButton !== null, 'the card has no library button')
    // The list of the chapters opens over the window, because the composer
    // cuts off anything that grows out of it.
    const overlay = componentOf(registered, 'shell.overlay')
    react.beginRender()
    overlay()
    await react.flushEffects()
    tocButton.props.onClick()
    await settle()
    react.beginRender()
    const popup = overlay()
    await react.flushEffects()
    const rows = []
    collect(popup, node => {
      if (node.type === 'button' && node.props && typeof node.props.className === 'string'
        && node.props.className.startsWith('sr-list-row')) rows.push(node)
    })
    assert.ok(rows.length > 0, 'the list of the chapters is empty')
    // Picking a chapter opens it.
    hostCalls.length = 0
    rows[1].props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    const opened = hostCalls.filter(call => call.action === 'open')
    assert.ok(opened.length > 0, 'the chapter was not opened')
    assert.equal(opened[opened.length - 1].payload.index, 1, 'the wrong chapter was opened')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card takes the arrow keys and a page step, and nothing else', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    // The card starts open; this renders it until it holds a chapter, which is
    // when it can read the arrow keys.
    let tree = ''
    for (let round = 0; round < 10; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      // The card reads the chapter itself, so the probe waits until the text
      // is there: the keys only act when there is text to move.
      const line = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-line'))
      if (line !== null && !String(line.children.join('')).includes('Loading')) break
    }
    const node = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))
    if (node === null) throw new Error('the card was not rendered')
    if (typeof node.props.onKeyDown !== 'function') throw new Error('the card does not read the keys')
    // The arrow keys move the text.
    let prevented = false
    node.props.onKeyDown({
      key: 'ArrowDown', preventDefault() { prevented = true }, stopPropagation() {},
    })
    await settle()
    if (!prevented) throw new Error('the arrow key was left to the page')
    // A letter is the composer's, not the card's.
    let took = false
    node.props.onKeyDown({
      key: 'a', preventDefault() { took = true }, stopPropagation() {},
    })
    if (took) throw new Error('the card took a letter from the composer')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card header opens the card, and a button opens the reader', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 5
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 8; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      const shown = find(tree, node => node.props && typeof node.props.className === 'string'
        && node.props.className.includes('sr-strip-count'))
      if (shown !== null && JSON.stringify(shown.children) !== '["No document open"]') break
    }
    // The card starts open; its contents are what this probe reads.
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    const opened = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')
      && hasClass(node.props.className, 'is-open'))
    if (opened === null) throw new Error('the header did not open the card')
    // Opening the whole reader is a decision of its own, so it has a button.
    const open = find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-open'))
    if (open === null) throw new Error('the card has no way to open the reader')
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the folded card is one quiet mark, and opening it shows the lines', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  // The card starts folded: a reader who is reading keeps the text.
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
  react.beginRender()
  overlay.component()
  await react.flushEffects()
  await settle()
  const card = componentOf(registered, 'conversation.input.dock')
  react.beginRender()
  card()
  await react.flushEffects()
  await settle()
  // The card starts open, so it is folded with its own button first.
  let tree = await foldCard(card)
  const mark = find(tree, node => node.type === 'button'
    && node.props && hasClass(node.props.className, 'sr-strip-mark')) || nativeMark()
  if (mark === null) throw new Error('the folded card has no mark')
  // A folded card is one mark and nothing else: no text, no panel.
  if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-body')) !== null) {
    throw new Error('the folded card still shows its text')
  }
  if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel')) !== null) {
    throw new Error('the folded card still draws its panel')
  }
  // The mark must not name what it opens.
  if (mark.props['aria-label'] === undefined) throw new Error('the mark has no accessible name')
  // Opening it shows the lines.
  mark.props.onClick()
  await settle()
  react.beginRender()
  tree = card()
  await react.flushEffects()
  await settle()
  tree = await openCard(card)
  const body = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-body'))
  if (body === null) throw new Error('the opened card shows no text')
  // And the card offers a way to fold itself again.
  const fold = find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-fold'))
  if (fold === null) throw new Error('the opened card cannot be folded again')
})

/**
 * Build a stand-in for the card, so the wheel can be read the way the
 * browser reads it.
 *
 * The listener is attached by hand and is not passive, because React
 * listens for the wheel at its own root and does so passively. The
 * stand-in records what was attached, so the probe can see the options the
 * card asked for.
 *
 * @returns {object} the stand-in
 */
function makeCardNode() {
  const listeners = []
  const node = {
    listeners,
    addEventListener(kind, listener, options) {
      listeners.push({ kind, listener, options })
    },
    removeEventListener(kind, listener) {
      const at = listeners.findIndex(row => row.kind === kind && row.listener === listener)
      if (at !== -1) listeners.splice(at, 1)
    },
    getBoundingClientRect() {
      return { top: 480, bottom: 620, left: 120, right: 560, width: 440, height: 140 }
    },
    focus() {},
  }
  return node
}

probe('the text of the side column keeps the wheel, so the page stays still', async () => {
  resetComponent()
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  const node = await openWithBody()
  const wheel = node.wheelListeners.find(row => row.kind === 'wheel')
  if (wheel === undefined) throw new Error('the text does not listen for the wheel')
  if (wheel.options === undefined || wheel.options.passive !== false) {
    throw new Error('the wheel is listened for passively, so the page scrolls away')
  }
  // The text is at its end: the wheel is taken, so the page behind does not
  // scroll away under the reader.
  node.scrollTop = node.scrollHeight
  let prevented = false
  wheel.listener({ deltaY: 120, preventDefault() { prevented = true }, stopPropagation() {} })
  if (!prevented) throw new Error('the wheel was handed to the page at the end of the text')
  // In the middle of the text the wheel belongs to the text.
  node.scrollTop = 0
  node.clientHeight = 10
  prevented = false
  wheel.listener({ deltaY: 120, preventDefault() { prevented = true }, stopPropagation() {} })
  if (prevented) throw new Error('the wheel was taken away from the text')
})

probe('the strip takes the wheel away from the page while there is text left', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  const after = await renderStrip()
  const card = find(after, node => node.props && hasClass(node.props.className, 'sr-strip'))
  if (card === null) throw new Error('the strip card was not rendered')
  if (typeof card.props.ref !== 'function') throw new Error('the card does not take the wheel')
  const node = makeCardNode()
  card.props.ref(node)
  const wheel = node.listeners.find(row => row.kind === 'wheel')
  if (wheel === undefined) throw new Error('the card does not listen for the wheel')
  // A passive listener cannot take the wheel away from the page.
  if (wheel.options === undefined || wheel.options.passive !== false) {
    throw new Error('the wheel is listened for passively, so the conversation scrolls away')
  }
  let prevented = false
  wheel.listener({ deltaY: 120, preventDefault() { prevented = true }, stopPropagation() {} })
  if (!prevented) throw new Error('the wheel was not taken away from the conversation')
})

probe('the wheel is left to the conversation when the book has no more text', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostBook.total = 1
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const strip = registered.find(entry => entry.options.name === 'conversation.input.dock')
    const card = strip.component
    react.beginRender()
    card()
    await react.flushEffects()
    await settle()
    const tree = await openCard(card)
    const root = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))
    if (root === null) throw new Error('the strip card was not rendered')
    const node = makeCardNode()
    root.props.ref(node)
    const wheel = node.listeners.find(row => row.kind === 'wheel')
    if (wheel === undefined) throw new Error('the card does not listen for the wheel')
    // The wheel is kept while there is text left to read: the card is the
    // reading surface, and the conversation must not scroll away under it.
    // The end of the chapter is a count of characters, and the text of the
    // chapter is counted in characters too, so the two can be compared.
    for (let round = 0; round < 10; round += 1) {
      let prevented = false
      wheel.listener({ deltaY: 120, preventDefault() { prevented = true }, stopPropagation() {} })
      if (!prevented) {
        throw new Error('the wheel was released while there was text left')
      }
      await settle()
      react.beginRender()
      card()
      await react.flushEffects()
      await settle()
      // The card reads one notch at a time, and a notch is not faster than
      // the throttle that keeps one notch from moving several lines.
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    // At the end of the book the wheel belongs to the conversation again,
    // so the reader can leave the book.
    let prevented = true
    for (let round = 0; round < 80; round += 1) {
      prevented = false
      wheel.listener({ deltaY: 120, preventDefault() { prevented = true }, stopPropagation() {} })
      await settle()
      react.beginRender()
      card()
      await react.flushEffects()
      await settle()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (prevented) throw new Error('the wheel was kept at the end of the book')
  } finally {
    hostBook.total = 5
  }
})

probe('a disguise keeps the strip from naming the book or the text', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'log'
  // The card reads whatever chapter is open, so the probe says which one.
  hostState.current = { bookId: 'book-1', index: 0 }
  // renderStrip opens the card, so the tree holds its text and header.
  const tree = await renderStrip()
  if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')) === null) {
    throw new Error('the strip was not rendered, so the check would pass on an empty tree')
  }
  const text = JSON.stringify(tree)
  if (text.includes('测试小说')) throw new Error('the strip named the book')
  if (text.includes('第一章')) throw new Error('the strip named the chapter')
  if (text.includes('第一段文字')) throw new Error('the strip showed the text')
  // The document is numbered the way the library numbers it.
  if (!text.includes('Document 1 · Section 1')) {
    throw new Error('the strip did not number the document the way the library does')
  }
})

probe('the sidebar body carries the panel and not the floating frame', async () => {
  resetComponent()
  hostSettings.placement = 'sidebar'
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  // The overlay surface is always there and is the one that learns the
  // placement, so it runs first.
  const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
  react.beginRender()
  overlay.component()
  await react.flushEffects()
  await settle()
  const body = registered.find(entry => entry.options.name === 'sidebar.right.pane.tab')
  if (!body) throw new Error('the sidebar body was not registered')
  if (body.options.key !== 'dsh-plugin-stealth-reader') throw new Error('the sidebar body key changed')
  const component = body.component
  react.beginRender()
  const tree = component()
  const panel = find(tree, node => node.props && node.props.className === 'sr-panel sr-panel-sidebar')
  if (panel === null) throw new Error('the sidebar panel was not rendered')
})

probe('the settings page is a card in the reader\'s place, not a full-screen takeover', async () => {
  const source = readFileSync(CLIENT, 'utf8')
  const rules = [...source.matchAll(/\.sr-set-settings-page\{[^}]*\}/g)].map(m => m[0])
  if (rules.length === 0) throw new Error('the settings page has no rule')
  if (rules.some(text => text.includes('inset:0'))) {
    throw new Error('the settings page covers the whole window')
  }
  // One surface in its own place, not a second corner card competing with the
  // panel it replaced. It hangs from the line every popup shares, so opening
  // the catalog and then the settings does not move the frame.
  if (!rules.some(text => /top:var\(--sr-pop-top/.test(text))) {
    throw new Error('the settings page does not open on the shared line')
  }
  if (rules.some(text => text.includes('right:16px'))) {
    throw new Error('the settings page is still a corner card')
  }
  // The strip is one card of the composer stack, so it takes the stack's
  // own inset instead of floating over the conversation.
  const strip = source.match(/\.sr-strip\{(?:\$\{[^}]*\}|[^}])*\}/)
  if (strip === null) throw new Error('the strip has no rule')
  if (!strip[0].includes('margin:0 auto calc')) throw new Error('the strip is not part of the stack')
  if (strip[0].includes('position:absolute')) throw new Error('the strip still floats over the conversation')
})

probe('the reader falls back to the strip when the side column cannot carry it', async () => {
  resetComponent()
  hostSettings.placement = 'sidebar'
  const { ctx, registered } = makeContext()
  // The side column refuses the tab, the way it does with no session.
  ctx.sidebarRight.openTab = () => { throw new Error('no session') }
  client.apply(ctx)
  const body = registered.find(entry => entry.options.name === 'sidebar.right.pane.tab')
  react.beginRender()
  body.component()
  await react.flushEffects()
  await settle()
  // The chord asks for the reader.
  const listener = ctx.shortcuts.listeners[ctx.shortcuts.listeners.length - 1]
  if (typeof listener !== 'function') throw new Error('no chord was installed')
  listener({
    type: 'keydown',
    gesture: { code: 'KeyN', control: true, alt: true, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false },
    context: { region: 'page', modal: null, target: null },
    consume() {},
  })
  await settle()
  // The side column could not take it, so the reader moves to the one shape
  // that needs nothing but the composer.
  const strip = registered.find(entry => entry.options.name === 'conversation.input.dock')
  if (strip === undefined) throw new Error('the strip was not registered')
  // The strip reads the book itself, so it needs a moment to hold it.
  react.beginRender()
  strip.component()
  await react.flushEffects()
  await settle()
  react.beginRender()
  const tree = strip.component()
  const card = tree === null || tree === undefined
    ? null
    : find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))
  if (card === null && nativeMark() === null) throw new Error('the reader has nowhere to be')
})

probe('the website library opens from the settings page and lists its saved sites', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (body === null) throw new Error('the settings page has no body')
  // The library's entry lives in the settings, next to the other ways in.
  const entry = find(body, node => node.type === 'button' && node.children.includes('Find books'))
  if (entry === null) throw new Error('the settings page does not offer the website library')
  entry.props.onClick()
  await settle()
  const overlay = lastRegistered.find(registered => registered.options.name === 'shell.overlay')
  if (overlay === undefined) throw new Error('the overlay was not registered')
  let tree = ''
  for (let round = 0; round < 4; round += 1) {
    react.beginRender()
    tree = overlay.component()
    await react.flushEffects()
    await settle()
    if (JSON.stringify(tree).includes('示例书站')) break
  }
  const shop = find(tree, node => node.props && hasClass(node.props.className, 'sr-shop'))
  if (shop === null) throw new Error('the website library is not mounted in the overlay')
  const text = JSON.stringify(shop)
  if (!text.includes('示例书站')) throw new Error('the saved website is not listed')
  if (!text.includes('books.example')) throw new Error('the saved website shows no address')
  const form = find(shop, node => node.type === 'form' && node.props && node.props.onSubmit !== undefined)
  if (form === null) throw new Error('the website library has no add form')
  const address = find(shop, node => node.type === 'input' && node.props && node.props.type === 'url')
  if (address === null) throw new Error('the add form has no address field')
  if (address.props['aria-label'] === undefined) throw new Error('the address field has no accessible name')
})

probe('the closed website library is hidden in the DOM, never unmounted', async () => {
  await resetComponentAndSettle()
  const overlay = lastRegistered.find(registered => registered.options.name === 'shell.overlay')
  if (overlay === undefined) throw new Error('the overlay was not registered')
  react.beginRender()
  const tree = overlay.component()
  await react.flushEffects()
  await settle()
  const shop = find(tree, node => node.props && hasClass(node.props.className, 'sr-shop'))
  if (shop === null) throw new Error('the website library is not mounted in the overlay')
  // An attached Electron guest cannot be re-attached to a new parent, so the
  // container stays mounted and only its visibility changes.
  const style = shop.props.style
  if (style === undefined || style.visibility !== 'hidden') {
    throw new Error('the closed website library is not merely hidden')
  }
})

probe('a disguise never prints a book title or a sample from the website library', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function BookstoreSurface()')
  const end = source.indexOf('let bookstoreTrigger', start)
  if (start < 0 || end < 0) throw new Error('the website library component is missing')
  const body = source.slice(start, end)
  // Reading an undeclared name here threw on the first preview render and
  // unmounted the whole overlay, so the declaration is part of the contract.
  const declared = body.indexOf('const disguised =')
  const firstUse = body.indexOf('disguised ?')
  if (declared < 0) throw new Error('the website library reads a skin it never declares')
  if (firstUse >= 0 && declared > firstUse) throw new Error('the skin is read before it is declared')
  // The preview names the book and prints real chapter text, so both must be
  // behind the same choice the rest of the reader uses.
  if (!body.includes("disguised ? t('shopPreviewNeutral') : preview.title")) {
    throw new Error('the preview prints the book title while disguised')
  }
  if (!body.includes("disguised ? t('shopSampleNeutral') : (preview.sample || '')")) {
    throw new Error('the preview prints chapter text while disguised')
  }
  if (!body.includes("disguised ? t('sectionN'")) {
    throw new Error('the preview chapter list prints real chapter names while disguised')
  }
})

probe('the settings page is four tabs and shows one subject at a time', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const tabs = []
  collect(page, node => {
    if (node.type === 'button' && hasClass(node.props.className, 'sr-set-tab')) tabs.push(node)
  })
  const names = tabs.map(node => node.children.join(''))
  for (const wanted of ['Reading', 'Looks', 'Books', 'Websites']) {
    if (!names.includes(wanted)) throw new Error('the page has no ' + wanted + ' tab: ' + names.join(','))
  }
  // Every section is mounted, so a half-typed path survives a look elsewhere,
  // but only the chosen tab's sections may be visible.
  const sections = []
  collect(page, node => {
    if (node.props && hasClass(node.props.className, 'sr-set-group')) sections.push(node)
  })
  if (sections.length < 4) throw new Error('the page has fewer sections than tabs: ' + sections.length)
  const shown = sections.filter(node => node.props.style === undefined)
  if (shown.length === 0) throw new Error('the page shows no section at all')
  const shownTabs = new Set(shown.map(node => node.props['data-tab']))
  if (shownTabs.size !== 1) throw new Error('the page shows sections of several tabs: ' + [...shownTabs].join(','))
  if (!shownTabs.has('reading')) throw new Error('the page did not open on the reading tab')
  // The selected tab is the only one a keyboard reaches.
  const active = tabs.filter(node => node.props['aria-selected'] === true)
  if (active.length !== 1) throw new Error('the page has ' + active.length + ' selected tabs')
  if (active[0].props.tabIndex !== 0) throw new Error('the selected tab is not reachable by Tab')
  // Choosing another tab moves the page, and the first one goes away.
  const looks = tabs.find(node => node.children.join('') === 'Looks')
  looks.props.onClick()
  await settle()
  react.beginRender()
  const after = componentOf(lastRegistered, 'sidebar.right.pane.tab')()
  await react.flushEffects()
  await settle()
  const shownAfter = []
  collect(after, node => {
    if (node.props && hasClass(node.props.className, 'sr-set-group') && node.props.style === undefined) shownAfter.push(node)
  })
  if (shownAfter.length === 0) throw new Error('choosing a tab showed no section')
  if (shownAfter.some(node => node.props['data-tab'] !== 'appearance')) {
    throw new Error('choosing Looks left another tab on screen')
  }
  if (!JSON.stringify(shownAfter[0]).includes('Disguise')) {
    throw new Error('choosing Looks did not show the appearance section')
  }
})

probe('every door into the settings opens it as a toggle, on a named tab', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function openSettings(')
  if (start < 0) throw new Error('the settings page has no shared opener')
  const body = source.slice(start, start + 400)
  if (!body.includes('settingsTabRequested')) throw new Error('the opener ignores the tab it was asked for')
  if (!body.includes('settingsOpen: true')) throw new Error('the opener does not open the page')
  // Every door calls the shared opener, so no call site can invent its own
  // tab or forget the toggle.
  const doors = (source.match(/toggleSettings\('/g) || []).length
  if (doors < 1) throw new Error('the reader has no door into the settings')
  if (!source.includes('function toggleSettings(')) throw new Error('the doors do not share one toggle')
  // The catalog is its own page, with its own toggle, so the two pages never
  // fight over the same flag.
  if (!source.includes('function togglePicker(')) throw new Error('the catalog has no toggle of its own')
  if (!source.includes('pickerOpen: true')) throw new Error('the catalog toggle does not open the page')
  // One toggle keeps every door behaving the same; a call site that decides
  // for itself is how the two buttons drifted apart before.
  if (/settingsOpen\) \? setShowSettings\(false\)/.test(source)) {
    throw new Error('a door decides the toggle for itself')
  }
  // Options lives on one button now, not on the settings glyph and the
  // library glyph opening the same page with nothing to tell them apart.
  const gears = (source.match(/}, '⚙'\)/g) || []).length
  if (gears !== 1) throw new Error('the panel draws ' + gears + ' Options buttons')
})

probe('the settings tabs answer the arrow keys', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const tabs = []
  collect(page, node => {
    if (node.type === 'button' && hasClass(node.props.className, 'sr-set-tab')) tabs.push(node)
  })
  const reading = tabs.find(node => node.children.join('') === 'Reading')
  if (reading === undefined) throw new Error('the reading tab is missing')
  let prevented = false
  // A tablist that only answers the mouse is not a tablist for a keyboard.
  reading.props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented = true } })
  await settle()
  if (!prevented) throw new Error('the arrow key was left to scroll the page')
  react.beginRender()
  const after = componentOf(lastRegistered, 'sidebar.right.pane.tab')()
  await react.flushEffects()
  await settle()
  const shown = []
  collect(after, node => {
    if (node.props && hasClass(node.props.className, 'sr-set-group') && node.props.style === undefined) shown.push(node)
  })
  if (shown.length === 0) throw new Error('the arrow key showed nothing')
  if (shown.some(node => node.props['data-tab'] !== 'appearance')) {
    throw new Error('the right arrow did not move to the next tab')
  }
})

probe('each door opens the subject its own button promised', async () => {
  await resetComponentAndSettle()
  // "Add a document…" promises adding, so it opens the tab that adds.
  const page = await openSettingsPage()
  const empty = []
  collect(page, node => {
    if (node.props && hasClass(node.props.className, 'sr-set-group') && node.props.style === undefined) empty.push(node)
  })
  // A remembered tab would make the button's own label a lie, so the opener
  // must hand the named subject through on every call.
  const source = readFileSync(CLIENT, 'utf8')
  const helper = source.slice(source.indexOf('function openSettings('), source.indexOf('function toggleSettings('))
  if (!helper.includes('settingsTabRequested = tab')) {
    throw new Error('the opener ignores the subject it was asked for')
  }
  const pageStart = source.indexOf('function SettingsPage(')
  const pageEnd = source.indexOf('function BookstoreSurface(')
  if (pageStart < 0 || pageEnd < pageStart) throw new Error('the settings page is missing')
  if (!source.slice(pageStart, pageEnd).includes('React.useState(settingsTabRequested)')) {
    throw new Error('the page does not start on the requested subject')
  }
  // The page must not persist a subject of its own, or the next door would
  // reopen on something its label did not name.
  if (/setTabState|settingsTabRequested = name/.test(source)) {
    throw new Error('the page remembers a subject across opens')
  }
})


probe('one Escape press closes one layer, not the page and the panel together', async () => {
  const source = readFileSync(CLIENT, 'utf8')
  // Three surfaces answered Escape on their own before, so a single press
  // closed several of them. They all go through one stack now.
  // One listener for the chords is fine; what must not exist is a second
  // listener that answers Escape on its own.
  if (!source.includes('escapeLayers.push(')) throw new Error('no shared Escape stack')
  const stackAt = source.indexOf('const escapeLayers = (() => {')
  const stackEnd = source.indexOf('    /**\n     * Map a host failure', stackAt)
  const outside = source.slice(0, stackAt) + source.slice(stackEnd)
  if (/addEventListener\('keydown'[\s\S]{0,200}Escape/.test(outside)) {
    throw new Error('a surface answers Escape outside the shared stack')
  }
  const pushes = (source.match(/escapeLayers\.push\(/g) || []).length
  if (pushes < 3) throw new Error('only ' + pushes + ' surfaces joined the Escape stack')
  for (const surface of ['SettingsPage', 'BookstoreSurface']) {
    const start = source.indexOf('function ' + surface + '(')
    const end = source.indexOf('function ', start + 10)
    const body = source.slice(start, end)
    if (body.includes("addEventListener('keydown'")) {
      throw new Error(surface + ' still answers Escape on its own')
    }
  }
})

probe('the settings page has one way out, and it stays out of the scrolling body', async () => {
  await resetComponentAndSettle()
  const page = await openSettingsPage()
  const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  if (body === null) throw new Error('the settings page has no body')
  // Two buttons that both closed the page, one of them inside the scroll area,
  // is how the way out disappeared on a long list.
  const inBody = []
  collect(body, node => {
    if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-set-action')) {
      const label = node.children.join('')
      if (label === 'Close' || label === 'Restore defaults') inBody.push(label)
    }
  })
  if (inBody.length > 0) throw new Error('the body still carries ' + inBody.join(', '))
  const foot = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-foot'))
  if (foot === null) throw new Error('the settings page has no fixed footer')
  const restore = find(foot, node => node.type === 'button')
  if (restore === null) throw new Error('the footer has no repair action')
  // The cross in the title row is the one way out, so the footer does not
  // repeat it.
  const head = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-head'))
  const cross = head === null ? null : find(head, node => node.type === 'button')
  if (cross === null) throw new Error('the title row has no close button')
  const footButtons = []
  collect(foot, node => { if (node.type === 'button') footButtons.push(node.children.join('')) })
  if (footButtons.includes('Close')) throw new Error('the footer repeats the close button')
})

probe('reading a website book does not need the website library to be opened first', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // Reading used to fail with "open this book's website first" whenever the
  // reader had not visited the website library that session. The panel now
  // asks the helper to open the site's own guest, so an added book is
  // readable immediately.
  const retryStart = source.indexOf('async function call(action, payload)')
  if (retryStart < 0) throw new Error('the reader has no browser retry path')
  const retry = source.slice(retryStart, source.indexOf('The reader\'s shared state', retryStart))
  if (!retry.includes('ensureAndFetch')) {
    throw new Error('the reader still requires the website library to be open first')
  }
  if (retry.includes('browser.fetchPage(site, need.url)')) {
    throw new Error('the reader still fetches without opening the site')
  }
  const helperStart = source.indexOf('async function ensureAndFetch(')
  if (helperStart < 0) throw new Error('the helper cannot open a site by itself')
  const helper = source.slice(helperStart, helperStart + 900)
  if (!helper.includes('await open(wanted)')) throw new Error('the helper never opens a closed site')
  if (!helper.includes('waitReady')) throw new Error('the helper does not wait for the page to load')
})

probe('a site that is still loading is waited for instead of refused', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('async function waitReady(')
  if (start < 0) throw new Error('there is no readiness wait')
  const body = source.slice(start, start + 700)
  if (!/while \(current && !current\.destroyed && !current\.ready\)/.test(body)) {
    throw new Error('the wait does not actually wait for the guest')
  }
  if (!body.includes('browserLoading')) throw new Error('the wait has no timeout failure')
})

probe('the Books tab shows its content in the settings section variant', async () => {
  await resetComponentAndSettle()
  const section = lastRegistered.find(entry => entry.options.name === 'settings.section')
  if (section === undefined) throw new Error('no settings section was registered')
  // The Harness settings page draws this variant, so it is the one a user sees
  // from Settings > Reading rather than from the reading panel.
  let tree = ''
  for (let round = 0; round < 4; round += 1) {
    react.beginRender()
    tree = section.component()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
  }
  const page = find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-page'))
  if (page === null) throw new Error('the section rendered no page')
  const tabs = []
  collect(page, node => {
    if (node.type === 'button' && hasClass(node.props.className, 'sr-set-tab')) tabs.push(node)
  })
  const books = tabs.find(node => node.children.join('') === 'Books')
  if (books === undefined) throw new Error('the section has no Books tab')
  books.props.onClick()
  await settle()
  react.beginRender()
  const after = section.component()
  await react.flushEffects()
  await settle()
  const shown = []
  collect(after, node => {
    if (node.props && hasClass(node.props.className, 'sr-set-group') && node.props.style === undefined) shown.push(node)
  })
  if (shown.length === 0) throw new Error('the Books tab showed no section at all')
  const text = JSON.stringify(shown)
  for (const wanted of ['Add a file', 'Add a web novel', 'Add a folder', 'Find books']) {
    if (!text.includes(wanted)) throw new Error('the Books tab does not show ' + wanted)
  }
  const list = find(after, node => node.props && hasClass(node.props.className, 'sr-set-books'))
  if (list === null) throw new Error('the Books tab does not list the books')
})

probe('the settings page loads its own lists, so a tab is never empty', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function SettingsPage(')
  const end = source.indexOf('function BookstoreSurface(')
  const body = source.slice(start, end)
  // Opened from the Harness settings there is no reading panel above this page
  // to fill the shared store, so the page has to ask for its own lists.
  if (!/React\.useEffect\(\(\) => \{\s*\n\s*void loadLibrary\(\)/.test(body)) {
    throw new Error('the settings page never loads the library itself')
  }
  if (!body.includes("readerStore.set({ books: data.books || [], sites: data.sites || [] })")) {
    throw new Error('the settings page does not publish both lists it draws')
  }
})

probe('the embedded settings tab is not collapsed to its padding', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const rule = source.match(/\.sr-set-settings-page\.sr-set-settings-section\{[^}]*\}/)
  if (rule === null) throw new Error('the section variant has no rule')
  // In the Harness settings the page is embedded in a document that owns its
  // own scrolling. A flex column gives the body flex:1 (basis 0); with an
  // auto-height parent there is no free space, so the body collapsed and its
  // content was clipped. That is what an empty-looking tab was.
  if (/display:flex/.test(rule[0])) {
    throw new Error('the embedded page is still a flex column')
  }
  const body = source.match(/\.sr-set-settings-page\.sr-set-settings-section \.sr-set-settings-body\{[^}]*\}/)
  if (body === null) throw new Error('the embedded body has no rule')
  if (!/flex:none/.test(body[0])) throw new Error('the embedded body can still be squashed to nothing')
  if (!/overflow:visible/.test(body[0])) throw new Error('the embedded body still clips its own content')
})


probe('DEBUG where do the other tabs live', async () => {
  await resetComponentAndSettle()
  const section = lastRegistered.find(entry => entry.options.name === 'settings.section')
  let tree = ''
  for (let round = 0; round < 4; round += 1) {
    react.beginRender()
    tree = section.component()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
  }
  const body = find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  const all = []
  collect(tree, node => {
    if (node.props && node.props['data-tab']) all.push(node.props['data-tab'])
  })
  const directKids = body.children.filter(c => c && c.props).map(c => [c.type, c.props.className, c.props['data-tab']])
  console.log('ALL_SECTIONS', JSON.stringify(all))
  console.log('DIRECT_CHILDREN', JSON.stringify(directKids))
  // Is the appearance section inside the reading section?
  const reading = find(tree, node => node.props && node.props['data-tab'] === 'reading')
  const nested = []
  if (reading) collect(reading, node => { if (node.props && node.props['data-tab']) nested.push(node.props['data-tab']) })
  console.log('NESTED_INSIDE_READING', JSON.stringify(nested))
})

probe('each tab is a sibling, so switching shows that tab and no other', async () => {
  await resetComponentAndSettle()
  const section = lastRegistered.find(entry => entry.options.name === 'settings.section')
  let tree = ''
  for (let round = 0; round < 4; round += 1) {
    react.beginRender(); tree = section.component(); await react.flushEffects(); await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
  }
  const body = find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
  const siblings = body.children.filter(c => c && c.props && c.props['data-tab']).map(c => c.props['data-tab'])
  // Appearance, library and sites were once nested inside Reading, so those
  // three tabs showed nothing when chosen. A sibling per tab is the property
  // that makes switching work, and a paren miscount breaks it silently.
  if (JSON.stringify(siblings) !== JSON.stringify(['reading', 'reading', 'appearance', 'library', 'sites'])) {
    throw new Error('the sections are not siblings: ' + JSON.stringify(siblings))
  }
  const tabs = []
  collect(tree, node => { if (node.type === 'button' && hasClass(node.props.className, 'sr-set-tab')) tabs.push(node) })
  for (const [label, expected, wanted] of [['Looks', 'appearance', 'Disguise'], ['Books', 'library', 'Add a file'], ['Websites', 'sites', 'My websites']]) {
    tabs.find(t => t.children.join('') === label).props.onClick()
    await settle()
    react.beginRender()
    const after = section.component()
    await react.flushEffects()
    await settle()
    const shown = find(after, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
      .children.filter(c => c && c.props && c.props['data-tab'] && c.props.style === undefined)
      .map(c => c.props['data-tab'])
    if (JSON.stringify(shown) !== JSON.stringify([expected])) {
      throw new Error(`choosing ${label} showed ${JSON.stringify(shown)}`)
    }
    if (!JSON.stringify(shown).includes(expected)) throw new Error(`${label} showed the wrong section`)
    if (!JSON.stringify(after).includes(wanted)) throw new Error(`${label} is missing ${wanted}`)
  }
})


probe('the library has a shelf shape, and a book without a cover still draws', async () => {
  await resetComponentAndSettle()
  const before = hostSettings.libraryShape
  hostSettings.libraryShape = 'shelf'
  try {
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    if (body === null) throw new Error('the settings page has no body')
    const shelf = find(body, node => node.props && hasClass(node.props.className, 'sr-set-shelf'))
    if (shelf === null) throw new Error('the shelf shape is not drawn')
    const spines = []
    collect(shelf, node => {
      if (node.type === 'button' && hasClass(node.props.className, 'sr-set-spine')) spines.push(node)
    })
    if (spines.length === 0) throw new Error('the shelf has no books on it')
    // Every shape names its book, and every shape is a real button.
    for (const spine of spines) {
      if (spine.props['aria-label'] === undefined) throw new Error('a spine has no accessible name')
      const title = find(spine, node => node.props && hasClass(node.props.className, 'sr-set-spine-title'))
      if (title === null) throw new Error('a shape drew no title')
      if (String(title.children.join('')).trim() === '') throw new Error('a shape drew an empty title')
    }
    // The name appears once, not twice: the old shelf printed it inside the
    // shape and again underneath, which read as a duplicated title.
    const titles = []
    collect(body, node => {
      if (node.props && hasClass(node.props.className, 'sr-set-spine-title')) titles.push(node.children.join(''))
    })
    if (titles.length !== spines.length) throw new Error('the title is drawn ' + titles.length + ' times for ' + spines.length + ' books')
    // The list shape must not be on the page at the same time.
    const rows = find(body, node => node.props && hasClass(node.props.className, 'sr-set-books'))
    if (rows !== null) throw new Error('both library shapes are drawn at once')
  } finally {
    hostSettings.libraryShape = before
  }
})

probe('a disguise names nothing on the shelf and says nothing about origin', async () => {
  await resetComponentAndSettle()
  const beforeShape = hostSettings.libraryShape
  const beforeSkin = hostSettings.skin
  const savedBooks = hostBooks
  hostSettings.libraryShape = 'shelf'
  hostSettings.skin = 'log'
  hostBooks = [
    { id: 'a', kind: 'txt', title: 'Alpha', source: 'a.txt', chapters: 1, origin: 'local', cached: 0 },
    { id: 'b', kind: 'web', title: 'Beta', source: 'https://x/b', chapters: 2, origin: 'web', transport: 'browser', siteId: 's', cached: 1 },
  ]
  try {
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    const text = JSON.stringify(body)
    for (const name of ['Alpha', 'Beta']) {
      if (text.includes(name)) throw new Error('a disguise still names ' + name + ' on the shelf')
    }
    if (!/Document \d/.test(text)) throw new Error('a disguise does not number the books on the shelf')
    // The origin line and the web mark both name where a book came from.
    if (find(body, node => node.props && hasClass(node.props.className, 'sr-set-spine-meta')) !== null) {
      throw new Error('a disguise still says where the books came from')
    }
    if (find(body, node => node.props && hasClass(node.props.className, 'sr-set-spine-mark')) !== null) {
      throw new Error('a disguise still marks a website book')
    }
  } finally {
    hostBooks = savedBooks
    hostSettings.skin = beforeSkin
    hostSettings.libraryShape = beforeShape
  }
})

probe('the shape switch is one button that remembers the choice', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function SettingsPage(')
  const end = source.indexOf('function BookstoreSurface(')
  const body = source.slice(start, end)
  if (!body.includes("change('libraryShape'")) throw new Error('the shape is never stored')
  if (!body.includes("libraryShape === 'shelf'")) throw new Error('the shelf is never selected')
  // One button that says what it will do, not two that both look available.
  const switches = (body.match(/className: 'sr-set-shape'/g) || []).length
  if (switches !== 1) throw new Error('there are ' + switches + ' shape switches')
})

probe('a full shelf draws every book, not just the first few', async () => {
  await resetComponentAndSettle()
  const before = hostSettings.libraryShape
  hostSettings.libraryShape = 'shelf'
  // A real library is not one book: the grid has to hold a whole shelf.
  const many = []
  for (let at = 0; at < 40; at += 1) {
    many.push({ id: 'book-' + at, kind: 'txt', title: 'Book ' + at, source: 'n' + at + '.txt', chapters: at + 1 })
  }
  const savedBooks = hostBooks
  hostBooks = many
  try {
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    const spines = []
    collect(body, node => {
      if (node.type === 'button' && hasClass(node.props.className, 'sr-set-spine')) spines.push(node)
    })
    if (spines.length !== 40) throw new Error('the shelf drew ' + spines.length + ' of 40 books')
    // Each shape is named, so no book is an unlabelled blank box.
    for (const spine of spines) {
      if (spine.props['aria-label'] === undefined) throw new Error('a spine has no accessible name')
      const title = find(spine, node => node.props && hasClass(node.props.className, 'sr-set-spine-title'))
      if (title === null || String(title.children.join('')).trim() === '') {
        throw new Error('a shape drew no title')
      }
    }
  } finally {
    hostBooks = savedBooks
    hostSettings.libraryShape = before
  }
})

probe('the shelf asks only for the covers that exist', async () => {
  await resetComponentAndSettle()
  const before = hostSettings.libraryShape
  hostSettings.libraryShape = 'shelf'
  const savedBooks = hostBooks
  const savedCover = hostFetchCover
  // One book claims a cover, the other does not.
  hostBooks = [
    { id: 'with-cover', kind: 'epub', title: 'With Cover', source: 'a.epub', chapters: 2, hasCover: true },
    { id: 'no-cover', kind: 'txt', title: 'No Cover', source: 'b.txt', chapters: 3 },
  ]
  const asked = []
  hostFetchCover = (bookId) => { asked.push(bookId); return { ok: true, cover: { mime: 'image/png', data: 'data:image/png;base64,AAAA' } } }
  try {
    await openSettingsPage()
    await settle()
    // A book without a cover must not cost a request: a shelf of text files
    // would otherwise fire one round trip per book for nothing.
    if (asked.length !== 1) throw new Error('the shelf asked for ' + asked.length + ' covers instead of 1')
    if (asked[0] !== 'with-cover') throw new Error('the shelf asked for the wrong cover: ' + asked[0])
  } finally {
    hostBooks = savedBooks
    hostFetchCover = savedCover
    hostSettings.libraryShape = before
  }
})

probe('the shelf says where each book lives and how much is saved', async () => {
  await resetComponentAndSettle()
  const beforeShape = hostSettings.libraryShape
  const beforeSkin = hostSettings.skin
  const savedBooks = hostBooks
  hostSettings.libraryShape = 'shelf'
  hostSettings.skin = 'plain'
  hostBooks = [
    { id: 'local-1', kind: 'txt', title: '本地书 作者：某人', source: 'a.txt', chapters: 120, origin: 'local', cached: 0 },
    { id: 'web-1', kind: 'web', title: '网络书', source: 'https://x/1/', chapters: 300, origin: 'web', transport: 'browser', siteId: 's', cached: 42 },
    { id: 'web-2', kind: 'web', title: '未缓存', source: 'https://x/2/', chapters: 10, origin: 'web', transport: 'browser', siteId: 's', cached: 0 },
  ]
  try {
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    // One line under each shape says where the book lives and how much of it
    // is on disk. That is the only place the shelf talks about origin.
    const meta = []
    collect(body, node => {
      if (node.props && hasClass(node.props.className, 'sr-set-spine-meta')) meta.push(node.children.join(''))
    })
    if (meta.length !== 3) throw new Error('only ' + meta.length + ' of 3 books say where they live')
    if (!meta.some(text => text.includes('Local'))) throw new Error('no line says a book is local: ' + JSON.stringify(meta))
    if (!meta.some(text => text.includes('42/300'))) throw new Error('no line shows the saved progress: ' + JSON.stringify(meta))
    // A website book also gets one small mark on the shape itself.
    const marks = []
    collect(body, node => {
      if (node.props && hasClass(node.props.className, 'sr-set-spine-mark')) marks.push(node)
    })
    if (marks.length !== 2) throw new Error('the website books are not marked: ' + marks.length)
  } finally {
    hostBooks = savedBooks
    hostSettings.skin = beforeSkin
    hostSettings.libraryShape = beforeShape
  }
})

probe('the shelf shows the book name, not the author written into the file name', async () => {
  await resetComponentAndSettle()
  const beforeShape = hostSettings.libraryShape
  const beforeSkin = hostSettings.skin
  const savedBooks = hostBooks
  hostSettings.libraryShape = 'shelf'
  hostSettings.skin = 'plain'
  hostBooks = [{ id: 'b1', kind: 'txt', title: '保护我方族长 作者：傲无常', source: 'a.txt', chapters: 545, origin: 'local', cached: 0 }]
  try {
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    const title = find(body, node => node.props && hasClass(node.props.className, 'sr-set-spine-title'))
    if (title === null) throw new Error('the shelf drew no title')
    const shown = title.children.join('')
    if (shown.includes('作者')) throw new Error('the author is still inside the title: ' + shown)
    if (shown !== '保护我方族长') throw new Error('the title was not reduced to the book name: ' + shown)
    // The author is kept, but as its own quieter line.
    const author = find(body, node => node.props && hasClass(node.props.className, 'sr-set-spine-author'))
    if (author === null) throw new Error('the author was dropped instead of separated')
    if (!author.children.join('').includes('傲无常')) throw new Error('the author line does not name the author')
  } finally {
    hostBooks = savedBooks
    hostSettings.skin = beforeSkin
    hostSettings.libraryShape = beforeShape
  }
})

probe('a very short or odd title still draws something readable', async () => {
  await resetComponentAndSettle()
  const beforeShape = hostSettings.libraryShape
  const beforeSkin = hostSettings.skin
  const savedBooks = hostBooks
  hostSettings.libraryShape = 'shelf'
  hostSettings.skin = 'plain'
  // Real libraries contain files named "1", "cks" and "《超品".
  hostBooks = [
    { id: 'n1', kind: 'txt', title: '1', source: 'a.txt', chapters: 202, origin: 'local', cached: 0 },
    { id: 'n2', kind: 'txt', title: 'cks', source: 'b.txt', chapters: 325, origin: 'local', cached: 0 },
    { id: 'n3', kind: 'txt', title: '《超品', source: 'c.txt', chapters: 2623, origin: 'local', cached: 0 },
  ]
  try {
    const page = await openSettingsPage()
    const body = find(page, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    const titles = []
    collect(body, node => {
      if (node.props && hasClass(node.props.className, 'sr-set-spine-title')) titles.push(node.children.join(''))
    })
    if (titles.length !== 3) throw new Error('only ' + titles.length + ' of 3 shapes drew a title')
    for (const title of titles) {
      if (String(title).trim() === '') throw new Error('a shape drew an empty title')
    }
    // The name appears exactly once per book, inside its shape.
    if (titles.length !== 3) throw new Error('the shelf drew ' + titles.length + ' titles for 3 books')
    for (const title of titles) {
      if (String(title).trim() === '') throw new Error('a shape drew an empty title')
    }
  } finally {
    hostBooks = savedBooks
    hostSettings.skin = beforeSkin
    hostSettings.libraryShape = beforeShape
  }
})

probe('a cover that fails to load still leaves the book named', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('const shelfShape =')
  const end = source.indexOf('// The library, as a list of books the reader can open.')
  const body = source.slice(start, end)
  // The drawn face is always in the tree, and the image sits over it. Without
  // this, a stored cover that went missing left a shape with no name at all.
  if (!body.includes("className: 'sr-set-spine-face'")) {
    throw new Error('the shape has no drawn face to fall back to')
  }
  const faceAt = body.indexOf("className: 'sr-set-spine-face'")
  const imgAt = body.indexOf("className: 'sr-set-spine-cover'")
  if (faceAt < 0 || imgAt < 0) throw new Error('the cover image or its fallback is missing')
  if (!body.includes('onError:')) throw new Error('a failed cover image is never hidden')
  // The face must be under the image, not inside the same conditional.
  if (!/stored === null\s*\n?\s*\? null\s*\n?\s*: h\('img'/.test(body)) {
    throw new Error('the face is still only drawn when there is no cover')
  }
})

probe('the shelf does not scroll inside the page, and its cross waits for a hover', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // A height cap with its own scrollbar clipped the first row of shapes in
  // half, because the settings page already scrolls.
  const shelf = source.match(/\.sr-set-shelf\{[^}]*\}/)
  if (shelf === null) throw new Error('the shelf has no rule')
  if (/max-height/.test(shelf[0])) throw new Error('the shelf still caps its height')
  if (/overflow:\s*auto/.test(shelf[0])) throw new Error('the shelf still scrolls inside the page')
  // The cross is hidden until the shape is hovered. The row rule further down
  // also styles this element, so the shelf rule has to outrank it.
  const rule = source.match(/\.sr-set-spine-item \.sr-set-spine-remove\{[^}]*\}/)
  if (rule === null) throw new Error('the shelf cross has no rule that outranks the row cross')
  if (!/opacity:0/.test(rule[0])) throw new Error('the shelf cross is visible before a hover')
  if (!/sr-set-spine-item:hover \.sr-set-spine-remove[^{]*\{opacity:1\}/.test(source)) {
    throw new Error('the cross never appears on hover')
  }
  // The shape itself must be a surface with a spine, not a bare box.
  const spine = source.match(/\.sr-set-spine\{[^}]*\}/)
  if (spine === null) throw new Error('the shape has no rule')
  if (!/aspect-ratio:2\/3/.test(spine[0])) throw new Error('the shape is not a book proportion')
  if (!/var\(--sr-bg\)/.test(spine[0])) throw new Error('the shape does not use the theme surface')
  if (/hsl\(/.test(source)) throw new Error('the shelf still invents its own colours')
})

probe('the shelf keeps a compact shape so a row holds several books', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const shelf = source.match(/\.sr-set-shelf\{[^}]*\}/)
  if (shelf === null) throw new Error('the shelf has no rule')
  const column = shelf[0].match(/minmax\((\d+)px/)
  if (column === null) throw new Error('the shelf has no column width')
  const width = Number(column[1])
  // A shape that is too wide makes the shelf look like a poster wall and forces
  // a scroll for a modest library.
  if (width < 60 || width > 88) throw new Error('the shelf column is ' + width + 'px, outside the compact range')
  // The title steps down with the shape, or a small face shows two characters.
  const title = source.match(/\.sr-set-spine-title\{[^}]*\}/)
  if (title === null) throw new Error('the shape title has no rule')
  const size = Number((title[0].match(/font-size:(\d+)px/) || [])[1])
  if (!Number.isFinite(size) || size > 12) throw new Error('the shape title is ' + size + 'px, too large for a compact shape')
})

probe('DEBUG folded mark with no book open', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const saved = hostState.current
  hostState.current = null
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(e => e.options.name === 'shell.overlay')
    react.beginRender(); overlay.component(); await react.flushEffects(); await settle()
    const strip = registered.find(e => e.options.name === 'conversation.input.dock')
    const comp = strip.component
    react.beginRender(); comp(); await react.flushEffects(); await settle()
    react.beginRender()
    const tree = comp()
    console.log('TREE_CLASS', JSON.stringify(tree && tree.props && tree.props.className))
    const all = []
    collect(tree, n => { if (n.props && typeof n.props.className === 'string') all.push(n.props.className) })
    console.log('CLASSES', JSON.stringify(all.slice(0, 12)))
  } finally { hostState.current = saved }
})

probe('the card folds to one mark, and its fold delay is short and settable', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const toolbar = source.match(/\.sr-strip\.sr-strip-toolbar\{[^}]*\}/)?.[0] || ''
  const mark = source.match(/(?:^|\n)\.sr-strip-mark\{[^}]*\}/)?.[0] || ''
  const family = source.match(/(?:^|\n)\.sr-ibtn\{[^}]*\}/)?.[0] || ''
  if (!toolbar.includes('margin:0;padding:0')) throw new Error('native entry adds extra spacing')
  // The entry is an icon button of the family, and the family draws no badge
  // of its own.
  if (!source.includes("className: 'sr-ibtn sr-strip-mark'")) {
    throw new Error('the native entry is not an icon button of the family')
  }
  if (!family.includes('background:transparent') || !family.includes('border:0')) {
    throw new Error('entry still draws a badge')
  }
  if (source.includes("className: 'sr-strip sr-strip-folded'")) throw new Error('folded dock row still rendered')
  // The fold is a button of its own, so putting the card away is one click.
  if (!source.includes("className: 'sr-ibtn sr-strip-fold'")) {
    throw new Error('the open card has no fold button')
  }
  // The wait comes from the settings, not a hard-coded 600ms.
  if (/setTimeout\(\(\) => \{\s*\n\s*hideTimerRef\.current = null\s*\n\s*setExpanded\(false\)\s*\n\s*\}, 600\)/.test(source)) {
    throw new Error('the fold delay is still hard-coded')
  }
  if (!source.includes('shared.settings.cardFoldDelay')) throw new Error('the fold delay ignores the setting')
})

probe('the first line of the card follows the chosen preset', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry(')
  const end = source.indexOf('function SettingsSection(')
  if (start < 0 || end < 0) throw new Error('the card component is missing')
  const body = source.slice(start, end)
  // The three presets the settings page offers must all be reachable, and the
  // chosen one must actually decide the first line.
  for (const preset of ['book', 'progress', 'neutral']) {
    if (!body.includes(`'${preset}'`)) throw new Error('the card does not know the ' + preset + ' preset')
  }
  if (!/head === 'progress'[^\n]*progressHead/.test(body)) {
    throw new Error('the progress preset never reaches the first line')
  }
  if (!/head === 'neutral'/.test(body)) throw new Error('the neutral preset never reaches the first line')
  // The progress bar is drawn whenever a book is open, so the reader can see
  // where they are without changing the preset.
  if (!body.includes("className: 'sr-strip-foot-progress'")) throw new Error('the card draws no progress bar')
  if (!body.includes("role: 'progressbar'")) throw new Error('the progress bar is not announced')
  // The settings page must offer the choice.
  if (!source.includes("change('cardHead'")) throw new Error('the settings page cannot choose the first line')
  if (!source.includes("change('cardFoldDelay'")) throw new Error('the settings page cannot choose the fold delay')
})

probe('the card carries the book progress, so the reader can see where they are', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardHead = 'book'
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    const tree = await renderStrip()
    const bar = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-foot-progress'))
    if (bar === null) throw new Error('the card shows no progress')
    const track = find(tree, node => node.props && node.props.role === 'progressbar')
    if (track === null) throw new Error('the progress bar is not announced to assistive tech')
    const now = Number(track.props['aria-valuenow'])
    if (!Number.isFinite(now) || now < 0 || now > 100) throw new Error('the progress value is not a percentage: ' + now)
    const fill = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-progress-fill'))
    if (fill === null) throw new Error('the progress bar has no fill')
    if (!String(fill.props.style.width).endsWith('%')) throw new Error('the fill is not sized by percentage')
  } finally {
    hostSettings.cardHead = 'book'
  }
})

probe('the progress preset still works under a disguise, without naming the book', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'log'
  hostSettings.cardHead = 'progress'
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    const tree = await renderStrip()
    // With the title row gone, the card's first line is its text line.
    const head = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-line'))
    if (head === null) throw new Error('the disguised card draws no first line')
    // The progress number is in the footer row, and a disguise keeps it: a
    // number names nothing.
    const bar = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-foot-progress'))
    if (bar === null) throw new Error('the disguised card shows no progress: ' + String(head.children.join('')))
    // What a disguise must still hide is the book itself.
    const whole = JSON.stringify(tree)
    if (whole.includes('测试小说')) throw new Error('the disguised card named the book')
    if (whole.includes('第一段文字')) throw new Error('the disguised card showed the text')
  } finally {
    hostSettings.cardHead = 'book'
    hostSettings.skin = 'plain'
  }
})

probe('folding the card leaves it folded, even though focus lands on the mark', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    react.beginRender()
    card()
    await react.flushEffects()
    await settle()
    react.beginRender()
    let tree = await openCard(card)
    const fold = find(tree, node => node.type === 'button'
      && node.props && hasClass(node.props.className, 'sr-strip-fold'))
    if (fold === null) throw new Error('the open card has no fold button')
    fold.props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    // Folded means one mark and no panel. If folding hands focus to the mark
    // and the mark opens on focus, this is where the card would spring back.
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel')) !== null) {
      throw new Error('the card reopened itself when it was folded')
    }
    const mark = find(tree, node => node.type === 'button'
      && node.props && hasClass(node.props.className, 'sr-strip-mark')) || nativeMark()
    if (mark === null) throw new Error('folding left no mark behind')
    // The probe cannot move real focus, so the contract is asserted directly:
    // a mark that opens on focus would undo the fold that just focused it.
    if (typeof mark.props.onFocus === 'function') {
      throw new Error('the folded mark opens on focus, so folding cannot stick')
    }
    // The mark still opens the card on a deliberate click.
    mark.props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    tree = await openCard(card)
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel')) === null) {
      throw new Error('the mark no longer opens the card')
    }
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card starts open, and its fold mode decides whether it folds itself', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry(')
  const end = source.indexOf('function SettingsSection(')
  const body = source.slice(start, end)
  // Open by default: a reader opens the window to read, not to find a dot.
  if (!/const \[expanded, setExpanded\] = React\.useState\(true\)/.test(body)) {
    throw new Error('the card does not start open')
  }
  // Only the auto mode folds on its own.
  if (!/mode !== 'auto'\) return/.test(body)) throw new Error('every mode folds on its own')
  if (!body.includes("cardFoldMode")) throw new Error('the card ignores the fold mode')
  if (source.includes("change('cardAlign'") || source.includes("change('cardOffset'")) {
    throw new Error('obsolete floating placement controls are still offered')
  }

})

probe('native toolbar entry has no overlap positioning or extra dock row', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripToolbarEntry(')
  const end = source.indexOf('function StripEntry(', start)
  const body = source.slice(start, end)
  if (!body.includes('stripOpenRequest') || !body.includes('onClick: open')) throw new Error('native entry cannot request the card')
  if (/translateX|position:|cardOffset/.test(body)) throw new Error('native entry still uses floating coordinates')
  if (!source.includes("name: 'conversation.input.right'")) throw new Error('native composer slot missing')
  if (!source.includes('return null\n      }\n\n      return h(')) throw new Error('folded dock is not empty')
})
probe('a card that may not fold never folds, and offers no fold button', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry(')
  const end = source.indexOf('function SettingsSection(')
  if (start < 0 || end < 0) throw new Error('the card component is missing')
  const body = source.slice(start, end)
  // The switch is its own setting, separate from when the card folds itself.
  if (!/shared\.settings\.cardFoldable !== false/.test(body)) {
    throw new Error('the card ignores the foldable switch')
  }
  if (!/foldable && !expanded/.test(body)) {
    throw new Error('the card still folds when folding is off')
  }
  // Without the switch the fold button is not drawn at all, so a card that may
  // not fold cannot be put away by accident.
  if (!/foldable\s*\n?\s*\? h\('button', \{\s*\n?\s*type: 'button', className: 'sr-ibtn sr-strip-fold'/.test(body)) {
    throw new Error('the fold button is drawn even when folding is off')
  }
  // A fold already waiting must not fire after the switch is turned off.
  if (!/cardFoldable === false\) return/.test(body)) {
    throw new Error('a pending fold is not dropped when folding is turned off')
  }
  // The settings page offers the switch.
  if (!source.includes("change('cardFoldable'")) throw new Error('the settings page cannot turn folding off')
})

probe('native toolbar entry has no overlap positioning or extra dock row', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripToolbarEntry(')
  const end = source.indexOf('function StripEntry(', start)
  const body = source.slice(start, end)
  if (!body.includes('stripOpenRequest') || !body.includes('onClick: open')) throw new Error('native entry cannot request the card')
  if (/translateX|position:|cardOffset/.test(body)) throw new Error('native entry still uses floating coordinates')
  if (!source.includes("name: 'conversation.input.right'")) throw new Error('native composer slot missing')
  if (!source.includes('return null\n      }\n\n      return h(')) throw new Error('folded dock is not empty')
})
probe('the folded card can be a one-line bar instead of a mark', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const before = hostSettings.cardFoldedShape
  // The shape is set before the mount, so the card reads it as it starts.
  hostSettings.cardFoldedShape = 'bar'
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    // The bar is a real shape, so the probe renders it: a source-only check
    // passed even when the branch was disabled.
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-fold'))) break
    }
    // Fold it: the folded shape is the bar this time.
    tree = await foldCard(card)
    const row = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-row'))
    if (row === null) throw new Error('the bar shape did not render')
    // The bar carries the first line, so a folded reader still sees where they are.
    const text = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-text'))
    if (text === null) throw new Error('the bar has no first line')
    if (String(text.children.join('')).trim() === '') throw new Error('the bar first line is empty')
    // A bar spans the stack, so the mark must not also be drawn.
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-mark')) !== null) {
      throw new Error('the bar and the mark are drawn together')
    }
  } finally {
    hostSettings.cardFoldedShape = before
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the card draws only the number of lines the reader chose', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry(')
  const end = source.indexOf('function SettingsSection(')
  if (start < 0 || end < 0) throw new Error('the card component is missing')
  const body = source.slice(start, end)
  // The setting was only ever shown in the settings page: the card itself
  // never read it, so "lines shown" did nothing and the card grew with the
  // step instead.
  if (!/shared\.settings\.stripLines/.test(body)) {
    throw new Error('the card ignores the line count')
  }
  if (!/WebkitLineClamp: String\(visibleLines\)/.test(body)) {
    throw new Error('the card does not clamp its text to those lines')
  }
  // The clamp must be on the text paragraph, not somewhere unrelated.
  const para = source.match(/className: 'sr-strip-line',[\s\S]{0,260}?WebkitLineClamp/)
  if (para === null) throw new Error('the clamp is not on the text paragraph')
  // A bad value falls back to the shipped default rather than to no clamp.
  if (!/DEFAULT_LINES/.test(body)) throw new Error('an unset line count has no fallback')
})

probe('the card offers no worded prompt to open the reader', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry(')
  const end = source.indexOf('function SettingsSection(')
  const body = source.slice(start, end)
  // The label lives on the button's accessible name, not in its visible text:
  // the card itself opens the reader, so a worded button only took space.
  // A worded button passes the label as its child. The accessible name uses
  // the same key, so the check has to look at the child position only.
  const worded = /\}\s*,\s*t\('stripExpand'\)\s*\)/.test(body)
    || /'sr-strip-bar-open'[^)]*\}\s*,\s*t\('stripExpand'\)/.test(body)
  if (worded) throw new Error('the card still shows the words for opening the reader')
  if (!body.includes("'aria-label': t('stripExpand')")) {
    throw new Error('opening the reader lost its accessible name')
  }
  // The floating panel the old button opened no longer exists as a surface:
  // the card and the side column are the two shapes now. A control that opens
  // nothing is worse than no control, so the button is gone with it.
  if (body.includes('onClick: openPanel')) throw new Error('the dead open-panel control is still there')
  if (body.includes('\\u2197')) throw new Error('the dead open-panel arrow is still there')
  // The card still reaches the other shapes.
  if (!body.includes("onClick: () => void placeReader('sidebar')")) {
    throw new Error('the card can no longer move the reader to the side column')
  }
})

probe('the card is the text and one row, with no title or progress row of its own', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry(')
  const end = source.indexOf('function SettingsSection(')
  if (start < 0 || end < 0) throw new Error('the card component is missing')
  const body = source.slice(start, end)
  // The title row and the separate progress row each cost a line of reading
  // height. Both are gone: the place label and the progress live in the footer.
  if (body.includes("className: 'sr-strip-head'")) throw new Error('the card still draws a title row')
  if (/className: 'sr-strip-progress'\s*\}/.test(body)) throw new Error('the card still draws a progress row')
  if (body.includes("className: 'sr-strip-count'")) throw new Error('the title is still a row of its own')
  // What they carried is still reachable, on the footer row.
  if (!body.includes("className: 'sr-strip-foot-label'")) throw new Error('the book place was dropped')
  if (!body.includes("className: 'sr-strip-foot-progress'")) throw new Error('the progress was dropped')
  // The footer must stay one row.
  const foot = source.match(/\.sr-strip-foot\{[^}]*\}/)
  if (foot === null) throw new Error('the footer has no rule')
  if (!/flex-wrap:nowrap/.test(foot[0])) throw new Error('the footer row can wrap onto two lines')
  // The progress bar is a hairline, not a band of its own.
  const track = source.match(/\.sr-strip-progress-track\{[^}]*\}/)
  if (track === null) throw new Error('the progress track has no rule')
  if (!/width:44px/.test(track[0])) throw new Error('the progress track is not a compact hairline')
  // The body no longer leaves a gap where the old rows were.
  const stripBody = source.match(/\.sr-strip-body\{[^}]*\}/)
  if (stripBody === null) throw new Error('the body has no rule')
  if (!/padding:9px 12px 6px/.test(stripBody[0])) throw new Error('the body still reserves the old rows')
})

probe('the open card renders one body and one footer row, with nothing above the text', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardHead = 'book'
  hostState.current = { bookId: 'book-1', index: 3 }
  try {
    const tree = await renderStrip()
    const panel = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel'))
    if (panel === null) throw new Error('the card has no panel')
    // Inside the panel: a body and nothing else at that level. A title row
    // here is exactly the wasted line this change removed.
    const body = find(panel, node => node.props && hasClass(node.props.className, 'sr-strip-body'))
    if (body === null) throw new Error('the card has no body')
    const headRow = find(panel, node => node.props && hasClass(node.props.className, 'sr-strip-head'))
    if (headRow !== null) throw new Error('a title row is still drawn above the text')
    // The text is the first thing in the body, so the card starts with reading.
    const line = find(body, node => node.props && hasClass(node.props.className, 'sr-strip-line'))
    if (line === null) throw new Error('the body has no text')
    if (find(body, node => node.props && hasClass(node.props.className, 'sr-strip-foot')) === null) {
      throw new Error('the body has no footer row')
    }
    // Everything the old rows carried is on that one footer row.
    const foot = find(body, node => node.props && hasClass(node.props.className, 'sr-strip-foot'))
    for (const [cls, what] of [
      ['sr-strip-foot-progress', 'the progress'],
      ['sr-strip-foot-label', 'the book place'],
      ['sr-strip-step', 'the step buttons'],
      ['sr-strip-fold', 'the fold control'],
    ]) {
      if (find(foot, node => node.props && hasClass(node.props.className, cls)) === null) {
        throw new Error('the footer row lost ' + what)
      }
    }
    // The percentage is a number beside the hairline, not a row of its own.
    const percent = find(foot, node => node.props && hasClass(node.props.className, 'sr-strip-progress-text'))
    if (percent === null) throw new Error('the footer row shows no percentage')
    if (!/%/.test(String(percent.children.join('')))) throw new Error('the percentage is not a percentage')
    // The percentage says how far through the book the reader is, and the
    // chapter says where it is: the two belong together, so the percentage
    // stands next to the chapter and not at the far end of the row.
    const order = foot.children.map(node => node.props && String(node.props.className || '').split(/\s+/))
    const labelAt = order.findIndex(names => names.includes('sr-strip-foot-label'))
    const progressAt = order.findIndex(names => names.includes('sr-strip-foot-progress'))
    if (labelAt < 0 || progressAt < 0) throw new Error('the footer row is missing a part')
    if (progressAt !== labelAt + 1) {
      throw new Error('the percentage does not stand next to the chapter')
    }
    // The old rule pushed it to the far end of the row.
    const source = readFileSync(CLIENT, 'utf8')
    const rule = source.match(/\.sr-strip-foot-progress\{[^}]*\}/)
    if (rule === null) throw new Error('the progress has no rule')
    if (/margin-inline-start:auto/.test(rule[0]) || /order:1/.test(rule[0])) {
      throw new Error('the percentage is still pushed to the far end of the row')
    }
    // The floating panel is gone as a shape, so the card does not offer a
    // button that opens nothing.
    if (find(foot, node => node.props && node.props['aria-label'] === 'Open the reader') !== null) {
      throw new Error('the card still offers the dead open-panel control')
    }
  } finally {
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the footer row cannot overflow its card when the window is narrow', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // Every child of the footer must be able to shrink or must be small and
  // fixed, or the row overflows the card on a narrow window.
  const foot = source.match(/\.sr-strip-foot\{[^}]*\}/)
  if (foot === null) throw new Error('the footer has no rule')
  if (!/flex-wrap:nowrap/.test(foot[0])) throw new Error('the footer can wrap')
  if (!/min-width:0/.test(foot[0])) throw new Error('the footer cannot shrink below its content')
  // The flexible label truncates instead of pushing the row wider.
  const label = source.match(/\.sr-strip-foot-label\{[^}]*\}/)
  if (label === null) throw new Error('the place label has no rule')
  if (!/text-overflow:ellipsis/.test(label[0])) throw new Error('the place label does not truncate')
  if (!/overflow:hidden/.test(label[0])) throw new Error('the place label can overflow')
  // The fixed pieces stay small enough to leave room for the text.
  const track = source.match(/\.sr-strip-progress-track\{[^}]*\}/)
  const width = Number((track[0].match(/width:(\d+)px/) || [])[1])
  if (!Number.isFinite(width) || width > 60) {
    throw new Error('the progress track takes ' + width + 'px, too much for one row')
  }
  // The percentage is a short number, not a sentence.
  const text = source.match(/\.sr-strip-progress-text\{[^}]*\}/)
  if (text === null) throw new Error('the percentage has no rule')
  if (!/font-size:10px/.test(text[0])) throw new Error('the percentage is not small')
})

probe('a page ends where the last drawn line ends, so no text is skipped', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // The step is measured, not a character count: a count could end mid-line
  // and the rest of that line was then never shown.
  if (/stripStep/.test(source)) throw new Error('the card still uses a character step')
  if (!/function pageEnd\(/.test(source)) throw new Error('there is no page boundary helper')
  if (!/function renderedLines\(/.test(source)) throw new Error('nothing measures rendered lines')
  // The page advances by the measured boundary, not by a fixed count.
  if (!/const span = pageSize >= 0 \? Math\.max\(pageSize - here, 1\)/.test(source)) {
    throw new Error('a step does not advance by the measured page')
  }
  // The drawn slice ends at that boundary too, so the next page starts with the
  // very next character. The card folds by unmounting its text, so the last
  // measurement is kept and used until the text can be measured again.
  if (!/const end = measured >= 0 \? measured : remembered/.test(source)) {
    throw new Error('the drawn text does not end at the page boundary')
  }
  if (!/flow\.slice\(here, end >= 0 \? end : flow\.length\)/.test(source)) {
    throw new Error('the drawn text does not end at the page boundary')
  }
  if (!/useLayout\(\(\) => \{/.test(source)) {
    throw new Error('the page is not measured before the browser paints')
  }
  // The place is held inside the chapter, so a place measured in another
  // chapter cannot leave the reader past the end of this one.
  if (!/function placeIn|const placeIn = /.test(source)) {
    throw new Error('the place is not held inside the chapter')
  }
  // Measuring must not disturb the card the reader is looking at.
  if (!/probe\.style\.visibility = 'hidden'/.test(source)) throw new Error('the measuring probe is visible')
  if (!/probe\.remove\(\)/.test(source)) throw new Error('the measuring probe is left in the page')
})

probe('a page turn measures once, not once per render', () => {
  // The binary search forces a layout on every step, and a page turn renders
  // the card more than once. Measuring again per render is what a wheel over
  // the card felt like: eleven forced layouts each time.
  const source = readFileSync(CLIENT, 'utf8')
  const body = source.slice(source.indexOf('function pageEnd('), source.indexOf('function chapterFlow('))
  if (!/let pageEndCache = null/.test(source)) throw new Error('the page measurement is never remembered')
  if (!/if \(pageEndCache !== null && pageEndCache\.key === key\) return pageEndCache\.value/.test(body)) {
    throw new Error('the remembered page is not read back')
  }
  // The key must cover everything the answer depends on, or a stale page is
  // served after a settings change.
  for (const part of ['lines', 'width', 'start', 'text.length', 'style.fontSize', 'style.lineHeight']) {
    if (!body.includes(part)) throw new Error('the cache key ignores ' + part)
  }
})

probe('the wheel folds notches together instead of dropping them', () => {
  // A dropped notch reads as a stutter on a trackpad. The card holds a turn
  // for one frame and gathers the notches that arrive meanwhile.
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('const onWheel = React.useCallback(')
  const end = source.indexOf('const wheelRef = React.useRef(null)', start)
  const body = source.slice(start, end)
  if (/now - wheelAtRef\.current < 40/.test(body)) throw new Error('the old time-based throttle is back')
  if (!/wheelFrameRef\.current !== null/.test(body)) throw new Error('a turn is not held for a frame')
  if (!/wheelDirRef\.current \+= event\.deltaY > 0 \? 1 : -1/.test(body)) {
    throw new Error('the notches inside one frame are not gathered')
  }
  if (!/requestAnimationFrame/.test(body)) throw new Error('no frame is asked for')
  // A held turn must not outlive the card.
  if (!/cancelAnimationFrame/.test(source)) throw new Error('a held turn is never cancelled')
})

probe('the page boundary search is monotonic and covers the whole flow', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function pageEnd(')
  const end = source.indexOf('function chapterFlow(')
  if (start < 0 || end < 0) throw new Error('the page boundary helper is missing')
  const body = source.slice(start, end)
  // A flow that already fits is the whole flow: no page can be empty. The
  // answer is remembered on the way out, so the return is wrapped.
  if (!/renderedLines\(element, text\.slice\(start\)\) <= lines\) return remember\(text\.length\)/.test(body)) {
    throw new Error('a flow that fits is not taken whole')
  }
  // The measured page is cached, because a page turn re-renders the card and
  // an uncached search forces a layout on every step.
  if (!/pageEndCache/.test(body)) throw new Error('the page boundary is measured again on every render')
  // The search narrows on the rendered count, which grows with the prefix.
  if (!/while \(low < high\)/.test(body)) throw new Error('the boundary is not searched')
  if (!/Math\.ceil\(\(low \+ high\) \/ 2\)/.test(body)) throw new Error('the search does not bisect')
  // It returns an absolute offset, not a length, so the caller cannot misplace it.
  if (!/return remember\(start \+ low\)/.test(body)) throw new Error('the boundary is not an absolute offset')
  // An unmeasurable element says so, instead of pretending the page is empty.
  if (!/if \(element === null \|\| lines <= 0\) return -1/.test(body)) {
    throw new Error('an unmeasurable page is not reported')
  }
})

probe('the folded bar carries a chosen text and a progress that fills the row', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardFoldedShape = 'bar'
  const before = { label: hostSettings.barLabel, cover: hostSettings.barCoverText }
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    // A cover story replaces the book name on the bar.
    hostSettings.barLabel = 'cover'
    hostSettings.barCoverText = 'Work log'
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = ''
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      tree = card()
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-fold'))) break
    }
    tree = await foldCard(card)
    const text = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-text'))
    if (text === null) throw new Error('the bar has no text')
    if (String(text.children.join('')) !== 'Work log') {
      throw new Error('the bar ignored the cover story: ' + String(text.children.join('')))
    }
    // The progress is on the same row. By default the bar shows the number
    // only: a long line took the row's space for a glance at a number.
    const track = find(tree, node => node.props && node.props.role === 'progressbar')
    if (track !== null) throw new Error('the bar draws a progress line by default')
    const percent = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-percent'))
    if (percent === null) throw new Error('the bar shows no percentage')
    if (!/%/.test(String(percent.children.join('')))) throw new Error('the bar percentage is not a percentage')
    // The bar must not carry the book's name while the cover story is on.
    if (JSON.stringify(tree).includes('测试小说')) throw new Error('the bar named the book under a cover story')
    // The progress line is still there for a reader who asks for it, and it
    // fills the middle of the row.
    const barSource = readFileSync(CLIENT, 'utf8')
    const trackRule = barSource.match(/\.sr-strip-bar-track\{[^}]*\}/)
    if (trackRule === null) throw new Error('the bar track has no rule')
    if (!/flex:1 1 auto/.test(trackRule[0])) throw new Error('the bar progress does not fill the row')
    if (/width:\s*\d+px/.test(trackRule[0])) throw new Error('the bar progress is a fixed short bar')
    const labelRule = barSource.match(/\.sr-strip-bar-text\{[^}]*\}/)
    if (labelRule === null) throw new Error('the bar label has no rule')
    if (!/max-width:40%/.test(labelRule[0])) throw new Error('the bar label can crowd out the progress')
  } finally {
    hostSettings.barLabel = before.label
    hostSettings.barCoverText = before.cover
    hostSettings.cardFoldedShape = 'mark'
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the bar progress is the reader\'s choice', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardFoldedShape = 'bar'
  hostState.current = { bookId: 'book-1', index: 1 }
  const render = async (mode) => {
    hostSettings.barProgress = mode
    react.reset()
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      card()
      await react.flushEffects()
      await settle()
    }
    return foldCard(card)
  }
  try {
    let tree = await render('percent')
    if (find(tree, node => node.props && node.props.role === 'progressbar') !== null) {
      throw new Error('the percent mode still draws a line')
    }
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-percent')) === null) {
      throw new Error('the percent mode shows no number')
    }
    tree = await render('track')
    if (find(tree, node => node.props && node.props.role === 'progressbar') === null) {
      throw new Error('the line mode draws no line')
    }
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-percent')) !== null) {
      throw new Error('the line mode still shows the number')
    }
    tree = await render('both')
    if (find(tree, node => node.props && node.props.role === 'progressbar') === null) {
      throw new Error('the both mode draws no line')
    }
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-percent')) === null) {
      throw new Error('the both mode shows no number')
    }
    tree = await render('none')
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-progress')) !== null) {
      throw new Error('the none mode still shows progress')
    }
    // An unknown mode falls back to the number, not to a blank row.
    tree = await render('nonsense')
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-percent')) === null) {
      throw new Error('an unknown mode shows no number')
    }
  } finally {
    hostSettings.cardFoldedShape = 'mark'
    hostSettings.barProgress = 'percent'
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

probe('the settings offer ready-made cover stories, and a preset fills the bar', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardFoldedShape = 'bar'
  hostSettings.barLabel = 'cover'
  hostSettings.cardFoldable = true
  const before = { text: hostSettings.barCoverText }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const settingsSection = componentOf(registered, 'settings.section')
    if (settingsSection === undefined) throw new Error('the settings section is missing')
    let tree = ''
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      tree = settingsSection({})
      await react.flushEffects()
      await settle()
      if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
    }
    const body = find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))
    if (body === null) throw new Error('the settings page has no body')
    // The presets are buttons that carry a ready-made line.
    const presets = []
    collect(body, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-set-choice')
        && String(node.children.join('')).length > 0) presets.push(node)
    })
    const cover = presets.filter(node => ['阅读笔记', '工作日志', '草稿备忘', '同步摘要', 'Reading notes', 'Work log', 'Draft notes', 'Sync summary']
      .includes(String(node.children.join(''))))
    if (cover.length < 4) throw new Error('the page offers ' + cover.length + ' cover stories, not 4')
    // Pressing one writes that line as the bar text.
    const target = cover.find(node => String(node.children.join('')) === '阅读笔记')
      || cover[0]
    const wanted = String(target.children.join(''))
    hostCalls.length = 0
    target.props.onClick()
    // The settings write is debounced by 400 ms, so the probe waits past it.
    for (let round = 0; round < 14; round += 1) {
      await settle()
      await new Promise(resolve => setTimeout(resolve, 60))
      if (hostCalls.some(call => call.action === 'settings')) break
    }
    const written = hostCalls.filter(call => call.action === 'settings')
    if (written.length === 0) throw new Error('a cover story preset wrote nothing')
    // And the bar draws that line.
    hostSettings.barCoverText = wanted
    const card = componentOf(registered, 'conversation.input.dock')
    let cardTree = ''
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      cardTree = card()
      await react.flushEffects()
      await settle()
      if (find(cardTree, node => node.props && hasClass(node.props.className, 'sr-strip-fold'))) break
    }
    cardTree = await foldCard(card)
    const text = find(cardTree, node => node.props && hasClass(node.props.className, 'sr-strip-bar-text'))
    if (text === null) throw new Error('the bar has no text')
    if (String(text.children.join('')) !== wanted) {
      throw new Error('the bar did not take the preset: ' + String(text.children.join('')))
    }
  } finally {
    hostSettings.barCoverText = before.text
    hostSettings.cardFoldedShape = 'mark'
    hostSettings.barLabel = 'head'
  }
})

probe('the folded bar has one button for the card and one for closing', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardFoldedShape = 'bar'
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    const settleCard = async () => {
      let tree = ''
      for (let round = 0; round < 6; round += 1) {
        react.beginRender()
        tree = card()
        await react.flushEffects()
        await settle()
        if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-fold'))) break
      }
      return tree
    }
    let tree = await settleCard()
    tree = await foldCard(card)
    const buttons = []
    collect(tree, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-strip-bar-btn')) {
        buttons.push(node)
      }
    })
    // Two controls, and neither is inside the row button: a button cannot hold
    // a button, so they sit beside it.
    if (buttons.length !== 2) throw new Error('the bar has ' + buttons.length + ' controls, not 2')
    const close = buttons.find(node => hasClass(node.props.className, 'sr-strip-bar-close'))
    const toCard = buttons.find(node => !hasClass(node.props.className, 'sr-strip-bar-close'))
    if (close === undefined || toCard === undefined) throw new Error('the bar is missing one of its two controls')
    for (const node of buttons) {
      if (node.props['aria-label'] === undefined) throw new Error('a bar control has no accessible name')
    }
    // Neither control may sit inside the row button.
    const rowButton = find(tree, node => node.type === 'button'
      && node.props && hasClass(node.props.className, 'sr-strip-bar-row'))
    if (rowButton === null) throw new Error('the bar row is not a button')
    if (find(rowButton, node => node.props && hasClass(node.props.className, 'sr-strip-bar-btn')) !== null) {
      throw new Error('a control is nested inside the row button')
    }
    // The to-card control opens the card.
    toCard.props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-panel')) === null) {
      throw new Error('the to-card control did not open the card')
    }
    // The close control removes the reader from the composer entirely.
    tree = await foldCard(card)
    const closeAgain = []
    collect(tree, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-strip-bar-close')) {
        closeAgain.push(node)
      }
    })
    if (closeAgain.length !== 1) throw new Error('the close control is gone after reopening')
    closeAgain[0].props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')) !== null) {
      throw new Error('the close control left the reader on screen')
    }
  } finally {
    hostSettings.cardFoldedShape = 'mark'
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})

for (const recoveryPlacement of ['strip', 'sidebar']) {
probe(`settings restores a closed reader to the composer from ${recoveryPlacement}`, async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardFoldedShape = 'bar'
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    const settleCard = async () => {
      let tree = ''
      for (let round = 0; round < 6; round += 1) {
        react.beginRender()
        tree = card()
        await react.flushEffects()
        await settle()
        if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-fold'))) break
      }
      return tree
    }
    await settleCard()
    let tree = await foldCard(card)
    const close = []
    collect(tree, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-strip-bar-close')) {
        close.push(node)
      }
    })
    if (close.length !== 1) throw new Error('the bar has no close control')
    close[0].props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')) !== null) {
      throw new Error('the reader did not close')
    }
    if (recoveryPlacement === 'sidebar') {
      hostSettings.placement = 'sidebar'
      const sidebar = componentOf(registered, 'sidebar.right.pane.tab')
      // This shim uses one root hook array: mount a fresh root, rather than
      // reusing the card's effect cells for SidebarSurface.
      react.reset()
      react.beginRender()
      sidebar()
      await react.flushEffects()
      await settle()
      react.beginRender()
      if (card() !== null) throw new Error('sidebar precondition did not suppress the card')
      react.reset()
    }
    // The settings page must offer the way back, because the card that would
    // reopen the reader is the thing that went away.
    const settingsSection = componentOf(registered, 'settings.section')
    if (settingsSection === undefined) throw new Error('the settings section is missing')
    let settingsTree = ''
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      settingsTree = settingsSection({})
      await react.flushEffects()
      await settle()
      if (find(settingsTree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
    }
    const reopen = []
    collect(settingsTree, node => {
      if (node.type === 'button' && node.props
        && String(node.children.join('')) === 'Open the reader') reopen.push(node)
    })
    if (reopen.length !== 1) {
      throw new Error('the settings page offers no way back: ' + reopen.length)
    }
    reopen[0].props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')) === null) {
      throw new Error('the settings button did not bring the reader back')
    }
  } finally {
    hostSettings.placement = 'strip'
    hostSettings.cardFoldedShape = 'mark'
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})
}

for (const sidebarReturn of ['unmount', 'toolbar']) {
probe(`the side column restores a closed card through ${sidebarReturn}`, async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostSettings.cardFoldedShape = 'bar'
  hostState.current = { bookId: 'book-1', index: 1 }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
    react.beginRender()
    overlay.component()
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    const settleCard = async () => {
      let tree = ''
      for (let round = 0; round < 6; round += 1) {
        react.beginRender()
        tree = card()
        await react.flushEffects()
        await settle()
        if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-fold'))) break
      }
      return tree
    }
    await settleCard()
    // Close the reader from its own bar.
    let tree = await foldCard(card)
    const close = []
    collect(tree, node => {
      if (node.type === 'button' && node.props && hasClass(node.props.className, 'sr-strip-bar-close')) {
        close.push(node)
      }
    })
    if (close.length !== 1) throw new Error('the bar has no close control')
    close[0].props.onClick()
    await settle()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')) !== null) {
      throw new Error('the reader did not close')
    }
    // Opening the side column, then letting its tab go, must hand the reader
    // back to the card: the two shapes are alternatives and one is always on
    // screen.
    const sidebar = componentOf(registered, 'sidebar.right.pane.tab')
    if (sidebar === undefined) throw new Error('the side column surface is missing')
    hostSettings.placement = 'sidebar'
    react.reset()
    let sidebarTree
    let closedTabs = 0
    const lifetime = new AbortController()
    const sidebarProps = { useTabInfo: () => ({ tab: {
      visible: true, signal: lifetime.signal, navigation: { revision: 1 },
      actions: { close: () => { closedTabs += 1; lifetime.abort() } },
    } }) }
    for (let round = 0; round < 4; round += 1) {
      react.beginRender()
      sidebarTree = sidebar(sidebarProps)
      await react.flushEffects()
      await settle()
    }
    if (closedTabs !== 0) throw new Error('opening the sidebar closed its tab immediately')
    if (sidebarReturn === 'unmount') {
      await react.unmount()
      lifetime.abort()
    } else {
      const back = find(sidebarTree, node => node.type === 'button' && node.children.includes('⇱'))
      if (!back) throw new Error('sidebar has no return-to-card control')
      back.props.onClick()
      await settle()
      react.beginRender()
      sidebarTree = sidebar(sidebarProps)
      await react.flushEffects()
      if (!sidebarTree || sidebarTree.props.hidden !== true || sidebarTree.props.style.display !== 'none') {
        throw new Error('sidebar reading contents remain visible after switching to card')
      }
      if (closedTabs !== 1) throw new Error('switching back did not close exactly the reading tab')
    }
    await settle()
    react.reset()
    react.beginRender()
    tree = card()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-strip')) === null) {
      throw new Error('leaving the side column left the reader closed')
    }
  } finally {
    hostSettings.placement = 'strip'
    hostSettings.cardFoldedShape = 'mark'
    hostState.current = { bookId: 'book-1', index: 0 }
  }
})
}

probe('opening the reader clears the closed flag, from either shape', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const lines = source.split('\n')
  // The module-level open helper is what every entry point funnels through.
  const clearsOnOpen = lines.some(line => /visible: true/.test(line) && /hidden: false/.test(line))
  if (!clearsOnOpen) throw new Error('opening the reader does not clear the closed flag')
  // The side column branch returns early, so it clears the flag on its own.
  const clearsOnSidebarOpen = lines.some(line => /readerStore\.set\(\{ hidden: false \}\)/.test(line))
  if (!clearsOnSidebarOpen) throw new Error('the side column branch does not clear the closed flag')
  // And the fallback to the card, when the side column cannot open, must not
  // land on a hidden card.
  const clearsOnFallback = lines.some(line => /sidebarUnavailable: true/.test(line) && /hidden: false/.test(line))
  if (!clearsOnFallback) throw new Error('the side column fallback leaves the card hidden')
  // The settings page is the entry that does not depend on the card existing.
  if (!source.includes("t('openReaderNow')")) throw new Error('the settings page has no way back')
})

probe('manual sidebar navigation survives other tabs and body remounts', async () => {
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const sidebar = componentOf(registered, 'sidebar.right.pane.tab')
  const card = componentOf(registered, 'conversation.input.dock')
  const lifetime = new AbortController()
  let closeCalls = 0
  const tabInfo = { visible: true, signal: lifetime.signal, navigation: { revision: 1 },
    actions: { close: () => { closeCalls += 1 } } }
  const props = { useTabInfo: () => ({ tab: tabInfo }) }
  const renderSidebar = async () => {
    react.beginRender()
    const tree = sidebar(props)
    await react.flushEffects()
    await settle()
    return tree
  }
  try {
    react.reset()
    await renderSidebar()
    let tree = await renderSidebar()
    if (tree.props.hidden) throw new Error('manual sidebar opening from card did not show the reader')
    if (closeCalls) throw new Error('manual sidebar opening immediately closed the reader')

    // Use the existing settings entry to return to the composer while the
    // tab record is still retained until its close request is applied.
    const settings = componentOf(registered, 'settings.section')
    let settingsTree
    for (let round = 0; round < 4; round += 1) {
      react.beginRender(); settingsTree = settings({})
      await react.flushEffects(); await settle()
    }
    const reopen = find(settingsTree, node => node.type === 'button' && node.children.includes('Open the reader'))
    if (!reopen) throw new Error('settings recovery control missing')
    reopen.props.onClick()
    await settle()
    if (closeCalls !== 1) throw new Error('explicit card command did not request exactly one tab close')

    // A new navigation revision is how the host signals manual reopening of
    // an already-retained tab. It must override the old strip placement.
    react.reset()
    tabInfo.navigation = { revision: 2 }
    await renderSidebar()
    tree = await renderSidebar()
    if (tree.props.hidden) throw new Error('manual reopening of an existing reader tab was ignored')
    if (closeCalls !== 1) throw new Error('manual reopening triggered another automatic close')

    const callsBeforeTabSwitch = hostCalls.length
    tabInfo.visible = false
    await renderSidebar()
    await react.unmount()
    await settle()
    if (lifetime.signal.aborted) throw new Error('selecting another tab ended the reader record')
    if (closeCalls !== 1) throw new Error('selecting another tab closed the reader')
    if (hostCalls.slice(callsBeforeTabSwitch).some(call => call.action === 'settings' && call.payload.patch?.placement === 'strip')) {
      throw new Error('body unmount persisted a switch back to the card')
    }
    react.reset()
    react.beginRender()
    if (card() !== null) throw new Error('another tab caused an unsolicited composer card')
    await react.flushEffects(); await settle()

    // Remount while inactive, then select the reader tab again.
    react.reset()
    await renderSidebar()
    tabInfo.visible = true
    await renderSidebar()
    tree = await renderSidebar()
    if (tree.props.hidden || closeCalls !== 1) throw new Error('reader failed to survive tab switching/remount')
    lifetime.abort()
    await settle()
    const finalWrite = hostCalls.filter(call => call.action === 'settings').at(-1)
    if (finalWrite?.payload.patch?.placement !== 'strip') throw new Error('real record closure did not restore card placement')
  } finally {
    lifetime.abort()
    hostSettings.placement = 'strip'
  }
})

probe('closing an older sidebar occurrence cannot dismiss the current reader', async () => {
  hostSettings.placement = 'strip'
  const { registered } = await mountAndSettle()
  const sidebar = componentOf(registered, 'sidebar.right.pane.tab')
  const card = componentOf(registered, 'conversation.input.dock')
  const first = new AbortController(), second = new AbortController()
  const propsFor = signal => ({ useTabInfo: () => ({ tab: { signal, visible: true,
    navigation: { revision: 1 }, actions: { close() {} } } }) })
  const mount = async signal => {
    react.reset()
    for (let round = 0; round < 3; round += 1) {
      react.beginRender(); sidebar(propsFor(signal))
      await react.flushEffects(); await settle()
    }
  }
  try {
    await mount(first.signal)
    await react.unmount()
    await mount(second.signal)
    first.abort()
    await settle()
    react.reset(); react.beginRender()
    if (card() !== null) throw new Error('old occurrence abort dismissed the new sidebar reader')
    await react.flushEffects(); await settle()
    second.abort()
    await settle()
    react.reset(); react.beginRender()
    if (card() === null) throw new Error('current occurrence abort did not restore the card')
  } finally {
    first.abort(); second.abort()
    hostSettings.placement = 'strip'
  }
})

probe('every popup wears the same skin', () => {
  // Four surfaces, one vocabulary: one radius, one shadow, one border. They
  // used to be 260/430/520/1080 wide with two radii and three shadows, which
  // reads as four unrelated things.
  const source = readFileSync(CLIENT, 'utf8')
  const cssOnly = source.slice(source.indexOf('const CSS = `'),
    source.indexOf('`\n', source.indexOf('const CSS = `') + 14)).replace(/\/\*[\s\S]*?\*\//g, '')
  const shared = cssOnly.match(/\.sr-picker,\.sr-shop,\.sr-set-settings-page,\.sr-strip-popup\{[^}]*\}/)
  if (shared === null) throw new Error('the popups have no shared rule')
  for (const part of ['--sr-pop-radius', '--sr-pop-shadow', '--sr-pop-border']) {
    if (!shared[0].includes(part)) throw new Error('the shared skin does not set ' + part)
  }
  // And no surface may bring its own radius or shadow back.
  for (const name of ['sr-picker', 'sr-shop', 'sr-set-settings-page', 'sr-strip-popup']) {
    const own = source.match(new RegExp('\\.' + name + '\\{[^}]*\\}'))
    if (own === null) continue
    if (/border-radius:\d/.test(own[0])) throw new Error(name + ' sets its own radius again')
    if (/box-shadow:0 /.test(own[0])) throw new Error(name + ' sets its own shadow again')
  }
  // The sizes come from one switchboard, not from four literals.
  // One width and one ceiling for the pages; the card list is the one strip.
  for (const token of ['--sr-pop-w', '--sr-pop-h', '--sr-pop-h-min']) {
    if (!source.includes(token)) throw new Error('the size token ' + token + ' is missing')
  }
  const cssStart = source.indexOf('const CSS = `')
  const css = source.slice(cssStart, source.indexOf('`\n', cssStart + 14))
    .replace(/\/\*[\s\S]*?\*\//g, '')
  // A class may appear in more than one rule (the arrival animation names it
  // too), so every rule for the class is considered before judging it.
  for (const name of ['sr-picker', 'sr-shop', 'sr-set-settings-page']) {
    const rules = [...css.matchAll(new RegExp('\\.' + name + '\\{[^}]*\\}', 'g'))]
    if (rules.length === 0) throw new Error(name + ' has no rule')
    const sized = rules.some(rule => /width:min\(var\(--sr-pop-w/.test(rule[0]))
    if (!sized) throw new Error(name + ' sets its own width, so the pages still differ')
  }
})

probe('a popup arrives instead of appearing', () => {
  // A surface that appears in one frame reads as a glitch. The arrival is
  // short enough not to wait for and small enough not to travel.
  const source = readFileSync(CLIENT, 'utf8')
  if (!/@keyframes sr-pop-in\{/.test(source)) throw new Error('no arrival animation')
  // The frame must not move at all: a box that jumps is what looked unpolished.
  const frames = source.slice(source.indexOf('@keyframes sr-pop-in{'),
    source.indexOf('@keyframes sr-pop-inner-in{'))
  if (/translate|scale/.test(frames)) {
    throw new Error('the popup frame still travels as it arrives')
  }
  if (!/@keyframes sr-pop-inner-in\{/.test(source)) {
    throw new Error('the popup contents do not settle')
  }
  // The sidebar variants fill a pane, so a rise would move a box that has
  // nowhere to move: they fade instead.
  // A docked surface has no frame of its own to arrive, so it only becomes
  // readable: the same fade the pages use, without the contents settling.
  const docked = source.match(/\.sr-picker\.sr-picker-sidebar,[\s\S]{0,220}?\{animation:none\}/)
  if (docked === null) throw new Error('the docked variants settle their contents as well')
  if (!/sr-picker\.sr-picker-sidebar/.test(source)) {
    throw new Error('the docked catalog would animate a transform it does not have')
  }
  // A surface mounted while hidden must not spend its animation before it is
  // ever shown.
  // The shelf stays mounted while hidden, so its arrival must not be spent
  // before it is shown: the class that carries the state is what animates.
  const shelfGated = /\.sr-shop\.is-open\{animation/.test(source)
    || /\.sr-shop\{animation[^}]*\}[\s\S]{0,80}?is-open/.test(source)
  if (!shelfGated) {
    const shelfAnim = [...source.matchAll(/\.sr-shop[^{]*\{[^}]*animation[^}]*\}/g)].map(m => m[0])
    if (!shelfAnim.some(text => /is-open/.test(text))) {
      throw new Error('the shelf spends its arrival while hidden')
    }
  }
  // Somebody who asked for less motion gets none of the arrivals. The block
  // must name the popups themselves or it protects something else.
  const quiet = source.match(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\{[^}]*\}/g) || []
  const coversPopups = quiet.some(block =>
    /\.sr-picker/.test(block) && /\.sr-strip-popup/.test(block) && /animation:none/.test(block))
  if (!coversPopups) throw new Error('the arrival ignores prefers-reduced-motion')
})

probe('the settings page and the book page are laid out for reading', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // The settings page inside the Harness settings: two columns when there is
  // room, one column when there is not, and a title that stays put.
  const body = source.match(/\.sr-set-settings-page\.sr-set-settings-section \.sr-set-settings-body\{[^}]*\}/)
  if (body === null) throw new Error('the embedded settings body has no rule')
  if (!/display:grid/.test(body[0])) throw new Error('the settings body is not a grid')
  if (!/minmax\(320px,1fr\)/.test(body[0])) throw new Error('the settings grid has no readable column width')
  if (!/align-items:start/.test(body[0])) throw new Error('the settings groups do not keep their own height')
  const head = source.match(/\.sr-set-settings-page\.sr-set-settings-section \.sr-set-settings-head\{[^}]*\}/)
  if (head === null) throw new Error('the settings head has no rule')
  if (!/position:sticky/.test(head[0])) throw new Error('the settings title does not stay put')
  // The fields keep a readable rhythm instead of a dense list.
  const field = source.match(/\.sr-set-field\{[^}]*\}/)
  if (field === null) throw new Error('the settings field has no rule')
  if (!/gap:8px/.test(field[0])) throw new Error('the settings field is cramped')
  const value = source.match(/\.sr-set-settings-value\{[^}]*\}/)
  if (value === null) throw new Error('the settings value has no rule')
  if (!/tabular-nums/.test(value[0])) throw new Error('the settings value jitters while it changes')
  // The book page is a card of its own, not a sheet over the whole window.
  const shopRules = [...source.matchAll(/\.sr-shop\{[^}]*\}/g)].map(m => m[0])
  if (shopRules.length === 0) throw new Error('the book page has no rule')
  // Every popup hangs from one shared line, so opening one after another does
  // not feel like the frame wandering. Top-aligned, not centred: the edge the
  // eye reads is the top one.
  const positioned = shopRules.find(text => /position:/.test(text))
  if (positioned === undefined) throw new Error('the book page has no positioning rule')
  if (!/left:50%/.test(positioned) || !/top:var\(--sr-pop-top/.test(positioned)) {
    throw new Error('the book page does not open on the shared line')
  }
  // The size is named by a token now, so the surface can share one vocabulary
  // with the other popups without losing the fact that it is a big page.
  if (!/width:min\(var\(--sr-pop-w/.test(positioned)
    || !/height:min\(var\(--sr-pop-h/.test(positioned)) {
    throw new Error('the book page has no size of its own')
  }
  if (/inset:4vh 4vw/.test(positioned)) throw new Error('the book page still stretches over the window')
  // The book page is the way to a book that is not here yet. The library of
  // books already held is the catalog, one button away; drawing it here too
  // made one page do two jobs.
  const shopFn = source.slice(source.indexOf('function BookstoreSurface()'),
    source.indexOf('let settingsTabRequested'))
  if (shopFn === '') throw new Error('the book page function is missing')
  if (/BookDirectory/.test(shopFn)) throw new Error('the book page draws the library directory again')
  if (/sr-shop-books/.test(shopFn)) throw new Error('the book page has a library section again')
  if (/sr-shop-books\{/.test(source)) throw new Error('the library section keeps its stylesheet')
  // The two pages of the reader wear one title: the same size, the same
  // weight, the same line, the same inset. They used to differ (15px/600
  // against 14px/500), which read as two applications side by side.
  const titleOf = (ruleText, name) => {
    const m = ruleText.match(new RegExp('\\.' + name + '\\{([^}]*)\\}'))
    if (m === null) throw new Error(name + ' has no rule')
    const size = m[1].match(/font-size:\s*(\d+)px/)
    const weight = m[1].match(/font-weight:\s*(\d+)/)
    const line = m[1].match(/line-height:\s*(\d+)px/)
    if (size === null || weight === null) throw new Error(name + ' declares no size or weight')
    return { size: size[1], weight: weight[1], line: line && line[1] }
  }
  const shopTitle = titleOf(source, 'sr-shop-head strong')
  const setTitle = titleOf(source, 'sr-set-settings-head strong,\\s*\\.sr-set-settings-head \\.sr-set-settings-title')
  for (const key of ['size', 'weight']) {
    if (shopTitle[key] !== setTitle[key]) {
      throw new Error('the book page title differs from the settings title: ' + key
        + ' ' + String(shopTitle[key]) + ' against ' + String(setTitle[key]))
    }
  }
  // The inset of the head is the same on both, so the titles start on one line.
  // The bare rules: the settings head is also written with a section prefix,
  // and that prefixed rule is a different declaration.
  const headRule = name => {
    const m = source.match(new RegExp('(?:^|\\n)\\.' + name + '\\{([^}]*)\\}'))
    if (m === null) throw new Error('.' + name + ' has no bare rule')
    return m[1]
  }
  const paddingOf = text => (text.replace(/\n\s+/g, ' ').match(/padding:(\d+px\s+\d+px[^;]*)/) || [])[1]
  const shopPad = paddingOf(headRule('sr-shop-head'))
  const setPad = paddingOf(headRule('sr-set-settings-head'))
  if (shopPad === undefined || setPad === undefined) throw new Error('a page head has no padding')
  if (shopPad !== setPad) {
    throw new Error('the two page heads are inset differently: ' + shopPad + ' against ' + setPad)
  }
})

probe('the book page is only the way to a book, not the library again', async () => {
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  await resetComponentAndSettle()
  const section = lastRegistered.find(entry => entry.options.name === 'settings.section')
  let tree = ''
  for (let round = 0; round < 5; round += 1) {
    react.beginRender()
    tree = section.component()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
  }
  const tabs = []
  collect(tree, node => {
    if (node.type === 'button' && hasClass(node.props.className, 'sr-set-tab')) tabs.push(node)
  })
  const books = tabs.find(node => node.children.join('') === 'Books')
  if (books === undefined) throw new Error('the section has no Books tab')
  books.props.onClick()
  await settle()
  react.beginRender()
  tree = section.component()
  await react.flushEffects()
  await settle()
  // The page is the website library, and the library of books belongs on it:
  // a reader who came to find a book wants the ones that are already there.
  const entry = find(tree, node => node.type === 'button' && node.children.includes('Find books'))
  if (entry === null) throw new Error('the settings page does not offer the website library')
  entry.props.onClick()
  await settle()
  const overlay = lastRegistered.find(registered => registered.options.name === 'shell.overlay')
  if (overlay === undefined) throw new Error('the overlay was not registered')
  tree = ''
  for (let round = 0; round < 6; round += 1) {
    react.beginRender()
    tree = overlay.component()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-shop-books')) !== null) break
  }
  // This page is the way to a book that is not here yet. The library of
  // books already held is the catalog, one button away; repeating it here
  // made one page do two jobs and look like neither.
  if (find(tree, node => node.props && hasClass(node.props.className, 'sr-shop-books')) !== null) {
    throw new Error('the book page lists the library as well')
  }
  if (find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-pick-open')) !== null) {
    throw new Error('the book page still draws library rows')
  }
  // What it does carry is the way into a book: the address bar of the guest
  // page, and the controls that read one.
  const shop2 = find(tree, node => node.props && hasClass(node.props.className, 'sr-shop'))
  if (shop2 === null) throw new Error('the website library is not mounted')
  if (find(shop2, node => node.type === 'input' && node.props && node.props.type === 'url') === null) {
    throw new Error('the book page has no address bar')
  }
  const toolbar = find(shop2, node => node.props && hasClass(node.props.className, 'sr-shop-toolbar'))
  if (toolbar === null) throw new Error('the book page has no toolbar')
  if (find(shop2, node => node.props && hasClass(node.props.className, 'sr-shop-actions')) === null) {
    throw new Error('the book page has no actions')
  }
})

probe('the catalog is one door away from the settings as well', async () => {
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  await resetComponentAndSettle()
  const section = lastRegistered.find(entry => entry.options.name === 'settings.section')
  let tree = ''
  for (let round = 0; round < 5; round += 1) {
    react.beginRender()
    tree = section.component()
    await react.flushEffects()
    await settle()
    if (find(tree, node => node.props && hasClass(node.props.className, 'sr-set-settings-body'))) break
  }
  const tabs = []
  collect(tree, node => {
    if (node.type === 'button' && hasClass(node.props.className, 'sr-set-tab')) tabs.push(node)
  })
  const books = tabs.find(node => node.children.join('') === 'Books')
  if (books === undefined) throw new Error('the section has no Books tab')
  books.props.onClick()
  await settle()
  react.beginRender()
  const after = section.component()
  await react.flushEffects()
  await settle()
  const catalog = find(after, node => node.type === 'button' && node.children.join('') === 'Your books')
  if (catalog === null) throw new Error('the Books tab has no door to the catalog')
  catalog.props.onClick()
  await settle()
  react.beginRender()
  const opened = section.component()
  await react.flushEffects()
  await settle()
  // The catalog is a page of its own, and it floats above the window: the
  // Harness settings live in a modal of their own, and a catalog drawn inside
  // the application would sit under that modal.
  if (find(opened, node => node.props && hasClass(node.props.className, 'sr-picker')) === null) {
    throw new Error('the catalog did not open over the settings')
  }
  const source = readFileSync(CLIENT, 'utf8')
  if (!/floatAbove\(h\(BookPicker/.test(source)) {
    throw new Error('the catalog is not drawn beside the root')
  }
  // One catalog only: two of them would close each other on the next click.
  const overlay = lastRegistered.find(entry => entry.options.name === 'shell.overlay')
  if (overlay === undefined) throw new Error('the overlay was not registered')
  react.beginRender()
  const floating = overlay.component()
  await react.flushEffects()
  await settle()
  if (find(floating, node => node.props && hasClass(node.props.className, 'sr-picker')) !== null) {
    throw new Error('the catalog was drawn twice')
  }
})

probe('a book in the catalog shows its chapters, and a chapter opens there', async () => {
  hostSettings.placement = 'sidebar'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const library = find(tab(), node => node.type === 'button'
    && node.props['aria-label'] === 'Library')
  if (library === null) throw new Error('the panel has no library button')
  library.props.onClick()
  await settle()
  let tree = null
  let tocButton = null
  for (let round = 0; round < 6; round += 1) {
    react.beginRender()
    tree = tab()
    await react.flushEffects()
    await settle()
    tocButton = find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-pick-toc'))
    if (tocButton !== null) break
  }
  if (tocButton === null) throw new Error('the catalog offers no chapter list')
  tocButton.props.onClick()
  await settle()
  let chapters = null
  for (let round = 0; round < 6; round += 1) {
    react.beginRender()
    tree = tab()
    await react.flushEffects()
    await settle()
    chapters = find(tree, node => node.props && hasClass(node.props.className, 'sr-pick-chapters'))
    if (chapters !== null) break
  }
  if (chapters === null) throw new Error('the chapter list did not open')
  const chapter = find(chapters, node => node.type === 'button' && hasClass(node.props.className, 'sr-pick-chapter'))
  if (chapter === null) throw new Error('the chapter list is empty')
  chapter.props.onClick()
  await settle()
  const asked = hostCalls.filter(call => call.action === 'open')
  if (asked.length === 0) throw new Error('the chapter did not open the book')
  // The chapter index travels with the request, so the book opens there.
  const last = asked[asked.length - 1]
  if (!Number.isInteger(last.payload.index)) throw new Error('the chapter index was not sent')
})

probe('the card has a door to the catalog, so a book is one click away', async () => {
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const { registered } = await mountAndSettle()
  const card = componentOf(registered, 'conversation.input.dock')
  react.beginRender()
  let tree = card()
  await react.flushEffects()
  await settle()
  const door = find(tree, node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-open')
    && node.props['aria-label'] === 'Library')
  if (door === null) throw new Error('the card has no door to the catalog')
  door.props.onClick()
  await settle()
  const overlay = registered.find(entry => entry.options.name === 'shell.overlay')
  let page = null
  for (let round = 0; round < 6; round += 1) {
    react.beginRender()
    page = overlay.component()
    await react.flushEffects()
    await settle()
    if (find(page, node => node.props && hasClass(node.props.className, 'sr-picker')) !== null) break
  }
  if (find(page, node => node.props && hasClass(node.props.className, 'sr-picker')) === null) {
    throw new Error('the card did not open the catalog')
  }
})

probe('the card keeps its page count above the shape it came back from', async () => {
  // A value the card pages with has to be initialised on every render it
  // makes, including the render where the reader is in the side column and
  // the card draws nothing. A `const` declared below that early return is
  // never initialised on those renders, and the callbacks rebuilt on them
  // close over a hole: the first wheel after the reader came back threw
  // "Cannot access 'visibleLines' before initialization" and neither the
  // wheel nor the arrow keys turned a page again.
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('function StripEntry()')
  const end = source.indexOf('function SettingsSection(', start)
  if (start < 0 || end < 0) throw new Error('the card is not where the probe expects it')
  const body = source.slice(start, end)

  // Everything the card returns nothing on, before the text is drawn.
  const guards = [
    "if (shared.placement !== 'strip') return null",
    'if (shared.hidden) return null',
  ]
  for (const guard of guards) {
    if (!body.includes(guard)) throw new Error('the shape guard is missing: ' + guard)
  }
  const firstGuard = Math.min(...guards.map(guard => body.indexOf(guard)).filter(at => at >= 0))
  // The name the paging call needs.
  const declAt = body.indexOf('const visibleLines =')
  if (declAt < 0) throw new Error('the card no longer knows how many lines a page holds')
  if (declAt > firstGuard) {
    const line = source.slice(0, start + declAt).split('\n').length
    throw new Error(`the page count is declared at line ${line}, below the early return, so it is`
      + ' uninitialised on the renders that return early')
  }

  // The callbacks that page with it are defined above the early return, so
  // they close over it on every render.
  for (const call of ['const move = React.useCallback(', 'const onWheel = React.useCallback(']) {
    const at = body.indexOf(call)
    if (at < 0) throw new Error('the paging call is missing: ' + call)
    if (at > firstGuard) continue
    if (declAt > at) {
      throw new Error(`${call.slice(0, 20)}… is defined above the early return but the page count`
        + ' is declared below it')
    }
  }
})

probe('the card still reads with the wheel after a trip to the side column', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const card = componentOf(registered, 'conversation.input.dock')
  react.beginRender()
  let tree = react.mount(card)
  await react.flushEffects()
  await settle()
  // To the side column.
  const toSidebar = find(tree, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-strip-open')
    && node.children[0] === '⇲')
  if (toSidebar === null) throw new Error('the card has no door to the side column')
  toSidebar.props.onClick()
  await settle()
  // The column is open, so the card is not drawn.
  react.beginRender()
  tree = react.mount(card)
  await react.flushEffects()
  await settle()
  if (tree !== null && tree !== undefined) {
    throw new Error('the card is drawn while the reader is in the side column')
  }
  // The column reads a chapter of its own and then hands the reader back.
  // The card's own slots are kept, the way a mounted component keeps its
  // state while another surface is on screen.
  const tab = componentOf(registered, 'sidebar.right.pane.tab')
  react.beginRender()
  const lifetime = new AbortController()
  let side = react.mount(tab, { useTabInfo: () => ({ tab: { visible: true, signal: lifetime.signal,
    navigation: { revision: 1 }, actions: { close() {} } } }) })
  await react.flushEffects()
  await settle()
  // Back to the card.
  const toStrip = find(side, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-btn')
    && node.children[0] === '⇱')
  if (toStrip === null) throw new Error('the side column has no door back to the card')
  toStrip.props.onClick()
  await settle()
  react.beginRender()
  tree = react.mount(card)
  await react.flushEffects()
  await settle()
  const root = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip'))
  if (root === null) throw new Error('the card did not come back')
  const node = makeCardNode()
  root.props.ref(node)
  const wheel = node.listeners.find(row => row.kind === 'wheel')
  if (wheel === undefined) throw new Error('the card does not listen for the wheel after the trip')
  let prevented = false
  wheel.listener({ deltaY: 120, preventDefault() { prevented = true }, stopPropagation() {} })
  if (!prevented) throw new Error('the wheel was not taken away after the trip to the side column')
})

probe('the card does not take a place from another chapter', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  // The host remembers a place in another chapter: the card counts
  // characters and the column counts lines, so the two places are kept
  // apart, and a place from another chapter is not a place at all.
  hostPositions['book-1'] = { index: 1, offset: 0, line: 0, flow: 5, mode: 'sidebar' }
  try {
    const { ctx, registered } = makeContext()
    client.apply(ctx)
    // The overlay asks the host for the settings, so the card knows the skin.
    const overlay = componentOf(registered, 'shell.overlay')
    react.beginRender()
    react.mount(overlay)
    await react.flushEffects()
    await settle()
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = null
    let line = null
    for (let round = 0; round < 6; round += 1) {
      react.beginRender()
      tree = react.mount(card)
      await react.flushEffects()
      await settle()
      line = find(tree, node => node.props && hasClass(node.props.className, 'sr-strip-line'))
      if (line !== null && !String(line.children.join('')).startsWith('Loading')) break
    }
    if (line === null) throw new Error('the card has no text')
    const shown = String(line.children.join(''))
    if (!shown.startsWith('第一段文字')) {
      throw new Error('the card opened in the middle of the text: ' + shown)
    }
  } finally {
    delete hostPositions['book-1']
  }
})

probe('every surface is closed by a click on the empty area around it', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const overlay = componentOf(registered, 'shell.overlay')
  // The catalog of the books is opened from the card.
  const card = componentOf(registered, 'conversation.input.dock')
  react.beginRender()
  let strip = card()
  await react.flushEffects()
  await settle()
  const door = find(strip, node => node.type === 'button' && hasClass(node.props.className, 'sr-strip-open')
    && node.props['aria-label'] === 'Library')
  if (door === null) throw new Error('the card has no door to the catalog')
  door.props.onClick()
  await settle()
  react.beginRender()
  let page = overlay()
  await react.flushEffects()
  await settle()
  const picker = find(page, node => node.props && hasClass(node.props.className, 'sr-picker'))
  if (picker === null) throw new Error('the catalog did not open')
  const pickerNode = nodeOf(picker)
  if (pickerNode === null) throw new Error('the catalog has no node')
  // A click inside the catalog leaves it alone.
  pickerNode.inside = true
  if (clickOutside({}) === 0) throw new Error('nothing is listening for the click')
  react.beginRender()
  page = overlay()
  await react.flushEffects()
  await settle()
  if (find(page, node => node.props && hasClass(node.props.className, 'sr-picker')) === null) {
    throw new Error('a click inside the catalog closed it')
  }
  // A click on the empty area around it closes it.
  pickerNode.inside = false
  clickOutside({})
  await settle()
  react.beginRender()
  page = overlay()
  await react.flushEffects()
  await settle()
  if (find(page, node => node.props && hasClass(node.props.className, 'sr-picker')) !== null) {
    throw new Error('a click outside the catalog did not close it')
  }

  // The website shelf.
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const second = makeContext()
  client.apply(second.ctx)
  const overlayOf = componentOf(second.registered, 'shell.overlay')
  const cardOf = componentOf(second.registered, 'conversation.input.dock')
  react.beginRender()
  overlayOf()
  await react.flushEffects()
  await settle()
  react.beginRender()
  let cardTree = cardOf()
  await react.flushEffects()
  await settle()
  const shopEntry = find(cardTree, node => node.type === 'button' && node.children.includes('Find books'))
  if (shopEntry === null) throw new Error('the card has no door to the website shelf')
  shopEntry.props.onClick()
  await settle()
  react.beginRender()
  let shelf = overlayOf()
  await react.flushEffects()
  await settle()
  const shop = find(shelf, node => node.props && hasClass(node.props.className, 'sr-shop'))
  if (shop === null) throw new Error('the website shelf did not open')
  const shopNode = nodeOf(shop)
  if (shopNode === null) throw new Error('the website shelf has no node')
  // The shelf stays mounted, so the probe reads whether it is shown.
  const shelfShown = () => {
    const node = find(shelf, node => node.props && hasClass(node.props.className, 'sr-shop'))
    if (node === null) return false
    const style = node.props.style
    return !(style !== undefined && style !== null && style.visibility === 'hidden')
  }
  shopNode.inside = true
  clickOutside({})
  await settle()
  react.beginRender()
  shelf = overlayOf()
  await react.flushEffects()
  await settle()
  if (!shelfShown()) throw new Error('a click inside the website shelf closed it')
  shopNode.inside = false
  clickOutside({})
  await settle()
  react.beginRender()
  shelf = overlayOf()
  await react.flushEffects()
  await settle()
  if (shelfShown()) throw new Error('a click outside the website shelf did not close it')

  // The list of the places a search found, over the card.
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  const third = makeContext()
  client.apply(third.ctx)
  const overlayThird = componentOf(third.registered, 'shell.overlay')
  const cardThird = componentOf(third.registered, 'conversation.input.dock')
  react.beginRender()
  overlayThird()
  await react.flushEffects()
  await settle()
  react.beginRender()
  let cardTree2 = cardThird()
  await react.flushEffects()
  await settle()
  const lens = find(cardTree2, node => node.type === 'button'
    && hasClass(node.props.className, 'sr-strip-open')
    && Array.isArray(node.children)
    && node.children.some(child => child !== null && child !== undefined
      && child.props !== undefined && child.props !== null
      && child.props.className === 'sr-lens'))
  if (lens === null) throw new Error('the card has no search button')
  lens.props.onClick()
  await settle()
  react.beginRender()
  cardTree2 = cardThird()
  await react.flushEffects()
  await settle()
  const field = find(cardTree2, node => node.type === 'input'
    && hasClass(node.props.className, 'sr-strip-search'))
  if (field === null) throw new Error('the search field is missing')
  field.props.onChange({ target: { value: '文字' } })
  await settle()
  react.beginRender()
  cardTree2 = cardThird()
  await react.flushEffects()
  await settle()
  const field2 = find(cardTree2, node => node.type === 'input'
    && hasClass(node.props.className, 'sr-strip-search'))
  field2.props.onKeyDown({ key: 'Enter', shiftKey: false, preventDefault() {}, stopPropagation() {} })
  await settle()
  react.beginRender()
  let list = overlayThird()
  await react.flushEffects()
  await settle()
  const popup = find(list, node => node.props && hasClass(node.props.className, 'sr-strip-popup'))
  if (popup === null) throw new Error('the list of the places did not open')
  const popupNode = nodeOf(popup)
  if (popupNode === null) throw new Error('the list of the places has no node')
  popupNode.inside = true
  clickOutside({})
  await settle()
  react.beginRender()
  list = overlayThird()
  await react.flushEffects()
  await settle()
  if (find(list, node => node.props && hasClass(node.props.className, 'sr-strip-popup')) === null) {
    throw new Error('a click inside the list of the places closed it')
  }
  popupNode.inside = false
  clickOutside({})
  await settle()
  react.beginRender()
  list = overlayThird()
  await react.flushEffects()
  await settle()
  if (find(list, node => node.props && hasClass(node.props.className, 'sr-strip-popup')) !== null) {
    throw new Error('a click outside the list of the places did not close it')
  }
})

probe('the pages that float above the window are drawn beside the root', async () => {
  const source = readFileSync(CLIENT, 'utf8')
  // The overlay layer of the application lives inside its root, and a page
  // drawn in it sits under every modal the host owns — the settings panel
  // among them. A page that has to float above one is drawn beside the root,
  // the way the host draws its own modals.
  if (!/function floatAbove\(/.test(source)) throw new Error('there is no way to draw a page beside the root')
  if (!/ReactDOM\.createPortal\(node, document\.body\)/.test(source)) {
    throw new Error('a floating page is not drawn beside the root')
  }
  // The renderer is optional: without it the page stays where it was.
  if (!/require\('react-dom'\)/.test(source)) throw new Error('the reader does not ask for the renderer')
  if (!/\.sr-float-page\{position:fixed;z-index:1150\}/.test(source)) {
    throw new Error('a floating page has no rule of its own')
  }
  // The rule has to be above the modal of the host, which sits at 1000.
  const layer = /\.sr-float-page\{[^}]*z-index:(\d+)\}/.exec(source)
  if (layer === null || Number(layer[1]) <= 1000) {
    throw new Error('a floating page stays under the modals of the host')
  }
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const overlay = componentOf(registered, 'shell.overlay')
  react.beginRender()
  const tree = overlay()
  await react.flushEffects()
  await settle()
  // The website library is the page the settings open, so it has to float.
  const shop = find(tree, node => node.props && hasClass(node.props.className, 'sr-shop'))
  if (shop === null) throw new Error('the website library is not on screen')
  if (!hasClass(shop.props.className, 'sr-float-page')) {
    throw new Error('the website library does not float above the modals of the host')
  }
  // It is drawn outside the reader's own root, so it carries the tokens of the
  // reader's surfaces with it.
  if (!hasClass(shop.props.className, 'sr-float')) {
    throw new Error('the website library does not carry the tokens of the reader')
  }
})

probe('the colours of the reader are the colours of the host', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // The line height and the colour of a line had the same name. A rule that
  // wanted the colour was handed the height, and a border that cannot be
  // drawn is no border at all: the reader lost every line and every frame.
  if (/'--sr-line'\s*:/.test(source)) {
    throw new Error('the colour of a line is named like its height')
  }
  if (!/--sr-line-height/.test(source)) throw new Error('the height of a line has no name of its own')
  // A floating page is the colour of a card. The host's overlay colour is a
  // shade darker, and taking it made the reader's pages look like a
  // different application from the reader's card.
  const floatRule = source.match(/\.sr-float\{\$\{READER_TOKENS\}([^`]*?)\}/)
  if (floatRule === null) throw new Error('the floating page declares no colours')
  if (/--sr-bg:var\(--dsw-alias-bg-overlay/.test(floatRule[1])) {
    throw new Error('the floating page takes the overlay colour again')
  }
  if (!/--sr-bg:var\(--dsw-alias-bg-layer-1/.test(floatRule[1])) {
    throw new Error('the floating page is not the colour of a card')
  }
  // One list of colours, so every surface takes them the same way. A floating
  // page overrides one colour to take the colour of a card, and that override
  // is the only allowed second copy: an overlay colour made the reader's own
  // pages look like a different application from the reader's card.
  const lists = [...source.matchAll(/--sr-bg:var\(--dsw-alias-bg-layer-1/g)]
  if (lists.length !== 2) {
    throw new Error('the colours of the surfaces are written ' + String(lists.length) + ' times, expected 2')
  }
  if (!/const READER_TOKENS = /.test(source)) throw new Error('the colours have no list of their own')
  // Every colour the reader asks of the host has to be a name the host has.
  // The host renamed one of them, and the surface kept a colour of its own
  // without anybody noticing.
  for (const token of ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-border-l1',
    '--dsw-alias-border-l2', '--dsw-alias-brand-primary', '--dsw-alias-state-success-primary',
    '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active']) {
    if (!source.includes(token)) throw new Error('the reader does not ask the host for ' + token)
  }
  // The colours of the surfaces have to be names the host publishes, so a
  // reader who changes the theme of the application changes them too. The
  // host publishes a fixed list of them; the reader may only ask for those.
  const published = JSON.parse(readFileSync(new URL('./verify/host-theme-tokens.json', import.meta.url), 'utf8'))
  const names = new Set(published.tokens.map(token => token.name))
  const tokens = source.match(/const READER_TOKENS = `([\s\S]*?)`/)
  if (tokens === null) throw new Error('the reader has no list of colours')
  const surfaces = ['--sr-bg', '--sr-bg2', '--sr-ink', '--sr-muted', '--sr-line', '--sr-line2',
    '--sr-accent', '--sr-ok', '--sr-warn', '--sr-err']
  for (const surface of surfaces) {
    const line = tokens[1].split('\n').find(part => part.trim().startsWith(surface + ':'))
    if (line === undefined) throw new Error('the reader does not declare ' + surface)
    const asked = line.match(/var\((--dsw-[a-z0-9-]+)/)
    if (asked === null) throw new Error(surface + ' does not come from the host')
    if (!names.has(asked[1])) {
      throw new Error(surface + ' asks for ' + asked[1] + ', which the host does not publish')
    }
  }
  // The states of a row under the pointer are not in the registry the Theme
  // provider publishes, but the host stylesheet defines them and its own rows
  // use them. They are recorded separately, and the reader may only ask for
  // those: a name the host has dropped would leave the rows with the colour
  // of the surface, which is the same as no hover at all.
  const interactive = new Set((published.interactiveTokens || []).map(token => token.name))
  for (const surface of ['--sr-hover', '--sr-active', '--sr-hover-accent']) {
    const line = tokens[1].split('\n').find(part => part.trim().startsWith(surface + ':'))
    if (line === undefined) throw new Error('the reader does not declare ' + surface)
    const asked = line.match(/var\((--dsw-[a-z0-9-]+)/)
    if (asked === null) throw new Error(surface + ' does not come from the host')
    if (!interactive.has(asked[1])) {
      throw new Error(surface + ' asks for ' + asked[1] + ', which the host no longer defines')
    }
  }
  // The fallbacks are a last resort, and they must not be the colour of the
  // surface: a fallback that matches the surface is an invisible hover.
  for (const surface of ['--sr-hover', '--sr-active']) {
    const line = tokens[1].split('\n').find(part => part.trim().startsWith(surface + ':'))
    const fallback = line.match(/,\s*([^)]+)\)/)
    if (fallback === null) throw new Error(surface + ' has no fallback of its own')
    if (/^\s*(transparent|#fff|white)\s*$/i.test(fallback[1])) {
      throw new Error(surface + ' falls back to the colour of the surface')
    }
  }
  // A name the host does not have is a colour that never changes with the
  // theme of the application.
  if (/--dsw-alias-state-warning-primary/.test(source)) {
    throw new Error('the reader asks for a colour the host does not have')
  }
})

probe('the card measures its page again when it comes back', async () => {
  const source = readFileSync(CLIENT, 'utf8')
  // Folding the card takes its text away, so the element the measurement
  // needs is gone while the card is away. The measurement is taken again as
  // soon as the card is back, before the browser paints.
  if (!/useLayout\(\(\) => \{/.test(source)) {
    throw new Error('the page is not measured before the browser paints')
  }
  if (!/const \[pageEndAt, setPageEndAt\] = React\.useState\(null\)/.test(source)) {
    throw new Error('the last measurement is not kept')
  }
  if (!/previous\.start === start && previous\.length === text\.length/.test(source)) {
    throw new Error('the kept measurement is not checked against the text it belongs to')
  }
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  const { ctx, registered } = makeContext()
  client.apply(ctx)
  const card = componentOf(registered, 'conversation.input.dock')
  react.beginRender()
  let tree = card()
  await react.flushEffects()
  await settle()
  const line = find(tree, node => node.type === 'p' && hasClass(node.props.className, 'sr-strip-line'))
  if (line === null) throw new Error('the card has no text')
  // The card is measured before it is painted, so the text it draws is the
  // text that was measured.
  const style = line.props.style
  if (!style || String(style.WebkitLineClamp) !== String(Number(hostSettings.stripLines) || 3)) {
    throw new Error('the text of the card is not clamped to the chosen number of lines')
  }
})

probe('the footer row leaves the rare actions out when it is narrow', async () => {
  resetComponent()
  hostSettings.placement = 'strip'
  hostSettings.skin = 'plain'
  hostState.current = { bookId: 'book-1', index: 0 }
  const context = makeContext()
  client.apply(context.ctx)
  const overlay = componentOf(context.registered, 'shell.overlay')
  const card = componentOf(context.registered, 'conversation.input.dock')
  react.beginRender()
  overlay()
  await react.flushEffects()
  await settle()
  react.beginRender()
  let tree = card()
  await react.flushEffects()
  await settle()
  const rowOf = source => find(source, node => node.props
    && hasClass(node.props.className, 'sr-strip-foot'))
  const libraryOf = source => find(source, node => node.type === 'button'
    && node.props && hasClass(node.props.className, 'sr-strip-open')
    && Array.isArray(node.children) && node.children[0] === '☰')
  const tocOf = source => find(source, node => node.type === 'button'
    && node.props && hasClass(node.props.className, 'sr-strip-open')
    && Array.isArray(node.children) && node.children[0] === '☷')
  if (libraryOf(tree) === null) throw new Error('the wide row has no catalog button')
  if (tocOf(tree) === null) throw new Error('the wide row has no table of contents button')
  const row = rowOf(tree)
  if (row === null) throw new Error('the card has no footer row')
  const node = nodeOf(row)
  if (node === null) throw new Error('the footer row was never given a node')
  // The card is told that the row is narrow, the way a browser would.
  if (resizeRows(300) === 0) throw new Error('the card does not watch its own row')
  await settle()
  react.beginRender()
  tree = card()
  await react.flushEffects()
  await settle()
  if (libraryOf(tree) !== null) throw new Error('the narrow row still shows the catalog')
  // The reading actions stay: the steps, the search and the way out.
  const steps = findAll(tree, node => node.type === 'button'
    && node.props && hasClass(node.props.className, 'sr-strip-step'))
  if (steps.length !== 2) throw new Error('the narrow row lost the steps')
  const search = find(tree, node => node.type === 'button'
    && node.props && hasClass(node.props.className, 'sr-strip-open')
    && Array.isArray(node.children)
    && node.children.some(child => child !== null && child !== undefined
      && child.props !== undefined && child.props !== null
      && child.props.className === 'sr-lens'))
  if (search === null) throw new Error('the narrow row lost the search')
  const fold = find(tree, node => node.type === 'button'
    && node.props && hasClass(node.props.className, 'sr-strip-fold'))
  if (fold === null) throw new Error('the narrow row lost the way out')
})

probe('every icon button of the reader is one of the family', () => {
  const source = readFileSync(CLIENT, 'utf8')
  // The rule is stated once, and it states the size, the glyph and the look.
  const family = source.match(/(?:^|\n)\.sr-ibtn\{[^}]*\}/)?.[0] || ''
  if (family === '') throw new Error('the reader has no rule for its icon buttons')
  for (const part of ['--sr-ibtn-size', '--sr-ibtn-glyph', '--sr-ibtn-radius', 'place-items:center']) {
    if (!family.includes(part)) throw new Error('the rule for the icon buttons is incomplete: ' + part)
  }
  if (!source.includes('\n.sr-lbtn{')) throw new Error('the reader has no rule for its labelled buttons')
  // Every button that only carries an icon is one of the family.
  const markers = ['sr-btn', 'sr-strip-open', 'sr-strip-step', 'sr-strip-fold', 'sr-strip-mark', 'sr-strip-bar-btn']
  const classes = [...source.matchAll(/className: '([^']*)'/g)].map(match => match[1])
  const offenders = classes.filter(name => {
    const parts = name.split(/\s+/)
    if (!parts.some(part => markers.includes(part))) return false
    return !parts.includes('sr-ibtn') && !parts.includes('sr-lbtn')
  })
  if (offenders.length > 0) {
    throw new Error('these icon buttons are outside the family: ' + offenders.join(' | '))
  }
  // The card row says its scale once.
  if (!source.includes('--sr-ibtn-size:22px')) {
    throw new Error('the card row does not say how big its icons are')
  }
})

probe('search result metadata uses a full-width wrapping header above its excerpt', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('    function searchHitRows(')
  const end = source.indexOf('\n    }', start) + 6
  const rows = vm.runInNewContext('(' + source.slice(start, end) + ')', {
    h: (type, props, ...children) => ({ type, props: props || {}, children }),
    highlight: text => text,
  })
  const place = { key: 'layout', index: 1234, line: 5678, title: '布局测试标题'.repeat(20), snippet: '布局测试片段' }
  let picked = null
  const options = { onPick: value => { picked = value }, t: (key, args) => key + args.n }
  const tree = rows([place], options)[0]
  const chapter = find(tree, node => hasClass(node.props?.className, 'sr-search-chapter'))
  if (chapter?.children[0] !== place.title) throw new Error('long chapter title was shortened')
  if (!hasClass(tree.props.className, 'sr-search-hit')) throw new Error('search still uses the narrow TOC layout')
  if (!source.includes('grid-template-columns:minmax(0,1fr) auto')) throw new Error('metadata cannot share full width')
  tree.props.onClick()
  if (picked !== place) throw new Error('layout change broke jumping to the search result')
  const disguised = rows([place], { ...options, disguised: true })[0]
  if (JSON.stringify(disguised).includes(place.title) || JSON.stringify(disguised).includes(place.snippet)) {
    throw new Error('search layout leaks book content in disguise mode')
  }
})

probe('editing search keeps the card open; blurring outside restores automatic folding', async () => {
  const saved = { ...hostSettings }
  try {
    Object.assign(hostSettings, { placement: 'strip', cardFoldable: true, cardFoldMode: 'auto', cardFoldDelay: 80, cardFoldedShape: 'mark' })
    const { registered } = await mountAndSettle()
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = await openCard(card)
    tree.props.onFocusCapture({ target: { tagName: 'INPUT' } })
    tree.props.onMouseLeave()
    await new Promise(resolve => setTimeout(resolve, 100))
    react.beginRender(); tree = card(); await react.flushEffects(); await settle()
    if (!find(tree, node => hasClass(node.props?.className, 'sr-strip-panel'))) throw new Error('focused search collapsed on mouse leave')
    tree.props.onBlurCapture({ relatedTarget: null, currentTarget: { matches: () => false } })
    await new Promise(resolve => setTimeout(resolve, 100))
    react.beginRender(); tree = card(); await react.flushEffects(); await settle()
    if (tree !== null) throw new Error('card did not fold after leaving the search field')
    if (!nativeMark()) throw new Error('native entry disappeared after automatic folding')
  } finally { Object.assign(hostSettings, saved) }
})

probe('pending automatic folding checks current preferences before committing', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('const scheduleHide = React.useCallback(')
  const end = source.indexOf('\n      React.useEffect(', start)
  const code = source.slice(start, end) + '\nscheduleHide'
  for (const patch of [{ cardFoldMode: 'manual' }, { cardFoldMode: 'never' }, { cardFoldable: false }]) {
    const settings = { cardFoldMode: 'auto', cardFoldable: true, cardFoldDelay: 80 }
    const live = { settings: { ...settings }, stripPopup: null }
    let scheduled = null, folded = false
    const hide = vm.runInNewContext(code, {
      React: { useCallback: fn => fn }, hideTimerRef: { current: null }, editingRef: { current: false },
      shared: { settings }, readerStore: { get: () => live },
      MIN_FOLD_DELAY: 80, MAX_FOLD_DELAY: 800, DEFAULT_FOLD_DELAY: 120,
      setTimeout: fn => { scheduled = fn; return 1 }, clearTimeout() {},
      setExpanded: value => { folded = value === false },
    })
    hide()
    if (!scheduled) throw new Error('automatic fold did not schedule')
    Object.assign(live.settings, patch)
    scheduled()
    if (folded) throw new Error('stale automatic timer overrode the current fold preference')
  }
})

probe('user folding requests focus only after the mark or bar has mounted', async () => {
  const saved = { ...hostSettings }
  try {
    for (const shape of ['mark', 'bar']) {
      Object.assign(hostSettings, { placement: 'strip', cardFoldable: true, cardFoldMode: 'manual', cardFoldedShape: shape })
      const { registered } = await mountAndSettle()
      const card = componentOf(registered, 'conversation.input.dock')
      let tree = await openCard(card)
      const mark = nativeMark()
      let focuses = 0
      if (shape === 'mark') mark.props.ref.current.focus = () => { focuses++ }
      const fold = find(tree, node => hasClass(node.props?.className, 'sr-strip-fold'))
      fold.props.onClick()
      if (focuses !== 0) throw new Error('focus moved before folded render committed')
      react.beginRender(); tree = card()
      if (shape === 'bar') {
        const row = find(tree, node => hasClass(node.props?.className, 'sr-strip-bar-row'))
        if (!row?.props.ref?.current) throw new Error('folded bar has no focus target')
        row.props.ref.current.focus = () => { focuses++ }
      }
      await react.flushEffects(); await settle()
      if (focuses !== 1) throw new Error('folded ' + shape + ' did not receive focus after commit')
    }
  } finally { Object.assign(hostSettings, saved) }
})

probe('the test double cleans an effect up when its dependencies change', async () => {
  const local = makeReact()
  const seen = []
  let cleanups = 0
  function Probe({ step }) {
    local.React.useEffect(() => {
      seen.push('run:' + step)
      return () => { cleanups += 1 }
    }, [step])
    return local.React.createElement('div', null)
  }
  local.beginRender()
  local.mount(Probe, { step: 1 })
  await local.flushEffects()
  if (cleanups !== 0) throw new Error('the first run cleaned up on its own')
  local.beginRender()
  local.mount(Probe, { step: 2 })
  await local.flushEffects()
  if (cleanups !== 1) throw new Error('the previous effect was not cleaned up on a change')
  if (seen.join(',') !== 'run:1,run:2') throw new Error('the effect did not run again')
  // The same dependencies do not run the effect again.
  local.beginRender()
  local.mount(Probe, { step: 2 })
  await local.flushEffects()
  if (cleanups !== 1) throw new Error('an unchanged effect was cleaned up')
  await local.unmount()
  if (cleanups !== 2) throw new Error('the last effect was not cleaned up on unmount')
})

probe('the test double keeps one element when a callback ref changes identity', async () => {
  const local = makeReact()
  const calls = []
  const first = node => { calls.push(['first', node]); return () => {} }
  const second = node => { calls.push(['second', node]); return () => {} }
  function Probe({ callback }) {
    return local.React.createElement('div', { ref: callback })
  }
  local.beginRender()
  local.mount(Probe, { callback: first })
  await local.flushEffects()
  if (calls.length !== 1 || calls[0][0] !== 'first') throw new Error('the ref was not attached')
  const element = calls[0][1]
  local.beginRender()
  local.mount(Probe, { callback: second })
  await local.flushEffects()
  if (calls.length !== 3) throw new Error('the ref was not attached and detached')
  if (calls[1][0] !== 'first' || calls[1][1] !== null) throw new Error('the old callback was not detached with null')
  if (calls[2][0] !== 'second' || calls[2][1] !== element) throw new Error('the element was replaced')
})

probe('the test double releases a subscription when the surface goes away', async () => {
  const local = makeReact()
  let subscribed = 0, unsubscribed = 0
  function Probe() {
    local.React.useEffect(() => {
      subscribed += 1
      return () => { unsubscribed += 1 }
    }, [])
    return local.React.createElement('div', null)
  }
  local.beginRender()
  local.mount(Probe)
  await local.flushEffects()
  if (subscribed !== 1) throw new Error('the effect did not subscribe')
  await local.unmount()
  if (unsubscribed !== 1) throw new Error('the subscription outlived the surface')
  if (local.cleanupCount() !== 0) throw new Error('a cleanup stayed registered after unmount')
})

probe('the search field closes itself and gives the row its icon back', async () => {
  const saved = { ...hostSettings }
  try {
    Object.assign(hostSettings, { placement: 'strip', skin: 'plain', cardFoldable: true, cardFoldMode: 'manual' })
    const { registered } = await mountAndSettle()
    const card = componentOf(registered, 'conversation.input.dock')
    let tree = await openCard(card)
    const searchButton = find(tree, node => node.type === 'button'
      && node.props && hasClass(node.props.className, 'sr-strip-open')
      && node.children && node.children.some(child => child && child.props
        && hasClass(child.props.className, 'sr-lens')))
    if (searchButton === null) throw new Error('the card has no search icon')
    searchButton.props.onClick()
    await settle()
    react.beginRender(); tree = card(); await react.flushEffects(); await settle()
    const field = find(tree, node => node.type === 'input' && node.props
      && hasClass(node.props.className, 'sr-strip-search'))
    if (field === null) throw new Error('the search field did not open')
    if (typeof field.props.onBlur !== 'function') throw new Error('the search field never closes itself')
    if (field.props.autoFocus !== true) throw new Error('the search field does not focus itself when it opens')
    field.props.onBlur()
    await settle()
    react.beginRender(); tree = card(); await react.flushEffects(); await settle()
    if (find(tree, node => node.type === 'input' && node.props
      && hasClass(node.props.className, 'sr-strip-search')) !== null) {
      throw new Error('the search field stayed open after it lost the focus')
    }
    const icon = find(tree, node => node.type === 'button'
      && node.props && hasClass(node.props.className, 'sr-strip-open')
      && node.children && node.children.some(child => child && child.props
        && hasClass(child.props.className, 'sr-lens')))
    if (icon === null) throw new Error('the search icon did not come back')
  } finally { Object.assign(hostSettings, saved) }
})

// Every probe has run by now.
for (const run of pendingProbes) await run()

console.log(results.join('\n'))
const failed = results.filter(line => line.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
