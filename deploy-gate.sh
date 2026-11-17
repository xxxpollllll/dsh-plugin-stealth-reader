#!/usr/bin/env bash
# Check the bundle before it is deployed.
#
# A syntax error in the client half blanks the panel, because the Harness
# replaces a slot that throws with an empty element. This gate refuses a
# broken build before it reaches the running app.
set -euo pipefail

BUNDLE="${1:-./dsh-plugin-stealth-reader}"
failed=0

for file in "$BUNDLE"/lib/*.js "$BUNDLE"/lib/host/*.js; do
  if ! node --check "$file" > /dev/null 2>&1; then
    echo "SYNTAX ERROR: ${file#"$BUNDLE"/}"
    node --check "$file" 2>&1 | head -5
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "REFUSING TO DEPLOY: the bundle does not parse."
  exit 1
fi

# The locale dictionaries must stay in step.
node -e "
const fs = require('fs')
const source = fs.readFileSync('$BUNDLE/lib/client.js', 'utf8')
const en = source.slice(source.indexOf('const EN = {'), source.indexOf('const ZH = {'))
const zh = source.slice(source.indexOf('const ZH = {'), source.indexOf('const SKINS'))
const keys = (text) => [...text.matchAll(/^\s{6}([A-Za-z][\w]*):/gm)].map((m) => m[1])
const enKeys = keys(en)
const zhKeys = keys(zh)
const missingZh = enKeys.filter((key) => !zhKeys.includes(key))
const missingEn = zhKeys.filter((key) => !enKeys.includes(key))
if (missingZh.length > 0 || missingEn.length > 0) {
  console.error('LOCALE MISMATCH: missing in zh:', missingZh.join(',') || 'none', '| missing in en:', missingEn.join(',') || 'none')
  process.exit(1)
}
console.log('locale keys aligned:', enKeys.length)
" || failed=1

if [ "$failed" -ne 0 ]; then
  echo "REFUSING TO DEPLOY: the locale dictionaries are out of step."
  exit 1
fi

# The isolated site browser is authored as lib/reader-browser.js and inlined
# into the Client factory, because a Client half is one static file loaded by
# the module loader and cannot import a sibling module. This check keeps the
# two copies identical, so an edit to one cannot silently drift from the other.
node -e "
const fs = require('fs')
const helper = fs.readFileSync('$BUNDLE/lib/reader-browser.js', 'utf8')
  .replace('export function createReaderBrowser', 'function createReaderBrowser')
const client = fs.readFileSync('$BUNDLE/lib/client.js', 'utf8')
if (!client.includes(helper.trimEnd())) {
  console.error('BROWSER DRIFT: lib/client.js no longer carries the current lib/reader-browser.js body')
  process.exit(1)
}
console.log('site browser inlined copy matches lib/reader-browser.js')
"


# The host packages the client half is loaded after must really be in the
# installation. A name that is not there is a client that never starts, and
# the failure is silent: the slot stays empty.
if [ -n "${DSH_INSTALL_DIR:-}" ]; then
  node "$(dirname "$0")/verify/host-packages.mjs" "$BUNDLE" || failed=1
else
  echo "host client packages: not checked (DSH_INSTALL_DIR is not set)"
fi

# The privacy promise is the point of this plugin: the tool result is what
# enters the session transcript, so the suite that grows that promise has to
# run on every deploy. A leak here is a novel in a chat log.
node "$(dirname "$0")/stealth-reader-routetest.mjs" || failed=1
node "$(dirname "$0")/stealth-reader-storetest.mjs" || failed=1

if [ "$failed" -ne 0 ]; then
  echo "REFUSING TO DEPLOY: the route or storage suite failed, so the privacy promise is unproven."
  exit 1
fi

# The packed tarball is what an installation really gets. A file that is used
# at run time but not shipped is a plugin that works in the workspace and is
# missing everywhere else.
node "$(dirname "$0")/verify/packed-install.mjs" "$BUNDLE" || failed=1

# Assertions a syntax check cannot make: a setting with no effect, a README
# that promises what the code does not do, and two copies of one bound.
node "$(dirname "$0")/verify/gate-checks.mjs" "$BUNDLE" || failed=1

if [ "$failed" -ne 0 ]; then
  echo "REFUSING TO DEPLOY: the code and its promises are out of step."
  exit 1
fi

echo "gate passed: the bundle parses and the locales are aligned."
