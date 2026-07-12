import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRedactionDetector } from '../services/api/src/redaction-detection'

type SpanCategory =
  | 'person_name'
  | 'email'
  | 'phone'
  | 'address'
  | 'date'
  | 'government_id'
  | 'account_number'
  | 'passport'
  | 'drivers_license'
  | 'url'
  | 'ip_address'
  | 'national_insurance'
  | 'case_reference'
  | 'organisation_name'
  | 'secret'
type Fixture = {
  text: string
  spans: Record<string, Array<[number, number]>>
  info?: { id?: string }
}
type Counts = { expected: number; detected: number; matched: number }
type ExpectedSpan = { category: SpanCategory; start: number; end: number }

const CORPUS_LABEL_TO_CATEGORY: Readonly<Record<string, SpanCategory>> = {
  private_person: 'person_name',
  private_address: 'address',
  private_email: 'email',
  private_phone: 'phone',
  private_date: 'date',
  account_number: 'account_number',
  secret: 'secret',
  private_url: 'url',
  national_insurance: 'national_insurance',
  case_reference: 'case_reference',
  passport: 'passport',
  organisation_name: 'organisation_name',
}

function corpusLabel(label: string): string {
  return label.split(':', 1)[0]
}

function overlaps(left: ExpectedSpan, right: ExpectedSpan): boolean {
  return left.start < right.end && right.start < left.end
}

function row(counts: Map<SpanCategory, Counts>, category: SpanCategory): Counts {
  const current = counts.get(category)
  if (current !== undefined) return current
  const created = { expected: 0, detected: 0, matched: 0 }
  counts.set(category, created)
  return created
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

async function main() {
  if (process.env.OBITER_RUN_RAMPART_EVAL !== '1') {
    throw new Error(
      'Refusing to download/load a model. Set OBITER_RUN_RAMPART_EVAL=1 to run this local-only evaluation.',
    )
  }
  let fixtures: Fixture[]
  try {
    fixtures = readFileSync(
      resolve('data/evals/redact/synthetic_validation.jsonl'),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Fixture)
  } catch (error) {
    throw new Error(
      `Unable to read the redaction evaluation corpus: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }

  const detect = createRedactionDetector({ log: () => undefined })
  const counts = new Map<SpanCategory, Counts>()
  const details: Array<Counts & { id: string }> = []
  for (const fixture of fixtures) {
    const expected = Object.entries(fixture.spans).flatMap(([label, offsets]) => {
      const category = CORPUS_LABEL_TO_CATEGORY[corpusLabel(label)]
      if (category === undefined) {
        throw new Error(`No detection category mapping for corpus label: ${label}`)
      }
      return offsets.map(([start, end]) => ({ category, start, end }))
    })
    const result = await detect(fixture.text)
    const matchedDetected = new Set<number>()
    let matched = 0
    for (const target of expected) {
      row(counts, target.category).expected++
      const detectedIndex = result.spans.findIndex(
        (span, index) =>
          !matchedDetected.has(index) &&
          span.category === target.category &&
          overlaps(target, span),
      )
      if (detectedIndex !== -1) {
        matchedDetected.add(detectedIndex)
        row(counts, target.category).matched++
        matched++
      }
    }
    for (const span of result.spans) row(counts, span.category).detected++
    if (process.argv.includes('--verbose')) {
      details.push({
        id: fixture.info?.id ?? 'unknown',
        expected: expected.length,
        detected: result.spans.length,
        matched,
      })
    }
  }

  const rows = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, value]) => ({
      category,
      precision: percent(value.detected ? value.matched / value.detected : 0),
      recall: percent(value.expected ? value.matched / value.expected : 0),
      f1: percent(
        value.detected + value.expected
          ? (2 * value.matched) / (value.detected + value.expected)
          : 0,
      ),
      support: value.expected,
    }))
  const overall = [...counts.values()].reduce(
    (total, value) => ({
      expected: total.expected + value.expected,
      detected: total.detected + value.detected,
      matched: total.matched + value.matched,
    }),
    { expected: 0, detected: 0, matched: 0 },
  )
  console.table([
    ...rows,
    {
      category: 'overall',
      precision: percent(
        overall.detected ? overall.matched / overall.detected : 0,
      ),
      recall: percent(
        overall.expected ? overall.matched / overall.expected : 0,
      ),
      f1: percent(
        overall.detected + overall.expected
          ? (2 * overall.matched) / (overall.detected + overall.expected)
          : 0,
      ),
      support: overall.expected,
    },
  ])
  if (details.length > 0) console.table(details)
}

void main()
