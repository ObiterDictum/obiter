import '@obiter/test-dom'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'bun:test'
import type { ReactNode } from 'react'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { documentStory, paragraphPlainText } from '../../document-model-text'
import { emptyFormatDrafts } from '../../document-format-types'
import { emptyDraftState, planDocumentSave } from '../../document-save-plan'
import type { StructuralDraft } from '../../document-structural-drafts'
import type { BreakDraft } from '../../document-draft-state'
import { useWorkspaceDerivations } from './use-workspace-derivations'
import { wireModel as model } from '../../document-wire-test-support'

function paragraph(
  id: string,
  text = 'text',
  styleId?: string,
): DocumentParagraphWire {
  return {
    id,
    ...(styleId ? { styleId } : {}),
    runs: text ? [{ id: `${id}-r`, text, preservedXmlFragments: [] }] : [],
    preservedXmlFragments: [],
  }
}

const tocDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'table-of-contents',
  paragraphId,
  offset: 0,
})

function derivations(
  base: DocumentModelWire,
  drafts: {
    deletedParagraphIds?: string[]
    extraRuns?: Parameters<
      typeof useWorkspaceDerivations
    >[0]['drafts']['extraRuns']
    structures?: StructuralDraft[]
  },
  caretParagraphId = 'p3',
) {
  const state = {
    ...emptyDraftState(),
    extraRuns: drafts.extraRuns ?? {},
    format: emptyFormatDrafts,
    deletedParagraphIds: drafts.deletedParagraphIds ?? [],
    structures: drafts.structures ?? [],
  }
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () =>
      useWorkspaceDerivations({
        documentId: 'doc_1',
        model: base,
        legalChecksOpen: false,
        drafts: {
          ...state,
          state,
          setBreaks: (_update: (current: BreakDraft[]) => BreakDraft[]) =>
            undefined,
          setStructures: (
            _update: (current: StructuralDraft[]) => StructuralDraft[],
          ) => undefined,
        },
        insert: {
          caret: {
            kind: 'caret',
            paragraphId: caretParagraphId,
            from: 0,
            to: 0,
          },
          offset: 0,
          trackChanges: false,
          onImageError: () => undefined,
          margin: {
            editingKind: 'document',
            onOpen: () => undefined,
            onClose: () => undefined,
          },
          paragraphId: caretParagraphId,
        },
      }),
    { wrapper },
  )
  return result.current
}

function tocEntries(painted: DocumentModelWire | undefined) {
  return (painted ? (documentStory(painted)?.paragraphs ?? []) : [])
    .filter((item) => item.styleId === 'TOC1')
    .map((item) => paragraphPlainText(item))
}

describe('workspace derivations shared deletions', () => {
  it('paints only the entry a batch-kept field will capture', () => {
    const base = model([
      paragraph('h1', '', 'Heading1'),
      paragraph('h2', 'Surviving', 'Heading1'),
      paragraph('p3', 'x'),
    ])
    const extraRuns = {
      h1: [{ id: 'h1-e', text: 'Typed', preservedXmlFragments: [] }],
    }
    const structures = [tocDraft('s1', 'p3')]
    const derived = derivations(base, { extraRuns, structures })

    const plan = planDocumentSave(base, {
      ...emptyDraftState(),
      extraRuns,
      structures,
    })
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toContainEqual({
      type: 'insert_table_of_contents',
      paragraphId: 'p3',
      offset: 0,
    })
    expect(tocEntries(derived.painted)).toEqual(['Surviving'])
    expect(derived.insert.structure.tableOfContentsUnavailable).toBeUndefined()
  })

  it('agrees across save, paint and ribbon when every delete is refused', () => {
    const base = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('p3', 'x'),
    ])
    const structures = [tocDraft('s1', 'p3')]
    const derived = derivations(base, {
      deletedParagraphIds: ['h1', 'p3'],
      structures,
    })

    const plan = planDocumentSave(base, {
      ...emptyDraftState(),
      deletedParagraphIds: ['h1', 'p3'],
      structures,
    })
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual([
      'delete',
      'delete',
    ])
    expect(plan.operations).toEqual([
      { type: 'insert_table_of_contents', paragraphId: 'p3', offset: 0 },
    ])
    expect(tocEntries(derived.painted)).toEqual(['Overview'])
    expect(derived.insert.structure.tableOfContentsUnavailable).toBeUndefined()
  })
})
