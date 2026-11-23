// The Explorer's setup: the form draft, its checks, and the instrument view the
// chart and tiles draw from. Validation and unit conversion only; prices come
// from Python.

import type { ExploreArgs, InstrumentKind, SetupMarket, Spec } from '../engine/types.ts'
import { SOFR_EXPIRY, needs, parseNum, specDesc, specTitle, typeById, type TypeId } from '../content/instruments.ts'

export interface Draft {
  und: string
  K: string
  exp: string
  face: string
  ratio: string
  S0: string
  vol: string
  q: string
  r: string
  cs: string
}
export type DraftKey = keyof Draft

export const blankDraft = (): Draft => ({ und: '', K: '', exp: '', face: '', ratio: '', S0: '', vol: '', q: '', r: '', cs: '' })

// The setup a visitor explored, in the units they typed (vol and rates in percent, credit in bp)
export interface Setup {
  id: number
  type: TypeId
  und: string
  K?: number
  exp: number
  face?: number
  ratio?: number
  S0: number
  vol: number
  q: number
  r: number
  cs: number
}

export const examples: { type: TypeId; name: string; sub: string; draft: Draft }[] = [
  {
    type: 'ecall', name: 'At-the-money call', sub: 'Index at 6,000, six months to expiry',
    draft: { und: 'SPX', K: '6000', exp: '0.5', face: '', ratio: '', S0: '6000', vol: '18', q: '1.3', r: '4', cs: '' },
  },
  {
    type: 'aput', name: 'American put', sub: 'Strike 5,800, one year to expiry',
    draft: { und: 'SPX', K: '5800', exp: '1', face: '', ratio: '', S0: '6000', vol: '20', q: '1.3', r: '4', cs: '' },
  },
  {
    type: 'cb', name: 'Convertible bond', sub: 'Five years, converts into 20 shares',
    draft: { und: 'XYZ', K: '', exp: '5', face: '1000', ratio: '20', S0: '42', vol: '35', q: '0', r: '4', cs: '250' },
  },
]

// Checks the form. Returns the problems by field, and the parsed numbers.
export function check(type: TypeId, d: Draft) {
  const need = needs(type)
  const errors: Partial<Record<DraftKey, string>> = {}
  const v: { und?: string } & Partial<Record<Exclude<DraftKey, 'und'>, number>> = {}
  if (need.und) {
    const t = d.und.trim()
    if (!t) errors.und = 'Give the underlying a name'
    else v.und = t.slice(0, 12)
  }
  const rule = (key: Exclude<DraftKey, 'und'>, blank: number | undefined, ok: (x: number) => boolean, msg: string) => {
    if (key !== 'r' && !need[key]) return
    const x = parseNum(d[key], blank)
    if (x === undefined) {
      errors[key] = 'Required'
      return
    }
    if (Number.isNaN(x) || !ok(x)) {
      errors[key] = msg
      return
    }
    v[key] = x
  }
  const pos = (x: number) => x > 0
  rule('K', undefined, pos, 'Must be above zero')
  rule('exp', undefined, (x) => x > 0 && x <= 50, 'Between 0 and 50 years')
  rule('face', undefined, pos, 'Must be above zero')
  rule('ratio', undefined, pos, 'Must be above zero')
  rule('S0', undefined, pos, 'Must be above zero')
  rule('vol', undefined, (x) => x >= 1 && x <= 300, 'Between 1% and 300%')
  rule('q', 0, (x) => x >= 0 && x <= 50, 'Between 0% and 50%')
  rule('r', undefined, (x) => x >= 0 && x <= 30, 'Between 0% and 30%')
  rule('cs', 0, (x) => x >= 0 && x <= 5000, 'Between 0 and 5,000 bp')
  return { errors, v }
}

export function toSetup(type: TypeId, d: Draft, id: number): Setup {
  const { v } = check(type, d)
  return {
    id,
    type,
    und: type === 'sofr' ? 'SOFR' : (v.und ?? ''),
    K: v.K,
    exp: type === 'sofr' ? SOFR_EXPIRY : (v.exp as number),
    face: v.face,
    ratio: v.ratio,
    S0: v.S0 ?? 0,
    vol: v.vol ?? 20,
    q: v.q ?? 0,
    r: v.r as number,
    cs: v.cs ?? 0,
  }
}

// ---------------------------------------------------------------- the view

