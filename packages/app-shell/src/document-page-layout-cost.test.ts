import '@obiter/test-dom'
import { beforeAll, expect, it } from 'bun:test'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
import { layoutDocument } from './document-page-engine'

const DEV_BODY_KEYSTROKE_TEXT_READS = 1598
const DEV_FOOTNOTE_KEYSTROKE_TEXT_READS = 1678

async function measure(
  noteCount: number,
  keystroke: {
    draftKey?: (runId: string) => string
    draft?: (text: string, index: number) => string
  } = {},
) {
  const { model } = await parseDocx(await createSyntheticDocx(['Body']))
  const body = model.stories[0]
  if (!body) throw new Error('Missing synthetic body')
  const bodyText = 'Ordinary legal document text '.repeat(10)
  let textReads = 0
  body.paragraphs = Array.from({ length: 400 }, (_, index) => ({
    id: `body-${index}`,
    runs: [
      {
        id: `body-run-${index}`,
        get text() {
          textReads += 1
          return bodyText
        },
        preservedXmlFragments: [],
      },
    ],
    preservedXmlFragments: [],
  }))
  const notes = Array.from({ length: noteCount }, (_, index) => {
    const paragraph = body.paragraphs[index * 10]
    if (!paragraph) throw new Error('Missing reference paragraph')
    paragraph.runs.push({
      id: `ref-${index}`,
      text: '',
      preservedXmlFragments: [`<w:footnoteReference w:id="${index + 1}"/>`],
    })
    return {
      id: `note-${index}`,
      runs: [
        {
          id: `note-run-${index}`,
          get text() {
            textReads += 1
            return 'Supporting authority and explanation.'
          },
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
  })
  if (noteCount)
    model.stories.push({
      ...body,
      kind: 'footnotes',
      partName: 'word/footnotes.xml',
      paragraphs: notes,
      preservedXmlFragments: notes.map(
        (_, index) => `<w:footnote w:id="${index + 1}"><w:p/></w:footnote>`,
      ),
    })
  const start = performance.now()
  const pages = layoutDocument(model)
  const cold = performance.now() - start
  const run = body.paragraphs[200]?.runs[0]
  if (!run) throw new Error('Missing edited run')
  const reads: number[] = []
  const times = Array.from({ length: 10 }, (_, index) => {
    const drafts = {
      [keystroke.draftKey?.(run.id) ?? run.id]:
        keystroke.draft?.(run.text, index) ?? `${run.text}${index}`,
    }
    textReads = 0
    const start = performance.now()
    layoutDocument(model, drafts)
    reads.push(textReads)
    return performance.now() - start
  }).sort((a, b) => a - b)
  const median = times[5] ?? Infinity
  const medianReads = reads.sort((a, b) => a - b)[5] ?? Infinity
  console.log({ noteCount, pages: pages.length, cold, median, medianReads })
  return medianReads
}

beforeAll(async () => {
  await measure(0)
  await measure(40)
})

it('bounds 400-paragraph keystroke text reads to 1.25 times the dev no-footnote budget', async () => {
  expect(await measure(0)).toBeLessThanOrEqual(
    DEV_BODY_KEYSTROKE_TEXT_READS * 1.25,
  )
})

it('bounds 40-footnote keystroke text reads to 1.25 times the dev footnote budget', async () => {
  expect(await measure(40)).toBeLessThanOrEqual(
    DEV_FOOTNOTE_KEYSTROKE_TEXT_READS * 1.25,
  )
})

it('reuses a cached footnote placement when a draft key matches no run', async () => {
  expect(
    await measure(40, { draftKey: (runId) => runId.replace('-run', '') }),
  ).toBeLessThanOrEqual(DEV_BODY_KEYSTROKE_TEXT_READS * 1.25)
})

it('bounds 40-footnote text reads when a keystroke adds lines', async () => {
  expect(
    await measure(40, {
      draft: (text, index) =>
        `${text}${' added words'.repeat((index + 1) * 12)}`,
    }),
  ).toBeLessThanOrEqual(DEV_BODY_KEYSTROKE_TEXT_READS * 1.25)
})
