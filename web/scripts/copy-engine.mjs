// Copies the engine's .py files the browser needs from ../scripts into
// public/engine before dev, build and bench. public/engine is gitignored, so
// scripts/ stays the only copy. The lists live in src/engine/manifest.json:
// "files" load with the engine; "bookFiles" (shock.py, which imports pandas)
// load the first time the Book page needs Python. export.py stays local.

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(web, '..', 'scripts')
const out = join(web, 'public', 'engine')
const { files, bookFiles } = JSON.parse(readFileSync(join(web, 'src', 'engine', 'manifest.json'), 'utf8'))
const all = [...files, ...bookFiles]

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const f of all) copyFileSync(join(src, f), join(out, f))
console.log(`engine: copied ${all.length} files from scripts/ to public/engine/`)
