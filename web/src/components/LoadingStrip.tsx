import manifest from '../engine/manifest.json'
import type { BookStatus, EngineStatus } from '../engine/client.ts'
import { copy } from '../content/book.ts'

// How far along the first load is: the engine, then pandas for the book
export default function LoadingStrip({ status, book }: { status: EngineStatus; book: BookStatus }) {
  let label = copy.loadingEngine
  let detail = ''
  let f = 0
  if (status.state === 'loading') {
    const p = status.progress
    if (p) {
      detail = `${p.label} · ${(p.bytes / 1e6).toFixed(1)} MB`
      f = p.step <= 2 ? Math.min(0.99, p.bytes / manifest.expectedBytes) * 0.8 : 0.8 + ((p.step - 2) / (p.steps - 1)) * 0.2
    }
  } else if (book.state === 'loading') {
    label = copy.loadingPandas
    const p = book.progress
    if (p) {
      detail = `${p.label} · ${(p.bytes / 1e6).toFixed(1)} MB`
      f = p.done ? 1 : p.step === 1 ? Math.min(0.99, p.bytes / manifest.bookExpectedBytes) * 0.8 : 0.9
    }
  } else return null
  return (
    <div className="card load-strip" role="status" aria-live="polite">
      <span className="title">{label}</span>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
        <span style={{ width: `${Math.max(3, f * 100)}%` }} />
      </div>
      <span className="meta">{detail}</span>
    </div>
  )
}
