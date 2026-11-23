// Book page copy and "why" texts, from design/v6/Book6.dc.html

import type { Pos, UiMove } from '../book/model.ts'
import { isOption } from './instruments.ts'
import { num } from '../lib/format.ts'

export const copy = {
  title: 'Book',
  intro: 'Set the market and add your positions. When the book is ready, set it, and the Exposure tab runs it through the scenarios.',
  clearBook: 'Clear book',
  confirmClear: 'Click again to clear',
  emptyTitle: 'Your book is empty',
  emptyText: 'Add the underlyings your positions are written on, then add positions. Or load the example book to see how the pieces fit together.',
  loadExample: 'Load the example book',
  addUnd: 'Add an underlying',
  marketTitle: 'Market',
  marketNote: 'Every price on this page comes from these inputs.',
  pullLive: 'Pull live prices',
  soon: 'Soon',
  rate: 'Interest rate',
  rateHint: 'Yearly risk-free rate, used by every position',
  undHeads: ['Underlying', 'Spot', 'Volatility, %', 'Dividend yield, %', 'Credit spread, bp'],
  noUnds: 'No underlyings yet. Add each stock or index your positions are written on.',
  addUnderlying: 'Add underlying',
  positionsTitle: 'Positions',
  positionsNote:
    'Value is price × quantity × multiplier. Futures cost nothing to enter, so they add no value, only gains and losses, and show their notional instead.',
  posHeads: ['Position', 'Terms', 'Quantity', 'Multiplier', 'Price', 'Value'],
  noPos: 'No positions yet.',
  addPosition: 'Add position',
  newPosition: 'New position',
  addToBook: 'Add to book',
  cancel: 'Cancel',
  posError: 'Fix the highlighted fields to add it.',
  scenariosTitle: 'Scenarios',
  scenariosNote: 'Pick the shocks to run. Each one becomes a column in the exposure map. The presets follow the underlyings in your book.',
  noScen: 'Add a position first.',
  groups: { single: 'Single moves', combo: 'Several moves at once', custom: 'Yours' },
  createScenario: 'Create a scenario',
  newScenario: 'New scenario',
  name: 'Name',
  movesTogether: 'Moves, applied together',
  addMove: 'Add another move',
  saveScenario: 'Save scenario',
  nameErr: 'Give it a name',
  movesErr: 'Fix the highlighted moves to save it.',
  mapTitle: 'Exposure map',
  mapIntro:
    'Each column applies one scenario to the market you set and holds everything else still. Each cell is the change in that position’s value. Click a cell to read it.',
  unitButtons: [
    ['value', 'Value change'],
    ['pct', '% of size'],
  ] as const,
  losesMore: 'Loses more',
  gainsMore: 'Gains more',
  notePct:
    'Each cell is divided by that position’s size: its value, or its notional for futures. The book row uses gross exposure, the sum of every position’s size.',
  noteValue: 'Change in value: price change × quantity × multiplier. Color uses one scale for every position, and its own scale for the book total.',
  positionHead: 'Position',
  bookTotal: 'Book total',
  allPositions: 'All positions',
  why: 'Why',
  colNote: 'Bars compare each position against its own size, so big and small positions line up fairly.',
  combinedTitle: 'Combined scenarios',
  combinedIntro: 'Real selloffs move several inputs at once. The interaction is the combined result minus the sum of each move on its own.',
  bookInteraction: 'Book interaction',
  positions: 'Positions',
  interaction: 'Interaction',
  wholeBook: 'Whole book',
  step: 'Step',
  valueChange: 'Value change',
  sumOfParts: 'Sum of the parts',
  allTogether: 'All moves together',
  legend: {
    loss: 'Loss from one move',
    gain: 'Gain from one move',
    sum: 'Sum of the parts',
    inter: 'Interaction',
    total: 'All moves together',
  },
  updating: 'Updating',
  loadingEngine: 'Loading the Python engine (first visit only)',
  loadingPandas: 'Loading pandas for the book (first time only)',
  stats: { value: 'Book value', positions: 'Positions', running: 'Scenarios running' },
}

// The card at the bottom of the Book tab
export const setCard = {
  readyTitle: 'Ready to run it?',
  setTitle: 'Book set',
  changedTitle: 'You\u2019ve changed the book since you set it',
  setButton: 'Set book',
  setAgain: 'Set book again',
  open: 'Open Exposure',
  issues: {
    noPositions: 'Add at least one position to set the book.',
    rate: 'Set the interest rate to set the book.',
    fix: 'Fix the positions marked in red to set the book.',
  },
  readyNote: 'Setting the book locks in this market and these positions for the Exposure tab. You can keep editing here and set it again.',
  setNote: (at: string) => `Set at ${at}. The Exposure tab is running this book.`,
  changedNote: (at: string) => `The Exposure tab still shows the version you set at ${at}. Set it again to update it.`,
}

export const exposureCopy = {
  title: 'Exposure',
  intro: 'Shock the book you set and see which positions move, by how much, and why.',
  emptyTitle: 'No book set yet',
  emptyText: 'Build your market and positions in the Book tab, then press Set book. Everything here runs on the book you set.',
  goToBook: 'Go to Book',
  editBook: 'Edit book',
}

