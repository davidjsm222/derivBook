// The Book page's state, its checks, the scenario presets, and the request
// sent to api.book_report. Validation, labels and unit conversion only: every
// price and change comes from Python.

import type { BookArgs, EngineMove } from '../engine/types.ts'
import { SOFR_EXPIRY, expiryWords, fmtK, needs, parseNum, typeById, type TypeId } from '../content/instruments.ts'
import { num } from '../lib/format.ts'

export interface Und {
  id: string
  name: string
  spot: string
  vol: string
  q: string
  cs: string
  touched: boolean
}

export interface Pos {
  id: string
  type: TypeId
  und: string
  K?: number
  exp: number
  face?: number
  ratio?: number
  qty: string
  mult: string
}

export type Target = 'spot' | 'vol' | 'q' | 'cs' | 'rate' | 'time'

export interface UiMove {
  target: Target
  und: string
  amount: number
}

export interface Custom {
  id: string
  name: string
  moves: UiMove[]
}

// What the cards and the map read: a book (live on the Book tab, the set one on
// the Exposure tab) plus the Exposure tab's scenario choices
export interface BookState {
  rate: string
  unds: Und[]
  positions: Pos[]
  off: Record<string, boolean>
  custom: Custom[]
  nextId: number
}

// The live book the Book tab edits, and the snapshot the Exposure tab runs
export interface LiveBook {
  rate: string
  unds: Und[]
  positions: Pos[]
}

export interface SetBook {
  rate: string
  underlyings: Und[]
  positions: Pos[]
  setAt: string // local time, e.g. "6:47 PM"
}

export const blankLive = (): LiveBook => ({ rate: '', unds: [], positions: [] })

// The example book from design/v6/Book6.dc.html. Its market and positions fill
// the Book tab; its custom scenario goes to the Exposure tab's scenarios.
export const exampleLive = (): LiveBook => ({
  rate: '4.00',
  unds: [
    { id: 'u1', name: 'SPX', spot: '6000', vol: '18', q: '1.3', cs: '', touched: true },
    { id: 'u2', name: 'XYZ', spot: '42', vol: '35', q: '0', cs: '250', touched: true },
  ],
  positions: [
    { id: 'p1', type: 'ecall', und: 'u1', K: 6000, exp: 0.5, qty: '10', mult: '100' },
    { id: 'p2', type: 'eput', und: 'u1', K: 5700, exp: 0.25, qty: '20', mult: '100' },
    { id: 'p3', type: 'aput', und: 'u1', K: 5800, exp: 1, qty: '-5', mult: '100' },
    { id: 'p4', type: 'fut', und: 'u1', exp: 0.5, qty: '-4', mult: '50' },
    { id: 'p5', type: 'sofr', und: '', exp: 0.25, qty: '-10', mult: '2500' },
    { id: 'p6', type: 'cb', und: 'u2', exp: 5, face: 1000, ratio: 20, qty: '50', mult: '' },
  ],
})
export const EXAMPLE_NEXT_ID = 10
export const exampleCustom = (): Custom[] => [
  {
    id: 'example:hawkish',
    name: 'Hawkish surprise',
    moves: [
      { target: 'rate', und: '', amount: 50 },
      { target: 'spot', und: 'u1', amount: -5 },
    ],
  },
]

// Field by field, by value: "4" and "4.00" are the same rate, and the touched
// flag (a display detail) doesn't count
function normNum(t: string | undefined): string {
  const v = parseNum(t)
  return v === undefined ? '' : Number.isNaN(v) ? `text:${String(t).trim()}` : String(v)
}
function canonical(rate: string, unds: Und[], positions: Pos[]): string {
  return JSON.stringify([
    normNum(rate),
    unds.map((u) => [u.id, u.name.trim(), normNum(u.spot), normNum(u.vol), normNum(u.q), normNum(u.cs)]),
    positions.map((p) => [p.id, p.type, p.und, p.K ?? null, p.exp, p.face ?? null, p.ratio ?? null, normNum(p.qty), normNum(p.mult)]),
  ])
}
export function sameBook(live: LiveBook, set: SetBook): boolean {
  return canonical(live.rate, live.unds, live.positions) === canonical(set.rate, set.underlyings, set.positions)
}

// ---------------------------------------------------------------- market

