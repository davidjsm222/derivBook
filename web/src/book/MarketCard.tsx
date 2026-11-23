import { copy } from '../content/book.ts'
import type { BookState, MarketRead, Und } from './model.ts'

const CELLS: { key: keyof Pick<Und, 'name' | 'spot' | 'vol' | 'q' | 'cs'>; placeholder: string; aria: string }[] = [
  { key: 'name', placeholder: 'e.g. SPX', aria: 'Name' },
  { key: 'spot', placeholder: 'e.g. 6000', aria: 'Spot' },
  { key: 'vol', placeholder: 'e.g. 18', aria: 'Volatility' },
  { key: 'q', placeholder: '0', aria: 'Dividend yield' },
  { key: 'cs', placeholder: 'Only for convertibles', aria: 'Credit spread' },
]

export default function MarketCard({
  st,
  mk,
  onChange,
  onAddUnd,
  showAllErrors = false,
}: {
  st: BookState
  mk: MarketRead
  onChange: (next: Partial<BookState>) => void
  onAddUnd: () => void
  // Show errors on rows nobody has typed in yet too (once they block setting the book)
  showAllErrors?: boolean
}) {
  const rateBad = Boolean(mk.rateErr) && (st.rate !== '' || st.positions.length > 0)
  const usedBy = (id: string) => st.positions.filter((p) => p.und === id).length

  return (
    <section className="card book-card" aria-labelledby="mk-title">
      <div className="card-head">
        <div className="stack gap-4">
          <h2 id="mk-title" className="book-card-title">
            {copy.marketTitle}
          </h2>
          <p className="sentence">{copy.marketNote}</p>
        </div>
        <span className="soon-chip">
          {copy.pullLive} <span className="badge">{copy.soon}</span>
        </span>
      </div>
      <div className="rate-row">
        <label htmlFor="bk-rate" className="field-label">
          {copy.rate}
        </label>
        <span className={`fld sm rate-fld${rateBad ? ' bad' : ''}`}>
          <input
            id="bk-rate"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={st.rate}
            placeholder="e.g. 4"
            aria-invalid={rateBad}
            aria-describedby="bk-rate-hint"
            onChange={(e) => onChange({ rate: e.target.value })}
          />
          <span className="unit">%</span>
        </span>
        <span id="bk-rate-hint" className={`field-hint${rateBad ? ' bad' : ''}`}>
          {rateBad ? mk.rateErr : copy.rateHint}
        </span>
      </div>
      <div className="table-scroll">
        <div role="table" aria-label="Underlyings" className="und-table">
          <div role="row" className="und-row head">
            {copy.undHeads.map((h) => (
              <span key={h} role="columnheader">
                {h}
              </span>
            ))}
            <span />
          </div>
          {st.unds.map((u, i) => {
            const e = u.touched || showAllErrors ? mk.errs[u.id] ?? {} : {}
            const n = usedBy(u.id)
            const edit = (k: keyof Und, v: string) => {
              const list = st.unds.slice()
              list[i] = { ...list[i], [k]: v, touched: true }
              onChange({ unds: list })
            }
            return (
              <div key={u.id} role="row" className="und-row">
                {CELLS.map((c) => {
                  const bad = Boolean(e[c.key])
                  return (
                    <span key={c.key} role="cell" className="stack gap-4">
                      <span className={`fld sm${bad ? ' bad' : ''}`}>
                        <input
                          type="text"
                          inputMode={c.key === 'name' ? 'text' : 'decimal'}
                          autoComplete="off"
                          value={u[c.key]}
                          placeholder={c.placeholder}
                          aria-label={`${c.aria}${u.name ? ` for ${u.name}` : ''}`}
                          aria-invalid={bad}
                          onChange={(ev) => edit(c.key, ev.target.value)}
                        />
                      </span>
                      <span className="cell-error">{e[c.key] ?? ''}</span>
                    </span>
                  )
                })}
                <button
                  type="button"
                  className="icon-btn"
                  disabled={n > 0}
                  aria-label={`Remove ${u.name || 'this underlying'}`}
                  title={n ? `Used by ${n}${n === 1 ? ' position' : ' positions'}` : ''}
                  onClick={() => onChange({ unds: st.unds.filter((x) => x.id !== u.id) })}
                >
                  {'×'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {st.unds.length === 0 && <p className="small-note">{copy.noUnds}</p>}
      <div>
        <button type="button" className="secondary-btn md" onClick={onAddUnd}>
          {copy.addUnderlying}
        </button>
      </div>
    </section>
  )
}
