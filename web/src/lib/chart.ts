// Drawing helpers: scales and SVG paths with d3-scale and d3-shape. No values
// are computed here, only positions for values Python returned.

import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import type { Series } from '../engine/types.ts'

export type Scale = (v: number) => number

export function linear(domain: [number, number], range: [number, number]): Scale {
  return scaleLinear().domain(domain).range(range)
}

// Smallest and largest finite values across several series (and extra points)
export function extent(series: (Series | null | undefined)[], extra: (number | null | undefined)[] = []): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number | null | undefined) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  series.forEach((s) => s?.forEach(take))
  extra.forEach(take)
  return lo <= hi ? [lo, hi] : null
}

// Pad a flat range so a constant line still sits in the middle of a chart
export function padFlat([lo, hi]: [number, number]): { domain: [number, number]; flat: boolean } {
  if (hi - lo < 1e-9 * Math.max(1, Math.abs(hi))) {
    const pad = Math.max(Math.abs(hi) * 0.05, 1)
    return { domain: [lo - pad, hi + pad], flat: true }
  }
  return { domain: [lo, hi], flat: false }
}

// Round-number axis: d3's nice() domain and its ticks
export function niceAxis(domain: [number, number], count: number) {
  const s = scaleLinear().domain(padFlat(domain).domain).nice(count)
  const ticks = s.ticks(count)
  const [lo, hi] = s.domain() as [number, number]
  return { lo, hi, ticks, step: ticks.length > 1 ? ticks[1] - ticks[0] : hi - lo }
}

export function path(xs: number[], ys: Series | null | undefined, X: Scale, Y: Scale): string {
  if (!ys) return ''
  const pts = xs.map((x, i) => [x, ys[i]] as [number, number | null])
  return (
    line<[number, number | null]>()
      .defined((d) => d[1] !== null && Number.isFinite(d[1]))
      .x((d) => X(d[0]))
      .y((d) => Y(d[1] as number))(pts) ?? ''
  )
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
