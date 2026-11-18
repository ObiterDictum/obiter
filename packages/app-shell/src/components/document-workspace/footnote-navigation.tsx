import {
  createContext,
  use,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  documentNotes,
  type NoteKind,
  type NoteRef,
} from '../../document-page-notes'

const Navigation = createContext<{
  id: string
  byNote: ReadonlyMap<string, { paragraphId: string; readOnly?: boolean }>
  byParagraph: ReadonlyMap<string, string>
  visit: (noteId: string, referenceId: string) => void
  back: (noteId: string) => void
} | null>(null)

export function FootnoteNavigation({
  model,
  onOpen,
  onClose,
  children,
}: {
  model: DocumentModelWire
  onOpen: (paragraphId: string) => void
  onClose: () => void
  children: ReactNode
}) {
  const id = useId()
  const recent = useRef(new Map<string, string>())
  const targets = useMemo(() => {
    const byNote = new Map<
      string,
      { paragraphId: string; readOnly?: boolean }
    >()
    const byParagraph = new Map<string, string>()
    for (const note of documentNotes(model)) {
      const first = note.paragraphs[0]
      if (note.kind !== 'footnote' || !first) continue
      byNote.set(note.noteId, {
        paragraphId: first.id,
        readOnly: note.readOnly,
      })
      byParagraph.set(first.id, note.noteId)
    }
    return { byNote, byParagraph }
  }, [model])
  return (
    <Navigation
      value={{
        id,
        ...targets,
        visit(noteId, referenceId) {
          recent.current.set(noteId, referenceId)
          const target = targets.byNote.get(noteId)
          if (target?.readOnly)
            document.getElementById(noteTarget(id, noteId))?.focus()
          else if (target) onOpen(target.paragraphId)
        },
        back(noteId) {
          const referenceId = recent.current.get(noteId)
          const reference =
            (referenceId && document.getElementById(referenceId)) ||
            Array.from(
              document.querySelectorAll<HTMLElement>(
                '[data-footnote-reference]',
              ),
            ).find(
              (element) =>
                element.dataset.footnoteReference === noteTarget(id, noteId),
            )
          if (!reference) return
          onClose()
          reference.focus()
        },
      }}
    >
      {children}
    </Navigation>
  )
}

function noteTarget(scope: string, id: string) {
  return `${scope}-footnote-${id}`
}

export function FootnoteReference({
  note,
  mark,
}: {
  note: NoteRef
  mark: string
}) {
  const navigation = use(Navigation)
  const target = navigation ? noteTarget(navigation.id, note.noteId) : ''
  const id = `${target}-ref-${note.runId}`
  const label = mark ? `Footnote ${mark}` : 'Custom footnote'
  return (
    <sup
      data-note-mark
      className="relative -top-[0.5em] align-baseline text-[0.65em] leading-none"
    >
      {navigation &&
      note.kind === 'footnote' &&
      navigation.byNote.has(note.noteId) ? (
        <a
          id={id}
          href={`#${target}`}
          data-footnote-reference={target}
          aria-label={label}
          className="pointer-events-auto relative z-10"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            navigation.visit(note.noteId, id)
          }}
        >
          {mark || '*'}
        </a>
      ) : (
        mark
      )}
    </sup>
  )
}

export function NoteLabel({
  kind,
  mark,
  paragraphId,
}: {
  kind?: NoteKind
  mark: string
  paragraphId: string
}) {
  const navigation = use(Navigation)
  const noteId = navigation?.byParagraph.get(paragraphId)
  const label =
    kind === 'endnote'
      ? `Endnote ${mark}`
      : mark
        ? `Footnote ${mark}`
        : 'Custom footnote'
  const number = (
    <span
      aria-hidden="true"
      className="relative -top-[0.5em] text-[0.65em] leading-none"
    >
      {mark || '*'}
    </span>
  )
  return (
    <span className="shrink-0 self-start pr-1" aria-label={label}>
      {navigation && noteId !== undefined ? (
        <button
          type="button"
          id={noteTarget(navigation.id, noteId)}
          aria-label={`Back to reference for ${label.toLowerCase()}`}
          onClick={(event) => {
            event.stopPropagation()
            navigation.back(noteId)
          }}
        >
          {number}
        </button>
      ) : (
        number
      )}
    </span>
  )
}
