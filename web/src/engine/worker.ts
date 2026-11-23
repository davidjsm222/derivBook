/// <reference lib="webworker" />
// Runs the Python engine off the main thread. Loads one pinned Pyodide from the
// jsDelivr CDN and the engine files from /engine/ (copied from scripts/ at build
// time). The book files and pandas load the first time a book is asked for.
// Jobs run one at a time, in the order they arrive.

import manifest from './manifest.json'
import { bootEngine, type Engine } from './boot.ts'
import type { FromWorker, ToWorker } from './protocol.ts'

declare const self: DedicatedWorkerGlobalScope

const CDN = `https://cdn.jsdelivr.net/pyodide/v${manifest.pyodide}/full/`
const ENGINE_URL = new URL(`${import.meta.env.BASE_URL}engine/`, self.location.origin)

const post = (m: FromWorker) => self.postMessage(m)
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function start(): Promise<Engine> {
  const t0 = performance.now()
  const { loadPyodide } = (await import(/* @vite-ignore */ `${CDN}pyodide.mjs`)) as typeof import('pyodide')
  const engine = await bootEngine({
    loadPyodide: () => loadPyodide({ indexURL: CDN }),
    files: manifest.files,
    bookFiles: manifest.bookFiles,
    entry: manifest.entry,
    readFile: async (name) => {
      const res = await fetch(new URL(name, ENGINE_URL))
      if (!res.ok) throw new Error(`couldn't load engine file ${name} (${res.status})`)
      return res.text()
    },
    onProgress: (progress) => post({ type: 'progress', progress }),
  })
  post({ type: 'ready', pyodide: engine.pyodideVersion, packages: engine.packages(), bootMs: performance.now() - t0 })
  return engine
}

const ready = start()
ready.catch((err) => post({ type: 'error', lane: 'boot', id: null, message: message(err) }))

let queue: Promise<unknown> = Promise.resolve()
const run = (job: () => Promise<void>) => {
  queue = queue.then(job, job)
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  run(async () => {
    let engine: Engine
    try {
      engine = await ready
    } catch {
      return // the boot error was already posted
    }
    if (msg.type === 'explore') {
      const t0 = performance.now()
      try {
        const result = engine.explore(msg.args)
        post({ type: 'result', id: msg.id, args: msg.args, result, ms: performance.now() - t0 })
      } catch (err) {
        post({ type: 'error', lane: 'explore', id: msg.id, message: message(err) })
      }
      return
    }
    try {
      const t0 = performance.now()
      const loaded = await engine.loadBook((progress) => post({ type: 'bookProgress', progress }))
      post({ type: 'bookReady', packages: loaded.packages, bytes: loaded.bytes, ms: performance.now() - t0 })
    } catch (err) {
      post({ type: 'error', lane: 'bookLoad', id: msg.id, message: message(err) })
      return
    }
    const t0 = performance.now()
    try {
      const result = engine.book(msg.args)
      post({ type: 'bookResult', id: msg.id, args: msg.args, result, ms: performance.now() - t0 })
    } catch (err) {
      post({ type: 'error', lane: 'book', id: msg.id, message: message(err) })
    }
  })
}
