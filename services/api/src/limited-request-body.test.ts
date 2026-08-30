import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import {
  contentLengthExceedsLimit,
  readBoundedBodyBytes,
  readLimitedFormData,
  readLimitedJsonValue,
} from './limited-request-body'
import {
  DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_JSON_BODY_MAX_BYTES,
} from './request-limit-defaults'

describe('limited-request-body', () => {
  it('rejects declared Content-Length above the JSON max before reading the body', () => {
    const request = new Request('http://localhost/api/search/fetch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(DEFAULT_JSON_BODY_MAX_BYTES + 1),
      },
      body: '{"query":"small"}',
    })

    expect(
      contentLengthExceedsLimit(request, DEFAULT_JSON_BODY_MAX_BYTES),
    ).toBe(true)
  })

  it('rejects a JSON body larger than the max when Content-Length is missing', async () => {
    const body = 'a'.repeat(DEFAULT_JSON_BODY_MAX_BYTES + 1)
    const request = new Request('http://localhost/api/search/fetch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })

    await expect(
      readBoundedBodyBytes(request, DEFAULT_JSON_BODY_MAX_BYTES),
    ).rejects.toMatchObject({ limitKind: 'json' })
  })

  it('returns payload_too_large from readLimitedJsonValue without parsing oversized JSON', async () => {
    let parsed = false
    const app = new Hono<{ Variables: { requestId: string } }>()
    app.post('/api/search/fetch', async (c) => {
      const result = await readLimitedJsonValue(c, DEFAULT_JSON_BODY_MAX_BYTES)
      if (!result.ok) return result.response
      parsed = true
      return c.json({ ok: true })
    })

    const response = await app.request('/api/search/fetch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(DEFAULT_JSON_BODY_MAX_BYTES + 1),
      },
      body: '{"query":"ignored"}',
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Request body exceeds the 48 KiB JSON limit.',
      },
    })
    expect(parsed).toBe(false)
  })

  it('rejects multipart uploads when Content-Length exceeds the upload max before buffering', async () => {
    let parsed = false
    const app = new Hono<{ Variables: { requestId: string } }>()
    app.post('/api/matters/:matterId/documents', async (c) => {
      const result = await readLimitedFormData(
        c,
        DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
      )
      if (!result.ok) return result.response
      parsed = true
      return c.json({ ok: true })
    })

    const response = await app.request('/api/matters/mtr_1/documents', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----test',
        'content-length': String(DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES + 1),
      },
      body: '----test\r\nContent-Disposition: form-data; name="file"\r\n\r\nx\r\n----test--\r\n',
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'payload_too_large',
        message: 'Request body exceeds the 25 MB upload limit.',
      },
    })
    expect(parsed).toBe(false)
  })
})
