import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Label =
  | 'private_person'
  | 'private_address'
  | 'private_email'
  | 'private_phone'
  | 'private_date'
  | 'account_number'
  | 'secret'
  | 'private_url'
  | 'national_insurance'
  | 'case_reference'
  | 'passport'
  | 'organisation_name'
type SpanMap = Record<string, Array<[number, number]>>

const output = resolve('data/evals/redact')
const types = [
  'skeleton_argument',
  'witness_statement',
  'case_report',
  'client_letter',
  'attendance_note',
  'court_form',
  'pleading',
] as const
const names = [
  'James Cartwright',
  'Sarah Chen',
  "Michael O'Brien",
  'Aisha Patel',
  'David Smith',
  'Emma Jones',
  'Priya Sharma',
  'Owen Williams',
  'Fatima Khan',
  'George Brown',
]
const streets = [
  'Belgrave Road, Leicester LE4 5AB',
  'High Holborn, London WC1V 6XX',
  'Market Street, Manchester M1 1AE',
  'Station Road, Bristol BS1 4QA',
  'King Street, Leeds LS1 2HT',
]
const roles = [
  'claimant',
  'defendant',
  'witness',
  'expert',
  'judge',
  'counsel',
  'solicitor',
]

function append(text: string, label: Label, value: string, spans: SpanMap) {
  const start = text.length
  const key = `${label}: ${value}`
  ;(spans[key] ??= []).push([start, start + value.length])
  return text + value
}

function documentFor(index: number) {
  const type = types[index % types.length]
  if (index < 7)
    return {
      text: `IN THE ${type.replaceAll('_', ' ').toUpperCase()}\n\nThis synthetic legal document contains no personal data.`,
      spans: {} as SpanMap,
      info: {
        id: `legal_${String(index + 1).padStart(3, '0')}`,
        source: 'obiter.synthetic',
        documentType: type,
        roles: {},
      },
    }
  const person = names[index % names.length]
  const opposing = names[(index + 3) % names.length]
  const spans: SpanMap = {}
  let text = `IN THE HIGH COURT OF JUSTICE\n\n${type.replaceAll('_', ' ').toUpperCase()}\n\n`
  text += 'Claim No. '
  text = append(
    text,
    'case_reference',
    `REF/2026/${String(index).padStart(4, '0')}`,
    spans,
  )
  text += '\n\n1. The Claimant, Mr '
  text = append(text, 'private_person', person, spans)
  text += ' of '
  text = append(
    text,
    'private_address',
    `${index + 10} ${streets[index % streets.length]}`,
    spans,
  )
  text += ', respectfully submits that the hearing listed for '
  text = append(text, 'private_date', `${(index % 27) + 1} March 2026`, spans)
  text += '. His email is '
  text = append(
    text,
    'private_email',
    `${person.toLowerCase().replaceAll(' ', '.').replaceAll("'", '')}@example.test`,
    spans,
  )
  text += ' and telephone number is '
  text = append(
    text,
    'private_phone',
    `07700 90${String(index).padStart(4, '0')}`,
    spans,
  )
  text += '. National Insurance number: '
  text = append(
    text,
    'national_insurance',
    `JX ${String(100000 + index).slice(0, 2)} ${String(100000 + index).slice(2, 4)} ${String(100000 + index).slice(4)} D`,
    spans,
  )
  text += '. Passport: '
  text = append(text, 'passport', String(100000000 + index), spans)
  text += '. Costs account '
  text = append(
    text,
    'account_number',
    `${String(10000000 + index).slice(-8)} / 12-34-56`,
    spans,
  )
  text += '. The Defendant is Ms '
  text = append(text, 'private_person', opposing, spans)
  text += ' of '
  text = append(
    text,
    'organisation_name',
    'Smith & Jones Solicitors LLP',
    spans,
  )
  text += '. Portal: '
  text = append(
    text,
    'private_url',
    `https://portal.example.test/matters/${index}`,
    spans,
  )
  text += '. Password: '
  text = append(text, 'secret', `SyntheticPass${index}!`, spans)
  text += `. In Smith v Jones [2023] EWHC 1234 (QB), the court held that CPR 3.1(2)(a) applies. ${person} repeats the evidence above.\n`
  const roleMap: Record<string, string> = {
    [person]: roles[index % 4],
    [opposing]: 'party',
    'Mr Justice Holroyd': 'judge',
    'Priya Sharma': 'counsel',
  }
  return {
    text,
    spans,
    info: {
      id: `legal_${String(index + 1).padStart(3, '0')}`,
      source: 'obiter.synthetic',
      documentType: type,
      roles: roleMap,
    },
  }
}

function validate(entry: ReturnType<typeof documentFor>, labels?: Set<string>) {
  for (const [key, offsets] of Object.entries(entry.spans)) {
    const label = key.slice(0, key.indexOf(': '))
    if (labels && !labels.has(label))
      throw new Error(`Unknown label ${label} in ${entry.info.id}`)
    const value = key.slice(key.indexOf(': ') + 2)
    for (const [start, end] of offsets)
      if (
        start >= end ||
        end > entry.text.length ||
        entry.text.slice(start, end) !== value
      )
        throw new Error(`Invalid offset in ${entry.info.id}`)
  }
}

async function main() {
  const entries = Array.from({ length: 300 }, (_, index) => documentFor(index))
  const labelSpace = {
    category_version: 'obiter_legal_v1',
    span_class_names: [
      'O', 'private_person', 'private_address', 'private_email', 'private_phone',
      'private_date', 'account_number', 'secret', 'private_url',
      'national_insurance', 'case_reference', 'passport', 'organisation_name',
    ],
  }
  const labels = new Set(labelSpace.span_class_names.filter((label) => label !== 'O'))
  entries.forEach((entry) => validate(entry, labels))
  const emitted = new Set(entries.flatMap((entry) => Object.keys(entry.spans).map((key) => key.slice(0, key.indexOf(': ')))))
  for (const label of labels) {
    if (!emitted.has(label)) throw new Error(`Label-space entry ${label} is never emitted`)
  }
  await mkdir(output, { recursive: true })
  const train = entries.filter((_, index) => index % 5 !== 0)
  const validation = entries.filter((_, index) => index % 5 === 0)
  await writeFile(
    resolve(output, 'synthetic_train.jsonl'),
    `${train.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  )
  await writeFile(
    resolve(output, 'synthetic_validation.jsonl'),
    `${validation.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  )
  await writeFile(
    resolve(output, 'custom_label_space.json'),
    `${JSON.stringify(labelSpace, null, 2)}\n`,
  )
  const perType = Object.fromEntries(
    types.map((type) => [
      type,
      entries.filter((entry) => entry.info.documentType === type).length,
    ]),
  )
  await writeFile(
    resolve(output, 'generation_manifest.json'),
    `${JSON.stringify({ generator: 'scripts/generate-synthetic-data.ts', totalDocuments: entries.length, trainDocuments: train.length, validationDocuments: validation.length, documentTypes: perType, piiTypes: ['person', 'address', 'email', 'phone', 'date', 'national_insurance', 'passport', 'case_reference', 'account_number', 'organisation', 'url', 'secret'], edgeCases: ['zero_pii', 'case_citation_names', 'repeated_names'], validation: 'all offsets verified' }, null, 2)}\n`,
  )
  await writeFile(
    resolve(output, 'validation_report.json'),
    `${JSON.stringify({ valid: true, documentsValidated: entries.length, failures: [] }, null, 2)}\n`,
  )
}

void main()
