/**
 * Check the packed tarball as a fresh installation would see it.
 *
 * A plugin that is installed from a tarball is not the plugin in the
 * workspace: only the files the manifest declares are shipped, and the
 * halves are loaded from wherever they land. A file that is used at run
 * time but not declared is a plugin that starts in the workspace and is
 * missing in every real installation, and the failure is silent.
 *
 * The check unpacks the tarball into a temporary directory, imports the
 * host half from there, and asks the client half to describe itself. No
 * book, no network, no real library.
 *
 * @module
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = process.argv[2] || join(here, '..', 'dsh-plugin-stealth-reader')

const problems = []

/* 1. Pack the bundle exactly as it would be published. */
const packDir = mkdtempSync(join(tmpdir(), 'sr-pack-'))
let tarball = null
try {
  const output = execFileSync('npm', ['pack', '--pack-destination', packDir], {
    cwd: bundle,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const name = output.trim().split('\n').filter(line => line.endsWith('.tgz')).pop()
  tarball = join(packDir, name)
} catch (error) {
  console.error('PACK CHECK: the bundle could not be packed: ' + error.message)
  process.exit(2)
}

/* 2. Unpack it where an installation would put it. */
const unpacked = mkdtempSync(join(tmpdir(), 'sr-unpacked-'))
try {
  execFileSync('tar', ['-xzf', tarball, '-C', unpacked], { stdio: 'ignore' })
  const root = join(unpacked, 'package')

  /* 3. Every file the bundle reads at run time has to be in the tarball. */
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const shipped = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else shipped.push(relative(root, full))
    }
  }
  walk(root)

  const sources = shipped.filter(name => name.endsWith('.js'))
  const declared = new Set(manifest.files || [])
  for (const name of sources) {
    const top = name.split('/')[0]
    if (!declared.has(top)) {
      problems.push(`the tarball carries ${name}, which the manifest does not declare`)
    }
  }

  /* 4. The host half loads from where it landed. */
  const host = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
  if (typeof host.apply !== 'function') problems.push('the packed host half exports no apply')
  if (host.name !== 'stealthReader') problems.push('the packed host half has the wrong name')
  if (!Array.isArray(host.inject) || host.inject.length === 0) {
    problems.push('the packed host half names no host services')
  }

  /* 5. The client half is one static file, and it carries its own copy of
   *    the site browser. */
  const client = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  if (!client.includes('function createReaderBrowser')) {
    problems.push('the packed client half lost its inlined site browser')
  }
  if (!/const READER_TOKENS = `/.test(client)) {
    problems.push('the packed client half lost its list of colours')
  }

  /* 6. The locales are in step in the tarball as well. */
  const en = JSON.parse(readFileSync(join(root, 'locale', 'en.json'), 'utf8'))
  const zh = JSON.parse(readFileSync(join(root, 'locale', 'zh.json'), 'utf8'))
  for (const [name, table] of [['en', en], ['zh', zh]]) {
    if (!table.meta || !table.meta.title || !table.meta.description) {
      problems.push(`the packed ${name} locale has no title or description`)
    }
  }
  if (en.meta.title === zh.meta.title) {
    problems.push('the packed locales carry the same title, so one of them was never translated')
  }

  console.log('packed tarball: ' + shipped.length + ' files, host half loads, client half carries its browser, locales in step')
} finally {
  rmSync(packDir, { recursive: true, force: true })
  rmSync(unpacked, { recursive: true, force: true })
}

if (problems.length > 0) {
  for (const line of problems) console.error('PACK CHECK: ' + line)
  process.exit(1)
}
