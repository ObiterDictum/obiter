import type { DocumentModelWire } from '@obiter/contracts'
import { runPropertiesFromFragments, type LocalInsert } from './document-edits'
import type {
  ParagraphFormatDraft,
  PendingEmphasis,
  SectionDraft,
} from './document-format-types'
import { editableParagraphs, paragraphPlainText } from './document-model-text'
import { documentSectionXml } from './document-page-layout'
import { xmlNumber, xmlTagAttrs } from './document-page-units'
import { type DraftState } from './document-save-plan'
import type { SaveBaseline } from './document-baseline-identity-keys'
import { pendingDeletedParagraphId } from './document-baseline-identity-keys'
import { storyParagraph } from './document-baseline-lineage'

export function sectionReversal(
  model: DocumentModelWire,
  sent: SectionDraft,
): SectionDraft | null {
  const sect = documentSectionXml(model)
  if (!sect) return null
  const size = xmlTagAttrs(sect, 'pgSz')
  const margin = xmlTagAttrs(sect, 'pgMar')
  const width = xmlNumber(size, 'w')
  const height = xmlNumber(size, 'h')
  const preSize =
    width !== undefined && height !== undefined ? { width, height } : null
  const readMargin = (name: string) => xmlNumber(margin, name) ?? null
  return {
    ...(sent.margins !== undefined
      ? {
          margins: {
            top: readMargin('top'),
            right: readMargin('right'),
            bottom: readMargin('bottom'),
            left: readMargin('left'),
            header: readMargin('header'),
            footer: readMargin('footer'),
            gutter: readMargin('gutter'),
          },
        }
      : {}),
    ...(sent.pageSize !== undefined || sent.orientation !== undefined
      ? { pageSize: preSize }
      : {}),
  }
}

/**
 * The paragraph layout a reversal restates. `source` is the answer to restore
 * (the snapshot's pending layout, or the save's own for comparison), `stored`
 * is the direct pre-save layout it falls back to, and `sent` names the families
 * the save wrote and so must be reversed. A family the paragraph did not carry
 * before is released with an explicit null, and every `w:ind` attribute is
 * named because the writer merges `w:ind`: a partial object would let an
 * attribute the save added survive its own reversal.
 */
export function reversalParagraphFormat(
  source: ParagraphFormatDraft | undefined,
  stored: ParagraphFormatDraft,
  sent: ParagraphFormatDraft,
): ParagraphFormatDraft {
  const indentation = (attr: 'left' | 'right' | 'firstLine' | 'hanging') => {
    const value = source?.indentation?.[attr]
    return value !== undefined ? value : (stored.indentation?.[attr] ?? null)
  }
  return {
    ...(sent.alignment !== undefined
      ? {
          alignment:
            source?.alignment !== undefined
              ? source.alignment
              : (stored.alignment ?? null),
        }
      : {}),
    ...(sent.lineSpacing !== undefined
      ? {
          // A pre-save spacing with no rule cannot clear a rule the save added:
          // the contract's `lineSpacingSchema` has no nullable `lineRule`. E3
          // only ever writes `auto` (the default), so the UI cannot reach it.
          lineSpacing:
            source?.lineSpacing !== undefined
              ? source.lineSpacing
              : (stored.lineSpacing ?? null),
        }
      : {}),
    ...(sent.indentation !== undefined
      ? {
          indentation: {
            left: indentation('left'),
            right: indentation('right'),
            firstLine: indentation('firstLine'),
            hanging: indentation('hanging'),
          },
        }
      : {}),
  }
}

/** Whether two complete reversal layouts name the same paragraph layout. */
export function sameParagraphFormat(
  a: ParagraphFormatDraft,
  b: ParagraphFormatDraft,
): boolean {
  return (
    a.alignment === b.alignment &&
    sameLineSpacing(a.lineSpacing, b.lineSpacing) &&
    sameIndentation(a.indentation, b.indentation)
  )
}