export interface ExplorerInst {
  id: number
  type: TypeId
  kind: InstrumentKind
  title: string
  description: string
  unit: string
  noun: string
  underlying: string
  applies: { spot: boolean; vol: boolean; time: boolean; rate: boolean; credit_spread: boolean }
  xKind: 'spot' | 'rate'
  spotRangePct: number
  expiry: number
  conversionRatio: number | null
  setup: { spot: number | null; volPts: number; rateBp: number; creditBp: number }
  volMax: number
  rateMax: number
  creditMax: number
  days: { max: number; step: number; leftAtMaxYears: number } | null
}

const KIND_APPLIES: Record<InstrumentKind, ExplorerInst['applies']> = {
  option: { spot: true, vol: true, time: true, rate: true, credit_spread: false },
  future: { spot: true, vol: false, time: true, rate: true, credit_spread: false },
  rates: { spot: false, vol: false, time: false, rate: true, credit_spread: false },
  convertible: { spot: true, vol: true, time: true, rate: true, credit_spread: true },
}

export function instView(s: Setup): ExplorerInst {
  const t = typeById(s.type)
  const rateBp = Math.round(s.r * 100)
  const creditBp = Math.round(s.cs)
  // Time slider: whole steps, stopping a day before expiry so greeks.py's one-day
  // theta bump never lands on or past it
  const step = s.exp > 2 ? 5 : 1
  const daysToExpiry = s.exp * 365
  const max = Math.max(0, step * Math.floor((daysToExpiry - 1) / step))
  const applies = KIND_APPLIES[t.kind]
  return {
    id: s.id,
    type: s.type,
    kind: t.kind,
    title: specTitle(s),
    description: specDesc(s),
    unit: t.unit,
    noun: t.noun,
    underlying: s.und,
    applies,
    xKind: t.kind === 'rates' ? 'rate' : 'spot',
    spotRangePct: s.type === 'cb' ? 50 : 30,
    expiry: s.exp,
    conversionRatio: s.ratio ?? null,
    setup: { spot: t.kind === 'rates' ? null : s.S0, volPts: s.vol, rateBp, creditBp },
    volMax: Math.max(80, Math.ceil((s.vol * 2) / 10) * 10),
    rateMax: Math.max(800, Math.ceil((rateBp * 2) / 100) * 100),
    creditMax: Math.max(1000, Math.ceil((creditBp * 2) / 100) * 100),
    days: applies.time && max > 0 ? { max, step, leftAtMaxYears: (daysToExpiry - max) / 365 } : null,
  }
}

// What the sliders hold, in slider units. Converted to decimals for Python.
export interface Settings {
  spotPct: number
  volPts: number
  days: number
  rateBp: number
  creditBp: number
}

export const setupSettings = (inst: ExplorerInst): Settings => ({
  spotPct: 0,
  volPts: inst.setup.volPts,
  days: 0,
  rateBp: inst.setup.rateBp,
  creditBp: inst.setup.creditBp,
})

export function toSpec(s: Setup): Spec {
  const t = typeById(s.type)
  const spec: Spec = { id: s.id, type: t.api }
  if (s.type !== 'sofr') {
    spec.underlying = s.und
    spec.expiry_years = s.exp
  }
  if (s.K !== undefined) spec.strike = s.K
  if (s.face !== undefined) spec.face = s.face
  if (s.ratio !== undefined) spec.conversion_ratio = s.ratio
  return spec
}

export function toBase(s: Setup): SetupMarket {
  const need = needs(s.type)
  const base: SetupMarket = { rate: s.r / 100 }
  if (need.S0) base.spot = s.S0
  if (need.vol) base.vol = s.vol / 100
  if (need.q) base.div_yield = s.q / 100
  if (need.cs) base.credit_spread = s.cs / 10000
  return base
}

// Slider units to the engine's units
export function toArgs(s: Setup, inst: ExplorerInst, st: Settings): ExploreArgs {
  const a = inst.applies
  return {
    spec: toSpec(s),
    base: toBase(s),
    now: {
      spot_pct: a.spot ? st.spotPct : undefined,
      vol: a.vol ? st.volPts / 100 : undefined,
      days_passed: a.time ? st.days : undefined,
      rate: st.rateBp / 10000,
      credit_spread: a.credit_spread ? st.creditBp / 10000 : undefined,
    },
  }
}
