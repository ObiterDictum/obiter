import {
  DEFINED_TERM_NAME_PREFIX,
  definedTermFromBookmarkName,
  definedTermWords,
  type DocumentModelWire,
} from '@obiter/contracts'

import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from './document-story-flow'
import type { LegalCheckFinding } from './document-legal-checks'
import {
  documentStory,
  effectiveParagraph,
  paragraphPlainText,
} from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'
import type { ExtraRuns } from './document-word-edits'

/**
 * The defined-term check. A mark is a `_Def_` bookmark pair whose name
 * carries the term's normalised words — written by `mark_defined_term` for
 * our own marks, read here for both stored and pending ones. The check
 * counts where the term's words appear in the body's effective text and
 * reports the drafting facts a person should see: a term used before its
 * definition, a definition marked twice, a mark whose covered text changed,
 * and quoted capitalised phrases that look like unmarked terms.
 *
 * What it cannot tell, it does not claim: a mark's position inside its
 * paragraph is lost in the wire, so same-paragraph use-before-define cannot
 * be ordered and only cross-paragraph ordering is reported.
 */

export type DefinedTermEntry = {
  /** The term's normalised words, joined for display. */
  term: string
  /** How many marks bind the term (stored and pending). */
  marks: number
  /** Body occurrences of the term's words outside the marked ranges. */
  uses: number
  /** The paragraph the first mark sits on, for navigation. */
  paragraphId: string | null
}

export type DefinedTermCheck = {
  terms: DefinedTermEntry[]
  findings: LegalCheckFinding[]
}

