import { useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { DocumentModelWire, DocumentTextRunWire } from '@obiter/contracts'

import { documentBreakToolbar } from '../../document-break-toolbar'
import type { BreakDraft } from '../../document-edits'
import type { FormatDrafts, FormatTarget } from '../../document-format-edits'
import type { LocalInsert } from '../../document-story-flow'
import { documentStory } from '../../document-model-text'
import { marginStories } from '../../document-page-layout'
import {
  documentStructureToolbar,
  storyTableCellIds,
} from '../../document-structure-toolbar'
import { readImageInsert } from '../../document-image-inserts'
import type { TableOfAuthoritiesFacts } from '../../document-legal-toolbar'
import type { StructuralDraft } from '../../document-structural-drafts'
import type { DocumentStructureToolbar } from './ribbon-types'

export type InsertRibbonProps = {
  onPageBreak: () => void
  onSectionBreak: () => void
  breakUnavailable?: string
  structure: DocumentStructureToolbar & { picturePicker: ReactNode }
}

export function useInsertRibbon(
  model: DocumentModelWire | undefined,
  painted: DocumentModelWire | undefined,
  caret: FormatTarget,
  offset: number | null,
  trackChanges: boolean,
  margin: {
    editingKind: 'document' | 'header' | 'footer' | 'footnotes'
    onOpen: (kind: 'header' | 'footer' | 'footnotes', selectId?: string) => void
    onClose: () => void
  },
  drafts: {
    deletedParagraphIds: ReadonlySet<string>
    drafts: Record<string, string>
    extraRuns: Record<string, DocumentTextRunWire[]>
    format: FormatDrafts
    breaks: BreakDraft[]
    inserts: LocalInsert[]
    structures: StructuralDraft[]
    setBreaks: (update: (current: BreakDraft[]) => BreakDraft[]) => void
    setStructures: (
      update: (current: StructuralDraft[]) => StructuralDraft[],
    ) => void
  },
  toaFacts: TableOfAuthoritiesFacts,
  onImageError: (message: string) => void,
): InsertRibbonProps {
  const pictureInput = useRef<HTMLInputElement>(null)
  const cellParagraphIds = useMemo(
    () => storyTableCellIds(model ? documentStory(model) : undefined),
    [model],
  )
  const paragraphId = (caret.kind === 'caret' && caret.paragraphId) || null
  const selectionActive = caret.kind === 'selection'
  const selectionRange =
    caret.kind === 'selection' && caret.ranges.length === 1
      ? (caret.ranges[0] ?? null)
      : null
  const headerUnavailable =
    model && marginStories(model, 'header').length === 0
      ? 'This document has no header part'
      : undefined
  const footerUnavailable =
    model && marginStories(model, 'footer').length === 0
      ? 'This document has no footer part'
      : undefined
  const structure = documentStructureToolbar({
    paragraphId,
    model,
    painted,
    cellParagraphIds,
    offset,
    selectionActive,
    selectionRange,
    deletedParagraphIds: drafts.deletedParagraphIds,
    trackChanges,
    structures: drafts.structures,
    drafts: drafts.drafts,
    extraRuns: drafts.extraRuns,
    format: drafts.format,
    breaks: drafts.breaks,
    inserts: drafts.inserts,
    setStructures: drafts.setStructures,
    toaFacts,
  })
  return {
    ...documentBreakToolbar({
      paragraphId,
      model: painted ?? model,
      offset,
      selectionActive,
      trackChanges,
      setBreaks: drafts.setBreaks,
    }),
    structure: {
      tableUnavailable: structure.tableUnavailable,
      pictureUnavailable: structure.pictureUnavailable,
      linkUnavailable: structure.linkUnavailable,
      crossReferenceUnavailable: structure.crossReferenceUnavailable,
      crossReferenceTargets: structure.crossReferenceTargets,
      definedTermUnavailable: structure.definedTermUnavailable,
      pageNumberUnavailable: structure.pageNumberUnavailable,
      footnoteUnavailable: structure.footnoteUnavailable,
      tableOfContentsUnavailable: structure.tableOfContentsUnavailable,
      tableOfAuthoritiesUnavailable: structure.tableOfAuthoritiesUnavailable,
      tableOfAuthoritiesUpdateUnavailable:
        structure.tableOfAuthoritiesUpdateUnavailable,
      editingStoryKind:
        margin.editingKind === 'document' ? undefined : margin.editingKind,
      headerUnavailable,
      footerUnavailable,
      onOpenStory: margin.onOpen,
      onCloseStory: margin.onClose,
      onInsertTable: (rows, columns) => structure.insertTable(rows, columns),
      onInsertLink: (target) => structure.insertLink(target),
      onInsertCrossReference: (targetParagraphId) =>
        structure.insertCrossReference(targetParagraphId),
      onMarkDefinedTerm: () => {
        const outcome = structure.markDefinedTerm()
        if (!outcome.inserted) onImageError(outcome.reason)
      },
      onInsertPageNumber: () => {
        const outcome = structure.insertPageNumber()
        if (!outcome.inserted) onImageError(outcome.reason)
      },
      onInsertTableOfContents: () => {
        const outcome = structure.insertTableOfContents()
        if (!outcome.inserted) onImageError(outcome.reason)
      },
      onInsertTableOfAuthorities: () => {
        const outcome = structure.insertTableOfAuthorities()
        if (!outcome.inserted) onImageError(outcome.reason)
      },
      onUpdateTableOfAuthorities: () => {
        const outcome = structure.updateTableOfAuthorities()
        if (!outcome.inserted) onImageError(outcome.reason)
      },
      onInsertFootnote: () => {
        const outcome = structure.insertFootnote()
        if (!outcome.inserted) {
          onImageError(outcome.reason)
          return
        }
        margin.onOpen('footnotes', outcome.noteParagraphId)
      },
      onInsertPicture: () => pictureInput.current?.click(),
      picturePicker: (
        <input
          ref={pictureInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/bmp"
          className="hidden"
          aria-label="Insert picture"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            void readImageInsert(file).then((result) => {
              if ('error' in result) {
                onImageError(result.error)
                return
              }
              const outcome = structure.insertImage(result)
              if (!outcome.inserted) onImageError(outcome.reason)
            })
          }}
        />
      ),
    },
  }
}
