import manifest from '../engine/manifest.json'
import type { EngineStatus } from '../engine/client.ts'
import { copy } from '../content/explorer.ts'

// Bytes are counted as they arrive in the worker. The total is what Pyodide
// 314.0.7 plus numpy and scipy decode to, measured once for the pinned version,
// so the bar tracks the real download. Later steps fill the rest.
const DOWNLOAD_SHARE = 0.8

function fraction(status: EngineStatus): number {
  if (status.state === 'ready') return 1
  if (status.state !== 'loading' || !status.progress) return 0
  const p = status.progress
  if (p.done) return 1
  if (p.step <= 2) return Math.min(0.99, p.bytes / manifest.expectedBytes) * DOWNLOAD_SHARE
  return DOWNLOAD_SHARE + ((p.step - 2) / (p.steps - 1)) * (1 - DOWNLOAD_SHARE)
}

export default function LoadingPanel({ status }: { status: EngineStatus }) {
  if (status.state === 'error') {
    return (
      <div className="loading-panel" role="alert">
        <div className="loading-box">
          <span className="title">{copy.engineError}</span>
          <span className="error-note">{status.message}</span>
        </div>
      </div>
    )
  }
  const p = status.state === 'loading' ? status.progress : null
  const f = fraction(status)
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <div className="loading-box">
        <span className="title">{copy.loading}</span>
        <div
          className="progress"
          role="progressbar"
          aria-label="Python engine loading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(f * 100)}
          aria-valuetext={p ? `${p.label}, step ${p.step} of ${p.steps}` : 'Starting'}
        >
          <span style={{ width: `${Math.max(3, f * 100)}%` }} />
        </div>
        <div className="meta">
          <span>{p ? p.label : 'Starting the worker'}</span>
          <span>
            {p ? `Step ${p.step} of ${p.steps} · ${(p.bytes / 1e6).toFixed(1)} MB` : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
