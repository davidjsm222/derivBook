import type { ExploreResult, LadderBar, Series } from '../engine/types.ts'
import type { ExplorerInst } from './setup.ts'
import { clamp, extent, linear, padFlat, path } from '../lib/chart.ts'
import { bound, bp, points, sgn, tick } from '../lib/format.ts'
import { copy, deltaText, gammaText, rhoText, thetaText, vegaText } from '../content/explorer.ts'

interface SmallChartData {
  xs: number[]
  ys: Series
  cur: { x: number; y: number | null }
  xLabels: [string, string, string]
  axis: string
  aria: string
}

// 300 x 110 chart from design/Five.dc.html: plot 44..296 by 10..100
function SmallChart({ c }: { c: SmallChartData }) {
  const ext = extent([c.ys], [c.cur.y])
  if (!ext) return null
  const { domain, flat } = padFlat(ext)
  const [lo, hi] = domain
  const X = linear([c.xs[0], c.xs[c.xs.length - 1]], [44, 296])
  const Y = linear([lo, hi], [100, 10])
  const dx = clamp(X(c.cur.x), 44, 296)
  const dy = c.cur.y !== null ? Y(c.cur.y) : null
  const zero = lo < 0 && hi > 0 ? Y(0) : null
  const span = hi - lo
  return (
    <div className="stack gap-4">
      <div className="small-chart">
        <svg viewBox="0 0 300 110" role="img" aria-label={c.aria}>
          <line x1="44" y1="10" x2="296" y2="10" style={{ stroke: 'rgba(var(--fg), 0.06)', strokeWidth: 1 }} />
          <line x1="44" y1="100" x2="296" y2="100" style={{ stroke: 'rgba(var(--fg), 0.06)', strokeWidth: 1 }} />
          {zero !== null && <path d={`M44 ${zero} L296 ${zero}`} style={{ fill: 'none', stroke: 'rgba(var(--fg), 0.28)', strokeWidth: 1, strokeDasharray: '3 4' }} />}
          <path d={path(c.xs, c.ys, X, Y)} style={{ fill: 'none', stroke: 'var(--hi)', strokeWidth: 1.75, strokeLinejoin: 'round', strokeLinecap: 'round' }} />
          <line x1={dx} x2={dx} y1="10" y2="100" style={{ stroke: 'rgba(var(--fg), 0.25)', strokeWidth: 1, strokeDasharray: '2 4' }} />
          {dy !== null && (
            <>
              <circle cx={dx} cy={dy} r="9" style={{ fill: 'rgba(var(--acc-rgb), 0.18)' }} />
              <circle cx={dx} cy={dy} r="4" style={{ fill: 'var(--hi)', stroke: 'var(--acc)', strokeWidth: 2 }} />
            </>
          )}
        </svg>
        {!flat && (
          <>
            <span aria-hidden="true" className="ylab" style={{ top: '9.09%' }}>
              {bound(hi, span)}
            </span>
            <span aria-hidden="true" className="ylab" style={{ top: '90.91%' }}>
              {bound(lo, span)}
            </span>
            {zero !== null && Math.abs(zero - 10) > 14 && Math.abs(zero - 100) > 14 && (
              <span aria-hidden="true" className="ylab" style={{ top: `${(zero / 110) * 100}%` }}>
                0
              </span>
            )}
          </>
        )}
      </div>
      <div className="small-x" aria-hidden="true">
        <span>{c.xLabels[0]}</span>
        <span>{c.xLabels[1]}</span>
        <span>{c.xLabels[2]}</span>
      </div>
      <div className="axis-title" aria-hidden="true">
        {c.axis}
      </div>
    </div>
  )
}

function CurveCard({ name, value, sentence, chart, pending }: { name: string; value: string; sentence: string; chart: SmallChartData | null; pending: boolean }) {
  return (
    <article className="card card-pad stack gap-10 span-4 curve-card">
      <div className="tile-head">
        <h3 className="card-title">{name}</h3>
        <span className={`tile-value${pending ? ' placeholder' : ''}`}>{value}</span>
      </div>
      <p className="sentence">{sentence}</p>
      {chart && <SmallChart c={chart} />}
    </article>
  )
}

