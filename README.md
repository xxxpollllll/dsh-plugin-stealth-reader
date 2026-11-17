# Stealth reader

A novel reader that lives inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
a side column or one quiet line above the input box. It reads local files and
web novels, and **keeps novel text out of your conversations** — no title, no
path, and no chapter text ever reaches a session transcript.

The plugin itself is in [`dsh-plugin-stealth-reader/`](dsh-plugin-stealth-reader);
its [README](dsh-plugin-stealth-reader/README.md) describes what it does and how
to install it.

## What it is for

Reading a novel in the same window you work in, without the reading showing up
in the record. The panel is a separate surface from the conversation: chapter
text is written to disk and drawn in the panel, never into a session. The agent
tool that manages the library reports counts and positions only.

Turn the plugin off and the panel and the tool go away. Cached chapters stay on
disk until you delete them.

## Install

Inside the Desktop app: **Plugins → Add plugin → `dsh-plugin-stealth-reader`**.

For a plain `dsh web`:

```sh
dsh plugin --profile web add dsh-plugin-stealth-reader
```

Then refresh the Harness window. See the [plugin README](dsh-plugin-stealth-reader/README.md#install)
for the details and the local-checkout route.

## Verifying it

Everything here runs offline against synthetic books — no real library, no
network, no novel text in any output.

| Suite | What it covers |
| --- | --- |
| `stealth-reader-selftest.mjs` | Host behaviour, formats, the reader service |
| `stealth-reader-webtest.mjs` | Reading and parsing web pages |
| `stealth-reader-routetest.mjs` | The local route, permissions, and **the privacy promise** |
| `stealth-reader-storetest.mjs` | Storage, cache, and credential rules |
| `stealth-reader-crashprobe.mjs` | Every reader component, focus order, timers |
| `stealth-reader-browsertest.mjs` | The isolated site browser |
| `verify/dom/run-dom-test.mjs` | The shipped client bundle in a real Chrome |

`bash deploy-gate.sh` runs what the release insists on: parsing, locale parity,
the inlined browser helper, the host packages the client binds to, the packed
tarball, and the two privacy suites. A build that could put chapter text into a
tool result is refused.

## Layout

```
dsh-plugin-stealth-reader/   the bundle: host half, client half, locales, icon
  lib/index.js               host: library, cache, route, agent tool
  lib/client.js              client: every surface, one static file
  lib/reader-browser.js      the isolated site browser (inlined into client.js)
verify/                      the checks, and the fixture data they compare against
*.mjs                        the suites, runnable on their own
deploy-gate.sh               the release gate
```

## Notes

- Test data is synthetic. The suites write their own chapters into a temporary
  directory and delete them afterwards.
- Nothing in this repository is a real book. The sample folder is ignored on
  purpose — a public repository should not be able to carry one by accident.
- The window must be refreshed after the plugin changes: the panel is
  client-side code, and a window that was already open keeps what it started
  with.

## Licence

MIT.
