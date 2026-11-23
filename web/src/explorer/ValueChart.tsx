import { useId, type KeyboardEvent, type PointerEvent } from 'react'
import type { ExploreResult } from '../engine/types.ts'
import type { ExplorerInst } from './setup.ts'
import type { EngineStatus } from '../engine/client.ts'
import { clamp, extent, linear, niceAxis, path } from '../lib/chart.ts'
import { num, stepDecimals, tick, timeLeft } from '../lib/format.ts'
import { copy, expiryLabel, xAxis, xName } from '../content/explorer.ts'
import { useMediaQuery } from '../lib/useMediaQuery.ts'
import LoadingPanel from './LoadingPanel.tsx'

// Geometry from design/Five.dc.html: viewBox 1000 x 680, plot 70..985 by 24..580.
// On phones the same chart gets a taller box and a wider label gutter.
const WIDE = { W: 1000, H: 680, L: 70, R: 985, T: 24, B: 580, tickGap: 26, titleGap: 66 }
const COMPACT = { W: 1000, H: 1180, L: 125, R: 985, T: 36, B: 1010, tickGap: 56, titleGap: 128 }

type CurveKey = 'now' | 'half' | 'fifteen' | 'expiry'
const KEYS: CurveKey[] = ['now', 'half', 'fifteen', 'expiry']
const SWATCH: Record<CurveKey, string> = { now: 'swatch-now', half: 'swatch-half', fifteen: 'swatch-fifteen', expiry: 'swatch-expiry' }

function fmtX(inst: ExplorerInst, x: number) {
  return inst.xKind === 'rate' ? `${(x * 100).toFixed(2)}%` : `${inst.underlying} ${tick(x)}`
}

function labels(inst: ExplorerInst, r: ExploreResult): Record<CurveKey, string | null> {
  if (inst.xKind === 'rate') return { now: 'Price', half: null, fifteen: null, expiry: null }
  return {
    now: `Now, ${timeLeft(r.time_left.now).toLowerCase()}`,
    half: r.time_left.half !== null ? timeLeft(r.time_left.half) : null,
    fifteen: r.time_left.fifteen !== null ? timeLeft(r.time_left.fifteen) : null,
    expiry: r.curves.expiry ? expiryLabel(inst) : null,
  }
}

function nearestIndex(xs: number[], x: number) {
  let best = 0
  xs.forEach((v, i) => {
    if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i
  })
  return best
}

