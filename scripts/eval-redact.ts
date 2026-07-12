import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectRedactionSpans } from '../services/api/src/redaction-detection'

type Fixture = { text: string; spans: Record<string, Array<[number, number]>> }

async function main() {
  if (process.env.OBITER_RUN_RAMPART_EVAL !== '1') {
    throw new Error('Refusing to download/load a model. Set OBITER_RUN_RAMPART_EVAL=1 to run this local-only evaluation.')
  }
  let fixtures: Fixture[]
  try {
    fixtures = readFileSync(resolve('data/evals/redact/synthetic_validation.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Fixture)
  } catch (error) {
    throw new Error(`Unable to read the redaction evaluation corpus: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  const counts = new Map<string, { expected: number; detected: number; matched: number }>()
  for (const fixture of fixtures) {
    const result = await detectRedactionSpans(fixture.text)
    for (const [label, expected] of Object.entries(fixture.spans)) {
      const row = counts.get(label) ?? { expected: 0, detected: 0, matched: 0 }
      row.expected += expected.length
      row.matched += expected.filter(([start, end]) => result.spans.some((span) => span.start === start && span.end === end)).length
      counts.set(label, row)
    }
    for (const span of result.spans) {
      const row = counts.get(span.category) ?? { expected: 0, detected: 0, matched: 0 }
      row.detected += 1
      counts.set(span.category, row)
    }
  }
  console.table([...counts.entries()].map(([type, value]) => ({ type, precision: value.detected ? value.matched / value.detected : 0, recall: value.expected ? value.matched / value.expected : 0, ...value })))
}

void main()
