import { expect, it } from 'bun:test'
import {
  legalSearchUrl,
  legalSearchUrlFilters,
  legalSearchUrlKey,
  legalSearchUrlType,
  validateLegalSearchSearch,
} from './legal-search-url'

it('keeps the query, filters and tab the URL carries', () => {
  expect(
    validateLegalSearchSearch({
      q: ' discrimination ',
      court: 'ewhc/ch',
      from: '2020-01-02',
      to: '2020-12-31',
      type: 'legislation',
    }),
  ).toEqual({
    q: 'discrimination',
    court: 'ewhc/ch',
    from: '2020-01-02',
    to: '2020-12-31',
    type: 'legislation',
  })
})

it('drops blank values, malformed dates and unknown tabs', () => {
  expect(
    validateLegalSearchSearch({
      q: '   ',
      court: '',
      from: '2020-1-2',
      to: 'yesterday',
      type: 'everything',
    }),
  ).toEqual({})
  expect(validateLegalSearchSearch({ q: 42, court: null })).toEqual({})
})

it('turns URL parameters into the filters and tab the search uses', () => {
  const params = validateLegalSearchSearch({
    court: 'uksc',
    from: '2024-01-01',
  })
  expect(legalSearchUrlFilters(params)).toEqual({
    court: 'uksc',
    dateFrom: '2024-01-01',
    dateTo: '',
  })
  expect(legalSearchUrlType(params)).toBe('all')
  expect(legalSearchUrlType({ type: 'judgments' })).toBe('judgments')
})

it('writes only the parameters that are set and canonical', () => {
  expect(
    legalSearchUrl(
      ' unfair dismissal ',
      { court: ' ukut/iac ', dateFrom: '2024-02-03', dateTo: '' },
      'judgments',
    ),
  ).toEqual({
    q: 'unfair dismissal',
    court: 'ukut/iac',
    from: '2024-02-03',
    type: 'judgments',
  })
  expect(
    legalSearchUrl('', { court: '', dateFrom: 'nope', dateTo: '' }, 'all'),
  ).toEqual({})
})

it('distinguishes URL states that differ only by one parameter', () => {
  expect(legalSearchUrlKey(validateLegalSearchSearch({ q: 'a' }))).not.toBe(
    legalSearchUrlKey(validateLegalSearchSearch({ q: 'a', court: 'uksc' })),
  )
  expect(legalSearchUrlKey(validateLegalSearchSearch({ q: 'a' }))).toBe(
    legalSearchUrlKey({ q: 'a' }),
  )
})