export interface UndValues {
  S: number
  vol: number // decimals from here on
  q: number
  cs: number
}

export interface MarketRead {
  r: number | null
  rateErr: string
  U: Record<string, UndValues>
  errs: Record<string, Partial<Record<'name' | 'spot' | 'vol' | 'q' | 'cs', string>>>
}

export function readMarket(st: BookState): MarketRead {
  const errs: MarketRead['errs'] = {}
  const U: MarketRead['U'] = {}
  const seen = new Set<string>()
  const r = parseNum(st.rate)
  const rateErr = r === undefined ? 'Required' : Number.isNaN(r) || r < 0 || r > 30 ? 'Between 0% and 30%' : ''
  for (const u of st.unds) {
    const e: MarketRead['errs'][string] = {}
    const name = u.name.trim()
    const key = name.toUpperCase()
    if (!name) e.name = 'Required'
    else if (seen.has(key)) e.name = 'Already used'
    seen.add(key)
    const S = parseNum(u.spot)
    if (S === undefined) e.spot = 'Required'
    else if (Number.isNaN(S) || S <= 0) e.spot = 'Above zero'
    const v = parseNum(u.vol)
    if (v === undefined) e.vol = 'Required'
    else if (Number.isNaN(v) || v < 1 || v > 300) e.vol = '1 to 300'
    const q = parseNum(u.q, 0) as number
    if (Number.isNaN(q) || q < 0 || q > 50) e.q = '0 to 50'
    const cs = parseNum(u.cs, 0) as number
    if (Number.isNaN(cs) || cs < 0 || cs > 5000) e.cs = '0 to 5,000'
    errs[u.id] = e
    if (!Object.keys(e).length) U[u.id] = { S: S as number, vol: (v as number) / 100, q: q / 100, cs: cs / 10000 }
  }
  return { r: rateErr ? null : (r as number) / 100, rateErr, U, errs }
}

export function undName(st: BookState, id: string): string {
  const u = st.unds.find((x) => x.id === id)
  return u ? u.name.trim() || 'Unnamed' : ''
}

// ---------------------------------------------------------------- positions

export interface PosInfo {
  qty: number | undefined
  mult: number
  qtyErr: string
  multErr: string
  ok: boolean
  problem: string
}

export function posInfo(st: BookState, p: Pos, mk: MarketRead): PosInfo {
  const qty = parseNum(p.qty)
  const mult = parseNum(p.mult, 1) as number
  const qtyErr = qty === undefined ? 'Required' : Number.isNaN(qty) || qty === 0 ? 'Non-zero' : ''
  const multErr = Number.isNaN(mult) || mult <= 0 ? 'Above zero' : ''
  let problem = ''
  if (mk.r === null) problem = 'Set the interest rate first'
  else if (p.type !== 'sofr' && !mk.U[p.und]) problem = `Fix ${undName(st, p.und) || 'its underlying'}’s market inputs`
  else if (qtyErr || multErr) problem = 'Fix the quantity or multiplier'
  return { qty, mult, qtyErr, multErr, ok: !problem, problem }
}

export interface PosDraft {
  type: TypeId
  und: string
  K: string
  exp: string
  face: string
  ratio: string
  qty: string
  mult: string
}

export const blankPos = (type: TypeId, und: string): PosDraft => ({ type, und, K: '', exp: '', face: '', ratio: '', qty: '', mult: '' })

export function checkPos(d: PosDraft, mk: MarketRead) {
  const need = needs(d.type)
  const e: Partial<Record<keyof PosDraft, string>> = {}
  const v: Partial<Record<'K' | 'exp' | 'face' | 'ratio' | 'qty' | 'mult', number>> = {}
  if (d.type !== 'sofr' && !mk.U[d.und]) e.und = Object.keys(mk.U).length ? 'Pick an underlying' : 'Add an underlying in the market first'
  const rule = (key: 'K' | 'exp' | 'face' | 'ratio' | 'qty' | 'mult', blank: number | undefined, ok: (x: number) => boolean, msg: string) => {
    const x = parseNum(d[key], blank)
    if (x === undefined) {
      e[key] = 'Required'
      return
    }
    if (Number.isNaN(x) || !ok(x)) {
      e[key] = msg
      return
    }
    v[key] = x
  }
  const pos = (x: number) => x > 0
  if (need.K) rule('K', undefined, pos, 'Must be above zero')
  if (need.exp) rule('exp', undefined, (x) => x > 0 && x <= 50, 'Between 0 and 50 years')
  if (need.face) rule('face', undefined, pos, 'Must be above zero')
  if (need.ratio) rule('ratio', undefined, pos, 'Must be above zero')
  rule('qty', undefined, (x) => x !== 0, 'Can’t be zero')
  rule('mult', 1, pos, 'Must be above zero')
  return { e, v }
}

