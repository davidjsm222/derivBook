import { useState, type FormEvent } from 'react'
import Field from '../components/Field.tsx'
import TypePills, { Glyph } from '../components/TypePills.tsx'
import { needs, typeById, SOFR_EXPIRY } from '../content/instruments.ts'
import { copy, fmtAbs } from '../content/book.ts'
import { num } from '../lib/format.ts'
import type { BookReport } from '../engine/types.ts'
import { blankPos, checkPos, posTerms, posTitle, type BookState, type MarketRead, type Pos, type PosDraft, type PosInfo } from './model.ts'

export default function PositionsCard({
  st,
  mk,
  rows,
  report,
  onChange,
}: {
  st: BookState
  mk: MarketRead
  rows: { p: Pos; info: PosInfo }[]
  report: BookReport | null
  onChange: (next: Partial<BookState>) => void
}) {
  const validUnds = st.unds.filter((u) => mk.U[u.id])
  const [open, setOpen] = useState(false)
  const [tried, setTried] = useState(false)
  const [draft, setDraft] = useState<PosDraft>(() => blankPos('ecall', validUnds[0]?.id ?? ''))
  const priced = new Map((report?.positions ?? []).map((p) => [p.id, p]))

  const posUnd = mk.U[draft.und] ? draft.und : (validUnds[0]?.id ?? '')
  const chk = checkPos({ ...draft, und: posUnd }, mk)
  const pe = tried ? chk.e : {}
  const need = needs(draft.type)
  const edit = (k: keyof PosDraft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))

  const add = (e: FormEvent) => {
    e.preventDefault()
    const d = { ...draft, und: posUnd }
    const r = checkPos(d, mk)
    if (Object.keys(r.e).length) {
      setDraft(d)
      setTried(true)
      return
    }
    const p: Pos = {
      id: `p${st.nextId}`,
      type: d.type,
      und: d.type === 'sofr' ? '' : d.und,
      K: r.v.K,
      exp: d.type === 'sofr' ? SOFR_EXPIRY : (r.v.exp as number),
      face: r.v.face,
      ratio: r.v.ratio,
      qty: d.qty,
      mult: d.mult,
    }
    onChange({ positions: [...st.positions, p], nextId: st.nextId + 1 })
    setOpen(false)
    setTried(false)
    setDraft(blankPos(d.type, d.und))
  }

  const editPos = (id: string, k: 'qty' | 'mult', v: string) =>
    onChange({ positions: st.positions.map((x) => (x.id === id ? { ...x, [k]: v } : x)) })

  return (
    <section className="card book-card" aria-labelledby="ps-title">
      <div className="stack gap-4">
        <h2 id="ps-title" className="book-card-title">
          {copy.positionsTitle}
        </h2>
        <p className="sentence">{copy.positionsNote}</p>
      </div>
      <div className="table-scroll">
        <div role="table" aria-label="Positions" className="pos-table">
          <div role="row" className="pos-row head">
            {copy.posHeads.map((h, i) => (
              <span key={h} role="columnheader" style={i >= 4 ? { textAlign: 'right' } : undefined}>
                {h}
              </span>
            ))}
            <span />
          </div>
          {rows.map(({ p, info }) => {
            const t = typeById(p.type)
            const title = posTitle(st, p)
            const r = info.ok ? priced.get(p.id) : undefined
            const isFut = p.type === 'fut' || p.type === 'sofr'
            const note = !info.ok ? info.problem : r && isFut && r.notional !== null ? `Notional ${fmtAbs(r.notional)}` : ''
            return (
              <div key={p.id} role="row" className="pos-row">
                <span role="cell" className="pos-name">
                  <Glyph path={t.path} small />
                  <span className="stack">
                    <span className="n">{title}</span>
                    <span className="s">{t.name}</span>
                  </span>
                </span>
                <span role="cell" className="pos-terms">
                  {posTerms(p)}
                </span>
                <span role="cell" className={`fld sm${info.qtyErr ? ' bad' : ''}`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={p.qty}
                    aria-label={`Quantity of ${title}`}
                    aria-invalid={Boolean(info.qtyErr)}
                    onChange={(e) => editPos(p.id, 'qty', e.target.value)}
                  />
                </span>
                <span role="cell" className={`fld sm${info.multErr ? ' bad' : ''}`}>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={p.mult}
                    placeholder="1"
                    aria-label={`Multiplier of ${title}`}
                    aria-invalid={Boolean(info.multErr)}
                    onChange={(e) => editPos(p.id, 'mult', e.target.value)}
                  />
                </span>
                <span role="cell" className="num-cell">
                  {r && r.price !== null ? num(r.price, 2) : '—'}
                </span>
                <span role="cell" className="value-cell">
                  <span className="v">{r && r.value !== null ? (isFut ? '0' : fmtAbs(r.value)) : '—'}</span>
                  <span className={`s${info.ok ? '' : ' bad'}`}>{note}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${title}`}
                  onClick={() => onChange({ positions: st.positions.filter((x) => x.id !== p.id) })}
                >
                  {'×'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {st.positions.length === 0 && <p className="small-note">{copy.noPos}</p>}

      {!open ? (
        <div>
          <button
            type="button"
            className="primary-btn md"
            onClick={() => {
              setOpen(true)
              setTried(false)
              setDraft(blankPos(draft.type, posUnd))
            }}
          >
            {copy.addPosition}
          </button>
        </div>
      ) : (
        <form className="sub-form" onSubmit={add} noValidate>
          <div className="stack gap-10">
            <span className="sub-title">{copy.newPosition}</span>
            <TypePills small selected={draft.type} onPick={(type) => setDraft((d) => ({ ...d, type }))} />
            <span className="type-note">{typeById(draft.type).note}</span>
          </div>
          <div className="field-grid tight">
            {draft.type !== 'sofr' && (
              <div className="field">
                <label htmlFor="pos-und" className="field-label">
                  Underlying
                </label>
                <span className={`fld sm${pe.und ? ' bad' : ''}`}>
                  <select id="pos-und" value={posUnd} onChange={(e) => setDraft((d) => ({ ...d, und: e.target.value }))} aria-invalid={Boolean(pe.und)}>
                    {validUnds.length ? (
                      validUnds.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name.trim()}
                        </option>
                      ))
                    ) : (
                      <option value="">No underlyings yet</option>
                    )}
                  </select>
                </span>
                <span className={`field-hint${pe.und ? ' bad' : ''}`}>
                  {pe.und || (validUnds.length ? 'From the market above' : 'Add an underlying in the market first')}
                </span>
              </div>
            )}
            {need.K && <Field label="Strike" placeholder="e.g. 6000" hint="The price you can buy or sell at" value={draft.K} error={pe.K} onChange={edit('K')} />}
            {need.exp && <Field label="Time to expiry" unit="years" placeholder="e.g. 0.5" hint="0.25 is three months" value={draft.exp} error={pe.exp} onChange={edit('exp')} />}
            {need.face && <Field label="Face value" placeholder="e.g. 1000" hint="Paid back at maturity" value={draft.face} error={pe.face} onChange={edit('face')} />}
            {need.ratio && <Field label="Conversion ratio" unit="shares" placeholder="e.g. 20" hint="Shares per bond" value={draft.ratio} error={pe.ratio} onChange={edit('ratio')} />}
            <Field label="Quantity" placeholder="e.g. 10" hint="Negative for a short position" value={draft.qty} error={pe.qty} onChange={edit('qty')} />
            <Field label="Multiplier" placeholder="1" hint="Contract size, e.g. 100 for most US options" value={draft.mult} error={pe.mult} onChange={edit('mult')} />
          </div>
          <div className="form-actions">
            <button type="submit" className="primary-btn md">
              {copy.addToBook}
            </button>
            <button
              type="button"
              className="secondary-btn md"
              onClick={() => {
                setOpen(false)
                setTried(false)
              }}
            >
              {copy.cancel}
            </button>
            <span role="status" className="form-error">
              {tried && Object.keys(chk.e).length ? copy.posError : ''}
            </span>
          </div>
        </form>
      )}
    </section>
  )
}