function Ladder({ bars, label, aria }: { bars: LadderBar[]; label: (s: number) => string; aria: string }) {
  const sizes = bars.map((b) => (b.change === null ? 0 : Math.abs(b.change)))
  const max = Math.max(...sizes)
  return (
    <div role="img" aria-label={aria} className="ladder">
      {bars.map((b) => {
        const v = b.change
        const h = v === null || max < 1e-9 ? 0 : Math.max((Math.abs(v) / max) * 46, 1.5)
        const cls = v === null || Math.abs(v) < 1e-9 ? 'bg-zero' : v < 0 ? 'bg-loss' : 'bg-gain'
        return (
          <div key={b.shift} className="stack" style={{ gap: 6 }}>
            <div className="ladder-well">
              <span className="mid" />
              {v !== null && <span className={`bar ${cls}`} style={{ top: `${v >= 0 ? 50 - h : 50}%`, height: `${h}%` }} />}
            </div>
            <div className="ladder-label">
              <span className="v">{v === null ? '—' : sgn(v, 2)}</span>
              <span className="l">{label(b.shift)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LadderCard({
  name,
  value,
  sentence,
  caption,
  bars,
  label,
  aria,
}: {
  name: string
  value: string
  sentence: string
  caption: string
  bars: LadderBar[] | null
  label: (s: number) => string
  aria: string
}) {
  const hasBars = bars !== null && bars.some((b) => b.change !== null && Math.abs(b.change) > 1e-9)
  return (
    <article className="card card-pad stack gap-10 span-6">
      <div className="tile-head">
        <h3 className="card-title">{name}</h3>
        <span className="tile-value">{value}</span>
      </div>
      <p className="sentence">{sentence}</p>
      {hasBars && (
        <div className="stack" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{caption}</span>
          <Ladder bars={bars!} label={label} aria={aria} />
        </div>
      )}
    </article>
  )
}

export default function Sensitivities({ inst, r }: { inst: ExplorerInst; r: ExploreResult | null }) {
  const dash = '—'
  const cards = (() => {
    if (!r) {
      return {
        delta: { value: dash, sentence: ' ', chart: null },
        gamma: { value: dash, sentence: ' ', chart: null },
        theta: { value: dash, sentence: ' ', chart: null },
      }
    }
    const isSpot = inst.xKind === 'spot'
    const xs = r.x
    const xl: [string, string, string] = [tick(xs[0]), `${tick(inst.setup.spot ?? 0)} setup`, tick(xs[xs.length - 1])]
    const axis = `${inst.underlying} spot`
    const dT = deltaText(inst, r.greeks.delta)
    const gT = gammaText(inst, r.greeks.gamma)
    const tT = thetaText(inst, r.greeks.theta, r.inputs.time_left_years)
    const tp = r.theta_path
    return {
      delta: {
        ...dT,
        chart:
          isSpot && r.delta_curve
            ? { xs, ys: r.delta_curve, cur: { x: r.x_current, y: r.greeks.delta }, xLabels: xl, axis, aria: `Delta across ${inst.underlying} spot` }
            : null,
      },
      gamma: {
        ...gT,
        chart:
          isSpot && r.gamma_curve
            ? { xs, ys: r.gamma_curve, cur: { x: r.x_current, y: r.greeks.gamma }, xLabels: xl, axis, aria: `Gamma across ${inst.underlying} spot` }
            : null,
      },
      theta: {
        ...tT,
        chart: tp
          ? {
              xs: tp.days,
              ys: tp.values,
              cur: { x: r.inputs.days_passed, y: r.price },
              xLabels: [copy.today, `${Math.round(tp.days[Math.floor(tp.days.length / 2)])} days`, copy.expiry] as [string, string, string],
              axis: copy.thetaAxis,
              aria: copy.thetaAria,
            }
          : null,
      },
    }
  })()

  const vT = r ? vegaText(inst, r.greeks.vega) : { value: dash, sentence: ' ' }
  const rT = r ? rhoText(inst, r.greeks.rho) : { value: dash, sentence: ' ' }

  return (
    <section aria-labelledby="s-title" className="stack gap-12">
      <div className="section-head">
        <h2 id="s-title" className="display-2">
          {copy.sensitivities}
        </h2>
        <p>{copy.sensitivitiesNote(inst.noun)}</p>
      </div>
      <div className="bento">
        <CurveCard name="Delta" {...cards.delta} pending={!r} />
        <CurveCard name="Gamma" {...cards.gamma} pending={!r} />
        <CurveCard name="Theta" {...cards.theta} pending={!r} />
        <LadderCard name="Vega" {...vT} caption={copy.vegaCaption} bars={r ? r.vega_ladder : null} label={points} aria={copy.vegaAria} />
        <LadderCard name="Rho" {...rT} caption={copy.rhoCaption} bars={r ? r.rho_ladder : null} label={bp} aria={copy.rhoAria} />
      </div>
    </section>
  )
}
