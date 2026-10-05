import type { DocumentEditOperation } from '@obiter/contracts'

import { operationConflicts, type ChangedFootprints } from './merge-conflicts'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'

export type DocumentEditReconciliation =
  { mergeable: true } | { mergeable: false; operationIndexes: number[] }

export function reconcileDocumentEdits(
  base: OoxmlDocument,
  current: OoxmlDocument,
  operations: readonly DocumentEditOperation[],
  baseIsCurrent: boolean,
): DocumentEditReconciliation {
  if (baseIsCurrent) return { mergeable: true }

  const baseStory = mainStory(base)
  const currentStory = mainStory(current)
  if (!baseStory || !currentStory || !sameSkeleton(baseStory, currentStory)) {
    return {
      mergeable: false,
      operationIndexes: operations.map((_, index) => index),
    }
  }

  const changes = changedFootprints(base, current)
  const conflicts: number[] = []
  operations.forEach((operation, index) => {
    if (operationConflicts(operation, changes)) conflicts.push(index)
  })
  return conflicts.length === 0
    ? { mergeable: true }
    : { mergeable: false, operationIndexes: conflicts }
}

type MainStory = OoxmlDocument['model']['stories'][number]

/**
 * The base-to-current correspondence of a reconciled merge: which current
 * paragraph continues each base paragraph, and which current run continues
 * each base run. Paragraphs are matched by persisted `w14:paraId` (or the
 * verified positional alignment for a legacy base); runs by their index in a
 * matched paragraph, which the merge's own conflict check requires to be
 * skeleton-stable. This is the base side of the merge lineage, never a
 * positional guess at reversal targets.
 */
export type MergeAlignment = {
  baseToCurrentParagraph: Map<string, string>
  baseToCurrentRun: Map<string, string>
}

export function alignMergeDocuments(
  base: OoxmlDocument,
  current: OoxmlDocument,
): MergeAlignment {
  const alignment: MergeAlignment = {
    baseToCurrentParagraph: new Map(),
    baseToCurrentRun: new Map(),
  }
  const baseStory = mainStory(base)
  const currentStory = mainStory(current)
  if (!baseStory || !currentStory) return alignment
  const aligned = indexAligned(baseStory, currentStory)
  const positional = !aligned && positionallyAligned(baseStory, currentStory)
  const currentById = new Map(
    currentStory.paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  )
  const currentByParaId = new Map(
    currentStory.paragraphs.flatMap((paragraph) =>
      paragraph.sourceParaId
        ? [[paragraph.sourceParaId, paragraph] as const]
        : [],
    ),
  )
  baseStory.paragraphs.forEach((baseParagraph, index) => {
    let currentParagraph = baseParagraph.sourceParaId
      ? currentByParaId.get(baseParagraph.sourceParaId)
      : undefined
    if (!currentParagraph && aligned) {
      currentParagraph = currentById.get(baseParagraph.id)
    }
    if (!currentParagraph && positional) {
      currentParagraph = currentStory.paragraphs[index]
    }
    if (!currentParagraph) return
    alignment.baseToCurrentParagraph.set(baseParagraph.id, currentParagraph.id)
    baseParagraph.runs.forEach((baseRun, runIndex) => {
      const currentRun = currentParagraph?.runs[runIndex]
      if (currentRun) {
        alignment.baseToCurrentRun.set(baseRun.id, currentRun.id)
      }
    })
  })
  return alignment
}

/**
 * Rewrites a client's operations from its base addresses to the current
 * version's addresses. A reconciled merge applies the batch to the newer
 * current document, where a collaborator's insert or edit has reallocated
 * positional run ids; applying the base ids directly would write an unrelated
 * run. An address the alignment does not name is refused rather than left to
 * collide with whatever current id happens to share it.
 */
export function remapMergeOperations(
  operations: readonly DocumentEditOperation[],
  alignment: MergeAlignment,
): DocumentEditOperation[] {
  const paragraph = (id: string) => {
    const mapped = alignment.baseToCurrentParagraph.get(id)
    if (!mapped) throw new OoxmlError('invalid-document-edit')
    return mapped
  }
  const run = (id: string) => {
    const mapped = alignment.baseToCurrentRun.get(id)
    if (!mapped) throw new OoxmlError('invalid-document-edit')
    return mapped
  }
  return operations.map((operation) => {
    switch (operation.type) {
      case 'replace_run_text':
      case 'set_run_style':
        return { ...operation, runId: run(operation.runId) }
      case 'set_run_emphasis':
        return {
          ...operation,
          ...(operation.runId !== undefined
            ? { runId: run(operation.runId) }
            : {}),
          ...(operation.paragraphId !== undefined
            ? { paragraphId: paragraph(operation.paragraphId) }
            : {}),
        }
      case 'set_paragraph_style':
      case 'set_paragraph_numbering':
      case 'set_paragraph_format':
      case 'delete_paragraph':
      case 'insert_paragraph_after':
      case 'insert_paragraph_before':
      case 'insert_break':
      case 'insert_section_break':
      case 'insert_table':
      case 'insert_image':
        return { ...operation, paragraphId: paragraph(operation.paragraphId) }
      default:
        return operation
    }
  })
}

