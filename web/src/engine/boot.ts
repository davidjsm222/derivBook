// Starts Pyodide and imports the engine. Shared by the Web Worker (browser) and
// scripts/bench.ts (Node), so the bench measures exactly what visitors run.
// Plain erasable TypeScript only: Node runs this file directly.

import type { PyodideAPI } from 'pyodide'
import type { BookArgs, BookReport, ExploreArgs, ExploreResult } from './types.ts'

export interface Progress {
  step: number // 1-based, of `steps`
  steps: number
  label: string
  bytes: number // downloaded so far in this load
  done: boolean
}

export interface Engine {
  pyodideVersion: string
  packages: () => string[]
  explore(args: ExploreArgs): ExploreResult
  // Loads the book files and their packages (pandas) the first time; later calls return at once
  loadBook(onProgress?: (p: Progress) => void): Promise<{ packages: string[]; bytes: number }>
  book(args: BookArgs): BookReport
}

export interface BootOptions {
  loadPyodide: () => Promise<PyodideAPI>
  files: string[]
  bookFiles: string[]
  entry: string
  readFile: (name: string) => Promise<string>
  onProgress?: (p: Progress) => void
}

const ENGINE_DIR = '/home/pyodide/engine'

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Count bytes as they arrive on every fetch made while loading. Pyodide fetches
// its wasm, standard library and package wheels, so this is the real download.
function countDownloads(onBytes: (n: number) => void): () => void {
  const original = globalThis.fetch
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const res = await original(input, init)
    if (!res.body) return res
    try {
      const counted = res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, ctrl) {
            onBytes(chunk.byteLength)
            ctrl.enqueue(chunk)
          },
        }),
      )
      return new Response(counted, { status: res.status, statusText: res.statusText, headers: res.headers })
    } catch {
      return res
    }
  }
  return () => {
    globalThis.fetch = original
  }
}

// A loading run with numbered steps and a byte counter
function tracker(steps: number, first: string, onProgress?: (p: Progress) => void) {
  let bytes = 0
  let last = 0
  let current: Omit<Progress, 'bytes'> = { step: 1, steps, label: first, done: false }
  const emit = () => onProgress?.({ ...current, bytes })
  const restore = countDownloads((n) => {
    bytes += n
    if (bytes - last > 262144) {
      last = bytes
      emit()
    }
  })
  return {
    emit,
    step(n: number, label: string) {
      current = { step: n, steps, label, done: false }
      emit()
    },
    done() {
      current = { step: steps, steps, label: 'Ready', done: true }
      emit()
    },
    bytes: () => bytes,
    restore,
  }
}

type PyProxyLike = { destroy(): void }
type PyCallable = (...args: unknown[]) => PyProxyLike

// Both directions go through JSON, so Python gets real dicts and lists, and JS
// gets plain objects with no NaN
function makeCall(py: PyodideAPI) {
  const json = py.pyimport('json')
  const loads = json.loads
  const dumps = json.dumps
  return (fn: PyCallable, ...args: unknown[]): unknown => {
    const pyArgs: PyProxyLike[] = args.map((a) => loads(JSON.stringify(a ?? null)))
    try {
      const out = fn(...pyArgs)
      try {
        return JSON.parse(dumps.callKwargs(out, { allow_nan: false }))
      } finally {
        out.destroy()
      }
    } finally {
      pyArgs.forEach((a) => a.destroy())
    }
  }
}

// Turn a Python exception into a short message: its last line, which names the error
function pythonError(err: unknown): Error {
  const text = err instanceof Error ? err.message : String(err)
  const lines = text.trim().split('\n').filter(Boolean)
  return new Error(lines[lines.length - 1] ?? text)
}

export async function bootEngine(opts: BootOptions): Promise<Engine> {
  const t = tracker(4, 'Downloading the Python runtime', opts.onProgress)
  let py: PyodideAPI
  let exploreFn: PyCallable
  let bookFn: PyCallable
  let call: (fn: PyCallable, ...args: unknown[]) => unknown
  try {
    t.emit()
    const [loaded, sources] = await Promise.all([
      opts.loadPyodide(),
      Promise.all(opts.files.map(async (f) => [f, await opts.readFile(f)] as const)),
    ])
    py = loaded

    // Packages come from the engine's own imports: whatever the .py files import
    // that Pyodide ships (numpy, and scipy while pricing.py imports it).
    const allSource = sources.map(([, text]) => text).join('\n')
    const found: string[] = py.pyodide_py.code.find_imports(allSource).toJs()
    const shipped = new Set(Object.values(py.lockfile.packages).flatMap((p) => p.imports))
    const packages = found.filter((name) => shipped.has(name))
    t.step(2, packages.length ? `Loading ${joinNames(packages)}` : 'Loading packages')
    await py.loadPackagesFromImports(allSource, { messageCallback: () => {} })

    t.step(3, 'Loading the engine files')
    py.FS.mkdirTree(ENGINE_DIR)
    for (const [name, text] of sources) py.FS.writeFile(`${ENGINE_DIR}/${name}`, text)

    t.step(4, 'Importing the engine')
    py.runPython(`import sys\nif ${JSON.stringify(ENGINE_DIR)} not in sys.path: sys.path.insert(0, ${JSON.stringify(ENGINE_DIR)})`)
    const api = py.pyimport(opts.entry)
    exploreFn = api.explore
    bookFn = api.book_report
    call = makeCall(py)
    t.done()
  } finally {
    t.restore()
  }

  let bookLoad: Promise<{ packages: string[]; bytes: number }> | null = null

  return {
    pyodideVersion: py.version,
    packages: () => Object.keys(py.loadedPackages).sort(),
    explore: (args: ExploreArgs) => {
      try {
        return call(exploreFn, args.spec, args.base, args.now) as ExploreResult
      } catch (err) {
        throw pythonError(err)
      }
    },
    loadBook: (onProgress) => {
      bookLoad ??= (async () => {
        const before = new Set(Object.keys(py.loadedPackages))
        const bt = tracker(2, 'Loading the book engine', onProgress)
        try {
          bt.emit()
          const sources = await Promise.all(opts.bookFiles.map(async (f) => [f, await opts.readFile(f)] as const))
          const src = sources.map(([, text]) => text).join('\n')
          const found: string[] = py.pyodide_py.code.find_imports(src).toJs()
          const shipped = new Set(Object.values(py.lockfile.packages).flatMap((p) => p.imports))
          const missing = found.filter((name) => shipped.has(name) && !before.has(name))
          if (missing.length) bt.step(1, `Loading ${joinNames(missing)}`)
          await py.loadPackagesFromImports(src, { messageCallback: () => {} })
          for (const [name, text] of sources) py.FS.writeFile(`${ENGINE_DIR}/${name}`, text)
          bt.step(2, 'Importing the book engine')
          py.pyimport(opts.bookFiles[0].replace(/\.py$/, ''))
          bt.done()
          return { packages: Object.keys(py.loadedPackages).filter((p) => !before.has(p)).sort(), bytes: bt.bytes() }
        } finally {
          bt.restore()
        }
      })()
      return bookLoad
    },
    book: (args: BookArgs) => {
      try {
        return call(bookFn, args.market, args.positions, args.scenarios) as BookReport
      } catch (err) {
        throw pythonError(err)
      }
    },
  }
}
