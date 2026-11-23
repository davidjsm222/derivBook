import { useMemo, type ReactNode } from 'react'
import { useExposureReport } from '../engine/client.ts'
import { copy, exposureCopy, fmtAbs } from '../content/book.ts'
import { priceError } from '../content/explorer.ts'
import { useDebounced } from '../lib/useDebounced.ts'
import LoadingStrip from '../components/LoadingStrip.tsx'
import { bookStore, useBookStore, type Choices } from '../state/bookStore.ts'
import { bookView, posTitle, type BookState, type SetBook } from '../book/model.ts'
import ScenariosCard from './ScenariosCard.tsx'
import BookMap, { type MapRow, type MapView } from './BookMap.tsx'
import Combined, { type ComboView } from './Combined.tsx'

const RECOMPUTE_PAUSE_MS = 300

function Intro({ children }: { children?: ReactNode }) {
  return (
    <section aria-labelledby="x-title" className="book-head">
      <div className="stack" style={{ gap: 10, flex: '1 1 520px' }}>
        <h1 id="x-title" className="display">
          {exposureCopy.title}
        </h1>
        <p className="book-intro">{exposureCopy.intro}</p>
      </div>
      {children}
    </section>
  )
}

// Runs the set book, and only the set book, through the scenarios that are on.
// Python is asked again only when the set book or the scenario choices change.
function Run({ setBook, choices, nextId }: { setBook: SetBook; choices: Choices; nextId: number }) {
  const st: BookState = useMemo(
    () => ({ rate: setBook.rate, unds: setBook.underlyings, positions: setBook.positions, off: choices.off, custom: choices.custom, nextId }),
    [setBook, choices.off, choices.custom, nextId],
  )
  const view = useMemo(() => bookView(st), [st])
  const args = useDebounced(view.args, RECOMPUTE_PAUSE_MS)
  const { outcome, error, status, bookStatus } = useExposureReport(args)
  const report = outcome?.result ?? null
  const waitingOnPython = view.args !== null && (!outcome || JSON.stringify(outcome.args) !== JSON.stringify(view.args)) && !error

  // The last result, drawn with the set book's labels. Columns switched off or
  // deleted since are left out until the next result arrives.
  const mapView: MapView | null = useMemo(() => {
    if (!outcome) return null
    const r = outcome.result
    const scenById = new Map(view.scen.map((s) => [s.id, s]))
    const resultCols = r.scenarios.filter((s) => scenById.has(s.id))
    const cols = resultCols.map((s) => scenById.get(s.id)!)
    const rowById = new Map(view.rows.map((x) => [x.p.id, x]))
    const rows: MapRow[] = r.positions
      .filter((p) => rowById.has(p.id) && rowById.get(p.id)!.info.ok)
      .map((p) => {
        const x = rowById.get(p.id)!
        return {
          id: p.id,
          p: x.p,
          info: x.info,
          title: posTitle(st, x.p),
          isFut: x.p.type === 'fut' || x.p.type === 'sofr',
          changes: resultCols.map((s) => s.changes[p.id] ?? null),
          pcts: resultCols.map((s) => s.pct_of_size[p.id] ?? null),
        }
      })
    if (!rows.length || !cols.length) return null
    return { rows, cols, book: { changes: resultCols.map((s) => s.total), pcts: resultCols.map((s) => s.total_pct_of_gross) } }
  }, [outcome, view, st])

  const combos: ComboView[] = useMemo(() => {
    if (!outcome || !mapView) return []
    return outcome.result.interactions
      .map((it) => {
        const s = mapView.cols.find((c) => c.id === it.id)
        if (!s || !s.multi) return null
        return { s, book: it.book, per: mapView.rows.map((row) => ({ row, data: it.positions[row.id] })).filter((x) => x.data) }
      })
      .filter((x): x is ComboView => x !== null)
  }, [outcome, mapView])

  const stats = [
    { label: copy.stats.value, value: report && report.book.value !== null ? fmtAbs(report.book.value) : '—' },
    { label: copy.stats.positions, value: String(view.valid.length) },
    { label: copy.stats.running, value: String(view.cols.length) },
  ]
  const setChoices = (next: Partial<BookState>) => {
    const out: Parameters<typeof bookStore.updateChoices>[0] = {}
    if (next.off !== undefined) out.off = next.off
    if (next.custom !== undefined) out.custom = next.custom
    if (next.nextId !== undefined) out.nextId = next.nextId
    bookStore.updateChoices(out)
  }

  return (
    <main className="shell book">
      <Intro>
        <div className="stack" style={{ gap: 10, alignItems: 'flex-end' }}>
          <dl className="stats">
            {stats.map((x) => (
              <div key={x.label}>
                <dt>{x.label}</dt>
                <dd>{x.value}</dd>
              </div>
            ))}
          </dl>
          <a className="edit-link" href="#/book">
            {exposureCopy.editBook}
          </a>
        </div>
      </Intro>

      <ScenariosCard st={st} mk={view.mk} scen={view.scen} hasPositions={view.valid.length > 0} onChange={setChoices} />

      {view.args && !outcome && <LoadingStrip status={status} book={bookStatus} />}
      {error && (
        <p className="error-note" role="alert">
          {priceError(error)}
        </p>
      )}

      {mapView && view.cols.length > 0 && (
        <BookMap
          st={st}
          view={mapView}
          units={choices.units}
          setUnits={(units) => bookStore.updateChoices({ units })}
          sel={choices.sel}
          setSel={(sel) => bookStore.updateChoices({ sel })}
          updating={waitingOnPython}
        />
      )}
      {combos.length > 0 && view.cols.length > 0 && (
        <Combined
          st={st}
          combos={combos}
          combo={choices.combo}
          setCombo={(combo) => bookStore.updateChoices({ combo })}
          comboPos={choices.comboPos}
          setComboPos={(comboPos) => bookStore.updateChoices({ comboPos })}
        />
      )}
    </main>
  )
}

export default function Exposure() {
  const { setBook, choices, nextId } = useBookStore()
  if (!setBook) {
    // Nothing set: one card, and no engine call
    return (
      <main className="shell book">
        <Intro />
        <div className="card empty-card">
          <div className="stack" style={{ gap: 8, maxWidth: 640 }}>
            <h2 className="empty-title">{exposureCopy.emptyTitle}</h2>
            <p className="book-intro">{exposureCopy.emptyText}</p>
          </div>
          <a className="primary-btn md link-btn" href="#/book">
            {exposureCopy.goToBook}
          </a>
        </div>
      </main>
    )
  }
  return <Run setBook={setBook} choices={choices} nextId={nextId} />
}