export function fmtV(v: number): string {
  const a = Math.abs(v)
  if (a < 0.005) return '0'
  const s = v > 0 ? '+' : '−'
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return s + num(a, 0)
  return s + num(a, 2)
}

export function fmtAbs(v: number): string {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`
  if (a >= 1e4) return s + num(a, 0)
  return s + num(a, 2)
}

export function fmtP(v: number): string {
  const a = Math.abs(v)
  if (a < 0.0005) return '0%'
  return `${v > 0 ? '+' : '−'}${a.toFixed(a >= 10 ? 1 : a >= 0.1 ? 2 : 3)}%`
}

// Why a position reacts to a single move
export function why(p: Pos, mv: UiMove, undName: (id: string) => string): string {
  const ty = p.type
  const t = mv.target
  const opt = isOption(ty)
  const call = ty === 'ecall' || ty === 'acall'
  if ((t === 'spot' || t === 'vol' || t === 'q' || t === 'cs') && mv.und !== p.und) {
    if (ty === 'sofr') return `It’s priced from the interest rate alone, so a move in ${undName(mv.und)} doesn’t touch it.`
    return `This position is written on ${undName(p.und)}, so a move in ${undName(mv.und)} doesn’t touch it.`
  }
  if (t === 'spot') {
    if (ty === 'ecall') return 'Delta. A call gains when the underlying rises. Gamma makes the gain on the way up bigger than the loss on the way down.'
    if (ty === 'eput') return 'Delta. A put gains when the underlying falls. Gamma makes the gain on the way down bigger than the loss on the way up.'
    if (ty === 'acall') return 'Delta, like a European call. Early exercise only adds value when dividends are worth capturing.'
    if (ty === 'aput') return 'Delta, like a European put, plus the right to exercise early, which matters most once it’s deep in the money.'
    if (ty === 'fut') return 'Delta of about 1. A future moves point for point with spot, scaled slightly by carry, and has no gamma.'
    if (ty === 'cb') return 'Equity delta. The right to convert gains as the stock rises, while the bond floor cushions the fall.'
  }
  if (t === 'vol') {
    if (opt) return 'Vega. More volatility raises the chance of finishing far in the money, while the most an option can lose is its price, so its value rises.'
    if (ty === 'fut') return 'A future has no optionality, so volatility doesn’t appear in its price.'
    if (ty === 'cb') return 'Vega. The right to convert is worth more when the stock swings more.'
  }
  if (t === 'q') {
    if (opt) return call ? 'Dividends lower the expected future price of the underlying, so a call loses value.' : 'Dividends lower the expected future price of the underlying, so a put gains value.'
    if (ty === 'fut') return 'Carry. A future is spot grown at the rate minus the dividend yield, so a higher yield lowers it.'
    if (ty === 'cb') return 'Dividends go to shareholders, not bondholders, so a higher yield makes converting less attractive.'
  }
  if (t === 'cs') {
    if (ty === 'cb') return 'The debt part is discounted at the rate plus the credit spread, so a wider spread lowers the bond floor.'
    return 'Only a convertible carries the issuer’s credit risk, so the credit spread doesn’t enter this price.'
  }
  if (t === 'rate') {
    if (call) return 'Rho. A higher rate lowers today’s value of the strike you pay later, so a call gains a little.'
    if (ty === 'eput') return 'Rho. A higher rate lowers today’s value of the strike you receive, so a put loses a little.'
    if (ty === 'aput') return 'Rho. Like a European put, but a higher rate also makes exercising early and collecting the strike sooner more attractive, which offsets part of the loss.'
    if (ty === 'fut') return 'Carry. A future is spot grown at the rate minus the dividend yield, so a higher rate raises it.'
    if (ty === 'sofr') return 'It’s quoted as 100 minus the rate, so it falls when rates rise. That’s the whole instrument.'
    if (ty === 'cb') return 'Two effects pull against each other: a higher rate lowers the bond floor and raises the stock’s forward. The bond side usually wins.'
  }
  if (t === 'time') {
    if (opt) return 'Theta. One less day for the underlying to move in the option’s favor, so time value bleeds away.'
    if (ty === 'fut') return 'One less day of carry, so the future drifts toward spot.'
    if (ty === 'sofr') return 'It’s priced from today’s rate alone, so a day passing changes nothing in this model.'
    if (ty === 'cb') return 'The bond floor rises toward face as maturity nears, which roughly offsets the conversion right’s time decay.'
  }
  return ''
}

export const shortFlip = ' You’re short, so the sign flips.'
export const multiWhy = 'Several inputs move at once. The combined scenarios below split this into each move on its own and the interaction between them.'
export const bookWhy = 'It’s the sum of every position’s change, so positions that move in opposite directions offset each other.'
export const tinyWhy = 'The moves barely interact here, so the parts add up.'
export const wrongWayWhy =
  'Once the stock has fallen, converting is less likely, so more of the bond’s value is debt exposed to credit. The spread widening bites harder and the volatility spike helps less. Desks call this wrong-way risk.'
export const pathWhy =
  'Each move changes the sensitivities the next one meets. After a big spot move, delta and vega are no longer what they were at the start, so the parts don’t add up.'
