import type { DocumentModelWire } from '@obiter/contracts'
import { paragraphOutlineLevel } from '@obiter/ooxml'

import {
  documentStory,
  effectiveParagraph,
  paragraphPlainText,
} from './document-model-text'
import type { ExtraRuns } from './document-word-edits'

/**
 * One heading in the document's body flow: the painted paragraph id the
 * caret can address, the 1-based outline level `TOC \o` collects, and the
 * paragraph's effective text.
 */
export type DocumentOutlineEntry = {
  paragraphId: string
  level: number
  text: string
}

/**
 * The navigation pane's outline: every document-story paragraph at an outline
 * level, in flow order. The level rule is the one a `TOC \o` field applies —
 * direct `w:outlineLvl`, then the `w:basedOn` style chain, then the built-in
 * `HeadingN` style identifiers — so the pane lists exactly what a table of
 * contents would, and nothing it invents itself. Draft text is resolved
 * through `effectiveParagraph`, the same effective text the pages paint, so
 * an edited heading names its current text.
 */
export function documentOutline(
  model: DocumentModelWire,
  drafts?: Record<string, string>,
  extraRuns: ExtraRuns = {},
  paragraphStyles: Record<string, string | null> = {},
): DocumentOutlineEntry[] {
  const story = documentStory(model)
  if (!story) return []
  const entries: DocumentOutlineEntry[] = []
  for (const paragraph of story.paragraphs) {
    // A pending style draft counts too: a paragraph the caret just made
    // Heading 1 lists as a heading before the save commits it.
    const draftStyle = paragraphStyles[paragraph.id]
    const levelParagraph =
      draftStyle === undefined
        ? paragraph
        : { ...paragraph, styleId: draftStyle ?? undefined }
    const level = paragraphOutlineLevel(levelParagraph, model.styles)
    if (level === undefined) continue
    const effective = effectiveParagraph(
      paragraph,
      drafts,
      extraRuns[paragraph.id] ?? [],
    )
    entries.push({
      paragraphId: paragraph.id,
      level: level + 1,
      text: paragraphPlainText(effective),
    })
  }
  return entries
}
