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

function sameSkeleton(base: MainStory, current: MainStory) {
  return (
    base.partName === current.partName &&
    base.paragraphs.length === current.paragraphs.length &&
    base.paragraphs.every((paragraph, paragraphIndex) => {
      const compared = current.paragraphs[paragraphIndex]
      return (
        compared !== undefined &&
        paragraph.id === compared.id &&
        paragraph.sourceParaId === compared.sourceParaId &&
        paragraph.sourceTextId === compared.sourceTextId &&
        paragraph.runs.length === compared.runs.length &&
        paragraph.runs.every((run, runIndex) => {
          const comparedRun = compared.runs[runIndex]
          return (
            comparedRun !== undefined &&
            run.id === comparedRun.id &&
            run.sourceTextId === comparedRun.sourceTextId
          )
        })
      )
    })
  )
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

  currentStory.paragraphs.forEach((currentParagraph, paragraphIndex) => {
    const baseParagraph = baseStory.paragraphs[paragraphIndex]
    if (!baseParagraph) return
    paragraphIds.add(currentParagraph.id)
    if (
      (baseParagraph.styleId ?? null) !== (currentParagraph.styleId ?? null)
    ) {
      paragraphStyles.add(currentParagraph.id)
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
      paragraphOpaque.add(currentParagraph.id)
    }

    currentParagraph.runs.forEach((currentRun, runIndex) => {
      const baseRun = baseParagraph.runs[runIndex]
      if (!baseRun) return
      runIds.add(currentRun.id)
      if (baseRun.text !== currentRun.text) runText.add(currentRun.id)
      if ((baseRun.styleId ?? null) !== (currentRun.styleId ?? null)) {
        runStyles.add(currentRun.id)
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
        runOpaque.add(currentRun.id)
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
  if (
    operation.type === 'insert_paragraph_after' ||
    operation.type === 'delete_paragraph'
  ) {
    return true
  }
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
