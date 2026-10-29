import type { DocumentModelWire } from '@obiter/contracts'
import { paragraphOutlineLevel } from '@obiter/ooxml'

import {
  documentStory,
  effectiveParagraph,
  paragraphPlainText,
} from './document-model-text'
import type { ExtraRuns } from './document-word-edits'

export type DocumentOutlineEntry = {
  paragraphId: string
  level: number
  text: string
}

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