export default function ValueChart({
  inst,
  r,
  status,
  hover,
  setHover,
  pending,
}: {
  inst: ExplorerInst
  r: ExploreResult | null
  status: EngineStatus
  hover: number | null
  setHover: (i: number | null) => void
  pending: boolean
}) {
  const uid = useId().replace(/:/g, '')
  const compact = useMediaQuery('(max-width: 640px)')
  const { W, H, L, R, T, B, tickGap, titleGap } = compact ? COMPACT : WIDE
  // marks keep their on-screen size when the phone layout shrinks the viewBox
  const k = compact ? 2.2 : 1
  const name = xName(inst)
  const showLoading = status.state !== 'ready'

  let body = null
  let overlay = null
  let readout = null

  if (r) {
    const xs = r.x
    const n = xs.length - 1
    const X = linear([xs[0], xs[n]], [L, R])
    const ext = extent([r.curves.now, r.curves.half, r.curves.fifteen, r.curves.expiry]) ?? [0, 1]
    const ax = niceAxis(ext, 4)
    const Y = linear([ax.lo, ax.hi], [B, T])
    const dec = stepDecimals(ax.step)
    const lab = labels(inst, r)

    const hv = hover !== null && hover >= 0 && hover <= n ? hover : null
    const rx = hv !== null ? X(xs[hv]) : clamp(X(r.x_current), L, R)
    const vals: Record<CurveKey, number | null> =
      hv !== null
        ? { now: r.curves.now[hv], half: r.curves.half?.[hv] ?? null, fifteen: r.curves.fifteen?.[hv] ?? null, expiry: r.curves.expiry?.[hv] ?? null }
        : r.at_current
    const dot = (k: CurveKey) => (lab[k] && vals[k] !== null ? { cx: rx, cy: Y(vals[k] as number) } : null)
    const cx = clamp(X(r.x_current), L, R)
    const zero = ax.lo < 0 && ax.hi > 0 ? Y(0) : null
    const mainPath = path(xs, r.curves.now, X, Y)
    const d0 = dot('now')
    const d1 = dot('half')
    const d2 = dot('fifteen')
    const d3 = dot('expiry')

    const onMove = (e: PointerEvent<SVGRectElement>) => {
      const box = e.currentTarget.getBoundingClientRect()
      const fx = clamp((e.clientX - box.left) / box.width, 0, 1)
      const idx = Math.round(fx * n)
      if (idx !== hover) setHover(idx)
    }

    body = (
      <>
        {ax.ticks.map((t) => (
          <line key={t} x1={L} x2={R} y1={Y(t)} y2={Y(t)} style={{ stroke: `rgba(var(--fg), ${Math.abs(Y(t) - B) < 0.5 ? 0.14 : 0.06})`, strokeWidth: 1 }} />
        ))}
        {zero !== null && <path d={`M${L} ${zero} L${R} ${zero}`} style={{ fill: 'none', stroke: 'rgba(var(--fg), 0.28)', strokeWidth: 1, strokeDasharray: '3 4' }} />}
        <path d={path(xs, r.curves.expiry, X, Y)} style={{ fill: 'none', stroke: 'rgba(var(--fg), 0.6)', strokeWidth: 1.5 * k, strokeDasharray: `${6 * k} ${6 * k}` }} />
        <path d={path(xs, r.curves.fifteen, X, Y)} style={{ fill: 'none', stroke: 'rgba(var(--fg), 0.24)', strokeWidth: 1.5 * k }} />
        <path d={path(xs, r.curves.half, X, Y)} style={{ fill: 'none', stroke: 'rgba(var(--fg), 0.45)', strokeWidth: 1.5 * k }} />
        <path d={mainPath} filter={`url(#glow-${uid})`} style={{ fill: 'none', stroke: `url(#spec-${uid})`, strokeWidth: 7 * k, opacity: 'var(--glow)' }} />
        <path key={inst.id} className="draw" d={mainPath} style={{ fill: 'none', stroke: 'var(--hi)', strokeWidth: 2.5 * k, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
        <path d={`M${cx} ${B} L${cx - 6 * k} ${B + 10 * k} L${cx + 6 * k} ${B + 10 * k} Z`} style={{ fill: 'var(--hi)' }} />
        <line x1={rx} x2={rx} y1={T} y2={B} style={{ stroke: 'rgba(var(--fg), 0.35)', strokeWidth: 1, strokeDasharray: '2 4' }} />
        {d3 && <circle {...d3} r={4 * k} style={{ fill: 'var(--bg)', stroke: 'rgba(var(--fg), 0.8)', strokeWidth: 1.5 * k }} />}
        {d2 && <circle {...d2} r={4 * k} style={{ fill: 'var(--bg)', stroke: 'rgba(var(--fg), 0.45)', strokeWidth: 1.5 * k }} />}
        {d1 && <circle {...d1} r={4 * k} style={{ fill: 'var(--bg)', stroke: 'rgba(var(--fg), 0.7)', strokeWidth: 1.5 * k }} />}
        {d0 && (
          <>
            <circle {...d0} r={13 * k} style={{ fill: 'rgba(var(--acc-rgb), 0.18)' }} />
            <circle {...d0} r={5 * k} style={{ fill: 'var(--hi)', stroke: 'var(--acc)', strokeWidth: 2.5 * k }} />
          </>
        )}
        <rect className="hit" x={L} y={T} width={R - L} height={B - T} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </>
    )

    const xi = [0, Math.round(n / 4), Math.round(n / 2), Math.round((3 * n) / 4), n]
    const xlab = (x: number) => (inst.xKind === 'rate' ? `${+(x * 100).toFixed(1)}%` : tick(x))
    overlay = (
      <div className="chart-labels" aria-hidden="true">
        {ax.ticks.map((t) => (
          <span key={t} className="ylab" style={{ top: `${(Y(t) / H) * 100}%`, width: `${(L / W) * 100}%` }}>
            {Math.abs(t) < ax.step * 1e-6 ? '0' : num(t, dec)}
          </span>
        ))}
        {xi.map((i, k) => (
          <span
            key={i}
            style={{
              left: `${(X(xs[i]) / W) * 100}%`,
              top: `${((B + tickGap) / H) * 100}%`,
              transform: `translate(${k === 0 ? '0' : k === 4 ? '-100%' : '-50%'}, -50%)`,
            }}
          >
            {xlab(xs[i])}
          </span>
        ))}
        <span className="xtitle" style={{ left: `${((L + R) / 2 / W) * 100}%`, top: `${((B + titleGap) / H) * 100}%`, transform: 'translate(-50%, -50%)' }}>
          {xAxis(inst)}
        </span>
      </div>
    )

    readout = (
      <dl className="readout">
        <div>
          <dt className="pos">{copy.position}</dt>
          <dd>{hv !== null ? fmtX(inst, xs[hv]) : `${fmtX(inst, r.x_current)} (now)`}</dd>
        </div>
        {KEYS.filter((k) => lab[k] && vals[k] !== null).map((k) => (
          <div key={k}>
            <dt>
              <span aria-hidden="true" className={`swatch ${SWATCH[k]}`} />
              {lab[k]}
            </dt>
            <dd>{num(vals[k] as number, 2)}</dd>
          </div>
        ))}
      </dl>
    )
  } else {
    // Frame only, while the engine loads or the first result for this instrument computes
    body = [0, 1, 2, 3, 4].map((k) => T + ((B - T) * k) / 4).map((y) => (
      <line key={y} x1={L} x2={R} y1={y} y2={y} style={{ stroke: `rgba(var(--fg), ${y === B ? 0.14 : 0.06})`, strokeWidth: 1 }} />
    ))
    readout = (
      <dl className="readout">
        <div>
          <dt className="pos">{copy.position}</dt>
          <dd className="placeholder">{'—'}</dd>
        </div>
      </dl>
    )
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!r) return
    const n = r.x.length - 1
    const from = hover ?? nearestIndex(r.x, r.x_current)
    let next: number | null | undefined
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(n, from + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, from - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n
    else if (e.key === 'Escape') next = null
    if (next !== undefined) {
      e.preventDefault()
      setHover(next)
    }
  }

  return (
    <figure className="card value-figure span-8">
      <div className="bloom" aria-hidden="true" />
      <figcaption className="figcaption">
        <div className="figcaption-top">
          <span className="title">{copy.valueAgainst(name)}</span>
          <span className="hint">{pending ? `${copy.pricing}…` : copy.hoverHint}</span>
        </div>
        {readout}
      </figcaption>
      <div
        className="chart"
        tabIndex={r ? 0 : -1}
        role="group"
        aria-label={`${copy.chartAria(inst.title, name)}. Use the arrow keys to read points.`}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={copy.chartAria(inst.title, name)}>
          <defs>
            <linearGradient id={`spec-${uid}`} gradientUnits="userSpaceOnUse" x1={L} y1="0" x2={R} y2="0">
              <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
              <stop offset="0.5" style={{ stopColor: 'var(--brand-b)' }} />
              <stop offset="1" style={{ stopColor: 'var(--brand-c)' }} />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>
          {body}
        </svg>
        {overlay}
        {showLoading && <LoadingPanel status={status} />}
      </div>
    </figure>
  )
}
