// Instrument types, their copy and their input rules, from design/v6
// (Explore6.dc.html and Book6.dc.html). Shared by the Explorer and the Book.

import type { InstrumentKind, InstrumentType } from '../engine/types.ts'
import { num } from '../lib/format.ts'

export type TypeId = 'ecall' | 'eput' | 'acall' | 'aput' | 'fut' | 'sofr' | 'cb'

export interface TypeInfo {
  id: TypeId
  api: InstrumentType
  kind: InstrumentKind
  name: string
  path: string // payoff glyph, viewBox 0 0 64 40
  note: string
  pricing: string
  unit: string
  noun: string
}

export const TYPES: TypeInfo[] = [
  {
    id: 'ecall', api: 'european_call', kind: 'option', name: 'European call', path: 'M6 32 L34 32 L58 8',
    note: 'The right to buy at the strike on the expiry date.', pricing: 'Black-Scholes, from pricing.py.',
    unit: 'per option', noun: 'option',
  },
  {
    id: 'eput', api: 'european_put', kind: 'option', name: 'European put', path: 'M6 8 L30 32 L58 32',
    note: 'The right to sell at the strike on the expiry date.', pricing: 'Black-Scholes, from pricing.py.',
    unit: 'per option', noun: 'option',
  },
  {
    id: 'acall', api: 'american_call', kind: 'option', name: 'American call', path: 'M6 32 L34 32 L58 8',
    note: 'The right to buy at the strike on any day until expiry.',
    pricing: 'Binomial tree from trees.py, checking at every step whether exercising beats holding.',
    unit: 'per option', noun: 'option',
  },
  {
    id: 'aput', api: 'american_put', kind: 'option', name: 'American put', path: 'M6 8 L30 32 L58 32',
    note: 'The right to sell at the strike on any day until expiry.',
    pricing: 'Binomial tree from trees.py, checking at every step whether exercising beats holding.',
    unit: 'per option', noun: 'option',
  },
  {
    id: 'fut', api: 'future', kind: 'future', name: 'Future', path: 'M6 32 L58 8',
    note: 'An agreement to buy at a fixed price on the expiry date. It costs nothing to enter.',
    pricing: 'Cost of carry, from pricing.py: spot grown at the rate minus the dividend yield.',
    unit: 'per contract', noun: 'contract',
  },
  {
    id: 'sofr', api: 'sofr_future', kind: 'rates', name: 'SOFR future', path: 'M6 10 Q32 16 58 30',
    note: 'A three-month interest rate future, quoted as 100 minus the rate.',
    pricing: '100 minus the three-month rate, from pricing.py.',
    unit: 'price points', noun: 'contract',
  },
  {
    id: 'cb', api: 'convertible', kind: 'convertible', name: 'Convertible bond', path: 'M6 26 L28 26 Q42 25 58 8',
    note: 'A bond the holder can swap for shares at any time.',
    pricing: 'Tsiveriotis-Fernandes tree from trees.py: the equity part is discounted at the rate, the debt part at the rate plus the credit spread.',
    unit: 'per bond', noun: 'bond',
  },
]

export const typeById = (id: TypeId) => TYPES.find((t) => t.id === id) ?? TYPES[0]
export const isOption = (id: TypeId) => id === 'ecall' || id === 'eput' || id === 'acall' || id === 'aput'

// Which inputs each type needs
export function needs(type: TypeId) {
  const opt = isOption(type)
  return {
    und: type !== 'sofr',
    K: opt,
    exp: type !== 'sofr',
    face: type === 'cb',
    ratio: type === 'cb',
    S0: type !== 'sofr',
    vol: type !== 'fut' && type !== 'sofr',
    q: type !== 'sofr',
    cs: type === 'cb',
  }
}

// Reads a text field as a number. Blank gives `blank` (undefined means required).
export function parseNum(txt: string | undefined | null, blank?: number): number | undefined {
  const t = String(txt ?? '').replace(/,/g, '').replace(/−/g, '-').trim()
  if (t === '') return blank
  const v = Number(t)
  return Number.isFinite(v) ? v : NaN
}

export const SOFR_EXPIRY = 0.25

// ---------------------------------------------------------------- wording

export function expiryWords(exp: number): string {
  const d = Math.round(exp * 365)
  const m = Math.round(exp * 12)
  if (d < 45) return `${d}${d === 1 ? ' day' : ' days'}`
  if (exp < 1) return `${m} months`
  const y = Math.abs(exp - Math.round(exp)) < 0.05 ? Math.round(exp) : Number(exp.toFixed(1))
  return `${y}${y === 1 ? ' year' : ' years'}`
}

export const fmtK = (x: number) => num(x, Math.abs(x - Math.round(x)) > 1e-9 ? 2 : 0)

export interface Terms {
  type: TypeId
  und: string
  K?: number
  exp: number
  face?: number
  ratio?: number
}

export function specTitle(s: Terms): string {
  const k = s.K !== undefined ? `${fmtK(s.K)} ` : ''
  const titles: Record<TypeId, string> = {
    ecall: `${s.und} ${k}call`,
    eput: `${s.und} ${k}put`,
    acall: `${s.und} ${k}American call`,
    aput: `${s.und} ${k}American put`,
    fut: `${s.und} future`,
    sofr: 'SOFR future',
    cb: `${s.und} convertible`,
  }
  return titles[s.type]
}

export function specDesc(s: Terms): string {
  const exp = expiryWords(s.exp)
  const k = s.K !== undefined ? fmtK(s.K) : ''
  switch (s.type) {
    case 'ecall':
    case 'eput':
      return `European ${s.type === 'ecall' ? 'call' : 'put'} on ${s.und}, strike ${k}, expiring in ${exp}. Priced with Black-Scholes.`
    case 'acall':
    case 'aput':
      return `American ${s.type === 'acall' ? 'call' : 'put'} on ${s.und}, strike ${k}, expiring in ${exp}. It can be exercised on any day, so it’s priced on a binomial tree.`
    case 'fut':
      return `Future on ${s.und}, expiring in ${exp}. Spot grown at the rate minus the dividend yield, so volatility has no effect.`
    case 'sofr':
      return 'Three-month SOFR future, quoted as 100 minus the rate. It depends only on the interest rate, so its chart runs along the rate.'
    case 'cb':
      return `${s.und} bond with face ${fmtK(s.face ?? 0)}, convertible into ${fmtK(s.ratio ?? 0)} shares at any time, maturing in ${exp}. Priced on a tree that discounts the debt part at the credit spread.`
  }
}

export function specTerms(s: Terms): string {
  const exp = expiryWords(s.exp)
  if (s.type === 'sofr') return 'Three-month rate'
  if (s.type === 'fut') return `${s.und}, ${exp}`
  if (s.type === 'cb') return `${s.und}, face ${fmtK(s.face ?? 0)}, ${fmtK(s.ratio ?? 0)} shares per bond, ${exp}`
  return `${s.und}, strike ${fmtK(s.K ?? 0)}, ${exp}`
}
