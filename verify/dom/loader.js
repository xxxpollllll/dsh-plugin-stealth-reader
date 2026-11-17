/* The module loader the Harness uses, defined before the client bundle runs. */
;(function () {
  'use strict'
  window.__LOADED__ = []
  window.__ModuleLoader__ = {
    load(definition) {
      const plugin = definition.factory(name => {
        if (name === 'react') return window.React
        // The renderer is optional for the client, but the Harness provides
        // it, and the reader draws a page that floats above the modals of the
        // host with it.
        if (name === 'react-dom') return window.ReactDOM
        throw new Error('the harness only provides react and react-dom')
      })
      window.__LOADED__.push({ id: definition.id, plugin })
      return plugin
    },
  }
  /* The harness records what the card's row reports to its own observer, so
   * the measurement can be checked from the outside. */
  window.__RO__ = []
  const Native = window.ResizeObserver
  window.ResizeObserver = class extends Native {
    constructor(callback) {
      super(entries => {
        for (const entry of entries) {
          window.__RO__.push({
            className: entry.target && entry.target.className ? entry.target.className : '',
            contentWidth: entry.contentRect ? entry.contentRect.width : -1,
            clientWidth: entry.target ? entry.target.clientWidth : -1,
          })
        }
        callback(entries)
      })
    }
  }
})()
