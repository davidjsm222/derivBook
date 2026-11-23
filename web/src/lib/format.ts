// Number formatting only. Every number passed in comes from the Python engine.

const MINUS = '−'

export const minus = (t: string) => t.replace(/^-/, MINUS)

// toFixed with a real minus sign, and no "−0.00" for values that round to zero
export function fixed(v: number, d: number): string {
  return Math.abs(v) < Math.pow(10, -d) / 2 ? (0).toFixed(d) : minus(v.toFixed(d))
}

// Fixed decimals with thousands separators: 1,020.48
export function num(v: number, d = 2): string {
  return minus(v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }))
}

// Axis tick: whole numbers when large, more decimals when small
export function tick(v: number): string {
  const a = Math.abs(v)
  if (a < 1e-12) return '0'
  if (a >= 100) return num(v, 0)
  if (a >= 1) return minus(v.toFixed(2))
  if (a >= 0.01) return minus(v.toFixed(3))
  return minus(v.toPrecision(2))
}

// Gamma-sized numbers
export function g(v: number): string {
  const a = Math.abs(v)
  if (a < 1e-10) return '0'
  return minus(a < 0.01 ? v.toPrecision(3) : v.toFixed(4))
}

// Signed, with a real minus sign: +82.93, −3.79, 0.00
export function sgn(v: number, d: number): string {
  if (Math.abs(v) < Math.pow(10, -d) / 2) return (0).toFixed(d)
  return (v > 0 ? '+' : MINUS) + Math.abs(v).toFixed(d)
}

// Exposure-map cell: 0 when it rounds to zero
export function fmt(v: number): string {
  return Math.abs(v) < 0.005 ? '0' : (v > 0 ? '+' : MINUS) + Math.abs(v).toFixed(2)
}

export function fmtPct(v: number): string {
  const a = Math.abs(v)
  if (a < 0.0005) return '0%'
  const d = a >= 10 ? 1 : a >= 0.1 ? 2 : 3
  return (v > 0 ? '+' : MINUS) + a.toFixed(d) + '%'
}

export const unsigned = (t: string) => t.replace(/^[+−-]/, '')

// Label for the top or bottom of a small chart, decimals set by the chart's span
export function bound(v: number, span: number): string {
  if (Math.abs(v) < span * 1e-3) return '0'
  const d = Math.min(8, Math.max(0, 2 - Math.floor(Math.log10(span))))
  return num(v, d)
}

// Decimals needed to print every multiple of a tick step exactly
export function stepDecimals(step: number): number {
  let d = 0
  while (d < 8 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-6) d++
  return d
}

// Time left, given in years (365-day years, as in the engine)
export function timeLeft(years: number): string {
  const days = years * 365
  if (years <= 1e-9) return 'At expiry'
  if (days >= 365) return `${years.toFixed(1)} years left`
  if (days >= 1.5) return `${Math.round(days)} days left`
  return 'Under 2 days left'
}

export const pct = (decimal: number, d = 2) => `${(decimal * 100).toFixed(d)}%`

// Shift labels for ladders and map columns
export function points(decimal: number): string {
  const n = Math.round(decimal * 1000) / 10
  return `${n > 0 ? '+' : MINUS}${Math.abs(n)} pts`
}
export function bp(decimal: number): string {
  const n = Math.round(decimal * 100000) / 10
  return `${n > 0 ? '+' : MINUS}${Math.abs(n).toLocaleString('en-US')} bp`
}
export function signedPct(decimal: number): string {
  const n = Math.round(decimal * 1000) / 10
  return `${n > 0 ? '+' : MINUS}${Math.abs(n)}%`
}
export function days(yearFraction: number): string {
  const n = Math.round(yearFraction * 365 * 10) / 10
  return `${n > 0 ? '+' : MINUS}${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
