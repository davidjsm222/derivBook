import { capitalize } from '../lib/format.ts'
import { copy, fmtAbs, fmtV, pathWhy, tinyWhy, wrongWayWhy } from '../content/book.ts'
import type { InteractionRow } from '../engine/types.ts'
import { moveLabel, type BookState, type ScenarioView } from '../book/model.ts'
import type { MapRow } from './BookMap.tsx'

export interface ComboView {
  s: ScenarioView
  book: InteractionRow
  per: { row: MapRow; data: InteractionRow }[]
}

type Kind = 'move' | 'sum' | 'inter' | 'total'
const n0 = (v: number | null) => v ?? 0

export default function Combined({
  st,
  combos,
  combo,
  setCombo,
  comboPos,
  setComboPos,
}: {
  st: BookState
  combos: ComboView[]
  combo: string | null
  setCombo: (id: string) => void
  comboPos: string
  setComboPos: (id: string) => void
}) {
  const cur = combos.find((c) => c.s.id === combo) ?? combos[0]
  const pid = comboPos === 'book' || cur.per.some((x) => x.row.id === comboPos) ? comboPos : 'book'
  const pick = pid === 'book' ? cur.book : cur.per.find((x) => x.row.id === pid)!.data
  const pickRow = pid === 'book' ? null : cur.per.find((x) => x.row.id === pid)!.row

  // Waterfall: each move from where the last one ended, then the sum, the gap, the joint result
  const steps: { label: string; a: number; b: number; kind: Kind; v: number }[] = []
  let run = 0
  cur.s.moves.forEach((mv, i) => {
    const v = n0(pick.singles[i])
    steps.push({ label: moveLabel(st, mv), a: run, b: run + v, kind: 'move', v })
    run += v
  })
  steps.push({ label: copy.sumOfParts, a: 0, b: n0(pick.sum), kind: 'sum', v: n0(pick.sum) })
  steps.push({ label: copy.interaction, a: n0(pick.sum), b: n0(pick.joint), kind: 'inter', v: n0(pick.interaction) })
  steps.push({ label: copy.allTogether, a: 0, b: n0(pick.joint), kind: 'total', v: n0(pick.joint) })
  let lo = 0
  let hi = 0
  steps.forEach((x) => {
    lo = Math.min(lo, x.a, x.b)
    hi = Math.max(hi, x.a, x.b)
  })
  if (hi - lo < 1e-9) {
    lo = -1
    hi = 1
  }
  const pad = (hi - lo) * 0.04
  lo -= pad
  hi += pad
  const P = (x: number) => ((x - lo) / (hi - lo)) * 100
  const zeroPct = P(0)

  const name = pid === 'book' ? 'the book' : `your ${pickRow!.title}`
  const inter = n0(pick.interaction)
  const joint = n0(pick.joint)
  const tiny = Math.abs(inter) < Math.max(0.005, 1e-5 * Math.abs(joint))
  let why: string
  if (tiny) why = tinyWhy
  else if (pid === 'book') {
    let bi = 0
    cur.per.forEach((x, k) => {
      if (Math.abs(n0(x.data.interaction)) > Math.abs(n0(cur.per[bi].data.interaction))) bi = k
    })
    why = `The book’s interaction is the sum of each position’s. The largest comes from ${cur.per[bi].row.title}, at ${fmtV(n0(cur.per[bi].data.interaction))}.`
  } else if (pickRow!.p.type === 'cb' && cur.s.moves.some((m) => m.target === 'cs')) why = wrongWayWhy
  else why = pathWhy
  const lead = tiny
    ? `${capitalize(name)}${joint < 0 ? ' loses ' : ' gains '}${fmtAbs(Math.abs(joint))}, and the parts add up.`
    : `Together, ${name}${joint < 0 ? ' loses ' : ' gains '}${fmtAbs(Math.abs(joint))}. That’s ${fmtAbs(Math.abs(inter))}${inter < 0 ? ' worse' : ' better'} than the moves add up to on their own.`

  const list = [{ id: 'book', name: copy.wholeBook, data: cur.book }, ...cur.per.map((x) => ({ id: x.row.id, name: x.row.title, data: x.data }))]

  return (
    <section aria-labelledby="j-title" className="stack gap-16" style={{ paddingTop: 12 }}>
      <div className="intro">
        <h2 id="j-title" className="display-2 book-h2">
          {copy.combinedTitle}
        </h2>
        <p>{copy.combinedIntro}</p>
      </div>
      <div role="group" aria-label="Scenario" className="combo-grid">
        {combos.map((x) => {
          const on = x.s.id === cur.s.id
          return (
            <button key={x.s.id} type="button" aria-pressed={on} className={`scenario${on ? ' selected-spectrum' : ''}`} onClick={() => setCombo(x.s.id)}>
              <span className="nm">{x.s.name}</span>
              <span className="chips-row">
                {x.s.moves.map((m, i) => (
                  <span key={i} className="chip">
                    {moveLabel(st, m)}
                  </span>
                ))}
              </span>
              <span className="foot">
                <span style={{ color: 'var(--ink-3)' }}>{copy.bookInteraction}</span>
                <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--hi)' }}>{fmtV(n0(x.book.interaction))}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="bento">
        <div className="card span-4 stack gap-4" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '4px 6px 8px', fontSize: 12, color: 'var(--ink-4)' }}>
            <h3 className="card-title">{copy.positions}</h3>
            <span>{copy.interaction}</span>
          </div>
          {list.map((row) => {
            const on = row.id === pid
            const small = Math.abs(n0(row.data.interaction)) < 0.005
            return (
              <button
                key={row.id}
                type="button"
                className="pos-btn"
                aria-pressed={on}
                onClick={() => {
                  setComboPos(row.id)
                  setCombo(cur.s.id)
                }}
              >
                <span className="stack">
                  <span style={{ fontWeight: 500 }}>{row.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Together {fmtV(n0(row.data.joint))}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: small ? 'var(--ink-5)' : 'var(--acc-ink)' }}>{small ? '0' : fmtV(n0(row.data.interaction))}</span>
              </button>
            )
          })}
        </div>
        <div className="card span-8 stack" style={{ padding: 24, gap: 18, minWidth: 0 }} aria-live="polite">
          <div className="stack" style={{ gap: 6 }}>
            <p style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: 28, lineHeight: 1.2, color: 'var(--hi)', textWrap: 'pretty' }}>{lead}</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 680, textWrap: 'pretty' }}>{why}</p>
          </div>
          <div
            role="img"
            aria-label={`Waterfall for ${name} in ${cur.s.name}: each move alone, the sum of the parts, the interaction, and all moves together.`}
            className="stack"
            style={{ gap: 8 }}
          >
            <div className="wf-row wide" style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              <span>{copy.step}</span>
              <span style={{ position: 'relative', height: 16 }}>
                <span style={{ position: 'absolute', left: `${zeroPct}%`, transform: 'translateX(-50%)' }}>0</span>
              </span>
              <span style={{ textAlign: 'right' }}>{copy.valueChange}</span>
            </div>
            {steps.map((x, i) => {
              const left = P(Math.min(x.a, x.b))
              const width = Math.max(0.5, P(Math.max(x.a, x.b)) - left)
              const small = Math.abs(x.v) < 0.005
              const cls = x.kind === 'move' ? (small ? 'bg-zero' : x.v < 0 ? 'bg-loss' : 'bg-gain') : x.kind === 'sum' ? 'wf-sum' : ''
              const style = x.kind === 'inter' ? { background: small ? 'rgba(var(--acc-rgb), 0.35)' : 'var(--acc)' } : x.kind === 'total' ? { background: 'var(--hi)' } : {}
              return (
                <div key={i} className="wf-row wide" style={x.kind === 'sum' ? { paddingTop: 10, borderTop: '1px solid rgba(var(--fg), 0.08)' } : undefined}>
                  <span
                    style={{
                      fontSize: 13,
                      color: x.kind === 'move' ? 'var(--ink-2)' : x.kind === 'inter' ? 'var(--acc-ink)' : 'var(--hi)',
                      fontWeight: x.kind === 'move' ? 400 : 500,
                    }}
                  >
                    {x.label}
                  </span>
                  <span className="wf-track">
                    <span className="wf-zero" style={{ left: `${zeroPct}%` }} />
                    <span className={`wf-bar ${cls}`} style={{ left: `${left}%`, width: `${width}%`, ...style }} />
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      textAlign: 'right',
                      color: x.kind === 'inter' ? 'var(--acc-ink)' : x.kind === 'move' ? 'var(--ink-2)' : 'var(--hi)',
                      fontWeight: x.kind === 'move' ? 400 : 600,
                    }}
                  >
                    {fmtV(x.v)}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="wf-legend">
            <span>
              <i aria-hidden="true" className="bg-loss" />
              {copy.legend.loss}
            </span>
            <span>
              <i aria-hidden="true" className="bg-gain" />
              {copy.legend.gain}
            </span>
            <span>
              <i aria-hidden="true" style={{ border: '1.5px dashed rgba(var(--fg), 0.6)' }} />
              {copy.legend.sum}
            </span>
            <span>
              <i aria-hidden="true" style={{ background: 'var(--acc)' }} />
              {copy.legend.inter}
            </span>
            <span>
              <i aria-hidden="true" style={{ background: 'var(--hi)' }} />
              {copy.legend.total}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
