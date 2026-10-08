import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import type { LegalCheckFinding } from './document-legal-checks'
import { effectiveParagraph, paragraphPlainText } from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'

/**
 * The stored cross-reference check: reads the bookmark and field markup the
 * wire keeps as preserved fragments, pairs each `REF`/`NOTEREF`/`PAGEREF`
 * instruction with the bookmark it names, and reports what cannot hold — a
 * missing or about-to-be-deleted target, an unpaired bookmark half, a result
 * text that no longer matches its target.
 *
 * Scope is deliberately narrow, and every limitation stays visible as a
 * `review` finding rather than a silent pass: a field instruction that does
 * not parse, a field whose begin and end sit in different paragraphs, or a
 * bookmark with no partner all report as unchecked rather than sound.
 */

export type CrossReferenceCheck = {
  /** Stored `REF`/`NOTEREF`/`PAGEREF` fields read and checked. */
  fields: number
  /** Pending cross-reference drafts the save will write. */
  pending: number
  findings: LegalCheckFinding[]
}

const BOOKMARK_START = /<w:bookmarkStart\b[^>]*>/g
const BOOKMARK_END = /<w:bookmarkEnd\b[^>]*>/g
const BOOKMARK_ID = /\bw:id="(\d+)"/u
const BOOKMARK_NAME = /\bw:name="([^"]*)"/u
const FIELD_CHAR = /<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"/u
const INSTRUCTION = /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/u
/** `REF` cannot match inside `PAGEREF` — the `\b` fails mid-word. */
const REFERENCE = /\b(?:PAGEREF|NOTEREF|REF)\s+([^\s\\]+)/iu

type BookmarkIndex = {
  /** Defined bookmark name → the paragraph holding its start marker. */
  names: Map<string, string>
  /** `w:id`s that opened a bookmark without a matching end, or vice versa. */
  unpaired: Array<{ paragraphId: string; id: string }>
}

function collectBookmarks(model: DocumentModelWire): BookmarkIndex {
  const names = new Map<string, string>()
  const started = new Map<string, string>()
  const ended = new Map<string, string>()
  for (const story of model.stories) {
    for (const paragraph of story.paragraphs) {
      const fragments = [
        ...paragraph.preservedXmlFragments,
        ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
      ]
      for (const fragment of fragments) {
        for (const match of fragment.matchAll(BOOKMARK_START)) {
          const element = match[0]
          const id = BOOKMARK_ID.exec(element)?.[1]
          const name = BOOKMARK_NAME.exec(element)?.[1]
          if (id !== undefined) started.set(id, paragraph.id)
          if (name !== undefined) names.set(name, paragraph.id)
        }
        for (const match of fragment.matchAll(BOOKMARK_END)) {
          const id = BOOKMARK_ID.exec(match[0])?.[1]
          if (id !== undefined) ended.set(id, paragraph.id)
        }
      }
    }
  }
  const unpaired: Array<{ paragraphId: string; id: string }> = []
  for (const [id, paragraphId] of started) {
    if (!ended.has(id)) unpaired.push({ paragraphId, id })
  }
  for (const [id, paragraphId] of ended) {
    if (!started.has(id)) unpaired.push({ paragraphId, id })
  }
  return { names, unpaired }
}

/** A `REF`/`NOTEREF`/`PAGEREF` field found by walking the runs in order. */
type StoredField = {
  paragraphId: string
  instruction: string
  result: string
  /** The field never closed in this paragraph — a cross-paragraph field or a malformed one. */
  open: boolean
}

function collectFields(
  story: { paragraphs: readonly DocumentParagraphWire[] },
  gone: ReadonlySet<string>,
): StoredField[] {
  const fields: StoredField[] = []
  for (const paragraph of story.paragraphs) {
    if (gone.has(paragraph.id)) continue
    let open: {
      instruction: string
      result: string
      separate: boolean
    } | null = null
    const flush = (closed: boolean) => {
      if (open) {
        fields.push({
          paragraphId: paragraph.id,
          instruction: open.instruction,
          result: open.result,
          open: !closed,
        })
        open = null
      }
    }
    for (const run of paragraph.runs) {
      for (const fragment of run.preservedXmlFragments) {
        const fieldChar = FIELD_CHAR.exec(fragment)?.[1]
        if (fieldChar === 'begin' && !open) {
          open = { instruction: '', result: '', separate: false }
          continue
        }
        if (!open) continue
        if (fieldChar === 'separate') open.separate = true
        else if (fieldChar === 'end') flush(true)
        else if (!open.separate) {
          const instruction = INSTRUCTION.exec(fragment)?.[1]
          if (instruction !== undefined) open.instruction += instruction
        }
      }
      if (open?.separate) open.result += run.text
    }
    flush(false)
  }
  return fields
}

