import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { searchBenchmarkCases } from './cases'

const executeFile = promisify(execFile)
const reportPath = process.env.SEARCH_BENCHMARK_REPORT_PATH
const host = process.env.SEARCH_BENCHMARK_HOST ?? 'http://127.0.0.1:7700'
const apiKey = process.env.SEARCH_BENCHMARK_API_KEY ?? 'search-benchmark-key'

if (!reportPath) {
  throw new Error('SEARCH_BENCHMARK_REPORT_PATH is required.')
}

const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
  indexName: string
}

const searchSummaryAttributes = [
  'id',
  'title',
  'neutralCitation',
  'court',
  'jurisdiction',
  'dateDecided',
  'sourceType',
  'sourceUrl',
]

function quoteFilter(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function filtersFor(testCase: (typeof searchBenchmarkCases)[number]) {
  const filters = testCase.filters
  if (!filters) return undefined
  const clauses: string[] = []
  if (filters.court) clauses.push(`court = ${quoteFilter(filters.court)}`)
  if (filters.jurisdiction)
    clauses.push(`jurisdiction = ${quoteFilter(filters.jurisdiction)}`)
  if (filters.sourceType)
    clauses.push(`sourceType = ${quoteFilter(filters.sourceType)}`)
  if (filters.dateFrom)
    clauses.push(`dateDecided >= ${quoteFilter(filters.dateFrom)}`)
  if (filters.dateTo)
    clauses.push(`dateDecided <= ${quoteFilter(filters.dateTo)}`)
  return clauses.length > 0 ? clauses : undefined
}

async function curlCase(testCase: (typeof searchBenchmarkCases)[number]) {
  const body = JSON.stringify({
    q: testCase.query,
    filter: filtersFor(testCase),
    sort: ['dateDecided:desc'],
    attributesToRetrieve: [...searchSummaryAttributes, 'paragraphs'],
    limit: 20,
  })
  const { stdout } = await executeFile('curl', [
    '--silent',
    '--show-error',
    '--output',
    '/dev/null',
    '--write-out',
    '%{time_total} %{size_download} %{http_code}',
    '--request',
    'POST',
    '--header',
    `Authorization: Bearer ${apiKey}`,
    '--header',
    'Content-Type: application/json',
    '--data',
    body,
    `${host}/indexes/${report.indexName}/search`,
  ])
  const [timeSeconds, responseByteLength, statusCode] = stdout.trim().split(' ')
  return {
    id: testCase.id,
    curlTimeMs: Number(timeSeconds) * 1_000,
    responseByteLength: Number(responseByteLength),
    statusCode: Number(statusCode),
  }
}

try {
  const curlDiagnostics = []
  for (const testCase of searchBenchmarkCases) {
    curlDiagnostics.push(await curlCase(testCase))
  }
  await writeFile(
    reportPath,
    `${JSON.stringify({ ...report, curlDiagnostics }, null, 2)}\n`,
    'utf8',
  )
} finally {
  await executeFile('curl', [
    '--silent',
    '--show-error',
    '--request',
    'DELETE',
    '--header',
    `Authorization: Bearer ${apiKey}`,
    `${host}/indexes/${report.indexName}`,
  ])
}
