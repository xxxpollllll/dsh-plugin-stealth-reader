/**
 * Gate checks that a syntax check cannot make.
 *
 * Run by deploy-gate.sh. Exits non-zero with a reason the deploy refuses on.
 *
 * @module
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = process.argv[2] || join(here, '..', 'dsh-plugin-stealth-reader')
const host = readFileSync(join(bundle, 'lib/index.js'), 'utf8')
const client = readFileSync(join(bundle, 'lib/client.js'), 'utf8')
const readme = readFileSync(join(bundle, 'README.md'), 'utf8')

const problems = []

/** The keys the host will store. */
const start = host.indexOf('const DEFAULT_SETTINGS = {')
const end = host.indexOf('\n}', start)
const keys = [...host.slice(start, end).matchAll(/^ {2}([a-zA-Z]+):/gm)].map(m => m[1])

/** Whether the client reads one setting. */
const reads = key => new RegExp(`(?:shared\\.)?settings\\.${key}\\b`).test(client)

// 1. A stored setting nobody reads is a control with no effect.
// Host keeps these only for older preference files; placement now belongs to the toolbar.
const retiredSettings = new Set(['cardAlign', 'cardOffset'])
for (const key of keys) {
  if (!retiredSettings.has(key) && !reads(key)) {
    problems.push(`setting "${key}" is stored but never read by the client`)
  }
}

// 2. A dead setting must leave the docs too, or the docs are describing a
//    feature that is not there.
for (const key of keys) {
  if (!reads(key) && new RegExp(`\\b${key}\\b`).test(readme)) {
    problems.push(`README still documents the dead setting "${key}"`)
  }
}

// 3. The README must not promise a control the settings page does not draw.
if (/\bAdvanced\b/.test(readme) && !/h\('details'|<details/.test(client)) {
  problems.push('README promises an "Advanced" disclosure; the settings page draws no disclosure')
}

// 4. Two copies of one bound must not disagree. The fold delay was written
//    three times: the slider said 800, the host and the card used 2000.
const bound = (text, name) => {
  const m = text.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))
  return m === null ? null : Number(m[1])
}
const hostMax = bound(host, 'MAX_FOLD_DELAY')
const clientMax = bound(client, 'MAX_FOLD_DELAY')
const hostMin = bound(host, 'MIN_FOLD_DELAY')
const clientMin = bound(client, 'MIN_FOLD_DELAY')
if (hostMax === null || clientMax === null) {
  problems.push('one side lost the shared fold-delay bounds')
} else if (hostMax !== clientMax || hostMin !== clientMin) {
  problems.push(`the fold delay is clamped to ${hostMin}-${hostMax} on the host `
    + `but ${clientMin}-${clientMax} in the client`)
}
// A stray literal in a clamp is the old mismatch coming back.
for (const [name, text] of [['client', client], ['host', host]]) {
  if (/Math\.max\(\s*wanted\s*,\s*\d+\s*\)/.test(text) || /Math\.max\(\s*delay\s*,\s*\d+\s*\)/.test(text)) {
    problems.push(`${name} still clamps a fold delay with a bare literal`)
  }
}

// 5. The client half names the host packages it must come after. A name that
//    the installation does not carry is a client that never starts, and the
//    failure is silent: the slot simply stays empty.
const manifest = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8'))
const injects = manifest.dsh?.client?.inject || []
if (injects.length === 0) {
  problems.push('the bundle names no host client packages, so its order is undefined')
} else {
  for (const name of injects) {
    if (!/^@deepseek-ai\//.test(name)) {
      problems.push(`the client inject names "${name}", which is not a Harness package`)
    }
  }
}

if (problems.length > 0) {
  for (const line of problems) console.error('GATE: ' + line)
  process.exit(1)
}
console.log(`active settings are read (${keys.length - retiredSettings.size} active, ${retiredSettings.size} legacy keys), the README claims nothing the code lacks, `
  + `the fold delay is bounded once per side, and ${injects.length} host client packages are named`)
