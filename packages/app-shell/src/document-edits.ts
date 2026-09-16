import {
  DOCUMENT_EDIT_COLOUR_PATTERN,
  documentEditHighlightSchema,
  documentEditVertAlignSchema,
  type DocumentEditOperation,
  type DocumentModelWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'
import {
  collectFormatOperations,
  emptyFormatDrafts,
  type FormatDrafts,
} from './document-format-edits'

export type LocalInsert = {
  clientId: string
  afterParagraphId: string
  text: string
  runs?: DocumentTextRunWire[]
}

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
  highlight: (typeof documentEditHighlightSchema.options)[number] | null
  strikethrough: boolean | null
  vertAlign: (typeof documentEditVertAlignSchema.options)[number] | null
  smallCaps: boolean | null
}

export function runPropertiesFromFragments(
  fragments: readonly string[],
): RunEditProperties {
  const xml = fragments.join('')
  return {
    bold: toggleValue(xml, 'b'),
    italic: toggleValue(xml, 'i'),
    underline: underlineValue(xml),
    fontFamily: fontFamilyValue(xml),
    fontSize: fontSizeValue(xml),
    colour: colourValue(xml),
    highlight: highlightValue(xml),
    strikethrough: toggleValue(xml, 'strike'),
    vertAlign: vertAlignValue(xml),
    smallCaps: toggleValue(xml, 'smallCaps'),
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
  return (Object.keys(a) as Array<keyof RunEditProperties>).every(
    (key) => a[key] === b[key],
  )
}

export function insertPlainText(insert: LocalInsert): string {
  if (insert.runs && insert.runs.length > 0) {
    const joined = insert.runs.map((run) => run.text).join('')
    return joined.length > 0 ? joined : insert.text
  }
  return insert.text
}

export function insertRuns(insert: LocalInsert): DocumentTextRunWire[] {
  if (insert.runs && insert.runs.length > 0) {
    const joined = insert.runs.map((run) => run.text).join('')
    if (joined.length > 0 || !insert.text) return insert.runs
    return [{ ...insert.runs[0], text: insert.text }]
  }
  return [
    {
      id: insert.clientId,
      text: insert.text,
      preservedXmlFragments: [],
    },
  ]
}

export function removeInsert(
  inserts: LocalInsert[],
  clientId: string,
): { inserts: LocalInsert[]; selectId: string } | undefined {
  const removed = inserts.find((item) => item.clientId === clientId)
  if (!removed) return undefined
  return {
    inserts: inserts
      .filter((item) => item.clientId !== clientId)
      .map((item) =>
        item.afterParagraphId === clientId
          ? { ...item, afterParagraphId: removed.afterParagraphId }
          : item,
      ),
    selectId: removed.afterParagraphId,
  }
}

const noOmitHosts: ReadonlySet<string> = new Set()

export function flowIds(
  hostIds: readonly string[],
  inserts: LocalInsert[],
  omitHosts: ReadonlySet<string> = noOmitHosts,
): string[] {
  const byAfter = new Map<string, LocalInsert[]>()
  for (const insert of inserts) {
    const list = byAfter.get(insert.afterParagraphId) ?? []
    list.push(insert)
    byAfter.set(insert.afterParagraphId, list)
  }
  const ids: string[] = []
  const appendInserts = (id: string) => {
    for (const insert of byAfter.get(id) ?? []) {
      ids.push(insert.clientId)
      appendInserts(insert.clientId)
    }
  }
  for (const id of hostIds) {
    if (!omitHosts.has(id)) ids.push(id)
    appendInserts(id)
  }
  return ids
}

export function flowParagraphIds(
  model: DocumentModelWire,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
): string[] {
  return flowIds(
    (documentStory(model)?.paragraphs ?? []).map((paragraph) => paragraph.id),
    inserts,
    new Set(deletedParagraphIds),
  )
}

export function collectEditOperations(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  const story = documentStory(model)
  const deleted = new Set(deletedParagraphIds)
  const emptyReplacements: string[] = []

  for (const paragraph of story?.paragraphs ?? []) {
    if (deleted.has(paragraph.id)) continue
    const extra = extraRuns[paragraph.id] ?? []
    const extraText = extra.map((run) => drafts[run.id] ?? run.text).join('')
    if (paragraph.runs.length === 0) {
      if (extraText) {
        operations.push({
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          ...extraParagraphPayload(extra, drafts),
          ...(paragraph.styleId ? { styleId: paragraph.styleId } : {}),
        })
        emptyReplacements.push(paragraph.id)
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

  const realIds = new Set(
    (story?.paragraphs ?? []).map((paragraph) => paragraph.id),
  )
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  for (const id of flowParagraphIds(model, inserts, deletedParagraphIds)) {
    const insert = insertById.get(id)
    if (!insert) continue
    // A pending insert's paragraph style is set by the insert operation itself:
    // its server paragraph id does not exist until the batch runs, so a
    // separate set_paragraph_style addressed to the client id would be rejected
    // and would then fail every later save (E45).
    const style = format.paragraphStyles[insert.clientId]
    operations.push({
      type: 'insert_paragraph_after',
      paragraphId: resolveInsertAnchor(insert, insertById, realIds),
      ...insertPayload(insert),
      ...(style ? { styleId: style } : {}),
    })
  }

  for (const paragraphId of deletedParagraphIds) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }
  for (const paragraphId of emptyReplacements) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }
  operations.push(
    ...collectFormatOperations(
      model,
      format,
      deletedParagraphIds,
      new Set(insertById.keys()),
    ),
  )

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

function xmlPrefix(xml: string) {
  return xml.match(/<([A-Za-z_][\w.-]*):/u)?.[1] ?? 'w'
}

function wordTag(xml: string, localName: string) {
  const prefix = xmlPrefix(xml)
  return xml.match(new RegExp(`<${prefix}:${localName}\\b([^>]*)\\/?>`, 'i'))
}

function wordAttr(attrs: string | undefined, name: string, prefix: string) {
  return attrs?.match(new RegExp(`(?:${prefix}:)?${name}="([^"]+)"`, 'i'))?.[1]
}

function toggleValue(xml: string, localName: string): boolean | null {
  const tag = wordTag(xml, localName)
  if (!tag) return null
  const value = wordAttr(tag[1], 'val', xmlPrefix(xml))?.toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

function underlineValue(xml: string): boolean | null {
  const tag = wordTag(xml, 'u')
  if (!tag) return null
  const value = wordAttr(tag[1], 'val', xmlPrefix(xml))?.toLowerCase()
  return value !== 'none' && value !== '0' && value !== 'false'
}

function fontFamilyValue(xml: string): string | null {
  const attrs = wordTag(xml, 'rFonts')?.[1]
  const prefix = xmlPrefix(xml)
  return (
    wordAttr(attrs, 'ascii', prefix) ?? wordAttr(attrs, 'hAnsi', prefix) ?? null
  )
}

function fontSizeValue(xml: string): number | null {
  const raw = wordAttr(wordTag(xml, 'sz')?.[1], 'val', xmlPrefix(xml))
  const size = raw === undefined ? Number.NaN : Number(raw)
  return Number.isInteger(size) ? size : null
}

function colourValue(xml: string): string | null {
  const value = wordAttr(wordTag(xml, 'color')?.[1], 'val', xmlPrefix(xml))
  return value && isEditColour(value) ? value : null
}

function highlightValue(
  xml: string,
): (typeof documentEditHighlightSchema.options)[number] | null {
  const value = wordAttr(wordTag(xml, 'highlight')?.[1], 'val', xmlPrefix(xml))
  return value && isHighlight(value) ? value : null
}

function vertAlignValue(
  xml: string,
): (typeof documentEditVertAlignSchema.options)[number] | null {
  const value = wordAttr(wordTag(xml, 'vertAlign')?.[1], 'val', xmlPrefix(xml))
  return value && isVertAlign(value) ? value : null
}

function isEditColour(value: string) {
  return DOCUMENT_EDIT_COLOUR_PATTERN.test(value)
}

function isHighlight(
  value: string,
): value is (typeof documentEditHighlightSchema.options)[number] {
  return (documentEditHighlightSchema.options as readonly string[]).includes(
    value,
  )
}

function isVertAlign(
  value: string,
): value is (typeof documentEditVertAlignSchema.options)[number] {
  return (documentEditVertAlignSchema.options as readonly string[]).includes(
    value,
  )
}

export function resolveInsertAnchor(
  insert: LocalInsert,
  insertById: ReadonlyMap<string, LocalInsert>,
  realIds: ReadonlySet<string>,
): string {
  let id = insert.afterParagraphId
  const seen = new Set<string>()
  while (!realIds.has(id)) {
    if (seen.has(id)) return insert.afterParagraphId
    seen.add(id)
    const parent = insertById.get(id)
    if (!parent) return insert.afterParagraphId
    id = parent.afterParagraphId
  }
  return id
}

export function isDraftDirty(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
) {
  return (
    collectEditOperations(
      model,
      drafts,
      inserts,
      deletedParagraphIds,
      extraRuns,
      format,
    ).length > 0
  )
}

export function selectedParagraphLength(
  model: DocumentModelWire,
  paragraphId: string | null,
) {
  if (!paragraphId) return 0
  const paragraph = documentStory(model)?.paragraphs.find(
    (item) => item.id === paragraphId,
  )
  return paragraph ? paragraphPlainText(paragraph).length : 0
}

export function downloadPlainText(filename: string, text: string) {
  downloadBlob(
    `${filename.replace(/\.[^.]+$/u, '')}.txt`,
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  )
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
