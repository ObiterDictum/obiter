import { expect, it } from 'bun:test'
import { formatJudgmentCitation } from './judgment-citation'
it('formats a single paragraph', () => {
  expect(formatJudgmentCitation('A v B', '[2012] UKSC 19', 137).text).toBe(
    'A v B [2012] UKSC 19 [137]',
  )
})
it('formats a range', () => {
  expect(formatJudgmentCitation('A v B', '[2012] UKSC 19', 136, 137).text).toBe(
    'A v B [2012] UKSC 19 [136]–[137]',
  )
})
it('omits a missing citation', () => {
  expect(formatJudgmentCitation('A v B', null, 1).text).toBe('A v B [1]')
})
it('escapes and italicises the HTML case name', () => {
  expect(formatJudgmentCitation('A & B', null, 1).html).toBe(
    '<i>A &amp; B</i> [1]',
  )
})
