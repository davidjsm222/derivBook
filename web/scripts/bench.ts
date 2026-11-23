// npm run bench
// Loads Pyodide and the engine through the same bootEngine() the Web Worker uses,
// then times explore() per instrument type and slider, and book_report on the
// example book (first run and after a quantity edit). Node runs this TypeScript directly.
//
// Pyodide's packages are fetched from the jsDelivr CDN the first time and cached
// in node_modules/pyodide, so the first bench run's load times include downloads.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPyodide, version as npmPyodideVersion } from 'pyodide'
import { bootEngine } from '../src/engine/boot.ts'
import type { ExploreArgs, SliderState } from '../src/engine/types.ts'
import { blankDraft, examples, instView, toSpec, toBase, toSetup, type Draft } from '../src/explorer/setup.ts'
import type { TypeId } from '../src/content/instruments.ts'
import { EXAMPLE_NEXT_ID, bookView, exampleCustom, exampleLive, type BookState } from '../src/book/model.ts'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(web, 'src', 'engine', 'manifest.json'), 'utf8'))
const EXPLORE_LIMIT_MS = 150
const RUNS = 8

if (npmPyodideVersion !== manifest.pyodide) {
  console.error(`pyodide npm package is ${npmPyodideVersion}, manifest pins ${manifest.pyodide}`)
  process.exit(1)
}

const t0 = performance.now()
let lastLabel = ''
const engine = await bootEngine({
  loadPyodide: () => loadPyodide(),
  files: manifest.files,
  bookFiles: manifest.bookFiles,
  entry: manifest.entry,
  readFile: (name) => readFile(join(web, 'public', 'engine', name), 'utf8'),
  onProgress: (p) => {
    if (p.label !== lastLabel) {
      lastLabel = p.label
      console.log(`  [${p.step}/${p.steps}] ${p.label}  (${(performance.now() - t0).toFixed(0)} ms, ${(p.bytes / 1e6).toFixed(1)} MB fetched)`)
    }
  },
})
console.log(`\nPyodide ${engine.pyodideVersion}, packages: ${engine.packages().join(', ')}`)
console.log(`Cold load (runtime + packages + engine import): ${(performance.now() - t0).toFixed(0)} ms\n`)

const time = (fn: () => void) => {
  const t = performance.now()
  fn()
  return performance.now() - t
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// ---------------------------------------------------------------- Explorer

// One setup per type: the design's three examples, plus the other four types
const setups: { type: TypeId; draft: Draft }[] = [
  examples[0],
  { type: 'eput', draft: { ...examples[0].draft, K: '5700', exp: '0.25' } },
  { type: 'acall', draft: { ...examples[1].draft, K: '6200', q: '3' } },
  examples[1],
  { type: 'fut', draft: { ...examples[0].draft, K: '', vol: '' } },
  { type: 'sofr', draft: { ...blankDraft(), r: '4' } },
  examples[2],
]

type Slider = 'spot' | 'vol' | 'time' | 'rate' | 'credit'
const SLIDERS: Slider[] = ['spot', 'vol', 'time', 'rate', 'credit']

const rows: { type: string; first: number; moves: Partial<Record<Slider, number>> }[] = []
let id = 1
for (const s of setups) {
  const setup = toSetup(s.type, s.draft, id++)
  const inst = instView(setup)
  const spec = toSpec(setup)
  const base = toBase(setup)
  const call = (now: SliderState) => engine.explore({ spec, base, now } satisfies ExploreArgs)
  const first = time(() => call({}))
  const moves: Partial<Record<Slider, number>> = {}
  for (const slider of SLIDERS) {
    const applies =
      slider === 'spot' ? inst.applies.spot : slider === 'vol' ? inst.applies.vol : slider === 'time' ? Boolean(inst.days) : slider === 'rate' ? true : inst.applies.credit_spread
    if (!applies) continue
    const ts: number[] = []
    for (let i = 1; i <= RUNS; i++) {
      const now: SliderState =
        slider === 'spot' ? { spot_pct: i }
        : slider === 'vol' ? { vol: (inst.setup.volPts + i) / 100 }
        : slider === 'time' ? { days_passed: Math.min(i * (inst.days?.step ?? 1), inst.days?.max ?? 0) }
        : slider === 'rate' ? { rate: (inst.setup.rateBp + 5 * i) / 10000 }
        : { credit_spread: (inst.setup.creditBp + 5 * i) / 10000 }
      ts.push(time(() => call(now)))
    }
    moves[slider] = median(ts)
  }
  rows.push({ type: inst.title, first, moves })
}

const cell = (v: number | undefined, limit: number) => (v === undefined ? '       —    ' : `${v.toFixed(1).padStart(8)} ms${v > limit ? ' !' : '  '}`)
console.log('Explorer: explore() per slider move (median of', RUNS, 'calls each)')
console.log(`${'instrument'.padEnd(24)}${'first'.padStart(13)}${SLIDERS.map((s) => s.padStart(13)).join('')}`)
for (const r of rows) console.log(`${r.type.padEnd(24)}${cell(r.first, Infinity)}${SLIDERS.map((s) => cell(r.moves[s], EXPLORE_LIMIT_MS)).join('')}`)
console.log(`! = slider move over ${EXPLORE_LIMIT_MS} ms\n`)

// ---------------------------------------------------------------- Book

const BOOK_LIMIT_MS = 1500
const tb = performance.now()
const loaded = await engine.loadBook()
const bookLoadMs = performance.now() - tb
console.log(`Book: loading ${loaded.packages.join(', ')} took ${bookLoadMs.toFixed(0)} ms, ${(loaded.bytes / 1e6).toFixed(2)} MB fetched`)
console.log('  (0 MB means the wheels were already cached in node_modules/pyodide from an earlier run)')

// The example book as the Exposure tab runs it: its market and positions, and its custom scenario
const example: BookState = { ...exampleLive(), off: {}, custom: exampleCustom(), nextId: EXAMPLE_NEXT_ID }
const view = bookView(example)
if (!view.args) throw new Error('the example book should be complete')
const firstBook = time(() => engine.book(view.args!))

const edited = bookView({ ...example, positions: example.positions.map((p) => (p.id === 'p1' ? { ...p, qty: '12' } : p)) })
const editRuns: number[] = []
for (let i = 0; i < 5; i++) editRuns.push(time(() => engine.book(edited.args!)))

const flag = (v: number) => `${v.toFixed(0)} ms${v > BOOK_LIMIT_MS ? ' !' : ''}`
console.log(`book_report on the example book (${view.args.positions.length} positions, ${view.args.scenarios.length} scenarios, ${view.cols.filter((s) => s.multi).length} combined):`)
console.log(`  first run            ${flag(firstBook)}`)
console.log(`  after a quantity edit ${flag(median(editRuns))} (median of ${editRuns.length})`)
console.log(`! = over ${BOOK_LIMIT_MS} ms`)