const BOOKMARK_START = /<w:bookmarkStart\b[^>]*>/g
const BOOKMARK_END = /<w:bookmarkEnd\b[^>]*>/g
const BOOKMARK_ID = /\bw:id="(\d+)"/u
const BOOKMARK_NAME = /\bw:name="([^"]*)"/u
const WORD = /[\p{L}\p{N}]+/gu
/** A quoted phrase plausibly naming a term: "Services" or “Hourly Rate”. */
const QUOTED = /["\u201c]([^"\u201d]{1,80})["\u201d]/gu
const CANDIDATE_MAX_WORDS = 6
const CANDIDATE_MAX_COUNT = 10

type Mark = {
  words: string[]
  paragraphId: string
  pending: boolean
}

function sameTerm(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((w, i) => w === right[i])
}

function wordTokens(text: string) {
  return text.toLowerCase().match(WORD) ?? []
}

/** How many times `term` appears as a word sequence in `tokens`. */
function countOccurrences(tokens: readonly string[], term: readonly string[]) {
  let count = 0
  for (let index = 0; index + term.length <= tokens.length; index += 1) {
    if (term.every((word, part) => tokens[index + part] === word)) count += 1
  }
  return count
}

function collectMarks(
  model: DocumentModelWire,
  structures: readonly StructuralDraft[],
  gone: ReadonlySet<string>,
  textOf: (paragraphId: string) => string | undefined,
) {
  const marks: Mark[] = []
  const definedStarted = new Map<string, string>()
  const ended = new Map<string, string>()
  const malformed: Array<{ paragraphId: string; name: string }> = []
  for (const paragraph of documentStory(model)?.paragraphs ?? []) {
    if (gone.has(paragraph.id)) continue
    const fragments = [
      ...paragraph.preservedXmlFragments,
      ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    ]
    for (const fragment of fragments) {
      for (const match of fragment.matchAll(BOOKMARK_START)) {
        const element = match[0]
        const name = BOOKMARK_NAME.exec(element)?.[1]
        if (name === undefined) continue
        const term = definedTermFromBookmarkName(name)
        if (term) {
          const id = BOOKMARK_ID.exec(element)?.[1]
          if (id !== undefined) definedStarted.set(id, paragraph.id)
          marks.push({
            words: term.words,
            paragraphId: paragraph.id,
            pending: false,
          })
        } else if (name.startsWith(DEFINED_TERM_NAME_PREFIX)) {
          malformed.push({ paragraphId: paragraph.id, name })
        }
      }
      for (const match of fragment.matchAll(BOOKMARK_END)) {
        const id = BOOKMARK_ID.exec(match[0])?.[1]
        if (id !== undefined) ended.set(id, paragraph.id)
      }
    }
  }
  for (const structure of structures) {
    if (structure.kind !== 'defined-term' || gone.has(structure.paragraphId)) {
      continue
    }
    const covered = textOf(structure.paragraphId)?.slice(
      structure.from,
      structure.to,
    )
    const words = covered === undefined ? null : definedTermWords(covered)
    if (words) {
      marks.push({ words, paragraphId: structure.paragraphId, pending: true })
    }
  }
  // Unpaired halves matter for `_Def_` marks; other bookmark families are the
  // cross-reference check's to report. A `bookmarkEnd` carries no name, so an
  // end cannot be told apart as a term mark — only a dangling `_Def_` start
  // is reportable.
  const unpaired: Array<{ paragraphId: string; id: string }> = []
  for (const [id, paragraphId] of definedStarted) {
    if (!ended.has(id)) unpaired.push({ paragraphId, id })
  }
  return { marks, unpaired, malformed }
}

export function checkDefinedTerms(
  model: DocumentModelWire,
  structures: readonly StructuralDraft[],
  inserts: readonly LocalInsert[],
  deletedParagraphIds: ReadonlySet<string>,
  drafts: Record<string, string> = {},
  extraRuns: ExtraRuns = {},
): DefinedTermCheck {
  const gone = new Set(deletedParagraphIds)
  const paragraphsById = new Map(
    documentStory(model)?.paragraphs.map((item) => [item.id, item]) ?? [],
  )
  const textOf = (paragraphId: string) => {
    const paragraph = paragraphsById.get(paragraphId)
    return paragraph
      ? paragraphPlainText(
          effectiveParagraph(paragraph, drafts, extraRuns[paragraphId] ?? []),
        )
      : undefined
  }
  const { marks, unpaired, malformed } = collectMarks(
    model,
    structures,
    gone,
    textOf,
  )

  // The body's effective text in flow order, stored and pending-insert
  // paragraphs alike, paired with its word tokens for occurrence counting.
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const flow: Array<{ paragraphId: string; text: string; words: string[] }> = []
  for (const id of flowParagraphIds(model, inserts, [...gone])) {
    const insert = insertById.get(id)
    const text = insert ? insertPlainText(insert) : (textOf(id) ?? '')
    flow.push({ paragraphId: id, text, words: wordTokens(text) })
  }
  const flowIndex = new Map(
    flow.map((row, index) => [row.paragraphId, index] as const),
  )
  const findings: LegalCheckFinding[] = []

  for (const { paragraphId, id } of unpaired) {
    findings.push({
      id: `term-unpaired-${paragraphId}-${id}`,
      paragraphId,
      pending: false,
      severity: 'issue',
      message: 'A defined-term bookmark has a start without a matching end.',
    })
  }
  for (const { paragraphId, name } of malformed) {
    findings.push({
      id: `term-malformed-${paragraphId}-${name}`,
      paragraphId,
      pending: false,
      severity: 'review',
      message: `The bookmark "${name}" looks like a defined-term mark but does not decode.`,
    })
  }

  // Marks sharing normalised words bind the same term.
  const grouped: Array<{ words: string[]; marks: Mark[] }> = []
  for (const mark of marks) {
    const group = grouped.find((item) => sameTerm(item.words, mark.words))
    if (group) group.marks.push(mark)
    else grouped.push({ words: mark.words, marks: [mark] })
  }

  const terms: DefinedTermEntry[] = []
  for (const group of grouped) {
    const term = group.words.join(' ')
    const firstMark = group.marks[0]
    const markIndex =
      firstMark === undefined
        ? -1
        : (flowIndex.get(firstMark.paragraphId) ?? -1)
    let uses = 0
    let earlierParagraphId: string | null = null
    for (const row of flow) {
      const count = countOccurrences(row.words, group.words)
      if (count === 0) continue
      uses += count
      const rowIndex = flowIndex.get(row.paragraphId) ?? -1
      if (
        earlierParagraphId === null &&
        rowIndex > -1 &&
        markIndex > -1 &&
        rowIndex < markIndex
      ) {
        earlierParagraphId = row.paragraphId
      }
    }
    // The marked ranges count toward `uses`; discount one occurrence per mark
    // so the figure reads as uses elsewhere in the body.
    terms.push({
      term,
      marks: group.marks.length,
      uses: Math.max(0, uses - group.marks.length),
      paragraphId: firstMark?.paragraphId ?? null,
    })
    if (group.marks.length > 1) {
      findings.push({
        id: `term-dup-${term}`,
        paragraphId: firstMark?.paragraphId ?? null,
        pending: group.marks.some((mark) => mark.pending),
        severity: 'issue',
        message: `"${term}" is marked ${String(group.marks.length)} times; a term should be defined once.`,
      })
    }
    for (const mark of group.marks) {
      if (mark.pending) continue
      const tokens = wordTokens(textOf(mark.paragraphId) ?? '')
      if (countOccurrences(tokens, group.words) === 0) {
        findings.push({
          id: `term-moved-${term}-${mark.paragraphId}`,
          paragraphId: mark.paragraphId,
          pending: false,
          severity: 'review',
          message: `The text under the "${term}" mark no longer reads as the term.`,
        })
      }
    }
    if (earlierParagraphId !== null) {
      findings.push({
        id: `term-early-${term}`,
        paragraphId: earlierParagraphId,
        pending: false,
        severity: 'review',
        message: `"${term}" is used before the paragraph that defines it.`,
      })
    }
  }

  // Quoted capitalised phrases that are not a marked term are candidates —
  // flagged for review, never asserted to be terms.
  const knownTerms = grouped.map((group) => group.words)
  const seen = new Set<string>()
  for (const row of flow) {
    for (const match of row.text.matchAll(QUOTED)) {
      if (seen.size >= CANDIDATE_MAX_COUNT) break
      const phrase = match[1]?.trim()
      if (!phrase || seen.has(phrase.toLowerCase())) continue
      const words = definedTermWords(phrase)
      if (
        !words ||
        words.length > CANDIDATE_MAX_WORDS ||
        !/^\p{Lu}/u.test(phrase) ||
        knownTerms.some((term) => sameTerm(term, words))
      ) {
        continue
      }
      seen.add(phrase.toLowerCase())
      findings.push({
        id: `term-candidate-${String(seen.size)}`,
        paragraphId: row.paragraphId,
        pending: false,
        severity: 'review',
        message: `"${phrase}" looks like a defined term but is not marked.`,
      })
    }
  }

  return { terms, findings }
}