export function posTitle(st: BookState, p: Pick<Pos, 'type' | 'und' | 'K'>): string {
  const u = p.type === 'sofr' ? 'SOFR' : undName(st, p.und)
  const k = p.K !== undefined ? `${fmtK(p.K)} ` : ''
  const titles: Record<TypeId, string> = {
    ecall: `${u} ${k}call`,
    eput: `${u} ${k}put`,
    acall: `${u} ${k}American call`,
    aput: `${u} ${k}American put`,
    fut: `${u} future`,
    sofr: 'SOFR future',
    cb: `${u} convertible`,
  }
  return titles[p.type]
}

export function posTerms(p: Pos): string {
  if (p.type === 'sofr') return 'Three-month rate'
  if (p.type === 'cb') return `Face ${fmtK(p.face ?? 0)}, ${fmtK(p.ratio ?? 0)} shares, ${expiryWords(p.exp)}`
  return `${expiryWords(p.exp)} to expiry`
}

export function sizeText(info: PosInfo): string {
  const q = info.qty as number
  const m = info.mult
  return `${q > 0 ? 'Long ' : 'Short '}${num(Math.abs(q), Math.abs(q) % 1 ? 2 : 0)}${m !== 1 ? ` × ${num(m, m % 1 ? 2 : 0)}` : ''}`
}

// ---------------------------------------------------------------- moves

const amt = (a: number) => (a > 0 ? '+' : a < 0 ? '−' : '') + num(Math.abs(a), Math.abs(a) % 1 ? 1 : 0)

export function amountLabel(mv: UiMove): string {
  const a = mv.amount
  if (mv.target === 'spot') return `${amt(a)}%`
  if (mv.target === 'vol' || mv.target === 'q') return `${amt(a)} pts`
  if (mv.target === 'time') return `+${num(a, 0)}${a === 1 ? ' day' : ' days'}`
  return `${amt(a)} bp`
}

export function moveLabel(st: BookState, mv: UiMove): string {
  const u = undName(st, mv.und)
  const a = amountLabel(mv)
  if (mv.target === 'spot') return `${u} ${a}`
  if (mv.target === 'vol') return `${u} vol ${a}`
  if (mv.target === 'q') return `${u} dividend ${a}`
  if (mv.target === 'cs') return `${u} credit ${a}`
  if (mv.target === 'rate') return `Rates ${a}`
  return `${num(mv.amount, 0)}${mv.amount === 1 ? ' day passes' : ' days pass'}`
}

export function moveDesc(st: BookState, mv: UiMove): string {
  const u = undName(st, mv.und)
  const a = mv.amount
  const n = num(Math.abs(a), Math.abs(a) % 1 ? 1 : 0)
  if (mv.target === 'spot') return `${u}${a < 0 ? ' falls ' : ' rises '}${n}%`
  if (mv.target === 'vol') return `${u} volatility ${a < 0 ? 'drops ' : 'rises '}${n} points`
  if (mv.target === 'q') return `${u}’s dividend yield ${a < 0 ? 'drops ' : 'rises '}${n} points`
  if (mv.target === 'cs') return `${u}’s credit spread ${a < 0 ? 'tightens by ' : 'widens by '}${n} basis points`
  if (mv.target === 'rate') return `rates ${a < 0 ? 'fall ' : 'rise '}${n} basis points`
  return `${n}${a === 1 ? ' day passes' : ' days pass'}`
}

export const unitFor = (t: Target) => ({ spot: '%', vol: 'pts', q: 'pts', cs: 'bp', rate: 'bp', time: 'days' })[t]

