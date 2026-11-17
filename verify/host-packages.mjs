/**
 * Check that the host packages the bundle depends on are really there.
 *
 * A client half is loaded by the Harness module loader, and it is loaded
 * after the packages it names. A name the installation does not carry is a
 * client that never starts, and the failure is silent: the slot simply
 * stays empty and the reader is nowhere to be seen.
 *
 * The installation is an ASAR archive, so the packages are read out of it
 * with the Electron runtime in Node mode. Nothing is written and nothing is
 * executed from the archive.
 *
 * @module
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = process.argv[2] || join(here, '..', 'dsh-plugin-stealth-reader')
const manifest = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8'))
const injects = manifest.dsh?.client?.inject || []

const install = process.env.DSH_INSTALL_DIR
if (install === undefined || install === '') {
  console.error('HOST CHECK: DSH_INSTALL_DIR is not set, so the installation cannot be read')
  process.exit(2)
}

/* The archive the installation lives in. The install directory points inside
 * it, so the archive is the part of the path up to the archive itself. */
const marker = install.indexOf('.asar')
const asar = marker === -1 ? install : install.slice(0, marker + '.asar'.length)
const runtime = process.env.DSH_NODE_EXECUTABLE
  || install.replace(/\/Contents\/Resources.*$/, '/Contents/MacOS/DeepSeek Harness')

const script = `
const fs = require('node:fs')
const base = ${JSON.stringify(asar + '/dsh/node_modules/@deepseek-ai/')}
const names = fs.readdirSync(base, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
const wanted = ${JSON.stringify(injects.map(name => name.replace('@deepseek-ai/', '')))}
const out = {}
for (const name of wanted) {
  if (!names.includes(name)) { out[name] = null; continue }
  try {
    const pkg = JSON.parse(fs.readFileSync(base + name + '/package.json', 'utf8'))
    out[name] = { version: pkg.version, entry: pkg.exports ? Object.keys(pkg.exports) : [] }
  } catch (error) { out[name] = { version: null, entry: [] } }
}
process.stdout.write(JSON.stringify(out))
`

let found = null
try {
  found = JSON.parse(execFileSync(runtime, ['-e', script], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }))
} catch (error) {
  console.error('HOST CHECK: the installation could not be read: ' + error.message)
  process.exit(2)
}

const missing = injects.filter(name => found[name.replace('@deepseek-ai/', '')] === null)
if (missing.length > 0) {
  console.error('HOST CHECK: the installation does not carry ' + missing.join(', '))
  console.error('  the client half would never start, and the failure would be silent')
  process.exit(1)
}

const versions = new Set()
for (const name of injects) {
  const info = found[name.replace('@deepseek-ai/', '')]
  versions.add(info.version)
}
if (versions.size > 1) {
  console.error('HOST CHECK: the host client packages are of several versions: ' + [...versions].join(', '))
  process.exit(1)
}

/* The colours the reader asks for must really be defined by the host's own
 * stylesheet. The Theme provider publishes only the colours it promises to
 * plugins; the states of a row under the pointer are in the stylesheet, and
 * a name the host has dropped leaves the reader's rows with no hover colour
 * at all, which looks like a dead surface rather than a broken one. */
const recorded = JSON.parse(readFileSync(join(here, 'host-theme-tokens.json'), 'utf8'))
const wanted = [
  ...recorded.tokens.map(token => token.name),
  ...(recorded.interactiveTokens || []).map(token => token.name),
  ...(recorded.typographyAndRadius || []).map(token => token.name),
]
const cssScript = `
const fs = require('node:fs')
const base = ${JSON.stringify(asar + '/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/src/styles/')}
const css = ['design-platform.css', 'base.css']
  .map(name => { try { return fs.readFileSync(base + name, 'utf8') } catch { return '' } })
  .join(' ')
process.stdout.write(JSON.stringify({ css }))
`
let css = ''
try {
  css = JSON.parse(execFileSync(runtime, ['-e', cssScript], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })).css
} catch (error) {
  console.error('HOST CHECK: the host stylesheet could not be read: ' + error.message)
  process.exit(2)
}
const undefinedTokens = wanted.filter(name => !css.includes(name + ':'))
if (undefinedTokens.length > 0) {
  console.error('HOST CHECK: the host stylesheet does not define ' + undefinedTokens.join(', '))
  console.error('  the reader would fall back to its own colours, and the host theme would not reach it')
  process.exit(1)
}

console.log('host client packages: ' + injects.length + ' present, all of version ' + [...versions][0]
  + '; ' + wanted.length + ' host colours are defined by the host stylesheet')
