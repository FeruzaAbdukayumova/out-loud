import type { Progress } from '../library/library'
import type { Text } from '../library/texts'

interface Props {
  texts: Text[]
  selectedId: string
  progress: Map<string, Progress>
  onSelect: (id: string) => void
  onAdd: () => void
}

export function Picker({ texts, selectedId, progress, onSelect, onAdd }: Props) {
  return (
    <div className="picker" role="group" aria-label="Choose a text">
      {texts.map((t) => {
        const best = progress.get(t.id)?.best
        return (
          <button key={t.id} className="pill" aria-pressed={t.id === selectedId} onClick={() => onSelect(t.id)}>
            {t.title}
            {best !== undefined && (
              <>
                <span className="sr">, best {best}%</span>
                <span className="best" aria-hidden="true">
                  {best}%
                </span>
              </>
            )}
          </button>
        )
      })}
      <button className="pill add" onClick={onAdd}>
        + Your own text
      </button>
    </div>
  )
}