// The UI's units to shock.py's Move vocabulary: spot % -> spots PCT; vol and
// dividend points -> ADD / 100; credit and rate bp -> ADD / 10,000; days -> time ADD / 365
export function toEngineMove(mv: UiMove): EngineMove {
  switch (mv.target) {
    case 'spot':
      return { field: 'spots', key: mv.und, amount: mv.amount / 100, kind: 'pct' }
    case 'vol':
      return { field: 'vols', key: mv.und, amount: mv.amount / 100, kind: 'add' }
    case 'q':
      return { field: 'div_yields', key: mv.und, amount: mv.amount / 100, kind: 'add' }
    case 'cs':
      return { field: 'credit_spreads', key: mv.und, amount: mv.amount / 10000, kind: 'add' }
    case 'rate':
      return { field: 'rate', key: null, amount: mv.amount / 10000, kind: 'add' }
    case 'time':
      return { field: 'time', key: null, amount: mv.amount / 365, kind: 'add' }
  }
}

// Why a set of moves can't run in this market, or '' if it can: a missing
// underlying, or a volatility, dividend yield or credit spread pushed below zero
export function movesProblem(moves: UiMove[], mk: MarketRead, present?: Set<string>): string {
  for (const mv of moves) {
    if (mv.target === 'rate' || mv.target === 'time') continue
    const u = mk.U[mv.und]
    if (!u && present && !present.has(mv.und)) return 'not in the set book'
    if (!u) return 'fix the market'
    if (mv.target === 'vol' && u.vol + mv.amount / 100 < 0) return 'volatility below zero'
    if (mv.target === 'q' && u.q + mv.amount / 100 < 0) return 'dividend yield below zero'
    if (mv.target === 'cs' && u.cs + mv.amount / 10000 < 0) return 'credit spread below zero'
  }
  return ''
}

// ---------------------------------------------------------------- scenarios

export interface ScenarioView {
  id: string
  group: 'single' | 'combo' | 'custom'
  name?: string
  moves: UiMove[]
  top: string
  bottom: string
  label: string
  multi: boolean
  on: boolean
  problem: string
}

export interface ValidRow {
  p: Pos
  info: PosInfo
}

// Presets follow the underlyings and instruments in the book; custom ones come after
export function scenarios(st: BookState, mk: MarketRead, valid: ValidRow[]): ScenarioView[] {
  const out: Omit<ScenarioView, 'bottom' | 'label' | 'multi' | 'on' | 'problem'>[] = []
  const used = st.unds.map((u) => u.id).filter((id) => mk.U[id] && valid.some((v) => v.p.und === id && v.p.type !== 'sofr'))
  const hasVol = (id: string) => valid.some((v) => v.p.und === id && v.p.type !== 'fut' && v.p.type !== 'sofr')
  const hasCb = (id: string) => valid.some((v) => v.p.und === id && v.p.type === 'cb')
  const single = (id: string, top: string, target: Target, und: string, a: number) =>
    out.push({ id, group: 'single', top, moves: [{ target, und, amount: a }] })
  for (const id of used) {
    const n = undName(st, id)
    single(`spot:${id}:-10`, `${n} spot`, 'spot', id, -10)
    single(`spot:${id}:10`, `${n} spot`, 'spot', id, 10)
    if (hasVol(id)) {
      single(`vol:${id}:-5`, `${n} volatility`, 'vol', id, -5)
      single(`vol:${id}:5`, `${n} volatility`, 'vol', id, 5)
    }
    if (hasCb(id)) {
      single(`cs:${id}:-100`, `${n} credit`, 'cs', id, -100)
      single(`cs:${id}:100`, `${n} credit`, 'cs', id, 100)
    }
  }
  if (valid.length) {
    single('rate:-25', 'Rates', 'rate', '', -25)
    single('rate:25', 'Rates', 'rate', '', 25)
    single('time:1', 'Time', 'time', '', 1)
  }
  if (used.length) {
    const mv: UiMove[] = []
    used.forEach((id) => mv.push({ target: 'spot', und: id, amount: -10 }))
    used.filter(hasVol).forEach((id) => mv.push({ target: 'vol', und: id, amount: 8 }))
    mv.push({ target: 'rate', und: '', amount: -25 })
    out.push({ id: 'combo:selloff', group: 'combo', name: 'Market selloff', top: 'Combined', moves: mv })
  }
  used.filter(hasCb).forEach((id) => {
    out.push({
      id: `combo:credit:${id}`,
      group: 'combo',
      name: `${undName(st, id)} credit stress`,
      top: 'Combined',
      moves: [
        { target: 'spot', und: id, amount: -20 },
        { target: 'vol', und: id, amount: 10 },
        { target: 'cs', und: id, amount: 200 },
      ],
    })
  })
  st.custom.forEach((c) => out.push({ id: c.id, group: 'custom', name: c.name, top: 'Yours', moves: c.moves }))

  return out.map((s) => {
    const problem = movesProblem(s.moves, mk, new Set(st.unds.map((u) => u.id)))
    const isSingle = s.group === 'single'
    return {
      ...s,
      bottom: isSingle ? amountLabel(s.moves[0]) : (s.name as string),
      label: isSingle ? moveLabel(st, s.moves[0]) : (s.name as string),
      multi: s.moves.length > 1,
      on: !st.off[s.id] && !problem,
      problem,
    }
  })
}

