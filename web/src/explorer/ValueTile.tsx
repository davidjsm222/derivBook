import type { ExploreResult } from '../engine/types.ts'
import type { ExplorerInst } from './setup.ts'
import { num, sgn, tick } from '../lib/format.ts'
import { breakdownLabels, convertibleLabels, copy, futureLabels, ratesLabels } from '../content/explorer.ts'

interface Row {
  label: string
  value: string
  dot: string
}

function rows(r: ExploreResult): { rows: Row[]; split: { part: number; cls: string }[] | null } {
  const b = r.breakdown
  switch (b.kind) {
    case 'option': {
      const l = breakdownLabels(r)!
      return {
        rows: [
          { label: l.payoff, value: num(b.payoff, 2), dot: 'fill-hi' },
          { label: l.timeValue, value: num(b.time_value, 2), dot: 'fill-acc' },
        ],
        split: r.price > 1e-9 ? [{ part: b.payoff, cls: 'fill-hi' }, { part: b.time_value, cls: 'fill-acc' }] : null,
      }
    }
    case 'future':
      return {
        rows: [
          { label: futureLabels.spot, value: tick(b.spot), dot: 'fill-hi' },
          { label: futureLabels.carry, value: sgn(b.carry, 2), dot: 'fill-acc' },
        ],
        split: null,
      }
    case 'rates':
      return { rows: [{ label: ratesLabels.implied, value: `${b.implied_rate_pct.toFixed(2)}%`, dot: 'fill-hi' }], split: null }
    case 'convertible': {
      const conv = b.larger_floor === 'conversion'
      const larger = conv ? b.conversion_value : b.bond_floor
      const other = conv ? b.bond_floor : b.conversion_value
      return {
        rows: [
          { label: convertibleLabels.larger(conv), value: num(larger, 2), dot: 'fill-hi' },
          { label: convertibleLabels.option, value: num(b.option, 2), dot: 'fill-acc' },
          { label: convertibleLabels.other(conv), value: num(other, 2), dot: 'fill-dim' },
        ],
        split: [
          { part: larger, cls: 'fill-hi' },
          { part: b.option, cls: 'fill-acc' },
        ],
      }
    }
  }
}

export default function ValueTile({ inst, r }: { inst: ExplorerInst; r: ExploreResult | null }) {
  const content = r ? rows(r) : null
  const atBase = r ? Math.abs(r.change) < 0.005 : true
  const changeText = !r
    ? ' '
    : atBase
      ? copy.sameAsSetup
      : copy.fromSetup(sgn(r.change, 2), r.change_pct !== null && Math.abs(r.base_price) > 1e-9 ? sgn(r.change_pct, 1) : null)
  const changeClass = !r || atBase ? 'faint' : r.change < 0 ? 'loss' : 'gain'

  // Bar widths only: each part's share of the drawn total (negative parts draw as zero)
  const split = content?.split
  const drawn = split ? split.reduce((s, p) => s + Math.max(0, p.part), 0) : 0

  return (
    <section className="card card-pad stack gap-14" aria-labelledby="v-title">
      <h2 id="v-title" className="card-title">
        {copy.value}
      </h2>
      <div className="stack gap-4">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className={`big-number${r ? '' : ' placeholder'}`}>{r ? num(r.price, 2) : '—'}</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{inst.unit}</span>
        </div>
        <span style={{ fontSize: 13 }} className={changeClass}>
          {changeText}
        </span>
      </div>
      {split && drawn > 0 && (
        <div className="split" aria-hidden="true">
          {split.map((p, i) => (
            <span key={i} className={p.cls} style={{ width: `${(Math.max(0, p.part) / drawn) * 100}%` }} />
          ))}
        </div>
      )}
      <dl className="breakdown">
        {content
          ? content.rows.map((row) => (
              <div key={row.label}>
                <dt>
                  <span aria-hidden="true" className={`dot-sq ${row.dot}`} />
                  {row.label}
                </dt>
                <dd>{row.value}</dd>
              </div>
            ))
          : (
            <div>
              <dt className="placeholder">{'—'}</dt>
              <dd />
            </div>
          )}
      </dl>
    </section>
  )
}
