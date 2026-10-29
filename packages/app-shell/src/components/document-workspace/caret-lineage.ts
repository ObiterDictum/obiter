import type { DocumentSelection } from '../../document-selection'
import { useBrowserLayoutEffect } from './use-browser-layout-effect'

type CaretPlacement = { paragraphId: string; offset: number }

export function useCaretLineageRemap({
  paragraphRemap,
  setSelectedParagraphId,
  setRestoreCaret,
  setSelection,
}: {
  paragraphRemap: ReadonlyMap<string, string>
  setSelectedParagraphId: (
    update: (current: string | null) => string | null,
  ) => void
  setRestoreCaret: (
    update: (current: CaretPlacement | null) => CaretPlacement | null,
  ) => void
  setSelection: (
    update: (current: DocumentSelection | null) => DocumentSelection | null,
  ) => void
}) {
  useBrowserLayoutEffect(() => {
    if (paragraphRemap.size === 0) return
    const remap = (id: string) => paragraphRemap.get(id) ?? id
    setSelectedParagraphId((current) => (current ? remap(current) : current))
    setRestoreCaret((current) =>
      current
        ? { ...current, paragraphId: remap(current.paragraphId) }
        : current,
    )
    setSelection((current) =>
      current
        ? {
            anchor: {
              ...current.anchor,
              paragraphId: remap(current.anchor.paragraphId),
            },
            focus: {
              ...current.focus,
              paragraphId: remap(current.focus.paragraphId),
            },
          }
        : current,
    )
  }, [paragraphRemap, setSelectedParagraphId, setRestoreCaret, setSelection])
}
