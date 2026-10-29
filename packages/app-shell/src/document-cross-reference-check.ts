import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { decodeXmlReferences } from '@obiter/ooxml'

import type { LegalCheckFinding } from './document-legal-checks'
import { effectiveParagraph, paragraphPlainText } from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'

export type CrossReferenceCheck = {
  fields: number
  pending: number
  findings: LegalCheckFinding[]
}

const BOOKMARK_START = /<w:bookmarkStart\b[^>]*>/g
const BOOKMARK_END = /<w:bookmarkEnd\b[^>]*>/g
const BOOKMARK_ID = /\bw:id="(\d+)"/u
const BOOKMARK_NAME = /\bw:name="([^"]*)"/u
const FIELD_CHAR = /<w:fldChar\b[^>]*\bw:fldCharType="(begin|separate|end)"/u
const INSTRUCTION = /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gu
const SIMPLE_FIELD =
  /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/gu
const SIMPLE_FIELD_TEXT = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu
const REFERENCE = /^\s*(PAGEREF|NOTEREF|REF)\s+("[^"]*"|[^\s\\]+)/iu
const REFERENCE_KEYWORD = /^\s*(PAGEREF|NOTEREF|REF)\b/iu

type BookmarkIndex = {
  names: Map<string, string>
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

type StoredField = {
  paragraphId: string
  instruction: string
  result: string
  open: boolean
}

function referenceInstruction(
  instruction: string,
): { kind: 'REF' | 'PAGEREF' | 'NOTEREF'; target: string | undefined } | null {
  const match = REFERENCE.exec(instruction)
  const raw = match?.[2]
  const kind =
    match === null
      ? REFERENCE_KEYWORD.exec(instruction)?.[1]?.toUpperCase()
      : match[1]?.toUpperCase()
  if (kind !== 'REF' && kind !== 'PAGEREF' && kind !== 'NOTEREF') return null
  const target =
    raw !== undefined && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw
  return { kind, target }
}

function collectFields(
  story: { paragraphs: readonly DocumentParagraphWire[] },
  gone: ReadonlySet<string>,
): StoredField[] {
  const fields: StoredField[] = []
  for (const paragraph of story.paragraphs) {
    if (gone.has(paragraph.id)) continue
    for (const fragment of paragraph.preservedXmlFragments) {
      for (const match of fragment.matchAll(SIMPLE_FIELD)) {
        const instruction = decodeXmlReferences(match[1] ?? '')
        let result = ''
        for (const text of (match[2] ?? '').matchAll(SIMPLE_FIELD_TEXT)) {
          result += decodeXmlReferences(text[1] ?? '')
        }
        fields.push({
          paragraphId: paragraph.id,
          instruction,
          result,
          open: false,
        })
      }
    }
    const open: Array<{
      instruction: string
      result: string
      separate: boolean
    }> = []
    for (const run of paragraph.runs) {
      for (const fragment of run.preservedXmlFragments) {
        const fieldChar = FIELD_CHAR.exec(fragment)?.[1]
        if (fieldChar === 'begin') {
          open.push({ instruction: '', result: '', separate: false })
          continue
        }
        if (fieldChar === 'separate') {
          const top = open.at(-1)
          if (top) top.separate = true
          continue
        }
        if (fieldChar === 'end') {
          const done = open.pop()
          if (done) {
            fields.push({
              paragraphId: paragraph.id,
              instruction: done.instruction,
              result: done.result,
              open: false,
            })
          }
          continue
        }
        const top = open.at(-1)
        if (top && !top.separate) {
          for (const match of fragment.matchAll(INSTRUCTION)) {
            top.instruction += match[1] ?? ''
          }
        }
      }
      for (const field of open) {
        if (field.separate) field.result += run.text
      }
    }
    for (const leftover of open) {
      fields.push({
        paragraphId: paragraph.id,
        instruction: leftover.instruction,
        result: leftover.result,
        open: true,
      })
    }
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
      const reference = referenceInstruction(field.instruction)
      if (reference === null) continue
      fields += 1
      if (field.open || reference.target === undefined) {
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
      const target = reference.target
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
      if (reference.kind !== 'REF' || field.result === '') continue
      const current = effectiveText(targetParagraphId)
      if (current !== undefined && !current.includes(field.result)) {
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
