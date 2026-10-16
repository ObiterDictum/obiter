import { definedTermWords, type DocumentModelWire } from '@obiter/contracts'

import {
  flowParagraphIds,
  insertPlainText,
  type LocalInsert,
} from './document-story-flow'
import type { LegalCheckFinding } from './document-legal-checks'
import {
  collectMarks,
  countOccurrences,
  sameTerm,
  wordTokens,
  type Mark,
} from './document-defined-term-marks'
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
 * What it cannot tell, it does not claim: a stored mark's position inside
 * its paragraph is lost in the wire, so same-paragraph use-before-define
 * cannot be ordered and only cross-paragraph ordering is reported.
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

/** A quoted phrase plausibly naming a term: "Services" or “Hourly Rate”. */
const QUOTED = /["\u201c]([^"\u201d]{1,80})["\u201d]/gu
const CANDIDATE_MAX_WORDS = 6
const CANDIDATE_MAX_COUNT = 10

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
  // A pending mark whose covered text drifted cannot save: the bookmark's
  // name derives from `marked`, so the finding names the term it would
  // have bound, not the text now under the range.
  for (const mark of marks) {
    if (!mark.drifted) continue
    findings.push({
      id: `term-drift-${mark.id}`,
      paragraphId: mark.paragraphId,
      pending: true,
      severity: 'issue',
      message: `The pending mark for "${mark.words.join(' ')}" covers text that changed; it will not be saved.`,
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
