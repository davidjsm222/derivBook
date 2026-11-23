import type { ExploreResult } from '../engine/types.ts'
import { tick, timeLeft } from '../lib/format.ts'
import { copy } from '../content/explorer.ts'
import { setupSettings, type ExplorerInst, type Settings } from './setup.ts'

interface SliderSpec {
  key: keyof Settings
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  base: number
  valueText: string
  lo: string
  hi: string
  baseText: string
}

function Slider({ s, onSet }: { s: SliderSpec; onSet: (k: keyof Settings, v: number) => void }) {
  const span = s.max - s.min
  const p = ((s.value - s.min) / span) * 100
  const b = ((s.base - s.min) / span) * 100
  const a = Math.min(p, b)
  const z = Math.max(p, b)
  const off = 'rgba(var(--fg), 0.12)'
  const on = 'var(--acc)'
  const fill = `linear-gradient(90deg, ${off} 0%, ${off} ${a}%, ${on} ${a}%, ${on} ${z}%, ${off} ${z}%, ${off} 100%)`
  const set = (v: number) => onSet(s.key, Math.min(s.max, Math.max(s.min, v)))
  return (
    <div className="stack" style={{ gap: 2 }}>
      <div className="slider-head">
        <label htmlFor={s.id}>{s.label}</label>
        <div className="stepper">
          <button type="button" aria-label={`Decrease ${s.label.toLowerCase()}`} onClick={() => set(s.value - s.step)} disabled={s.value <= s.min}>
            {'−'}
          </button>
          <output htmlFor={s.id}>{s.valueText}</output>
          <button type="button" aria-label={`Increase ${s.label.toLowerCase()}`} onClick={() => set(s.value + s.step)} disabled={s.value >= s.max}>
            +
          </button>
        </div>
      </div>
      <div className="track">
        <input
          className="rng"
          id={s.id}
          type="range"
          min={s.min}
          max={s.max}
          step={s.step}
          value={s.value}
          aria-valuetext={s.valueText}
          onChange={(e) => set(Number(e.target.value))}
          style={{ backgroundImage: fill }}
        />
        <span aria-hidden="true" className="base-mark" style={{ left: `${b}%` }} />
      </div>
      <div className="slider-ends">
        <span>{s.lo}</span>
        <span>{s.baseText}</span>
        <span>{s.hi}</span>
      </div>
    </div>
  )
}

export default function MarketInputs({
  inst,
  settings,
  r,
  onSet,
  onReset,
}: {
  inst: ExplorerInst
  settings: Settings
  r: ExploreResult | null
  onSet: (k: keyof Settings, v: number) => void
  onReset: () => void
}) {
  const base = setupSettings(inst)
  const a = inst.applies
  const und = inst.underlying
  const list: SliderSpec[] = []

  if (a.spot && inst.setup.spot !== null) {
    const range = inst.spotRangePct
    const level = inst.setup.spot * (1 + settings.spotPct / 100)
    list.push({
      key: 'spotPct', id: 'in-spot', label: `${und} spot`,
      min: -range, max: range, step: 1, value: settings.spotPct, base: 0,
      valueText: tick(level) + (settings.spotPct ? ` (${settings.spotPct > 0 ? '+' : '−'}${Math.abs(settings.spotPct)}%)` : ''),
      lo: `−${range}%`, hi: `+${range}%`, baseText: `Setup ${tick(inst.setup.spot)}`,
    })
  }
  if (a.vol) {
    list.push({
      key: 'volPts', id: 'in-vol', label: 'Volatility',
      min: 1, max: inst.volMax, step: 1, value: settings.volPts, base: base.volPts,
      valueText: `${settings.volPts}%`, lo: '1%', hi: `${inst.volMax}%`, baseText: `Setup ${base.volPts}%`,
    })
  }
  if (inst.days) {
    const left = r && r.id === inst.id ? r.inputs.time_left_years : inst.expiry
    list.push({
      key: 'days', id: 'in-days', label: 'Time passed',
      min: 0, max: inst.days.max, step: inst.days.step, value: settings.days, base: 0,
      valueText: settings.days ? `${settings.days} ${settings.days === 1 ? 'day' : 'days'}` : 'None',
      lo: copy.today, hi: timeLeft(inst.days.leftAtMaxYears), baseText: timeLeft(left),
    })
  }
  list.push({
    key: 'rateBp', id: 'in-rate', label: 'Interest rate',
    min: 0, max: inst.rateMax, step: 5, value: settings.rateBp, base: base.rateBp,
    valueText: `${(settings.rateBp / 100).toFixed(2)}%`, lo: '0%', hi: `${inst.rateMax / 100}%`,
    baseText: `Setup ${(base.rateBp / 100).toFixed(2)}%`,
  })
  if (a.credit_spread) {
    list.push({
      key: 'creditBp', id: 'in-credit', label: `${und} credit spread`,
      min: 0, max: inst.creditMax, step: 5, value: settings.creditBp, base: base.creditBp,
      valueText: `${settings.creditBp} bp`, lo: '0 bp', hi: `${inst.creditMax.toLocaleString('en-US')} bp`,
      baseText: `Setup ${base.creditBp} bp`,
    })
  }

  const atBase = list.every((s) => s.value === s.base)
  return (
    <section className="card card-pad stack gap-12" aria-labelledby="i-title">
      <div className="slider-head">
        <h2 id="i-title" className="card-title">
          {copy.inputs}
        </h2>
        <button type="button" className="ghost-btn" onClick={onReset} disabled={atBase}>
          {copy.reset}
        </button>
      </div>
      {list.map((s) => (
        <Slider key={s.key} s={s} onSet={onSet} />
      ))}
    </section>
  )
}
