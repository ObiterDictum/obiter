import {
  type DocumentEditOperation,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'
import type { BreakDraft } from './document-draft-state'
import {
  collectFormatOperations,
  emptyFormatDrafts,
  type FormatDrafts,
} from './document-format-edits'
import type { HighlightValue, VertAlignValue } from './document-format-types'
import { editableStories } from './document-model-text'
import {
  runColour,
  runFlag,
  runFontFamily,
  runFontSize,
  runHighlight,
  runUnderline,
  runVertAlign,
  withoutTrackedRunProperties,
} from './document-run-properties'
import {
  flowIds,
  insertRuns,
  resolveInsertAnchor,
  type LocalInsert,
} from './document-story-flow'
import {
  structuralEditOperations,
  type StructuralDraft,
} from './document-structural-drafts'

/**
 * The run properties the edit contract can restate, read from a run's preserved
 * fragments. `null` means the run does not set the property directly, which is
 * the value a range emphasis needs to strip an inherited direct setting. One
 * extractor serves both the insert payload (compacted, absent properties
 * omitted) and the emphasis a joined tail run needs, so the two cannot drift.
 */
export type RunEditProperties = {
  bold: boolean | null
  italic: boolean | null
  underline: boolean | null
  fontFamily: string | null
  fontSize: number | null
  colour: string | null
  highlight: HighlightValue | null
  strikethrough: boolean | null
  vertAlign: VertAlignValue | null
  smallCaps: boolean | null
}

export function runPropertiesFromFragments(
  fragments: readonly string[],
): RunEditProperties {
  const xml = withoutTrackedRunProperties(fragments.join(''))
  return {
    bold: runFlag(xml, 'b'),
    italic: runFlag(xml, 'i'),
    underline: runUnderline(xml),
    fontFamily: runFontFamily(xml),
    fontSize: runFontSize(xml),
    colour: runColour(xml),
    highlight: runHighlight(xml),
    strikethrough: runFlag(xml, 'strike'),
    vertAlign: runVertAlign(xml),
    smallCaps: runFlag(xml, 'smallCaps'),
  }
}

/** The set properties only, for an operation that creates a fresh run. */
export function compactRunProperties(properties: RunEditProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== null),
  )
}

/** Whether two runs set the same representable properties. */
export function sameRunProperties(
  a: RunEditProperties,
  b: RunEditProperties,
): boolean {
  // SAFETY: Object.keys of a RunEditProperties value yields its own property names, which are exactly the keys of RunEditProperties.
  return (Object.keys(a) as Array<keyof RunEditProperties>).every(
    (key) => a[key] === b[key],
  )
}

/**
 * The runless paragraphs a batch replaces instead of editing: an empty
 * paragraph carrying pending typed text becomes an `insert_paragraph_after`
 * plus a `delete_paragraph`, so its id lands in the writer's `deletedIds`
 * without ever appearing in a draft's delete list. Every "gone after this
 * batch" check — the save partition's structure guards and the painted
 * surfaces alike — must include this set or it disagrees with the writer.
 */
export function replacedEmptyParagraphIds(
  paragraphs: readonly DocumentParagraphWire[],
  extraRuns: Record<string, DocumentTextRunWire[]>,
  drafts: Record<string, string>,
): Set<string> {
  const replaced = new Set<string>()
  for (const paragraph of paragraphs) {
    if (paragraph.runs.length !== 0) continue
    if (
      (extraRuns[paragraph.id] ?? []).some(
        (run) => (drafts[run.id] ?? run.text).length > 0,
      )
    ) {
      replaced.add(paragraph.id)
    }
  }
  return replaced
}

