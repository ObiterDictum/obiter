import { describe, expect, it } from 'bun:test'

import type {
  DocumentChangeWire,
  DocumentFieldWire,
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '../../packages/contracts/src/document-model'
import { EMPTY_DOCUMENT_MARKINGS } from '../../packages/contracts/src/document-markings'
import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'
import { applyDocumentEdits } from '../../packages/ooxml/src/model-edits'
import { parseDocx } from '../../packages/ooxml/src/parse'
import { serialiseDocx } from '../../packages/ooxml/src/serialise'
import { planCycle2Edit, type Cycle2EditPlan } from './cycle2-edit'
import { compare, summarise } from './summary'

/*
 * The cycle-2 edit leg: one deterministic replace_run_text through the real
 * edit surface between the Word-labelled upload and the second export, and a
 * body-text expectation derived from the model and the declared operation —
 * never from the exported output itself. A missing edit, a stale-version
 * export or an edit that landed on the wrong run all fail the named check.
 */

function run(id: string, text: string): DocumentTextRunWire {
  return { id, text, preservedXmlFragments: [] }
}

function paragraph(
  id: string,
  runs: DocumentTextRunWire[],
): DocumentParagraphWire {
  return { id, runs, preservedXmlFragments: [] }
}

function field(paragraphId: string): DocumentFieldWire {
  return {
    headId: paragraphId,
    closed: true,
    boundaryIds: [paragraphId],
    paragraphIds: [paragraphId],
    resultIds: [paragraphId],
    instruction: ' REF _Ref1 ',
    rangeReplaceable: false,
    boundariesAnchored: true,
  }
}

function insertedChange(
  id: string,
  paragraphId: string,
  runId?: string,
): DocumentChangeWire {
  return {
    id,
    kind: 'insert',
    elementName: 'ins',
    storyPartName: 'word/document.xml',
    paragraphId,
    ...(runId ? { runId } : {}),
    text: '',
  }
}

function wireModel(
  paragraphs: DocumentParagraphWire[],
  extras: {
    fields?: DocumentFieldWire[]
    unanchoredFieldParagraphIds?: string[]
    changes?: DocumentChangeWire[]
  } = {},
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: [],
        fields: extras.fields ?? [],
        unanchoredFieldParagraphIds: extras.unanchoredFieldParagraphIds ?? [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: extras.changes ?? [],
    comments: [],
    markings: EMPTY_DOCUMENT_MARKINGS,
  }
}

function requirePlan(plan: Cycle2EditPlan | null): Cycle2EditPlan {
  if (!plan) throw new Error('expected the model to offer an editable run')
  return plan
}

function namedCheck(checks: ReturnType<typeof compare>, name: string) {
  const check = checks.find((candidate) => candidate.name === name)
  if (!check) throw new Error(`compare() must emit a "${name}" check`)
  return check
}

describe('word-roundtrip cycle-2 edit planning', () => {
  it('skips field and tracked-change carriers to find a plain body run', () => {
    const plan = planCycle2Edit(
      wireModel(
        [
          paragraph('p-field', [run('r-field', 'field carrier')]),
          paragraph('p-tracked', [run('r-tracked', 'tracked carrier')]),
          paragraph('p-body', [run('r-blank', ''), run('r-body', 'Hello')]),
          paragraph('p-tail', [run('r-tail', 'World')]),
        ],
        {
          fields: [field('p-field')],
          unanchoredFieldParagraphIds: ['p-field'],
          changes: [insertedChange('c1', 'p-tracked', 'r-tracked')],
        },
      ),
    )
    expect(plan).not.toBeNull()
    expect(plan?.paragraphId).toBe('p-body')
    expect(plan?.operation).toEqual({
      type: 'replace_run_text',
      runId: 'r-body',
      text: 'Hello [round-trip edit]',
    })
    // The oracle is positional: only the addressed run's text changes, every
    // other paragraph's text carries through verbatim.
    expect(plan?.expectedBodyText).toBe(
      'field carrier tracked carrier Hello [round-trip edit] World',
    )
  })

  it('returns null when the body has no plain text run to address', () => {
    const plan = planCycle2Edit(
      wireModel([paragraph('p-field', [run('r-field', 'field carrier')])], {
        fields: [field('p-field')],
        unanchoredFieldParagraphIds: ['p-field'],
      }),
    )
    expect(plan).toBeNull()
  })
})

describe('word-roundtrip cycle-2 edit oracle', () => {
  it('derives expected text the real edit pipeline then produces', async () => {
    // The oracle is not self-referential: the expected text comes from the
    // model plus the declared operation, and the assertion is that the real
    // apply -> serialise -> parse -> summarise path lands on exactly it.
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const first = await summarise(fixture)
    const parsed = await parseDocx(fixture)
    const plan = requirePlan(planCycle2Edit(parsed.model))
    applyDocumentEdits(parsed, [plan.operation])
    const second = await summarise(await serialiseDocx(parsed))

    expect(second.bodyText).toBe(plan.expectedBodyText)
    const checks = compare(first, second, {
      bodyText: plan.expectedBodyText,
    })
    expect(namedCheck(checks, 'cycle-2 edit applied').pass).toBe(true)
    expect(checks.every((check) => check.pass)).toBe(true)
  })

  it('fails the named check when the export carries no edit', async () => {
    // A stale-version export — or an edit that never reached it — leaves the
    // body text at the cycle-1 shape, which is not the expectation.
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const first = await summarise(fixture)
    const plan = requirePlan(planCycle2Edit((await parseDocx(fixture)).model))
    const checks = compare(first, first, {
      bodyText: plan.expectedBodyText,
    })
    const applied = namedCheck(checks, 'cycle-2 edit applied')
    expect(applied.pass).toBe(false)
    expect(checks.every((check) => check.pass)).toBe(false)
  })

  it('fails the named check when the edit landed on a different run', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const first = await summarise(fixture)
    const parsed = await parseDocx(fixture)
    const plan = requirePlan(planCycle2Edit(parsed.model))
    const story = parsed.model.stories.find((item) => item.kind === 'document')
    const otherRun = story?.paragraphs
      .flatMap((item) => item.runs)
      .find((item) => item.id !== plan.runId && item.text.length > 0)
    if (!otherRun) throw new Error('fixture must offer a second text run')
    applyDocumentEdits(parsed, [
      { type: 'replace_run_text', runId: otherRun.id, text: 'wrong target' },
    ])
    const second = await summarise(await serialiseDocx(parsed))

    const checks = compare(first, second, {
      bodyText: plan.expectedBodyText,
    })
    expect(namedCheck(checks, 'cycle-2 edit applied').pass).toBe(false)
  })

  it('keeps the unedited identity check when no expectation is supplied', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const first = await summarise(fixture)
    const parsed = await parseDocx(fixture)
    const plan = requirePlan(planCycle2Edit(parsed.model))
    applyDocumentEdits(parsed, [plan.operation])
    const second = await summarise(await serialiseDocx(parsed))

    // No expectation: the comparison stays the plain cycle-1 identity and
    // the applied edit shows up as a body-text difference.
    const checks = compare(first, second)
    expect(namedCheck(checks, 'body text identical').pass).toBe(false)
  })
})
