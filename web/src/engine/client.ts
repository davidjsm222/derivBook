// Page side of the engine. Three lanes: explore, book pricing (the Book tab)
// and exposure (the Exposure tab). Each has one request in flight at a time: if
// new inputs arrive while Python is computing, only the newest is kept and sent
// next. Results are routed back to the lane that asked, by request id.

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Progress } from './boot.ts'
import type { FromWorker, ToWorker } from './protocol.ts'
import type { BookArgs, BookReport, ExploreArgs, ExploreResult } from './types.ts'

export type EngineStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: Progress | null }
  | { state: 'ready'; pyodide: string; packages: string[]; bootMs: number }
  | { state: 'error'; message: string }

export type BookStatus =
  | { state: 'idle' }
  | { state: 'loading'; progress: Progress | null }
  | { state: 'ready'; packages: string[]; bytes: number; ms: number }
  | { state: 'error'; message: string }

export interface Outcome<A, R> {
  args: A
  result: R
  ms: number
}

type Listener<A, R> = (r: Outcome<A, R> | { error: string; args: A }) => void

interface LaneSnapshot<A, R> {
  last: Outcome<A, R> | null
  error: { message: string; key: string } | null
}

class Lane<A, R> {
  inFlight: { id: number; args: A } | null = null
  pending: A | null = null
  listeners = new Set<Listener<A, R>>()
  // The last result and error, kept here so they outlive the page that asked
  snapshot: LaneSnapshot<A, R> = { last: null, error: null }
  // The newest inputs asked for, so a page that mounts again doesn't ask twice
  wantedKey: string | null = null
  private subs = new Set<() => void>()
  readonly kind: 'explore' | 'book'

  constructor(kind: 'explore' | 'book') {
    this.kind = kind
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  getSnapshot = () => this.snapshot

  emit(r: Outcome<A, R> | { error: string; args: A }) {
    this.snapshot =
      'error' in r
        ? { last: this.snapshot.last, error: { message: r.error, key: JSON.stringify(r.args) } }
        : { last: r, error: null }
    this.listeners.forEach((fn) => fn(r))
    this.subs.forEach((fn) => fn())
  }
}

class EngineClient {
  private worker: Worker | null = null
  private status: EngineStatus = { state: 'idle' }
  private bookStatus: BookStatus = { state: 'idle' }
  private listeners = new Set<() => void>()
  private nextId = 1
  readonly explore = new Lane<ExploreArgs, ExploreResult>('explore')
  readonly priceLane = new Lane<BookArgs, BookReport>('book')
  readonly exposureLane = new Lane<BookArgs, BookReport>('book')
  private readonly bookLanes = [this.priceLane, this.exposureLane]

  start = () => {
    if (this.worker) return
    this.set({ status: { state: 'loading', progress: null } })
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data)
    this.worker.onerror = (e) => this.set({ status: { state: 'error', message: e.message || 'The engine worker failed to start.' } })
  }

  getStatus = () => this.status
  getBookStatus = () => this.bookStatus

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  requestExplore(args: ExploreArgs) {
    this.explore.pending = args
    this.flush()
  }

  requestBook(lane: Lane<BookArgs, BookReport>, args: BookArgs) {
    this.start()
    lane.pending = args
    if (this.bookStatus.state === 'idle') this.set({ book: { state: 'loading', progress: null } })
    this.flush()
  }

  private send<A, R>(lane: Lane<A, R>, type: 'explore' | 'book') {
    const args = lane.pending as A
    lane.pending = null
    const id = this.nextId++
    lane.inFlight = { id, args }
    this.worker!.postMessage({ type, id, args } as ToWorker)
  }

  private flush() {
    if (!this.worker) return
    // Explore waits for the engine; book requests queue in the worker behind the boot
    if (this.status.state === 'ready' && !this.explore.inFlight && this.explore.pending) this.send(this.explore, 'explore')
    if (this.status.state !== 'error') {
      for (const lane of this.bookLanes) if (!lane.inFlight && lane.pending) this.send(lane, 'book')
    }
  }

  private set(next: { status?: EngineStatus; book?: BookStatus }) {
    if (next.status) this.status = next.status
    if (next.book) this.bookStatus = next.book
    this.listeners.forEach((fn) => fn())
  }

  private fail<A, R>(lane: Lane<A, R>, message: string) {
    const args = lane.inFlight?.args
    lane.inFlight = null
    if (args) lane.emit({ error: message, args })
  }

