import { TYPES, type TypeId } from '../content/instruments.ts'

export function Glyph({ path, active = false, small = false }: { path: string; active?: boolean; small?: boolean }) {
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className={`glyph${small ? ' glyph-sm' : ''}${active ? ' on' : ''}`}>
      <path d={path} />
    </svg>
  )
}

export default function TypePills({ selected, onPick, small = false }: { selected: TypeId; onPick: (t: TypeId) => void; small?: boolean }) {
  return (
    <div className="pills">
      {TYPES.map((t) => {
        const on = t.id === selected
        return (
          <button key={t.id} type="button" className={`pill${small ? ' pill-sm' : ''}${on ? ' selected-spectrum' : ''}`} aria-pressed={on} onClick={() => onPick(t.id)}>
            <Glyph path={t.path} active={on} small={small} />
            {t.name}
          </button>
        )
      })}
    </div>
  )
}
