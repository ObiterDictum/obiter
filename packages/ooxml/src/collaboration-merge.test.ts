import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import type { DocumentEditOperation } from '@obiter/contracts'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  compareXmlSemantics,
  parseDocx,
  reconcileDocumentEdits,
  serialiseDocx,
} from './index'

const source = await buildOoxmlFixture('full-fidelity-with-w14-ids')

describe('bounded collaboration reconciliation', () => {
  it('allows current-base structural edits without mutating either input', async () => {
    const base = await parseDocx(source)
    const current = await parseDocx(source)
    const beforeBase = structuredClone(base.model)
    const beforeCurrent = structuredClone(current.model)
    const paragraphId = mainParagraphs(base)[0]?.id
    if (!paragraphId) throw new Error('Fixture paragraph is missing.')

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [{ type: 'delete_paragraph', paragraphId }],
        true,
      ),
    ).toEqual({ mergeable: true })
    expect(base.model).toEqual(beforeBase)
    expect(current.model).toEqual(beforeCurrent)
    expect([...base.sourceParts.values()].every(({ dirty }) => !dirty)).toBe(
      true,
    )
    expect([...current.sourceParts.values()].every(({ dirty }) => !dirty)).toBe(
      true,
    )
  })

  it('merges disjoint run edits over a stable skeleton', async () => {
    const base = await parseDocx(source)
    const [first, second] = firstTwoRuns(base)
    const current = await editedSource([
      { type: 'replace_run_text', runId: first.id, text: 'First revision' },
    ])

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'replace_run_text',
            runId: second.id,
            text: 'Second revision',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })
  })

  it('treats text and direct style on one run as independent footprints', async () => {
    const textBase = await parseDocx(source)
    const [textRun] = firstTwoRuns(textBase)
    const textCurrent = await editedSource([
      { type: 'replace_run_text', runId: textRun.id, text: 'Text revision' },
    ])
    expect(
      reconcileDocumentEdits(
        textBase,
        textCurrent,
        [
          {
            type: 'set_run_style',
            runId: textRun.id,
            styleId: 'Heading1Char',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })

    const styleBase = await parseDocx(source)
    const [styleRun] = firstTwoRuns(styleBase)
    const styleCurrent = await editedSource([
      {
        type: 'set_run_style',
        runId: styleRun.id,
        styleId: 'Heading1Char',
      },
    ])
    expect(
      reconcileDocumentEdits(
        styleBase,
        styleCurrent,
        [
          {
            type: 'replace_run_text',
            runId: styleRun.id,
            text: 'Text after style',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })
  })

  it('keeps paragraph style independent from contained run text', async () => {
    const textBase = await parseDocx(source)
    const paragraph = mainParagraphs(textBase)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture region is missing.')
    const textCurrent = await editedSource([
      { type: 'replace_run_text', runId: run.id, text: 'Text revision' },
    ])
    expect(
      reconcileDocumentEdits(
        textBase,
        textCurrent,
        [
          {
            type: 'set_paragraph_style',
            paragraphId: paragraph.id,
            styleId: 'Base',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })

    const styleBase = await parseDocx(source)
    const styleCurrent = await editedSource([
      {
        type: 'set_paragraph_style',
        paragraphId: paragraph.id,
        styleId: 'Base',
      },
    ])
    expect(
      reconcileDocumentEdits(
        styleBase,
        styleCurrent,
        [{ type: 'replace_run_text', runId: run.id, text: 'Text revision' }],
        false,
      ),
    ).toEqual({ mergeable: true })
    expect(
      reconcileDocumentEdits(
        styleBase,
        styleCurrent,
        [
          {
            type: 'set_paragraph_style',
            paragraphId: paragraph.id,
            styleId: null,
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })

  it('reports only overlapping operation indexes', async () => {
    const base = await parseDocx(source)
    const [first, second] = firstTwoRuns(base)
    const current = await editedSource([
      { type: 'replace_run_text', runId: first.id, text: 'Winning revision' },
    ])

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'replace_run_text',
            runId: second.id,
            text: 'Disjoint revision',
          },
          {
            type: 'replace_run_text',
            runId: first.id,
            text: 'Overlapping revision',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [1] })
  })

  it('treats changed opaque run fragments as atomic conflicts', async () => {
    const base = await parseDocx(source)
    const [run] = firstTwoRuns(base)
    const zip = await JSZip.loadAsync(source)
    const entry = zip.file('word/document.xml')
    if (!entry) throw new Error('Fixture story is missing.')
    const xml = await entry.async('string')
    zip.file(
      'word/document.xml',
      xml.replace(
        '<w:r><w:t>Alice Example overview</w:t></w:r>',
        '<w:r><w:tab/><w:t>Alice Example overview</w:t></w:r>',
      ),
    )
    const current = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [{ type: 'replace_run_text', runId: run.id, text: 'Unsafe' }],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })

  it('refuses stale deletes and keeps inserts off a rewritten skeleton', async () => {
    const base = await parseDocx(source)
    const paragraphId = mainParagraphs(base)[0]?.id
    const [first] = firstTwoRuns(base)
    if (!paragraphId) throw new Error('Fixture paragraph is missing.')

    expect(
      reconcileDocumentEdits(
        base,
        await parseDocx(source),
        [{ type: 'delete_paragraph', paragraphId }],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
    expect(
      reconcileDocumentEdits(
        base,
        await parseDocx(source),
        [
          {
            type: 'insert_paragraph_after',
            paragraphId,
            text: 'Structure',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })

    const current = await editedSource([
      {
        type: 'insert_paragraph_after',
        paragraphId,
        text: 'Concurrent structure',
      },
    ])
    expect(
      reconcileDocumentEdits(
        base,
        current,
        [{ type: 'replace_run_text', runId: first.id, text: 'Safe disjoint' }],
        false,
      ),
    ).toEqual({ mergeable: true })
  })

  it('preserves tracked changes and remains semantically stable after a merge', async () => {
    const base = await parseDocx(source)
    const [first, second] = firstTwoRuns(base)
    const current = await editedSource([
      { type: 'replace_run_text', runId: first.id, text: 'Current revision' },
    ])
    const foreignChanges = current.model.changes.map((change) => ({
      ...change,
    }))
    const operation: DocumentEditOperation = {
      type: 'replace_run_text',
      runId: second.id,
      text: 'Merged revision',
    }
    const reconciliation = reconcileDocumentEdits(
      base,
      current,
      [operation],
      false,
    )
    expect(reconciliation).toEqual({ mergeable: true })

    applyDocumentEdits(current, [operation])
    const merged = await serialiseDocx(current)
    const reparsed = await parseDocx(merged)
    expect(reparsed.model.changes).toEqual(foreignChanges)
    expect(mainParagraphs(reparsed)[1]?.runs[0]?.text).toBe('Merged revision')

    const secondRoundTrip = await serialiseDocx(reparsed)
    expect(
      compareXmlSemantics(
        await zipText(merged, 'word/document.xml'),
        await zipText(secondRoundTrip, 'word/document.xml'),
      ),
    ).toEqual({ equivalent: true })
    const beforeParts = await zipParts(source)
    const afterParts = await zipParts(merged)
    for (const [name, bytes] of beforeParts) {
      if (name !== 'word/document.xml')
        expect(afterParts.get(name)).toEqual(bytes)
    }
  })
  it('merges emphasis over a concurrent text change on the same run', async () => {
    const base = await parseDocx(source)
    const [first, second] = firstTwoRuns(base)
    const current = await editedSource([
      { type: 'replace_run_text', runId: first.id, text: 'Typed elsewhere' },
    ])

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [{ type: 'set_run_emphasis', runId: second.id, bold: true }],
        false,
      ),
    ).toEqual({ mergeable: true })
  })

  it('conflicts emphasis with a concurrent style change on the same run', async () => {
    const base = await parseDocx(source)
    const [, second] = firstTwoRuns(base)
    const current = await editedSource([
      { type: 'set_run_style', runId: second.id, styleId: 'Heading1Char' },
    ])

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [{ type: 'set_run_emphasis', runId: second.id, bold: true }],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })

  it('merges numbering over a concurrent paragraph style change', async () => {
    const base = await parseDocx(source)
    const first = mainParagraphs(base)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')
    const current = await editedSource([
      { type: 'set_paragraph_style', paragraphId: first.id, styleId: 'Base' },
    ])

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'set_paragraph_numbering',
            paragraphId: first.id,
            numId: '1',
            ilvl: 1,
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: true })
  })

  it('merges inserts anchored to different paragraphs', async () => {
    const base = await parseDocx(source)
    const [first, second] = firstTwoParagraphs(base)
    const current = await editedSource([
      {
        type: 'insert_paragraph_after',
        paragraphId: first.id,
        runs: [
          {
            text: 'Remote insert',
            fontFamily: 'Times New Roman',
            colour: '0000FF',
            bold: true,
          },
        ],
        alignment: 'left',
        spaceBefore: 120,
      },
    ])

    const local: DocumentEditOperation = {
      type: 'insert_paragraph_after',
      paragraphId: second.id,
      runs: [
        {
          text: 'Local insert',
          fontFamily: 'Arial',
          colour: 'FF0000',
          strikethrough: true,
        },
      ],
      alignment: 'right',
      spaceBefore: 240,
    }
    expect(reconcileDocumentEdits(base, current, [local], false)).toEqual({
      mergeable: true,
    })

    applyDocumentEdits(current, [local])
    const merged = mainParagraphs(await parseDocx(await serialiseDocx(current)))
    const remote = merged.find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Remote insert'),
    )
    const localParagraph = merged.find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Local insert'),
    )
    const remoteXml = remote?.runs[0]?.preservedXmlFragments.join('') ?? ''
    const localXml =
      localParagraph?.runs[0]?.preservedXmlFragments.join('') ?? ''
    const remoteParagraphXml = remote?.preservedXmlFragments.join('') ?? ''
    const localParagraphXml =
      localParagraph?.preservedXmlFragments.join('') ?? ''

    expect(remote).toBeDefined()
    expect(localParagraph).toBeDefined()
    expect(remoteXml).toContain('Times New Roman')
    expect(remoteXml).toContain('0000FF')
    expect(remoteXml).toMatch(/<w:b\b/)
    expect(remoteParagraphXml).toMatch(/w:val="left"/)
    expect(remoteParagraphXml).toContain('120')
    expect(localXml).toContain('Arial')
    expect(localXml).toContain('FF0000')
    expect(localXml).toMatch(/<w:strike\b/)
    expect(localParagraphXml).toMatch(/w:val="right"/)
    expect(localParagraphXml).toContain('240')
  })

  it('merges two inserts after the same paragraph without dropping either', async () => {
    const base = await parseDocx(source)
    const [first] = firstTwoParagraphs(base)
    const current = await editedSource([
      {
        type: 'insert_paragraph_after',
        paragraphId: first.id,
        text: 'Remote same-anchor',
      },
    ])
    const local: DocumentEditOperation = {
      type: 'insert_paragraph_after',
      paragraphId: first.id,
      text: 'Local same-anchor',
    }
    expect(reconcileDocumentEdits(base, current, [local], false)).toEqual({
      mergeable: true,
    })
    applyDocumentEdits(current, [local])
    const texts = mainParagraphs(
      await parseDocx(await serialiseDocx(current)),
    ).flatMap((paragraph) => paragraph.runs.map((run) => run.text))
    expect(texts).toContain('Remote same-anchor')
    expect(texts).toContain('Local same-anchor')
  })

  it('conflicts paragraph style when extras made current ids diverge from base', async () => {
    const base = await parseDocx(source)
    const [first] = firstTwoParagraphs(base)
    const current = await editedSource([
      {
        type: 'insert_paragraph_after',
        paragraphId: first.id,
        text: 'Extra',
      },
      {
        type: 'set_paragraph_style',
        paragraphId: first.id,
        styleId: 'Base',
      },
    ])
    const matched = mainParagraphs(current).find(
      (paragraph) => paragraph.sourceParaId === first.sourceParaId,
    )
    if (!matched) throw new Error('Identified paragraph is missing.')
    // w14 ids stay equal; sequential ids after extras are not matched.
    // Shift the matched current id so the extras id space is the thing under
    // test, not an accident of w14 stability.
    matched.id = `${matched.id}-shifted`
    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'set_paragraph_style',
            paragraphId: first.id,
            styleId: null,
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })

  it('conflicts an insert when its anchor paragraph was deleted', async () => {
    const base = await parseDocx(source)
    const [first] = firstTwoParagraphs(base)
    const current = await editedSource([
      { type: 'delete_paragraph', paragraphId: first.id },
    ])
    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'insert_paragraph_after',
            paragraphId: first.id,
            text: 'Orphan insert',
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })

  it('conflicts numbering with a concurrent numbering change on the same paragraph', async () => {
    const base = await parseDocx(source)
    const first = mainParagraphs(base)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')
    const current = await editedSource([
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: '1',
        ilvl: 1,
      },
    ])

    expect(
      reconcileDocumentEdits(
        base,
        current,
        [
          {
            type: 'set_paragraph_numbering',
            paragraphId: first.id,
            numId: '1',
            ilvl: 2,
          },
        ],
        false,
      ),
    ).toEqual({ mergeable: false, operationIndexes: [0] })
  })
})

async function editedSource(operations: readonly DocumentEditOperation[]) {
  const document = await parseDocx(source)
  applyDocumentEdits(document, operations)
  return parseDocx(await serialiseDocx(document))
}

function firstTwoRuns(document: Awaited<ReturnType<typeof parseDocx>>) {
  const first = mainParagraphs(document)[0]?.runs[0]
  const second = mainParagraphs(document)[1]?.runs[0]
  if (!first || !second) throw new Error('Fixture runs are missing.')
  return [first, second] as const
}

function firstTwoParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  const first = mainParagraphs(document)[0]
  const second = mainParagraphs(document)[1]
  if (!first || !second) throw new Error('Fixture paragraphs are missing.')
  return [first, second] as const
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}

async function zipParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  return new Map(
    await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map(
          async (entry) =>
            [entry.name, await entry.async('uint8array')] as const,
        ),
    ),
  )
}
