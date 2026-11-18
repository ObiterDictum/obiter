import { expect, it } from 'bun:test'
import { exportFilename } from './output-transfer'

it('uses the sanitised source stem and keeps the output format', () => {
  expect(exportFilename('  /letter\\:\u0000.DOCX ', ' (redacted).pdf')).toBe(
    'letter (redacted).pdf',
  )
  expect(exportFilename('letter.v2.pdf', ' (pseudonymised).docx')).toBe(
    'letter.v2 (pseudonymised).docx',
  )
  expect(exportFilename('/.docx', ' redaction schedule.pdf')).toBe(
    'Document redaction schedule.pdf',
  )
})

it('keeps the suffix intact within the UTF-8 filename limit', () => {
  const filename = exportFilename('📄'.repeat(200) + '.pdf', ' (redacted).pdf')
  expect(filename).toMatch(/^📄+ \(redacted\)\.pdf$/u)
  expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255)
})
