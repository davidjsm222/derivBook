import type { CSSProperties } from 'react'
import { bookWhy, copy, fmtAbs, fmtP, fmtV, multiWhy, shortFlip, why } from '../content/book.ts'
import { moveDesc, sizeText, undName, type BookState, type Pos, type PosInfo, type ScenarioView } from '../book/model.ts'

export interface MapRow {
  id: string
  p: Pos
  info: PosInfo
  title: string
  isFut: boolean
  changes: (number | null)[]
  pcts: (number | null)[]
}

export interface MapView {
  rows: MapRow[]
  book: { changes: (number | null)[]; pcts: (number | null)[] }
  cols: ScenarioView[]
}

export type Units = 'value' | 'pct'
export type Sel = { r: string; c: string } | null

// Square-root color scale, so small but real exposures still show next to large ones
function tint(v: number | null, max: number): CSSProperties {
  if (v === null || Math.abs(v) < 1e-9 || max < 1e-12) return { background: 'rgba(var(--fg), 0.02)', color: 'var(--ink-6)' }
  const norm = Math.sqrt(Math.min(1, Math.abs(v) / max))
  return {
    background: `rgba(${v < 0 ? 'var(--loss-rgb)' : 'var(--gain-rgb)'}, calc(var(--tint-max) * ${(0.11 + 0.89 * norm).toFixed(3)}))`,
    color: 'var(--cell-ink)',
  }
}

const absMax = (xs: (number | null)[]) => xs.reduce<number>((m, v) => (v === null ? m : Math.max(m, Math.abs(v))), 0)

