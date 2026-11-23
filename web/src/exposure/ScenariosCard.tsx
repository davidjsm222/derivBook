import { useState, type FormEvent } from 'react'
import { copy } from '../content/book.ts'
import { parseNum } from '../content/instruments.ts'
import { moveLabel, movesProblem, unitFor, type BookState, type MarketRead, type ScenarioView, type Target, type UiMove } from '../book/model.ts'

interface DraftMove {
  target: string // "spot:u1", "rate", ...
  amount: string
}

function parseMove(mv: DraftMove) {
  const [target, und = ''] = mv.target.split(':') as [Target, string?]
  const a = parseNum(mv.amount)
  let err = ''
  if (a === undefined) err = 'Required'
  else if (Number.isNaN(a) || a === 0) err = 'Non-zero number'
  else if (target === 'spot' && a <= -100) err = 'Above −100%'
  else if (target === 'time' && (a < 0 || a > 3650)) err = '0 to 3,650 days'
  return { target, und, amount: a as number, err }
}

export default function ScenariosCard({
  st,
  mk,
  scen,
  hasPositions,
  onChange,
}: {
  st: BookState
  mk: MarketRead
  scen: ScenarioView[]
  hasPositions: boolean
  onChange: (next: Partial<BookState>) => void
}) {
  const [open, setOpen] = useState(false)
  const [tried, setTried] = useState(false)
  const [name, setName] = useState('')
  const [moves, setMoves] = useState<DraftMove[]>([])

  const validUnds = st.unds.filter((u) => mk.U[u.id])
  const targets: { value: string; label: string }[] = []
  validUnds.forEach((u) => {
    const n = u.name.trim()
    targets.push(
      { value: `spot:${u.id}`, label: `${n} spot` },
      { value: `vol:${u.id}`, label: `${n} volatility` },
      { value: `q:${u.id}`, label: `${n} dividend yield` },
      { value: `cs:${u.id}`, label: `${n} credit spread` },
    )
  })
  targets.push({ value: 'rate', label: 'Interest rate' }, { value: 'time', label: 'Time passing' })

  // Each move on its own, then the checks that need the whole scenario: the same
  // input twice (interaction() can't split it), or a level pushed below zero
  const parsed = moves.map(parseMove)
  const seen = new Set<string>()
  const errs = parsed.map((m) => {
    if (m.err) return m.err
    const key = `${m.target}:${m.und}`
    if (seen.has(key)) return 'Already moved above'
    seen.add(key)
    const below = movesProblem([{ target: m.target, und: m.und, amount: m.amount }], mk)
    return below && below !== 'fix the market' ? `Takes ${below}` : ''
  })
  const nameErr = name.trim() ? '' : copy.nameErr
  const errCount = (nameErr ? 1 : 0) + errs.filter(Boolean).length

  const chip = (s: ScenarioView) => (
    <span key={s.id} className={`chip-toggle${s.on ? ' on' : ''}`}>
      <button
        type="button"
        aria-pressed={s.on}
        title={s.moves.map((m) => moveLabel(st, m)).join(', ')}
        disabled={Boolean(s.problem)}
        onClick={() => onChange({ off: { ...st.off, [s.id]: s.on } })}
      >
        {s.label}
        {s.problem ? ` (${s.problem})` : ''}
      </button>
      {s.group === 'custom' && (
        <button type="button" className="x" aria-label={`Delete ${s.label}`} onClick={() => onChange({ custom: st.custom.filter((c) => c.id !== s.id) })}>
          {'×'}
        </button>
      )}
    </span>
  )

  const groups = (['single', 'combo', 'custom'] as const)
    .map((g) => ({ g, title: copy.groups[g], chips: scen.filter((s) => s.group === g) }))
    .filter((x) => x.chips.length)

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (errCount) {
      setTried(true)
      return
    }
    const ms: UiMove[] = parsed.map((m) => ({ target: m.target, und: m.und, amount: m.amount }))
    onChange({ custom: [...st.custom, { id: `c${st.nextId}`, name: name.trim().slice(0, 40), moves: ms }], nextId: st.nextId + 1 })
    setOpen(false)
    setTried(false)
  }

  return (
    <section className="card book-card" aria-labelledby="sc-title">
      <div className="stack gap-4">
        <h2 id="sc-title" className="book-card-title">
          {copy.scenariosTitle}
        </h2>
        <p className="sentence">{copy.scenariosNote}</p>
      </div>
      {scen.length === 0 && <p className="small-note">{copy.noScen}</p>}
      {groups.map((g) => (
        <div key={g.g} className="stack" style={{ gap: 8 }}>
          <span className="group-title">{g.title}</span>
          <div className="chips-row">{g.chips.map(chip)}</div>
        </div>
      ))}

      {!open ? (
        hasPositions && (
          <div>
            <button
              type="button"
              className="secondary-btn md"
              onClick={() => {
                setOpen(true)
                setTried(false)
                setName('')
                setMoves([{ target: targets[0].value, amount: '' }])
              }}
            >
              {copy.createScenario}
            </button>
          </div>
        )
      ) : (
        <form className="sub-form" onSubmit={save} noValidate>
          <span className="sub-title">{copy.newScenario}</span>
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="sc-name" className="field-label">
              {copy.name}
            </label>
            <span className={`fld sm${tried && nameErr ? ' bad' : ''}`}>
              <input id="sc-name" type="text" autoComplete="off" value={name} placeholder="e.g. Hawkish surprise" onChange={(e) => setName(e.target.value)} />
            </span>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <span className="field-label">{copy.movesTogether}</span>
            {moves.map((mv, i) => {
              const bad = tried && Boolean(errs[i])
              const upd = (k: keyof DraftMove, v: string) => setMoves((all) => all.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
              return (
                <div key={i} className="stack gap-4">
                  <div className="move-row">
                    <span className="fld sm">
                      <select value={mv.target} aria-label={`Move ${i + 1} input`} onChange={(e) => upd('target', e.target.value)}>
                        {targets.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className={`fld sm${bad ? ' bad' : ''}`}>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={mv.amount}
                        placeholder={'e.g. −10'}
                        aria-label={`Move ${i + 1} size`}
                        aria-invalid={bad}
                        onChange={(e) => upd('amount', e.target.value)}
                      />
                      <span className="unit">{unitFor(parsed[i].target)}</span>
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={moves.length === 1}
                      aria-label={`Remove move ${i + 1}`}
                      onClick={() => setMoves((all) => all.filter((_, j) => j !== i))}
                    >
                      {'×'}
                    </button>
                  </div>
                  {bad && <span className="cell-error">{errs[i]}</span>}
                </div>
              )
            })}
            <div>
              <button type="button" className="dashed-btn" onClick={() => setMoves((all) => [...all, { target: targets[0].value, amount: '' }])}>
                {copy.addMove}
              </button>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="primary-btn md">
              {copy.saveScenario}
            </button>
            <button type="button" className="secondary-btn md" onClick={() => setOpen(false)}>
              {copy.cancel}
            </button>
            <span role="status" className="form-error">
              {tried && errCount ? nameErr || copy.movesErr : ''}
            </span>
          </div>
        </form>
      )}
    </section>
  )
}
