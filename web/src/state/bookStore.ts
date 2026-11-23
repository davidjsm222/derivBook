// Shared app state for the Book and Exposure tabs: the live book the Book tab
// edits, the snapshot the visitor set for the Exposure tab, and the Exposure
// tab's scenario choices. Kept outside React so it survives switching tabs.
// The book, the snapshot and the scenarios (custom ones and which are off) are
// saved in localStorage, as the book already was; view choices (units, the
// selected cell and combo) live for the visit.

import { useSyncExternalStore } from 'react'
import { loadJSON, saveJSON } from '../lib/storage.ts'
import {
  EXAMPLE_NEXT_ID,
  blankLive,
  exampleCustom,
  exampleLive,
  validLive,
  validSetBook,
  type Custom,
  type LiveBook,
  type SetBook,
} from '../book/model.ts'
import type { Sel, Units } from '../exposure/BookMap.tsx'

export interface Choices {
  off: Record<string, boolean>
  custom: Custom[]
  units: Units
  sel: Sel
  combo: string | null
  comboPos: string
}

export interface AppBookState {
  live: LiveBook
  nextId: number // one counter for underlying, position and scenario ids
  setBook: SetBook | null
  choices: Choices
}

const KEY = 'derivbook.book.v2'
const OLD_KEY = 'derivbook.book.v1' // before the Exposure tab: book and scenarios in one object

const blankChoices = (): Choices => ({ off: {}, custom: [], units: 'value', sel: null, combo: null, comboPos: 'book' })

interface Saved {
  live: LiveBook
  nextId: number
  setBook: SetBook | null
  off: Record<string, boolean>
  custom: Custom[]
}

function validSaved(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const s = x as Partial<Saved>
  return (
    validLive(s.live) &&
    typeof s.nextId === 'number' &&
    validSetBook(s.setBook ?? null) &&
    typeof s.off === 'object' &&
    s.off !== null &&
    Array.isArray(s.custom)
  )
}

function load(): AppBookState {
  const saved = loadJSON<Saved | null>(KEY, null, validSaved)
  if (saved) {
    return { live: saved.live, nextId: saved.nextId, setBook: saved.setBook ?? null, choices: { ...blankChoices(), off: saved.off, custom: saved.custom } }
  }
  // Carry a book saved before the split across
  const old = loadJSON<(LiveBook & { off: Record<string, boolean>; custom: Custom[]; nextId: number }) | null>(
    OLD_KEY,
    null,
    (x) => validLive(x) && typeof (x as { nextId?: unknown }).nextId === 'number',
  )
  if (old) {
    return {
      live: { rate: old.rate, unds: old.unds, positions: old.positions },
      nextId: old.nextId,
      setBook: null,
      choices: { ...blankChoices(), off: old.off ?? {}, custom: Array.isArray(old.custom) ? old.custom : [] },
    }
  }
  return { live: blankLive(), nextId: 1, setBook: null, choices: blankChoices() }
}

let state: AppBookState = load()
const subs = new Set<() => void>()

function commit(next: AppBookState) {
  state = next
  const saved: Saved = { live: state.live, nextId: state.nextId, setBook: state.setBook, off: state.choices.off, custom: state.choices.custom }
  saveJSON(KEY, saved)
  subs.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export function useBookStore(): AppBookState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export const bookStore = {
  get: () => state,

  // The Book tab: the market and positions
  updateLive(next: Partial<LiveBook> & { nextId?: number }) {
    const { nextId, ...live } = next
    commit({ ...state, live: { ...state.live, ...live }, nextId: nextId ?? state.nextId })
  },

  clearLive() {
    commit({ ...state, live: blankLive() })
  },

  // Fills the Book tab only; the visitor still sets the book. The example's
  // custom scenario joins the Exposure tab's scenarios if it isn't there yet.
  loadExample() {
    const custom = state.choices.custom.some((c) => c.id === exampleCustom()[0].id) ? state.choices.custom : [...state.choices.custom, ...exampleCustom()]
    commit({
      ...state,
      live: exampleLive(),
      nextId: Math.max(state.nextId, EXAMPLE_NEXT_ID),
      choices: { ...state.choices, custom },
    })
  },

  // A deep copy, so later edits to the live book can't reach it
  setTheBook() {
    const copy = JSON.parse(JSON.stringify(state.live)) as LiveBook
    const setAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    commit({ ...state, setBook: { rate: copy.rate, underlyings: copy.unds, positions: copy.positions, setAt } })
  },

  // The Exposure tab: scenarios and view choices
  updateChoices(next: Partial<Choices> & { nextId?: number }) {
    const { nextId, ...choices } = next
    commit({ ...state, choices: { ...state.choices, ...choices }, nextId: nextId ?? state.nextId })
  },
}
