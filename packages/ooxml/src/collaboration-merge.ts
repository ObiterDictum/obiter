import type { DocumentEditOperation } from '@obiter/contracts'

import type {
  OoxmlDocument,
  ParagraphAnchor,
  TextRunAnchor,
  XmlElementRange,
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

type ChangedFootprints = {
  paragraphStyles: ReadonlySet<string>
  paragraphOpaque: ReadonlySet<string>
  runText: ReadonlySet<string>
  runStyles: ReadonlySet<string>
  runOpaque: ReadonlySet<string>
  paragraphIds: ReadonlySet<string>
  runIds: ReadonlySet<string>
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

function changedFootprints(
  base: OoxmlDocument,
  current: OoxmlDocument,
): ChangedFootprints {
  const paragraphStyles = new Set<string>()
  const paragraphOpaque = new Set<string>()
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
      runText,
      runStyles,
      runOpaque,
      paragraphIds,
      runIds,
    }
  }

  const aligned = indexAligned(baseStory, currentStory)
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
  currentStory.paragraphs.forEach((currentParagraph) => {
    const baseParagraph = currentParagraph.sourceParaId
      ? baseByParaId.get(currentParagraph.sourceParaId)
      : aligned
        ? baseById.get(currentParagraph.id)
        : undefined
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
      if (baseRun.text !== currentRun.text) runText.add(runId)
      if ((baseRun.styleId ?? null) !== (currentRun.styleId ?? null)) {
        runStyles.add(runId)
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
      }
    })
  })

  return {
    paragraphStyles,
    paragraphOpaque,
    runText,
    runStyles,
    runOpaque,
    paragraphIds,
    runIds,
  }
}

function operationConflicts(
  operation: DocumentEditOperation,
  changes: ChangedFootprints,
) {
  if (operation.type === 'insert_paragraph_after') {
    return !changes.paragraphIds.has(operation.paragraphId)
  }
  if (operation.type === 'delete_paragraph') return true
  if (operation.type === 'set_paragraph_style') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphStyles.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  if (operation.type === 'set_paragraph_numbering') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  if (operation.type === 'set_paragraph_format') {
    return (
      !changes.paragraphIds.has(operation.paragraphId) ||
      changes.paragraphOpaque.has(operation.paragraphId)
    )
  }
  if (operation.type === 'set_run_emphasis') {
    if (operation.runId === undefined) return true
    return (
      !changes.runIds.has(operation.runId) ||
      changes.runOpaque.has(operation.runId) ||
      changes.runStyles.has(operation.runId)
    )
  }
  if (!changes.runIds.has(operation.runId)) return true
  if (changes.runOpaque.has(operation.runId)) return true
  return operation.type === 'replace_run_text'
    ? changes.runText.has(operation.runId)
    : changes.runStyles.has(operation.runId)
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
