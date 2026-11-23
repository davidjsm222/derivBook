// Explorer copy, from design/v6/Explore6.dc.html. Sentences are written from
// numbers the engine returns; the functions here only choose words and format.

import type { ExploreResult } from '../engine/types.ts'
import type { ExplorerInst } from '../explorer/setup.ts'
import { fixed, g, sgn } from '../lib/format.ts'
import { fmtK } from './instruments.ts'

export const copy = {
  title: 'Explorer',
  intro: 'Set up one instrument and watch how its price and Greeks move as the market changes. It stands on its own and never touches your book.',
  instrument: 'Instrument',
  contractTerms: 'Contract terms',
  market: 'Market',
  explore: 'Explore',
  clear: 'Clear',
  formError: 'Fix the highlighted fields to explore.',
  examplesTitle: 'Start from an example',
  examplesNote: 'Fills the form with made-up market numbers, not live prices.',
  pricedTitle: 'How it’s priced',
  liveTitle: 'Live market data',
  liveNote: 'Fill spot, volatility and the rate from the market in one click.',
  soon: 'Soon',
  editSetup: 'Edit setup',
  newInstrument: 'New instrument',
  hoverHint: 'Hover the chart to read any point',
  loading: 'Loading the Python engine (first visit only)',
  pricing: 'Pricing in Python',
  value: 'Value',
  inputs: 'Market inputs',
  reset: 'Reset to setup',
  position: 'Position',
  sensitivities: 'Sensitivities',
  sensitivitiesNote: (noun: string) => `For one ${noun}, at the market you’ve set.`,
  sameAsSetup: 'Same as your setup',
  fromSetup: (chg: string, pctChg: string | null) => `${chg}${pctChg === null ? '' : ` (${pctChg}%)`} from your setup`,
  valueAgainst: (xName: string) => `Value against ${xName}`,
  chartAria: (name: string, xName: string) =>
    `${name} value plotted against ${xName}, with the same instrument at less time left and its value at expiry`,
  vegaCaption: 'Change in value if volatility moves by',
  rhoCaption: 'Change in value if rates move by',
  vegaAria: 'Change in value for volatility moves of minus 10, minus 5, plus 5 and plus 10 points',
  rhoAria: 'Change in value for rate moves of minus 50, minus 25, plus 25 and plus 50 basis points',
  thetaAria: 'Value from today to expiry if nothing else changes',
  thetaAxis: 'Days passed',
  today: 'Today',
  expiry: 'Expiry',
  engineError: 'The Python engine couldn’t start in this browser.',
}

// The tree can't price some markets (trees.py's probability guard). Say so plainly.
export function priceError(message: string): string {
  if (/P not between 0 and 1/.test(message)) {
    return 'The binomial tree in trees.py can’t price this market: with volatility this low and a rate this high, its up-move probability falls outside 0 to 1. Raise the volatility or lower the rate.'
  }
  return `Python couldn’t price this: ${message}`
}

export const xName = (inst: ExplorerInst) => (inst.xKind === 'rate' ? 'the 3-month rate' : `${inst.underlying} spot`)
export const xAxis = (inst: ExplorerInst) => (inst.xKind === 'rate' ? '3-month interest rate' : `${inst.underlying} spot`)

const unitMove = (inst: ExplorerInst) => `${inst.kind === 'convertible' ? '$1' : '1-point'} rise in ${inst.underlying}`

export function expiryLabel(inst: ExplorerInst) {
  return inst.kind === 'future' ? 'Spot (where it ends up)' : 'At expiry'
}

export function breakdownLabels(r: ExploreResult) {
  const b = r.breakdown
  if (b.kind === 'option') {
    return {
      payoff: 'Payoff if it expired at this spot',
      // The design clamps time value at zero; the engine's number can go negative
      // for a deep in-the-money European put, so the label says so instead.
      timeValue: b.time_value < 0 ? 'Time value, below zero this deep in the money' : 'Time value, which theta eats',
    }
  }
  return null
}

export const convertibleLabels = {
  larger: (conv: boolean) => (conv ? 'Conversion value (the larger floor)' : 'Bond floor (the larger floor)'),
  option: 'Option on top',
  other: (conv: boolean) => (conv ? 'Bond floor' : 'Conversion value'),
}
export const futureLabels = { spot: 'Spot', carry: 'Carry to expiry' }
export const ratesLabels = { implied: 'Implied 3-month rate' }