function mainStory(document: OoxmlDocument) {
  return document.model.stories.find(({ kind }) => kind === 'document')
}

type StoryParagraph = MainStory['paragraphs'][number]

function sameRunSkeleton(base: StoryParagraph, current: StoryParagraph) {
  return (
    (base.sourceTextId ?? null) === (current.sourceTextId ?? null) &&
    base.runs.length === current.runs.length &&
    base.runs.every((run, runIndex) => {
      const comparedRun = current.runs[runIndex]
      return (
        comparedRun !== undefined &&
        (run.sourceTextId ?? null) === (comparedRun.sourceTextId ?? null) &&
        (run.sourceTextId != null || run.id === comparedRun.id)
      )
    })
  )
}

function indexAligned(base: MainStory, current: MainStory) {
  return (
    base.paragraphs.length === current.paragraphs.length &&
    base.paragraphs.every((paragraph, paragraphIndex) => {
      const compared = current.paragraphs[paragraphIndex]
      return (
        compared !== undefined &&
        paragraph.id === compared.id &&
        (paragraph.sourceParaId ?? null) === (compared.sourceParaId ?? null) &&
        sameRunSkeleton(paragraph, compared) &&
        paragraph.runs.every(
          (run, runIndex) => run.id === compared.runs[runIndex]?.id,
        )
      )
    })
  )
}

function sameSkeleton(base: MainStory, current: MainStory) {
  if (base.partName !== current.partName) return false
  if (indexAligned(base, current)) return true
  // Sequential model ids shift after a round-tripped insert. Only w14
  // paraId/textId stay stable, so extras are allowed when every identified
  // base paragraph still exists in order.
  let currentIndex = 0
  for (const paragraph of base.paragraphs) {
    if (!paragraph.sourceParaId) continue
    while (
      currentIndex < current.paragraphs.length &&
      current.paragraphs[currentIndex]?.sourceParaId !== paragraph.sourceParaId
    ) {
      currentIndex += 1
    }
    const matched = current.paragraphs[currentIndex]
    if (!matched || !sameRunSkeleton(paragraph, matched)) return false
    currentIndex += 1
  }
  return true
}

/**
 * Positional alignment for a base that predates persisted paragraph ids.
 * Reconciliation is a conflict check, not identity translation: when the base
 * carries no `w14:paraId`, the only link to a canonicalised current version is
 * the verified run skeleton at the same index. History translation never uses
 * this; it consumes the authoritative lineage.
 */
function positionallyAligned(base: MainStory, current: MainStory) {
  return (
    base.paragraphs.length === current.paragraphs.length &&
    base.paragraphs.every((paragraph, index) => {
      const compared = current.paragraphs[index]
      return compared !== undefined && sameRunSkeleton(paragraph, compared)
    })
  )
}