function sameLineSpacing(
  a: ParagraphFormatDraft['lineSpacing'],
  b: ParagraphFormatDraft['lineSpacing'],
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a === null || b === null) return a === b
  return a.line === b.line && a.lineRule === b.lineRule
}

function sameIndentation(
  a: ParagraphFormatDraft['indentation'],
  b: ParagraphFormatDraft['indentation'],
): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a === null || b === null) return a === b
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.firstLine === b.firstLine &&
    a.hanging === b.hanging
  )
}

/** Adds a tracked-change rejection group once, keyed by its change ids. */
export function addTrackedRejection(
  state: DraftState,
  ooxmlIds: string[],
  removeParagraphIds?: string[],
) {
  const key = `reject:${ooxmlIds.join(',')}`
  if (!state.trackedRejections.some((group) => group.key === key)) {
    state.trackedRejections.push({
      key,
      ooxmlIds: [...ooxmlIds],
      ...(removeParagraphIds?.length
        ? { removeParagraphIds: [...removeParagraphIds] }
        : {}),
    })
    return
  }
  // A later translation of the same change may add the shell removal.
  if (!removeParagraphIds?.length) return
  const existing = state.trackedRejections.find((group) => group.key === key)
  if (existing && !existing.removeParagraphIds?.length) {
    existing.removeParagraphIds = [...removeParagraphIds]
  }
}

/** The pre-save character formatting of a run, for a formatting reversal. */
export function preEmphasisForRun(
  model: DocumentModelWire,
  runId: string,
): PendingEmphasis | null {
  for (const paragraph of editableParagraphs(model)) {
    const run = paragraph.runs.find((item) => item.id === runId)
    if (run) return emphasisOf(run.preservedXmlFragments)
  }
  return null
}

/** The pre-save formatting at the start of a range, for a range reversal. */
export function preEmphasisForRange(
  model: DocumentModelWire,
  paragraphId: string,
  from: number,
  to: number,
): PendingEmphasis | null {
  const paragraph = storyParagraph(model, paragraphId)
  if (!paragraph) return null
  let cursor = 0
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (from >= cursor && from < end && to > cursor) {
      return emphasisOf(run.preservedXmlFragments)
    }
    cursor = end
  }
  return null
}

function emphasisOf(fragments: readonly string[]): PendingEmphasis {
  const properties = runPropertiesFromFragments(fragments)
  return {
    bold: properties.bold,
    italic: properties.italic,
    underline: properties.underline,
    strikethrough: properties.strikethrough,
    fontFamily: properties.fontFamily,
    fontSize: properties.fontSize,
    colour: properties.colour,
    highlight: properties.highlight,
    vertAlign: properties.vertAlign,
    smallCaps: properties.smallCaps,
  }
}

/**
 * Rebuilds a paragraph the save deleted, from the model that still held it.
 * The restored paragraph is an ordinary pending insert, so the next save sends
 * one insertion and the persisted document has exactly one copy.
 */
export function restoreInsert(
  baseline: SaveBaseline,
  paragraphId: string,
  anchor: string | undefined,
  beforeAnchor: string | undefined,
): LocalInsert | null {
  const paragraph = storyParagraph(baseline.fromModel, paragraphId)
  if (!paragraph || (!anchor && !beforeAnchor)) return null
  return {
    clientId: pendingDeletedParagraphId(paragraphId),
    // SAFETY: the guard above returns unless `anchor` or `beforeAnchor` is set,
    // so a missing anchor here means `beforeAnchor` is a string.
    afterParagraphId: anchor ?? (beforeAnchor as string),
    ...(beforeAnchor ? { beforeParagraphId: beforeAnchor } : {}),
    text: paragraphPlainText(paragraph),
    runs: paragraph.runs.map((run) => ({ ...run })),
  }
}

/**
 * Resolves the placeholders a pre-reload translation left behind now that the
 * saved model names the result content. An identity the model still cannot
 * name is kept, never dropped, so the caller can tell that the reversal cannot
 * be represented and block instead of silently losing it.
 */