// ---------------------------------------------------------------- Greeks

export function deltaText(inst: ExplorerInst, d: number | null) {
  if (d === null) return { value: '—', sentence: 'Doesn’t apply: there’s no spot price to move.' }
  const value = fixed(d, Math.abs(d) >= 10 ? 2 : 4)
  if (inst.kind === 'convertible') {
    const shares = d.toFixed(1)
    return {
      value,
      sentence: `Moves like ${shares} shares of ${inst.underlying}, out of the ${fmtK(inst.conversionRatio ?? 0)} it converts into. To hedge one, short ${shares} shares.`,
    }
  }
  if (inst.kind === 'future') {
    const why = Math.abs(d - 1) < 5e-5 ? 'Exactly 1, because carry is zero.' : d > 1 ? 'Slightly above 1 because of carry.' : 'Slightly below 1 because of carry.'
    return { value, sentence: `Gains ${d.toFixed(4)} for every ${unitMove(inst)}. ${why}` }
  }
  const a = Math.abs(d).toFixed(2)
  return {
    value,
    sentence: `${d >= 0 ? 'Gains' : 'Loses'} ${a} for every ${unitMove(inst)}. To hedge one, ${d >= 0 ? 'sell' : 'buy'} ${a} units of ${inst.underlying}.`,
  }
}

export function gammaText(inst: ExplorerInst, gm: number | null) {
  if (gm === null) return { value: '—', sentence: 'Doesn’t apply: there’s no spot price to move.' }
  if (Math.abs(gm) < 1e-9) return { value: g(gm), sentence: 'Zero: delta stays the same wherever spot goes.' }
  const where =
    inst.kind === 'convertible'
      ? ` It fades as ${inst.underlying} rises and converting becomes close to certain.`
      : inst.kind === 'option'
        ? ' Highest near the strike, where the outcome is least certain.'
        : ''
  return {
    value: g(gm),
    sentence: `Delta ${gm > 0 ? 'rises' : 'falls'} by ${g(Math.abs(gm))} for every ${unitMove(inst)}.${where}`,
  }
}

export function thetaText(inst: ExplorerInst, th: number | null, timeLeftYears: number) {
  if (!inst.applies.time) {
    return { value: sgn(th ?? 0, 2), sentence: 'Time passing changes nothing here, because the rate is the same at every date.' }
  }
  if (timeLeftYears <= 0) return { value: sgn(0, 2), sentence: 'Expired, so time has nothing left to take.' }
  if (th === null) return { value: '—', sentence: 'Can’t be measured this close to expiry.' }
  if (Math.abs(th) < 0.005) return { value: sgn(th, 2), sentence: 'Time passing barely changes the value.' }
  return {
    value: sgn(th, 2),
    sentence: `${th < 0 ? 'Loses' : 'Gains'} ${Math.abs(th).toFixed(2)} per day if nothing else moves. The chart is the value from today to expiry at this spot.`,
  }
}

export function vegaText(inst: ExplorerInst, v: number | null) {
  if (inst.kind === 'future') return { value: v === null ? '—' : fixed(v, 2), sentence: 'Has no optionality, so volatility doesn’t enter its price.' }
  if (v === null) return { value: '—', sentence: 'Has no volatility input.' }
  const value = fixed(v, 2)
  if (Math.abs(v) < 0.005) return { value, sentence: 'Doesn’t react to volatility.' }
  return { value, sentence: `${v > 0 ? 'Gains' : 'Loses'} ${Math.abs(v).toFixed(2)} per point of volatility.` }
}

export function rhoText(inst: ExplorerInst, rh: number | null) {
  if (rh === null) return { value: '—', sentence: 'Not measured at a 0% rate, because the engine bumps the rate by 1% of its level.' }
  const d = inst.kind === 'rates' ? 4 : 3
  const value = fixed(rh, d)
  if (Math.abs(rh) < 0.0005) return { value, sentence: 'Barely reacts to rates.' }
  return {
    value,
    sentence:
      `${rh > 0 ? 'Gains' : 'Loses'} ${Math.abs(rh).toFixed(d)} per basis point of rates.` +
      (inst.kind === 'rates' ? ' About $25 on the real contract.' : ''),
  }
}
