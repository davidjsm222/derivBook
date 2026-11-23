import { useEffect, useMemo, useState } from 'react'
import { useExplore } from '../engine/client.ts'
import { Glyph } from '../components/TypePills.tsx'
import { specTerms, typeById, type TypeId } from '../content/instruments.ts'
import { copy, priceError } from '../content/explorer.ts'
import { loadJSON, saveJSON } from '../lib/storage.ts'
import SetupForm from './SetupForm.tsx'
import ValueChart from './ValueChart.tsx'
import ValueTile from './ValueTile.tsx'
import MarketInputs from './MarketInputs.tsx'
import Sensitivities from './Sensitivities.tsx'
import { blankDraft, check, examples, instView, setupSettings, toArgs, toSetup, type Draft, type Settings, type Setup } from './setup.ts'

const STORAGE_KEY = 'derivbook.explorer.v1'

interface Saved {
  type: TypeId
  draft: Draft
  mode: 'setup' | 'explore'
  setup: Setup | null
}

const initial: Saved = { type: 'ecall', draft: blankDraft(), mode: 'setup', setup: null }

// A saved setup is only trusted if it still has the shape this page writes
function validSaved(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const s = x as Partial<Saved>
  if (!s.type || !typeById(s.type) || !s.draft || typeof s.draft !== 'object') return false
  if (s.mode !== 'setup' && s.mode !== 'explore') return false
  if (s.mode === 'explore' && (!s.setup || typeof s.setup.id !== 'number')) return false
  return Object.keys(blankDraft()).every((k) => typeof (s.draft as unknown as Record<string, unknown>)[k] === 'string')
}

export default function Explorer() {
  const [saved, setSaved] = useState<Saved>(() => loadJSON(STORAGE_KEY, initial, validSaved))
  const [tried, setTried] = useState(false)
  const inst = useMemo(() => (saved.setup ? instView(saved.setup) : null), [saved.setup])
  const [settings, setSettings] = useState<Settings | null>(() => (inst ? setupSettings(inst) : null))
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => saveJSON(STORAGE_KEY, saved), [saved])

  const exploring = saved.mode === 'explore' && saved.setup && inst && settings
  const args = useMemo(
    () => (exploring ? toArgs(saved.setup as Setup, inst, settings) : null),
    [exploring, saved.setup, inst, settings],
  )
  const { outcome, current, error, status } = useExplore(args)
  const r = outcome && inst && outcome.result.id === inst.id ? outcome.result : null
  const pending = status.state === 'ready' && !current && !error

  const update = (next: Partial<Saved>) => setSaved((s) => ({ ...s, ...next }))

  const submit = () => {
    if (Object.keys(check(saved.type, saved.draft).errors).length) {
      setTried(true)
      return
    }
    const setup = toSetup(saved.type, saved.draft, (saved.setup?.id ?? 0) + 1)
    setTried(false)
    setHover(null)
    setSettings(setupSettings(instView(setup)))
    update({ setup, mode: 'explore' })
    window.scrollTo({ top: 0 })
  }

  if (!exploring) {
    return (
      <main className="shell explorer">
        <section className="intro" aria-labelledby="x-title">
          <h1 id="x-title" className="display">
            {copy.title}
          </h1>
          <p>{copy.intro}</p>
        </section>
        <SetupForm
          type={saved.type}
          draft={saved.draft}
          tried={tried}
          onType={(t) => update({ type: t })}
          onDraft={(d) => update({ draft: d })}
          onSubmit={submit}
          onClear={() => {
            setTried(false)
            update({ draft: blankDraft() })
          }}
          onExample={(i) => {
            setTried(false)
            update({ type: examples[i].type, draft: { ...examples[i].draft } })
          }}
        />
      </main>
    )
  }

  const t = typeById(saved.setup!.type)
  return (
    <main className="shell explorer">
      <div className="card inst-bar">
        <Glyph path={t.path} active />
        <span className="name">{t.name}</span>
        <span className="terms">{specTerms(saved.setup!)}</span>
        <span className="actions">
          <button type="button" className="secondary-btn sm" onClick={() => update({ mode: 'setup' })}>
            {copy.editSetup}
          </button>
          <button
            type="button"
            className="primary-btn sm"
            onClick={() => {
              setTried(false)
              update({ mode: 'setup', draft: blankDraft() })
            }}
          >
            {copy.newInstrument}
          </button>
        </span>
      </div>

      <section className="intro" aria-labelledby="d-title">
        <h1 id="d-title" className="display">
          {inst.title}
        </h1>
        <p>{inst.description}</p>
      </section>

      {error && (
        <p className="error-note" role="alert">
          {priceError(error)}
        </p>
      )}

      <div className="bento">
        <ValueChart inst={inst} r={r} status={status} hover={hover} setHover={setHover} pending={pending} />
        <div className="span-4 stack gap-12">
          <ValueTile inst={inst} r={r} />
          <MarketInputs
            inst={inst}
            settings={settings}
            r={r}
            onSet={(k, v) => setSettings((s) => (s ? { ...s, [k]: v } : s))}
            onReset={() => {
              setSettings(setupSettings(inst))
              setHover(null)
            }}
          />
        </div>
      </div>

      <Sensitivities inst={inst} r={r} />
    </main>
  )
}
