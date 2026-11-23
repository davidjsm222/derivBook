import { useMemo, useRef, useState } from 'react'
import { useBookPricing } from '../engine/client.ts'
import { copy, fmtAbs, setCard } from '../content/book.ts'
import { priceError } from '../content/explorer.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import LoadingStrip from '../components/LoadingStrip.tsx'
import { bookStore, useBookStore } from '../state/bookStore.ts'
import MarketCard from './MarketCard.tsx'
import PositionsCard from './PositionsCard.tsx'
import { bookView, sameBook, setBookIssue, type BookState } from './model.ts'

const RECOMPUTE_PAUSE_MS = 300

// The card at the bottom: why the book can't be set yet, or set it, or say
// whether the Exposure tab is running this version
function SetBookCard({ issue, state, setAt }: { issue: keyof typeof setCard.issues | ''; state: 'never' | 'same' | 'changed'; setAt: string }) {
  const setAndGo = () => {
    bookStore.setTheBook()
    window.location.hash = '#/exposure'
  }
  let title = setCard.readyTitle
  let note = setCard.readyNote
  let noteClass = 'sentence'
  let button = (
    <button type="button" className="primary-btn md" onClick={setAndGo}>
      {setCard.setButton}
    </button>
  )
  if (issue) {
    note = setCard.issues[issue]
    noteClass = 'sentence loss'
    button = (
      <button type="button" className="primary-btn md" disabled aria-describedby="set-note">
        {setCard.setButton}
      </button>
    )
  } else if (state === 'same') {
    title = setCard.setTitle
    note = setCard.setNote(setAt)
    button = (
      <a className="primary-btn md link-btn" href="#/exposure">
        {setCard.open}
      </a>
    )
  } else if (state === 'changed') {
    title = setCard.changedTitle
    note = setCard.changedNote(setAt)
    button = (
      <button type="button" className="primary-btn md" onClick={setAndGo}>
        {setCard.setAgain}
      </button>
    )
  }
  return (
    <section className="card set-card" aria-labelledby="set-title">
      <div className="stack" style={{ gap: 6 }}>
        <h2 id="set-title" className="set-title">
          {title}
        </h2>
        <p id="set-note" className={noteClass}>
          {note}
        </p>
      </div>
      {button}
    </section>
  )
}

export default function Book() {
  const { live, nextId, setBook } = useBookStore()
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The cards read a book plus scenario choices; on this tab there are none
  const st: BookState = useMemo(() => ({ ...live, off: {}, custom: [], nextId }), [live, nextId])
  const view = useMemo(() => bookView(st, false), [st])

  // Live pricing of the positions: no scenarios run from this tab
  const args = useDebounced(view.args, RECOMPUTE_PAUSE_MS)
  const { outcome, error, status, bookStatus } = useBookPricing(args)
  const report = outcome?.result ?? null

  const updateLive = (next: Partial<BookState>) => {
    const out: Parameters<typeof bookStore.updateLive>[0] = {}
    if (next.rate !== undefined) out.rate = next.rate
    if (next.unds !== undefined) out.unds = next.unds
    if (next.positions !== undefined) out.positions = next.positions
    if (next.nextId !== undefined) out.nextId = next.nextId
    bookStore.updateLive(out)
  }

  const empty = live.unds.length === 0 && live.positions.length === 0
  const addUnd = () =>
    updateLive({ unds: [...live.unds, { id: `u${nextId}`, name: '', spot: '', vol: '', q: '', cs: '', touched: false }], nextId: nextId + 1 })

  const clear = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 4000)
      return
    }
    setConfirmClear(false)
    bookStore.clearLive()
  }

  const issue = setBookIssue(view, st)
  const setState = !setBook ? 'never' : sameBook(live, setBook) ? 'same' : 'changed'

  const validCount = view.valid.length
  const stats = validCount
    ? [
        { label: copy.stats.value, value: report && report.book.value !== null ? fmtAbs(report.book.value) : '—' },
        { label: copy.stats.positions, value: String(validCount) + (view.rows.length > validCount ? ` of ${view.rows.length}` : '') },
      ]
    : []

  return (
    <main className="shell book">
      <section aria-labelledby="b-title" className="book-head">
        <div className="stack" style={{ gap: 10, flex: '1 1 520px' }}>
          <div className="title-row">
            <h1 id="b-title" className="display">
              {copy.title}
            </h1>
            {!empty && (
              <button type="button" className={`clear-btn${confirmClear ? ' armed' : ''}`} onClick={clear}>
                {confirmClear ? copy.confirmClear : copy.clearBook}
              </button>
            )}
          </div>
          <p className="book-intro">{copy.intro}</p>
        </div>
        {stats.length > 0 && (
          <dl className="stats">
            {stats.map((x) => (
              <div key={x.label}>
                <dt>{x.label}</dt>
                <dd>{x.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {empty && (
        <div className="card empty-card">
          <div className="stack" style={{ gap: 8, maxWidth: 640 }}>
            <h2 className="empty-title">{copy.emptyTitle}</h2>
            <p className="book-intro">{copy.emptyText}</p>
          </div>
          <div className="form-actions" style={{ gap: 10 }}>
            <button type="button" className="primary-btn md" onClick={() => bookStore.loadExample()}>
              {copy.loadExample}
            </button>
            <button type="button" className="secondary-btn md" onClick={addUnd}>
              {copy.addUnd}
            </button>
          </div>
        </div>
      )}

      <MarketCard st={st} mk={view.mk} onChange={updateLive} onAddUnd={addUnd} showAllErrors={live.positions.length > 0} />
      <PositionsCard st={st} mk={view.mk} rows={view.rows} report={report} onChange={updateLive} />

      {view.args && !outcome && <LoadingStrip status={status} book={bookStatus} />}
      {error && (
        <p className="error-note" role="alert">
          {priceError(error)}
        </p>
      )}

      <SetBookCard issue={issue} state={setState} setAt={setBook?.setAt ?? ''} />
    </main>
  )
}
