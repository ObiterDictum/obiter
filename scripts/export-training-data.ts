import { readFile, writeFile } from 'node:fs/promises'

type Category = 'person_name' | 'email' | 'phone' | 'address' | 'date' | 'government_id' | 'account_number' | 'passport' | 'drivers_license' | 'url' | 'ip_address' | 'secret' | 'national_insurance' | 'case_reference' | 'organisation_name'
const mapping: Record<Category, string | null> = {
  person_name: 'GIVEN_NAME', email: 'EMAIL', phone: 'PHONE', address: 'STREET_NAME', date: null,
  government_id: 'GOVERNMENT_ID', account_number: 'BANK_ACCOUNT', passport: 'PASSPORT', drivers_license: 'DRIVERS_LICENSE',
  url: 'URL', ip_address: 'IP_ADDRESS', secret: 'secret', national_insurance: 'national_insurance', case_reference: 'case_reference', organisation_name: null,
}

interface InputRun { id: string; status: string; fullyReviewed: boolean; text: string; spans: Array<{ id: string; start: number; end: number; text: string; category: Category }>; decisions: Record<string, { decision: string }> }

export function mapCategoryToRampart(category: Category) { return mapping[category] }
export function exportReviewedRuns(runs: InputRun[], includePartial = false) {
  return runs.filter((run) => run.status === 'finalized' && (run.fullyReviewed || includePartial)).map((run) => {
    const spans: Record<string, Array<[number, number]>> = {}
    for (const span of run.spans) {
      const decision = run.decisions[span.id]?.decision
      const label = mapping[span.category]
      if (!label || !['accept', 'override_redact', 'pseudonymise'].includes(decision) || run.text.slice(span.start, span.end) !== span.text) continue
      ;(spans[`${label}: ${span.text}`] ??= []).push([span.start, span.end])
    }
    return { text: run.text, spans, info: { id: run.id, source: 'obiter.reviewed_export' } }
  })
}

async function main() {
  const [inputPath, outputPath = 'data/evals/redact/exported_training_data.jsonl', flag] = process.argv.slice(2)
  if (!inputPath) throw new Error('Usage: tsx scripts/export-training-data.ts <reviewed-runs.json> [output.jsonl] [--include-partial]')
  let runs: InputRun[]
  try {
    runs = JSON.parse(await readFile(inputPath, 'utf8')) as InputRun[]
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Could not read reviewed runs: ${message}`)
  }
  const entries = exportReviewedRuns(runs, flag === '--include-partial')
  await writeFile(outputPath, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''))
}
if (process.argv[1]?.endsWith('export-training-data.ts')) void main()
