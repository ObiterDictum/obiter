import { describe, expect, it } from 'bun:test'
import { scrubEvent, scrubBreadcrumb } from './error-reporting'

describe('error report privacy', () => {
  for (const field of [
    'documentText',
    'filename',
    'matterName',
    'searchQuery',
    'redactionValue',
    'authorization',
    'cookie',
  ]) {
    it('removes ' + field + ' wherever attached', () => {
      const secret = 'synthetic confidential value'
      const event = scrubEvent({
        extra: { [field]: secret },
        contexts: { custom: { [field]: secret } },
        request: {
          data: secret,
          headers: { [field]: secret },
          url: '/matters/123?query=' + secret,
        },
        message: secret,
        exception: { values: [{ value: secret }] },
      })
      expect(JSON.stringify(event)).not.toContain(secret)
    })
  }
  it('removes long strings from extra and contexts', () => {
    expect(
      JSON.stringify(
        scrubEvent({
          extra: { x: 'x'.repeat(201) },
          contexts: { x: { value: 'x'.repeat(201) } },
        }),
      ),
    ).not.toContain('x'.repeat(201))
  })
  it('drops console breadcrumbs and arbitrary breadcrumb data', () => {
    expect(
      scrubBreadcrumb({ category: 'console', message: 'secret' }),
    ).toBeNull()
    expect(
      scrubBreadcrumb({ category: 'fetch', data: { url: 'secret' } }),
    ).toBeNull()
  })
  it('keeps only stable diagnostic metadata', () => {
    expect(
      scrubEvent({
        event_id: '123',
        release: 'abc',
        environment: 'production',
        message: 'secret',
      }),
    ).toEqual({
      event_id: '123',
      release: 'abc',
      environment: 'production',
      message: 'Application error',
    })
  })
})
