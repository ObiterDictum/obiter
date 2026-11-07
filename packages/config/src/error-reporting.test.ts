import { describe, expect, it } from 'bun:test'
import {
  redactMessage,
  scrubEvent,
  scrubBreadcrumb,
  routePattern,
} from './error-reporting'

describe('diagnostic error report privacy', () => {
  for (const [rule, input, expected] of [
    ['emails', 'Failure for jane@firm.co.uk', 'Failure for [email]'],
    [
      'six or more digits',
      'Failure for matter 12345678',
      'Failure for matter [number]',
    ],
    [
      'words longer than forty characters',
      'Failure ' + 'x'.repeat(41),
      'Failure [long]',
    ],
    [
      'three hundred character limit',
      'failed '.repeat(100),
      'failed '.repeat(100).slice(0, 300),
    ],
  ]) {
    it('redacts messages using the rule for ' + rule, () => {
      expect(redactMessage(input ?? '')).toBe(expected)
    })
  }

  it('redacts quoted filenames emails and long numbers in realistic exceptions', () => {
    expect(
      redactMessage(
        'Failed to save "Smith v Jones skeleton.docx" for jane@firm.co.uk (matter 12345678)',
      ),
    ).toBe('Failed to save [quoted] for [email] (matter [number])')
  })
  it('redacts single double and curly quoted content', () => {
    expect(redactMessage(`'Smith' "Jones" ‘Matter’ “Document”`)).toBe(
      '[quoted] [quoted] [quoted] [quoted]',
    )
  })
  it('redacts words longer than forty characters and truncates messages at three hundred', () => {
    expect(redactMessage('x'.repeat(41))).toBe('[long]')
    expect(redactMessage('failure '.repeat(100))).toHaveLength(300)
  })
  it('keeps exception types and stack locations but removes local variables and source text', () => {
    const event = scrubEvent({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'Failed for jane@firm.co.uk',
            stacktrace: {
              frames: [
                {
                  function: 'saveDocument',
                  filename:
                    'https://app.obiter.si/assets/editor.js?token=secret',
                  lineno: 42,
                  colno: 9,
                  vars: { documentText: 'secret' },
                  context_line: 'secret',
                },
              ],
            },
          },
        ],
      },
    })
    expect(event.exception?.values?.[0]?.type).toBe('TypeError')
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      function: 'saveDocument',
      filename: 'editor.js',
      lineno: 42,
      colno: 9,
    })
    expect(JSON.stringify(event)).not.toContain('secret')
  })
  it('keeps route patterns and ids method status release and environment without queries or fragments', () => {
    expect(
      routePattern(
        'https://app.obiter.si/api/matters/12345678/documents/doc_abc?search=secret#secret',
      ),
    ).toBe('/api/matters/12345678/documents/doc_abc')
    const event = scrubEvent({
      request: {
        url: '/api/matters/123?secret=yes#secret',
        method: 'POST',
        data: 'secret',
        cookies: { session: 'secret' },
        headers: { Authorization: 'secret' },
      },
      tags: { status: 500 },
      release: 'commit',
      environment: 'production',
    })
    expect(event.request).toEqual({ url: '/api/matters/123', method: 'POST' })
    expect(event.tags).toEqual({ status: 500 })
    expect(event.release).toBe('commit')
    expect(event.environment).toBe('production')
    expect(JSON.stringify(event)).not.toContain('secret')
  })
  it('keeps pseudonymous user and organisation ids and drops email name and IP', () => {
    expect(
      scrubEvent({
        user: {
          id: 'usr_abc',
          organisationId: 'org_def',
          email: 'jane@firm.co.uk',
          username: 'Jane',
          ip_address: '127.0.0.1',
        },
      }).user,
    ).toEqual({ id: 'usr_abc', organisationId: 'org_def' })
  })
  for (const field of [
    'documentText',
    'document_text',
    'filename',
    'matterName',
    'searchQuery',
    'redactionValue',
    'authorization',
    'cookie',
  ]) {
    it('removes sensitive field ' + field + ' recursively', () => {
      const event = scrubEvent({
        extra: { nested: { [field]: 'secret', useful: 'retry' } },
        contexts: { custom: { [field]: 'secret' } },
      })
      expect(JSON.stringify(event)).not.toContain('secret')
      expect(event.extra?.nested).toEqual({ useful: 'retry' })
    })
  }
  it('drops extra and contexts strings over two hundred characters while keeping short diagnostics', () => {
    expect(
      scrubEvent({
        extra: { long: 'x'.repeat(201), stage: 'save' },
        contexts: { custom: { long: 'x'.repeat(201), attempt: 2 } },
      }),
    ).toMatchObject({
      extra: { stage: 'save' },
      contexts: { custom: { attempt: 2 } },
    })
  })
  it('drops console breadcrumbs and scrubs retained breadcrumb messages', () => {
    expect(
      scrubBreadcrumb({ category: 'console', message: 'secret' }),
    ).toBeNull()
    expect(
      scrubBreadcrumb({
        category: 'error',
        message: 'Failed "Smith.docx" jane@firm.co.uk 12345678',
      })?.message,
    ).toBe('Failed [quoted] [email] [number]')
  })
  it('navigation and fetch breadcrumbs keep only route method and status', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        message: 'secret',
        data: {
          url: '/api/matters/123?secret=yes',
          method: 'GET',
          status_code: 503,
          body: 'secret',
        },
      }),
    ).toEqual({
      category: 'fetch',
      data: { url: '/api/matters/123', method: 'GET', status_code: 503 },
    })
  })
})