// ---------------------------------------------------------------- the request

export interface BookView {
  mk: MarketRead
  rows: { p: Pos; info: PosInfo }[]
  valid: ValidRow[]
  scen: ScenarioView[]
  cols: ScenarioView[]
  args: BookArgs | null
}

// withScenarios false: the request prices the positions and runs no scenarios
export function bookView(st: BookState, withScenarios = true): BookView {
  const mk = readMarket(st)
  const rows = st.positions.map((p) => ({ p, info: posInfo(st, p, mk) }))
  const valid = rows.filter((r) => r.info.ok)
  const scen = withScenarios && valid.length ? scenarios(st, mk, valid) : []
  const cols = scen.filter((s) => s.on)
  let args: BookArgs | null = null
  if (mk.r !== null && valid.length) {
    const usedUnds = st.unds.filter((u) => mk.U[u.id])
    args = {
      market: {
        rate: mk.r,
        underlyings: usedUnds.map((u) => ({
          id: u.id,
          name: u.name.trim(),
          spot: mk.U[u.id].S,
          vol: mk.U[u.id].vol,
          div_yield: mk.U[u.id].q,
          credit_spread: mk.U[u.id].cs,
        })),
      },
      positions: valid.map(({ p, info }) => {
        const t = typeById(p.type)
        return {
          id: p.id,
          spec: {
            type: t.api,
            underlying: p.type === 'sofr' ? '' : p.und,
            expiry_years: p.type === 'sofr' ? SOFR_EXPIRY : p.exp,
            ...(p.K !== undefined ? { strike: p.K } : {}),
            ...(p.face !== undefined ? { face: p.face } : {}),
            ...(p.ratio !== undefined ? { conversion_ratio: p.ratio } : {}),
          },
          quantity: info.qty as number,
          multiplier: info.mult,
        }
      }),
      scenarios: cols.map((s) => ({ id: s.id, moves: s.moves.map(toEngineMove) })),
    }
  }
  return { mk, rows, valid, scen, cols, args }
}

// Why the book can't be set yet, the first reason that applies, or '' if it can
export function setBookIssue(view: BookView, st: Pick<BookState, 'unds'>): 'noPositions' | 'rate' | 'fix' | '' {
  if (!view.rows.length) return 'noPositions'
  if (view.mk.rateErr) return 'rate'
  const badUnd = st.unds.some((u) => Object.keys(view.mk.errs[u.id] ?? {}).length > 0)
  if (badUnd || view.rows.some((r) => !r.info.ok)) return 'fix'
  return ''
}

// Saved state is only trusted if it still has the shape this page writes
export function validLive(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const b = x as Partial<LiveBook>
  return (
    typeof b.rate === 'string' &&
    Array.isArray(b.unds) &&
    Array.isArray(b.positions) &&
    b.unds.every((u) => u && typeof u.id === 'string' && typeof u.name === 'string') &&
    b.positions.every((p) => p && typeof p.id === 'string' && typeof p.type === 'string' && typeof p.exp === 'number')
  )
}

export function validSetBook(x: unknown): boolean {
  if (x === null) return true
  if (!x || typeof x !== 'object') return false
  const b = x as Partial<SetBook>
  return typeof b.setAt === 'string' && validLive({ rate: b.rate, unds: b.underlyings, positions: b.positions })
}