export function collectEditOperations(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
  breaks: BreakDraft[] = [],
  structures: StructuralDraft[] = [],
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  // Text edits address every editable story: a header or footer paragraph's
  // runs carry the same wire ids the batch resolves.
  const paragraphs = editableStories(model).flatMap((story) => story.paragraphs)
  const deleted = new Set(deletedParagraphIds)
  const emptyReplacements = replacedEmptyParagraphIds(
    paragraphs,
    extraRuns,
    drafts,
  )
  for (const paragraphId of deleted) emptyReplacements.delete(paragraphId)

  for (const paragraph of paragraphs) {
    if (deleted.has(paragraph.id)) continue
    const extra = extraRuns[paragraph.id] ?? []
    const extraText = extra.map((run) => drafts[run.id] ?? run.text).join('')
    if (paragraph.runs.length === 0) {
      if (emptyReplacements.has(paragraph.id)) {
        operations.push({
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          ...extraParagraphPayload(extra, drafts),
          ...(paragraph.styleId ? { styleId: paragraph.styleId } : {}),
        })
      }
      continue
    }
    for (const [index, run] of paragraph.runs.entries()) {
      const last = index === paragraph.runs.length - 1
      const draft =
        last && extraText
          ? `${drafts[run.id] ?? run.text}${extraText}`
          : drafts[run.id]
      if (draft !== undefined && draft !== run.text) {
        operations.push({
          type: 'replace_run_text',
          runId: run.id,
          text: draft,
        })
      }
    }
    // The appended tail is folded into the head paragraph's last run, which
    // would paint it with that run's formatting. Restate each moved run's own
    // properties over its slice so the save keeps what the editor painted.
    operations.push(...appendedRunEmphasis(paragraph, extra, drafts))
  }

  // Formatting and page setup are emitted before the breaks: no format operation
  // changes text offsets, and the section-break seed and any run-property write
  // must already be pending when the break is applied. The paginator seeds a
  // section break from the painted section too, so both paths read the same
  // geometry.
  const realIds = new Set(paragraphs.map((paragraph) => paragraph.id))
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  operations.push(
    ...collectFormatOperations(
      model,
      format,
      deletedParagraphIds,
      new Set(insertById.keys()),
    ),
  )

  // Breaks are applied after the text replacements above, so their offset
  // addresses the same effective text the client recorded it in.
  for (const item of breaks) {
    if (deleted.has(item.paragraphId)) continue
    if (item.kind === 'page') {
      operations.push({
        type: 'insert_break',
        paragraphId: item.paragraphId,
        offset: item.offset,
        kind: 'page',
      })
    } else {
      operations.push({
        type: 'insert_section_break',
        paragraphId: item.paragraphId,
      })
    }
  }

  // Each insert lands in its anchor's story; walking every editable story's
  // flow emits header and footer paragraphs alongside the body's.
  const insertOrder = editableStories(model).flatMap((story) =>
    flowIds(
      story.paragraphs.map((paragraph) => paragraph.id),
      inserts,
      deleted,
    ),
  )
  for (const id of insertOrder) {
    const insert = insertById.get(id)
    if (!insert) continue
    // A pending insert's paragraph style is set by the insert operation itself:
    // its server paragraph id does not exist until the batch runs, so a
    // separate set_paragraph_style addressed to the client id would be rejected
    // and would then fail every later save (E45).
    const style = format.paragraphStyles[insert.clientId]
    const anchor = resolveInsertAnchor(insert, insertById, realIds)
    const before = insert.beforeParagraphId !== undefined
    operations.push({
      type: before ? 'insert_paragraph_before' : 'insert_paragraph_after',
      paragraphId: anchor,
      // The opaque intent id is echoed back in the lineage so the client can
      // name the stored paragraph without matching insert order.
      intentId: insert.clientId,
      ...insertPayload(insert),
      ...(style ? { styleId: style } : {}),
    })
  }

  // Structural insertions run after the paragraph inserts: a table chains
  // after any paragraph the same batch inserted at its anchor, matching the
  // order the pending fold paints, and still before the deletions that close
  // the batch so a deleted anchor cannot silently swallow an insertion.
  // The writer's `deletedIds` collects every planned `delete_paragraph` —
  // explicit marks and empty replacements alike — so the structural scan
  // reads the union, matching the anchors and targets the batch removes.
  operations.push(
    ...structuralEditOperations(
      structures,
      new Set([...deleted, ...emptyReplacements]),
      drafts,
      extraRuns,
    ),
  )

  for (const paragraphId of deletedParagraphIds) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }
  for (const paragraphId of emptyReplacements) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }

  return operations
}

/**
 * Reads direct run formatting from preserved fragments onto editRunSchema.
 * Prefix comes from the fragment, not a hardcoded `w:`.
 */
function insertPayload(insert: LocalInsert) {
  if (!insert.runs || insert.runs.length === 0) return { text: insert.text }
  return {
    runs: insertRuns(insert).map((run) => ({
      text: run.text,
      ...(run.styleId ? { styleId: run.styleId } : {}),
      ...compactRunProperties(
        runPropertiesFromFragments(run.preservedXmlFragments),
      ),
    })),
  }
}

/**
 * The payload for a paragraph that has no runs of its own and is built entirely
 * from appended runs. Plain text keeps the compact `text` shape; anything that
 * carries formatting or a character style becomes `runs`, so a join can never
 * leave the appended text plainer than it was painted.
 */
function extraParagraphPayload(
  runs: readonly DocumentTextRunWire[],
  drafts: Record<string, string>,
) {
  const payload = runs.map((run) => ({
    text: drafts[run.id] ?? run.text,
    ...(run.styleId ? { styleId: run.styleId } : {}),
    ...compactRunProperties(
      runPropertiesFromFragments(run.preservedXmlFragments),
    ),
  }))
  const formatted = payload.some((run) => Object.keys(run).length > 1)
  return formatted
    ? { runs: payload }
    : { text: payload.map((run) => run.text).join('') }
}

/**
 * The emphasis operations that restate each appended tail run's own properties
 * over its slice of the joined paragraph. The head's last run receives the
 * appended text, so a slice whose properties differ from its predecessor needs
 * an operation whether it sets a property or clears one the predecessor had.
 * Ranges are post-text-edit offsets, which is the space the server applies
 * range emphasis in.
 */
function appendedRunEmphasis(
  paragraph: { id: string; runs: DocumentTextRunWire[] },
  extra: readonly DocumentTextRunWire[],
  drafts: Record<string, string>,
): DocumentEditOperation[] {
  if (extra.length === 0) return []
  const last = paragraph.runs[paragraph.runs.length - 1]
  if (!last) return []
  const operations: DocumentEditOperation[] = []
  let cursor = paragraph.runs.reduce(
    (sum, run) => sum + (drafts[run.id] ?? run.text).length,
    0,
  )
  let previous = runPropertiesFromFragments(last.preservedXmlFragments)
  for (const run of extra) {
    const text = drafts[run.id] ?? run.text
    const properties = runPropertiesFromFragments(run.preservedXmlFragments)
    if (text.length > 0 && !sameRunProperties(properties, previous)) {
      operations.push({
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: cursor,
        to: cursor + text.length,
        ...properties,
      })
    }
    cursor += text.length
    previous = properties
  }
  return operations
}
