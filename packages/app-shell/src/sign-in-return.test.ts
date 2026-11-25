import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { returnToCallbackURL, safeReturnTo } from './sign-in-return'

const ALLOWED: [string, string][] = [
  ['/matters/mtr_1/documents/doc_1', '/matters/mtr_1/documents/doc_1'],
  ['/settings?section=security', '/settings?section=security'],
  ['/ln/ukpga/2010/15/section/1#p2', '/ln/ukpga/2010/15/section/1#p2'],
  ['/matters/mtr_1?side=doc_2', '/matters/mtr_1?side=doc_2'],
  ['/invites', '/invites'],
  ['/sign-in-help', '/sign-in-help'],
]

const REJECTED: unknown[] = [
  undefined,
  null,
  42,
  '',
  'matters/mtr_1',
  'https://evil.example/matters',
  'http://app.obiter.si/matters',
  'javascript:alert(1)',
  '//evil.example/matters',
  '///evil.example',
  '/\\evil.example',
  '\\\\evil.example',
  '/matters\\..\\evil',
  '/\t/evil.example',
  '/\n/evil.example',
  '/',
  '/?redirect=/matters',
  '/sign-in',
  '/sign-in?redirect=/matters',
  '/sign-in/',
  '/SIGN-IN',
  '/%73ign-in',
  '/sign-up',
  '/request-access',
  '/request-access/confirm?token=abc',
  '/forgot-password',
  '/reset-password?token=abc',
  '/invites/accept?token=abc',
  '/%E0%A4%A',
]

describe('safeReturnTo', () => {
  it.each(ALLOWED)('keeps the same-origin path %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected)
  })

  it.each(REJECTED.map((value) => [value]))('rejects %p', (value) => {
    expect(safeReturnTo(value)).toBeNull()
  })

  it('uses an inherited judgment anchor only for a safe case-law return target without a fragment', () => {
    expect(safeReturnTo('/case/example?q=trust', '#para-12')).toBe(
      '/case/example?q=trust#para-12',
    )
    expect(safeReturnTo('/cases/uksc-2024-3', '#page-47')).toBe(
      '/cases/uksc-2024-3#page-47',
    )
    expect(safeReturnTo('/case/example#para-11', '#para-12')).toBe(
      '/case/example#para-11',
    )
    expect(safeReturnTo('/case/example', '#unexpected')).toBe('/case/example')
    expect(safeReturnTo('/matters/mtr_1', '#para-12')).toBe('/matters/mtr_1')
    expect(safeReturnTo('//evil.example/case/example', '#para-12')).toBeNull()
  })
})

describe('returnToCallbackURL', () => {
  it('builds an absolute link on the current origin for the email-link sign-in', () => {
    expect(returnToCallbackURL('/matters/mtr_1')).toBe(
      `${window.location.origin}/matters/mtr_1`,
    )
  })

  it('returns nothing without a return target', () => {
    expect(returnToCallbackURL(null)).toBeUndefined()
  })
})
