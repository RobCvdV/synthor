import { type ChangeEvent, useState } from 'react'
import type { Doc, Id } from '../domain/types'
import { useDocStore } from '../state/docStore'

interface Props {
  doc: Doc
}

export function SongBar({ doc }: Props) {
  const addSection = useDocStore((s) => s.addSection)
  const removeSection = useDocStore((s) => s.removeSection)
  const renameSection = useDocStore((s) => s.renameSection)
  const addPattern = useDocStore((s) => s.addPattern)
  const removePattern = useDocStore((s) => s.removePattern)
  const duplicatePattern = useDocStore((s) => s.duplicatePattern)
  const addPatternToSection = useDocStore((s) => s.addPatternToSection)
  const removePatternFromSection = useDocStore((s) => s.removePatternFromSection)
  const setCurrentPattern = useDocStore((s) => s.setCurrentPattern)
  const renamePattern = useDocStore((s) => s.renamePattern)
  const reorderSections = useDocStore((s) => s.reorderSections)

  const [editingSection, setEditingSection] = useState<Id | null>(null)
  const [editingPattern, setEditingPattern] = useState<Id | null>(null)

  const allPatterns = Object.values(doc.entities.patterns)

  return (
    <div className="songbar">
      {doc.sectionIds.map((secId, si) => {
        const section = doc.entities.sections[secId]
        if (!section) return null
        const isEditing = editingSection === secId

        return (
          <div key={secId} className="songbar-section">
            <div className="songbar-section-head">
              {isEditing ? (
                <input
                  className="songbar-name-input"
                  defaultValue={section.name}
                  autoFocus
                  onBlur={() => setEditingSection(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameSection(secId, (e.target as HTMLInputElement).value)
                      setEditingSection(null)
                    }
                    if (e.key === 'Escape') setEditingSection(null)
                  }}
                />
              ) : (
                <span
                  className="songbar-section-name"
                  title="Double-click to rename"
                  onDoubleClick={() => setEditingSection(secId)}
                >
                  {section.name}
                </span>
              )}
              <span className="songbar-section-actions">
                {si > 0 && (
                  <button
                    className="songbar-btn"
                    title="Move section left"
                    onClick={() => reorderSections(si, si - 1)}
                  >
                    ◀
                  </button>
                )}
                {si < doc.sectionIds.length - 1 && (
                  <button
                    className="songbar-btn"
                    title="Move section right"
                    onClick={() => reorderSections(si, si + 1)}
                  >
                    ▶
                  </button>
                )}
                <button
                  className="songbar-btn songbar-btn-del"
                  title="Remove section"
                  onClick={() => removeSection(secId)}
                >
                  ×
                </button>
              </span>
            </div>
            <div className="songbar-section-patterns">
              {section.patternIds.map((patId, pi) => {
                const pat = doc.entities.patterns[patId]
                if (!pat) return null
                const isCurrent = patId === doc.patternId
                const isPatEditing = editingPattern === patId

                return (
                  <span key={patId} className={'songbar-pattern' + (isCurrent ? ' current' : '')}>
                    {isPatEditing ? (
                      <input
                        className="songbar-name-input"
                        defaultValue={pat.name}
                        autoFocus
                        style={{ width: '90px' }}
                        onBlur={() => setEditingPattern(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renamePattern(patId, (e.target as HTMLInputElement).value)
                            setEditingPattern(null)
                          }
                          if (e.key === 'Escape') setEditingPattern(null)
                        }}
                      />
                    ) : (
                      <span
                        className="songbar-pattern-name"
                        title="Double-click to rename"
                        onDoubleClick={() => setEditingPattern(patId)}
                        onClick={() => setCurrentPattern(patId)}
                      >
                        {pat.name}
                      </span>
                    )}
                    <button
                      className="songbar-btn songbar-btn-del"
                      title="Remove pattern from section"
                      onClick={(e) => {
                        e.stopPropagation()
                        removePatternFromSection(secId, pi)
                      }}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
              <select
                className="songbar-add-pat-select"
                value=""
                title="Add pattern to section"
                onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                  if (e.target.value) {
                    addPatternToSection(secId, e.target.value)
                    e.target.value = ''
                  }
                }}
              >
                <option value="">+ pattern</option>
                {allPatterns
                  .filter((p) => !section.patternIds.includes(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            </div>
          </div>
        )
      })}
      <div className="songbar-section songbar-actions">
        <button className="octbtn" onClick={() => addSection()}>+ Section</button>
        <button className="octbtn" onClick={() => addPattern()}>
          + Pattern
        </button>
        <button
          className="octbtn"
          title="Duplicate current pattern"
          onClick={() => duplicatePattern(doc.patternId)}
        >
          ⧉ Pattern
        </button>
        <button
          className="octbtn"
          title="Remove current pattern"
          onClick={() => removePattern(doc.patternId)}
        >
          − Pattern
        </button>
      </div>
    </div>
  )
}