export function checkCrossReferences(
  model: DocumentModelWire,
  structures: readonly StructuralDraft[],
  deletedParagraphIds: ReadonlySet<string>,
  drafts: Record<string, string> = {},
  extraRuns: Record<string, readonly DocumentTextRunWire[]> = {},
): CrossReferenceCheck {
  const gone = new Set(deletedParagraphIds)
  const bookmarks = collectBookmarks(model)
  const findings: LegalCheckFinding[] = []
  const paragraphsById = new Map(
    model.stories.flatMap((story) =>
      story.paragraphs.map((paragraph) => [paragraph.id, paragraph] as const),
    ),
  )
  const effectiveText = (paragraphId: string) => {
    const paragraph = paragraphsById.get(paragraphId)
    if (!paragraph) return undefined
    return paragraphPlainText(
      effectiveParagraph(paragraph, drafts, [
        ...(extraRuns[paragraphId] ?? []),
      ]),
    )
  }
  let fields = 0
  for (const story of model.stories) {
    for (const field of collectFields(story, gone)) {
      const target = REFERENCE.exec(field.instruction)?.[1]
      if (target === undefined) continue
      fields += 1
      if (field.open) {
        findings.push({
          id: `xref-open-${field.paragraphId}-${String(fields)}`,
          paragraphId: field.paragraphId,
          pending: false,
          severity: 'review',
          message:
            'A reference field could not be fully read, so it is not checked.',
        })
        continue
      }
      const targetParagraphId = bookmarks.names.get(target)
      if (targetParagraphId === undefined) {
        findings.push({
          id: `xref-missing-${field.paragraphId}-${String(fields)}`,
          paragraphId: field.paragraphId,
          pending: false,
          severity: 'issue',
          message: `A reference points at "${target}", which is not a bookmark in this document.`,
        })
        continue
      }
      if (gone.has(targetParagraphId)) {
        findings.push({
          id: `xref-deleted-${field.paragraphId}-${String(fields)}`,
          paragraphId: field.paragraphId,
          pending: true,
          severity: 'issue',
          message:
            'A reference points at a bookmark on a paragraph marked for deletion.',
        })
        continue
      }
      if (targetParagraphId === field.paragraphId) {
        findings.push({
          id: `xref-self-${field.paragraphId}-${String(fields)}`,
          paragraphId: field.paragraphId,
          pending: false,
          severity: 'review',
          message: 'A reference points at a bookmark in its own paragraph.',
        })
        continue
      }
      const current = effectiveText(targetParagraphId)
      if (
        current !== undefined &&
        field.result !== '' &&
        current !== field.result
      ) {
        findings.push({
          id: `xref-stale-${field.paragraphId}-${String(fields)}`,
          paragraphId: field.paragraphId,
          pending: false,
          severity: 'review',
          message:
            'The reference shows a stored result that differs from the target\u2019s current text; Word refreshes it on open.',
        })
      }
    }
  }
  for (const { paragraphId, id } of bookmarks.unpaired) {
    if (gone.has(paragraphId)) continue
    findings.push({
      id: `xref-unpaired-${paragraphId}-${id}`,
      paragraphId,
      pending: false,
      severity: 'issue',
      message: 'A bookmark has a start without a matching end.',
    })
  }
  let pending = 0
  for (const structure of structures) {
    if (structure.kind !== 'cross-reference') continue
    pending += 1
    const target = paragraphsById.get(structure.targetParagraphId)
    if (target === undefined || gone.has(structure.targetParagraphId)) {
      findings.push({
        id: `xref-pending-${structure.id}`,
        paragraphId: structure.paragraphId,
        pending: true,
        severity: 'issue',
        message:
          'A pending cross-reference points at a paragraph that is gone; it will not be saved.',
      })
    }
  }
  return { fields, pending, findings }
}