  private bookLaneFor(id: number | null) {
    return this.bookLanes.find((l) => l.inFlight?.id === id) ?? null
  }

  private onMessage(msg: FromWorker) {
    switch (msg.type) {
      case 'progress':
        this.set({ status: { state: 'loading', progress: msg.progress } })
        break
      case 'ready':
        this.set({ status: { state: 'ready', pyodide: msg.pyodide, packages: msg.packages, bootMs: msg.bootMs } })
        this.flush()
        break
      case 'bookProgress':
        this.set({ book: { state: 'loading', progress: msg.progress } })
        break
      case 'bookReady':
        if (this.bookStatus.state !== 'ready') this.set({ book: { state: 'ready', packages: msg.packages, bytes: msg.bytes, ms: msg.ms } })
        break
      case 'result':
        this.explore.inFlight = null
        this.explore.emit({ args: msg.args, result: msg.result, ms: msg.ms })
        this.flush()
        break
      case 'bookResult': {
        const lane = this.bookLaneFor(msg.id)
        if (lane) {
          lane.inFlight = null
          lane.emit({ args: msg.args, result: msg.result, ms: msg.ms })
        }
        this.flush()
        break
      }
      case 'error': {
        if (msg.lane === 'boot') {
          this.set({ status: { state: 'error', message: msg.message } })
          break
        }
        if (msg.lane === 'bookLoad') this.set({ book: { state: 'error', message: msg.message } })
        if (msg.lane === 'explore') this.fail(this.explore, msg.message)
        else {
          const lane = this.bookLaneFor(msg.id)
          if (lane) this.fail(lane, msg.message)
        }
        this.flush()
        break
      }
    }
  }
}

export const engine = new EngineClient()

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus)
}

export function useBookStatus(): BookStatus {
  return useSyncExternalStore(engine.subscribe, engine.getBookStatus, engine.getBookStatus)
}

// The Explorer's hook: the newest result for these inputs, held by the page.
// While a new one computes, the previous result stays on screen; `current`
// says whether it matches the inputs.
function useLane<A, R>(lane: Lane<A, R>, request: (a: A) => void, args: A | null, canSend: boolean) {
  const [outcome, setOutcome] = useState<Outcome<A, R> | null>(null)
  const [error, setError] = useState<{ message: string; key: string } | null>(null)
  const key = args ? JSON.stringify(args) : null

  useEffect(() => {
    const fn: Listener<A, R> = (r) => {
      if ('error' in r) setError({ message: r.error, key: JSON.stringify(r.args) })
      else {
        setError(null)
        setOutcome(r)
      }
    }
    lane.listeners.add(fn)
    return () => {
      lane.listeners.delete(fn)
    }
  }, [lane])

  useEffect(() => {
    if (canSend && args) request(args)
    // key captures every field of args
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, canSend])

  const current = Boolean(outcome && key && JSON.stringify(outcome.args) === key)
  return { outcome, current, error: error && error.key === key ? error.message : null }
}

export function useExplore(args: ExploreArgs | null) {
  const status = useEngineStatus()
  const lane = useLane(engine.explore, (a) => engine.requestExplore(a), args, status.state === 'ready')
  return { ...lane, status }
}

// The book lanes' hook: the last result lives in the lane, so it's on screen as
// soon as a page mounts again, and Python is only asked again when the inputs
// differ from the newest ones already asked for. null inputs ask for nothing.
function useStoredBookLane(lane: Lane<BookArgs, BookReport>, args: BookArgs | null) {
  const status = useEngineStatus()
  const bookStatus = useBookStatus()
  const snap = useSyncExternalStore(lane.subscribe, lane.getSnapshot, lane.getSnapshot)
  const key = args ? JSON.stringify(args) : null

  useEffect(() => {
    if (!args || key === lane.wantedKey) return
    lane.wantedKey = key
    engine.requestBook(lane, args)
    // key captures every field of args
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const current = Boolean(snap.last && key && JSON.stringify(snap.last.args) === key)
  return { outcome: snap.last, current, error: snap.error && snap.error.key === key ? snap.error.message : null, status, bookStatus }
}

// The Book tab: prices the live positions (no scenarios)
export const useBookPricing = (args: BookArgs | null) => useStoredBookLane(engine.priceLane, args)

// The Exposure tab: runs the set book through the scenarios that are on
export const useExposureReport = (args: BookArgs | null) => useStoredBookLane(engine.exposureLane, args)
