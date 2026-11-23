import { useId } from 'react'

// A labeled text field with a unit, a hint, and an inline error that replaces the hint
export default function Field({
  label,
  value,
  onChange,
  unit,
  placeholder,
  hint,
  error,
  inputMode = 'decimal',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  unit?: string
  placeholder?: string
  hint?: string
  error?: string
  inputMode?: 'decimal' | 'text'
}) {
  const id = useId()
  const bad = Boolean(error)
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <span className={`fld${bad ? ' bad' : ''}`}>
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          aria-invalid={bad}
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
      <span id={`${id}-hint`} className={`field-hint${bad ? ' bad' : ''}`}>
        {bad ? error : hint}
      </span>
    </div>
  )
}