function changedFootprints(
  base: OoxmlDocument,
  current: OoxmlDocument,
): ChangedFootprints {
  const paragraphStyles = new Set<string>()
  const paragraphOpaque = new Set<string>()
  const paragraphRunChanges = new Set<string>()
  const runText = new Set<string>()
  const runStyles = new Set<string>()
  const runOpaque = new Set<string>()
  const paragraphIds = new Set<string>()
  const runIds = new Set<string>()
  const baseStory = mainStory(base)
  const currentStory = mainStory(current)
  if (!baseStory || !currentStory) {
    return {
      paragraphStyles,
      paragraphOpaque,
      paragraphRunChanges,
      runText,
      runStyles,
      runOpaque,
      paragraphIds,
      runIds,
    }
  }

  const aligned = indexAligned(baseStory, currentStory)
  const positional = !aligned && positionallyAligned(baseStory, currentStory)
  const baseById = new Map(
    baseStory.paragraphs.map((paragraph) => [paragraph.id, paragraph]),
  )
  const baseByParaId = new Map(
    baseStory.paragraphs.flatMap((paragraph) =>
      paragraph.sourceParaId
        ? [[paragraph.sourceParaId, paragraph] as const]
        : [],
    ),
  )
  currentStory.paragraphs.forEach((currentParagraph, currentIndex) => {
    let baseParagraph = currentParagraph.sourceParaId
      ? baseByParaId.get(currentParagraph.sourceParaId)
      : undefined
    if (!baseParagraph && aligned) {
      baseParagraph = baseById.get(currentParagraph.id)
    }
    if (!baseParagraph && positional) {
      baseParagraph = baseStory.paragraphs[currentIndex]
    }
    if (!baseParagraph) return
    const paragraphId = baseParagraph.id
    paragraphIds.add(paragraphId)
    if (
      (baseParagraph.styleId ?? null) !== (currentParagraph.styleId ?? null)
    ) {
      paragraphStyles.add(paragraphId)
    }
    if (
      !sameStrings(
        paragraphOpaqueFragments(
          base,
          base.paragraphAnchors.get(baseParagraph.id),
        ),
        paragraphOpaqueFragments(
          current,
          current.paragraphAnchors.get(currentParagraph.id),
        ),
      )
    ) {
      paragraphOpaque.add(paragraphId)
    }

    currentParagraph.runs.forEach((currentRun, runIndex) => {
      const baseRun = baseParagraph.runs[runIndex]
      if (!baseRun) return
      const runId = baseRun.id
      runIds.add(runId)
      if (baseRun.text !== currentRun.text) {
        runText.add(runId)
        paragraphRunChanges.add(paragraphId)
      }
      if ((baseRun.styleId ?? null) !== (currentRun.styleId ?? null)) {
        runStyles.add(runId)
        paragraphRunChanges.add(paragraphId)
      }
      if (
        !sameStrings(
          runOpaqueFragments(base, base.textRunAnchors.get(baseRun.id)),
          runOpaqueFragments(
            current,
            current.textRunAnchors.get(currentRun.id),
          ),
        )
      ) {
        runOpaque.add(runId)
        paragraphRunChanges.add(paragraphId)
      }
    })
  })

  return {
    paragraphStyles,
    paragraphOpaque,
    paragraphRunChanges,
    runText,
    runStyles,
    runOpaque,
    paragraphIds,
    runIds,
  }
}

function paragraphOpaqueFragments(
  document: OoxmlDocument,
  anchor: ParagraphAnchor | undefined,
) {
  if (!anchor) return []
  return opaqueFragments(
    document,
    anchor.partName,
    anchor.wire.preservedXmlFragments,
    anchor.paragraphPropertiesRange,
    anchor.paragraphStyleRange,
  )
}

function runOpaqueFragments(
  document: OoxmlDocument,
  anchor: TextRunAnchor | undefined,
) {
  if (!anchor) return []
  return opaqueFragments(
    document,
    anchor.partName,
    anchor.wire.preservedXmlFragments,
    anchor.runPropertiesRange,
    anchor.runStyleRange,
  )
}

function opaqueFragments(
  document: OoxmlDocument,
  partName: string,
  fragments: readonly string[],
  propertiesRange: XmlElementRange | undefined,
  styleRange: XmlElementRange | undefined,
) {
  if (!propertiesRange) return [...fragments]
  const source = sourceForRange(document, partName, propertiesRange)
  if (!source) return [...fragments]
  const properties = source.slice(propertiesRange.start, propertiesRange.end)
  const index = fragments.indexOf(properties)
  if (index === -1) return [...fragments]

  const withoutStyle = styleRange
    ? source.slice(propertiesRange.start, styleRange.start) +
      source.slice(styleRange.end, propertiesRange.end)
    : properties
  const normalised = emptyProperties(withoutStyle) ? '' : withoutStyle
  return fragments.flatMap((fragment, fragmentIndex) =>
    fragmentIndex === index ? (normalised ? [normalised] : []) : [fragment],
  )
}

function sourceForRange(
  document: OoxmlDocument,
  partName: string,
  range: XmlElementRange,
) {
  const part = document.sourceParts.get(partName)
  if (!part?.overlay || range.end > part.overlay.source.length) return undefined
  return part.overlay.source
}

function emptyProperties(fragment: string) {
  const match = fragment.match(/^<([^\s/>]+)>\s*<\/\1>$/u)
  return match !== null || /^<[^\s/>]+\s*\/>$/u.test(fragment)
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
