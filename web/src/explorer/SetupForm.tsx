import type { FormEvent } from 'react'
import Field from '../components/Field.tsx'
import TypePills from '../components/TypePills.tsx'
import { needs, typeById, type TypeId } from '../content/instruments.ts'
import { copy } from '../content/explorer.ts'
import { check, examples, type Draft, type DraftKey } from './setup.ts'

interface FieldDef {
  key: DraftKey
  label: string
  unit: string
  placeholder: string
  hint: string
}

export default function SetupForm({
  type,
  draft,
  tried,
  onType,
  onDraft,
  onSubmit,
  onClear,
  onExample,
}: {
  type: TypeId
  draft: Draft
  tried: boolean
  onType: (t: TypeId) => void
  onDraft: (d: Draft) => void
  onSubmit: () => void
  onClear: () => void
  onExample: (i: number) => void
}) {
  const need = needs(type)
  const { errors } = check(type, draft)
  const shown = tried ? errors : {}
  const t = typeById(type)

  const terms: FieldDef[] = []
  const market: FieldDef[] = []
  if (need.und) terms.push({ key: 'und', label: 'Underlying', unit: '', placeholder: 'e.g. SPX', hint: 'A name for the labels' })
  if (need.K) terms.push({ key: 'K', label: 'Strike', unit: '', placeholder: 'e.g. 6000', hint: 'The price you can buy or sell at' })
  if (need.exp) terms.push({ key: 'exp', label: 'Time to expiry', unit: 'years', placeholder: 'e.g. 0.5', hint: '0.25 is three months' })
  if (need.face) terms.push({ key: 'face', label: 'Face value', unit: '', placeholder: 'e.g. 1000', hint: 'Paid back at maturity' })
  if (need.ratio) terms.push({ key: 'ratio', label: 'Conversion ratio', unit: 'shares', placeholder: 'e.g. 20', hint: 'Shares received per bond' })
  if (need.S0) market.push({ key: 'S0', label: 'Spot', unit: '', placeholder: 'e.g. 6000', hint: 'Today’s price of the underlying' })
  if (need.vol) market.push({ key: 'vol', label: 'Volatility', unit: '%', placeholder: 'e.g. 18', hint: 'Yearly, as a percent' })
  if (need.q) market.push({ key: 'q', label: 'Dividend yield', unit: '%', placeholder: '0', hint: 'Leave blank for none' })
  market.push({ key: 'r', label: 'Interest rate', unit: '%', placeholder: 'e.g. 4', hint: 'Yearly risk-free rate' })
  if (need.cs) market.push({ key: 'cs', label: 'Credit spread', unit: 'bp', placeholder: 'e.g. 250', hint: 'Extra yield the issuer pays over the rate' })
  const groups = [
    { title: copy.contractTerms, fields: terms },
    { title: copy.market, fields: market },
  ].filter((g) => g.fields.length)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit()
  }

  return (
    <div className="bento setup">
      <form className="card setup-form span-8" onSubmit={submit} noValidate>
        <fieldset>
          <legend>{copy.instrument}</legend>
          <TypePills selected={type} onPick={onType} />
          <p className="type-note">{t.note}</p>
        </fieldset>
        {groups.map((g) => (
          <fieldset key={g.title}>
            <legend>{g.title}</legend>
            <div className="field-grid">
              {g.fields.map((f) => (
                <Field
                  key={f.key}
                  label={f.label}
                  unit={f.unit}
                  placeholder={f.placeholder}
                  hint={f.hint}
                  value={draft[f.key]}
                  error={shown[f.key]}
                  inputMode={f.key === 'und' ? 'text' : 'decimal'}
                  onChange={(v) => onDraft({ ...draft, [f.key]: v })}
                />
              ))}
            </div>
          </fieldset>
        ))}
        <div className="form-actions">
          <button type="submit" className="primary-btn">
            {copy.explore}
          </button>
          <button type="button" className="secondary-btn" onClick={onClear}>
            {copy.clear}
          </button>
          <span role="status" className="form-error">
            {tried && Object.keys(errors).length ? copy.formError : ''}
          </span>
        </div>
      </form>
      <aside className="span-4 stack gap-12">
        <section className="card card-pad stack gap-10" aria-labelledby="ex-title">
          <h2 id="ex-title" className="card-title">
            {copy.examplesTitle}
          </h2>
          <p className="small-note">{copy.examplesNote}</p>
          {examples.map((ex, i) => (
            <button key={ex.name} type="button" className="example" onClick={() => onExample(i)}>
              <span className="n">{ex.name}</span>
              <span className="s">{ex.sub}</span>
            </button>
          ))}
        </section>
        <section className="card card-pad stack" style={{ gap: 8 }} aria-labelledby="pr-title">
          <h2 id="pr-title" className="card-title">
            {copy.pricedTitle}
          </h2>
          <p className="sentence">{t.pricing}</p>
        </section>
        <section className="card card-pad stack" style={{ gap: 8 }} aria-labelledby="lv-title">
          <h2 id="lv-title" className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {copy.liveTitle} <span className="badge">{copy.soon}</span>
          </h2>
          <p className="sentence">{copy.liveNote}</p>
        </section>
      </aside>
    </div>
  )
}