export default function BookMap({
  st,
  view,
  units,
  setUnits,
  sel: selIn,
  setSel,
  updating,
}: {
  st: BookState
  view: MapView
  units: Units
  setUnits: (u: Units) => void
  sel: Sel
  setSel: (s: Sel) => void
  updating: boolean
}) {
  const { rows, book, cols } = view
  const pct = units === 'pct'
  const shown = (r: { changes: (number | null)[]; pcts: (number | null)[] }, j: number) => (pct ? r.pcts[j] : r.changes[j])
  const txt = (v: number | null) => (v === null ? '—' : pct ? fmtP(v) : fmtV(v))
  const rowIds = [...rows.map((r) => r.id), 'book']
  const sel = selIn && rowIds.includes(selIn.r) && cols.some((s) => s.id === selIn.c) ? selIn : { r: rows[0].id, c: cols[0].id }

  const gmax = absMax(rows.flatMap((r) => cols.map((_, j) => shown(r, j))))
  const bmax = absMax(cols.map((_, j) => shown(book, j)))
  const name = (id: string) => undName(st, id)

  const makeRow = (id: string, title: string, sub: string, data: { changes: (number | null)[]; pcts: (number | null)[] }, max: number, total = false) => (
    <div key={id} role="row" className={`bmap-row${total ? ' total' : ''}`}>
      <div role="rowheader" className="rowhead">
        <span className="n">{title}</span>
        <span className="s">{sub}</span>
      </div>
      {cols.map((s, j) => {
        const v = shown(data, j)
        const on = sel.r === id && sel.c === s.id
        const dv = data.changes[j]
        return (
          <div key={s.id} role="cell" className="cell">
            <button
              type="button"
              aria-pressed={on}
              aria-label={`${title}, ${s.label}: ${dv === null ? 'no price' : fmtV(dv)}`}
              onClick={() => setSel({ r: id, c: s.id })}
              style={tint(v, max)}
            >
              {txt(v)}
            </button>
          </div>
        )
      })}
    </div>
  )

  // reading strip
  const j = cols.findIndex((s) => s.id === sel.c)
  const s = cols[j]
  const isBook = sel.r === 'book'
  const row = isBook ? null : rows.find((r) => r.id === sel.r) ?? null
  const dv = isBook ? book.changes[j] : row!.changes[j]
  const pv = isBook ? book.pcts[j] : row!.pcts[j]
  const who = isBook ? 'The book' : `Your ${row!.title}`
  const when = s.multi ? `in the ${s.name} scenario` : `when ${moveDesc(st, s.moves[0])}`
  const sizeWord = isBook ? 'gross exposure' : row!.isFut ? 'notional' : 'value'
  const zero = dv === null || Math.abs(dv) < 0.005
  const sentence =
    dv === null
      ? `${who} can’t be priced ${when}.`
      : zero
        ? `${who} doesn’t move ${when}.`
        : `${who}${dv < 0 ? ' loses ' : ' gains '}${fmtAbs(Math.abs(dv))} ${when}, ${fmtP(pv ?? 0).replace(/^[+−]/, '')} of its ${sizeWord}.`
  let whyText: string
  if (s.multi) whyText = multiWhy
  else if (isBook) whyText = bookWhy
  else whyText = why(row!.p, s.moves[0], name) + ((row!.info.qty as number) < 0 && !zero ? shortFlip : '')
  let context: string
  if (isBook) {
    let bi = 0
    rows.forEach((r, k) => {
      if (Math.abs(r.changes[j] ?? 0) > Math.abs(rows[bi].changes[j] ?? 0)) bi = k
    })
    const movers = rows.filter((r) => Math.abs(r.changes[j] ?? 0) >= 0.005).length
    context = `Biggest contributor: ${rows[bi].title}, at ${fmtV(rows[bi].changes[j] ?? 0)}. ${movers} of ${rows.length} positions move.`
  } else {
    let bj = 0
    row!.changes.forEach((x, k) => {
      if (Math.abs(x ?? 0) > Math.abs(row!.changes[bj] ?? 0)) bj = k
    })
    context = `Its biggest exposure on the map is ${cols[bj].label}, at ${fmtV(row!.changes[bj] ?? 0)}.`
  }
  const detailClass = zero ? 'placeholder' : (dv as number) < 0 ? 'loss' : 'gain'

  // column list: bars compare each position's change against its own size
  const cpct = rows.map((r) => r.pcts[j] ?? 0)
  const cmax = Math.max(1e-12, ...cpct.map(Math.abs))

  return (
    <section aria-labelledby="ex-title" className="stack gap-16" style={{ paddingTop: 12 }}>
      <div className="intro">
        <h2 id="ex-title" className="display-2 book-h2">
          {copy.mapTitle}
          {updating && <span className="updating">{copy.updating}</span>}
        </h2>
        <p>{copy.mapIntro}</p>
      </div>
      <div className="controls">
        <div role="group" aria-label="Units" className="segmented">
          {copy.unitButtons.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={units === k} onClick={() => setUnits(k)}>
              {label}
            </button>
          ))}
        </div>
        <div aria-hidden="true" className="legend">
          <span>{copy.losesMore}</span>
          <span className="chips">
            <span style={{ background: 'rgba(var(--loss-rgb), var(--tint-max))' }} />
            <span style={{ background: 'rgba(var(--loss-rgb), calc(var(--tint-max) * 0.5))' }} />
            <span style={{ background: 'rgba(var(--fg), 0.03)' }} />
            <span style={{ background: 'rgba(var(--gain-rgb), calc(var(--tint-max) * 0.5))' }} />
            <span style={{ background: 'rgba(var(--gain-rgb), var(--tint-max))' }} />
          </span>
          <span>{copy.gainsMore}</span>
        </div>
      </div>
      <p className="note">{pct ? copy.notePct : copy.noteValue}</p>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="heat-scroll">
          <div role="table" aria-label="Exposure map" className="bmap" style={{ '--cols': Math.max(cols.length, 1), minWidth: 214 + Math.max(cols.length, 1) * 100 } as CSSProperties}>
            <div role="row" className="bmap-row heads">
              <div role="columnheader" className="corner">
                {copy.positionHead}
              </div>
              {cols.map((c) => (
                <div key={c.id} role="columnheader" className="colhead">
                  <span className="t">{c.top}</span>
                  <span className="b">{c.bottom}</span>
                </div>
              ))}
            </div>
            {rows.map((r) => makeRow(r.id, r.title, sizeText(r.info), r, gmax))}
            {makeRow('book', copy.bookTotal, copy.allPositions, book, bmax, true)}
          </div>
        </div>
      </div>

      <div className="bento">
        <div className="card reading span-8" aria-live="polite">
          <div className="stack" style={{ gap: 2, minWidth: 150 }}>
            <span className={`big ${detailClass}`}>{pct ? (pv === null ? '—' : fmtP(pv)) : dv === null ? '—' : fmtV(dv)}</span>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {pct ? `${dv === null ? '—' : fmtV(dv)} in value` : `${pv === null ? '—' : fmtP(pv)} of its ${sizeWord}`}
            </span>
          </div>
          <div className="stack gap-10" style={{ flex: '1 1 380px' }}>
            <p className="lead">{sentence}</p>
            <div className="why-box">
              <span className="k">{copy.why}</span>
              <p>{whyText}</p>
            </div>
            <p className="context">{context}</p>
          </div>
        </div>
        <div className="card card-pad stack gap-10 span-4">
          <h3 className="card-title">All positions under {s.label}</h3>
          <ul className="col-list wide">
            {rows.map((r, k) => {
              const v = r.changes[j]
              const z = v === null || Math.abs(v) < 0.005
              const w = (Math.abs(cpct[k]) / cmax) * 50
              const on = !isBook && r.id === sel.r
              return (
                <li key={r.id}>
                  <span style={{ color: on ? 'var(--hi)' : z ? 'var(--ink-5)' : 'var(--ink-2)', fontWeight: on ? 500 : 400 }}>{r.title}</span>
                  <span aria-hidden="true" className="hbar">
                    <span className={`b ${cpct[k] < 0 ? 'bg-loss' : 'bg-gain'}`} style={{ left: `${cpct[k] < 0 ? 50 - w : 50}%`, width: `${w}%` }} />
                    <span className="z" />
                  </span>
                  <span style={{ textAlign: 'right', color: z ? 'var(--ink-6)' : cpct[k] < 0 ? 'var(--loss-ink)' : 'var(--gain-ink)' }}>{z ? '0' : txt(shown(r, j))}</span>
                </li>
              )
            })}
          </ul>
          <p className="note" style={{ margin: 'auto 0 0' }}>
            {copy.colNote}
          </p>
        </div>
      </div>
    </section>
  )
}
