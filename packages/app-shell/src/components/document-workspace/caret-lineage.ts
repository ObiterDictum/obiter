import type { DocumentSelection } from '../../document-selection'
import { useBrowserLayoutEffect } from './use-browser-layout-effect'

type CaretPlacement = { paragraphId: string; offset: number }

/**
 * Retargets the caret and selection to the paragraph ids a save produced. A
 * save canonicalises legacy paragraph ids, so the live caret otherwise points
 * at an id the reloaded model no longer holds. Run identifiers are unchanged,
 * so only paragraph ids are rewritten. The map is the one the drafts hook
 * published when the save boundary resolved, never a positional guess.
 *
 * This runs as a layout effect so the retarget lands in the same synchronous
 * commit cascade as the model swap: a passive-effect hop paints a commit
 * where no paragraph is selected, unmounting the editor, and a keystroke
 * delivered there falls through to `document.body` and is silently lost.
 */
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
