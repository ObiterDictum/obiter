/*
 * Unit tests for the HTTP response policy: Accept-Encoding negotiation and
 * cache/header merging. Uses Node's built-in test runner (node:test).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  acceptsGzip,
  cacheControlFor,
  cacheControlRank,
  mergeVary,
  negotiateEncoding,
  strictestCacheControl,
} from './http-policy.mjs'

test('acceptsGzip / negotiateEncoding — RFC 9110 Accept-Encoding', async (t) => {
  await t.test('accepts a plain gzip token', () => {
    assert.equal(acceptsGzip('gzip'), true)
    assert.deepEqual(negotiateEncoding('gzip'), { gzip: true, identity: true })
  })

  await t.test('is case-insensitive', () => {
    assert.equal(acceptsGzip('GZIP'), true)
    assert.equal(acceptsGzip('GzIp;Q=1.0'), true)
  })

  await t.test('accepts a positive fractional quality', () => {
    assert.equal(acceptsGzip('gzip;q=0.5'), true)
    assert.equal(acceptsGzip('br, gzip;q=1.0'), true)
    assert.equal(acceptsGzip('gzip;q=0.001'), true)
  })

  await t.test('tolerates whitespace around tokens and parameters', () => {
    assert.equal(acceptsGzip(' gzip '), true)
    assert.equal(acceptsGzip('gzip ; q=1'), true)
    assert.equal(acceptsGzip('br , gzip ; q=0.8'), true)
  })

  await t.test('honours an explicit q=0 refusal', () => {
    assert.equal(acceptsGzip('gzip;q=0'), false)
    assert.deepEqual(negotiateEncoding('gzip;q=0'), {
      gzip: false,
      identity: true,
    })
    assert.equal(acceptsGzip('gzip ;q=0'), false)
    assert.equal(acceptsGzip('gzip;q=0.000'), false)
  })

  await t.test('a wildcard makes gzip acceptable', () => {
    assert.equal(acceptsGzip('*'), true)
    assert.equal(acceptsGzip('br, *'), true)
  })

  await t.test('wildcard exclusion loses to an explicit gzip entry', () => {
    assert.equal(acceptsGzip('gzip;q=0, *'), false)
    assert.deepEqual(negotiateEncoding('gzip;q=0, *'), {
      gzip: false,
      identity: true,
    })
    assert.equal(acceptsGzip('*;q=0, gzip'), true)
  })

  await t.test('*;q=0 excludes identity unless it is named', () => {
    assert.deepEqual(negotiateEncoding('*;q=0'), {
      gzip: false,
      identity: false,
    })
    assert.deepEqual(negotiateEncoding('*;q=0, identity'), {
      gzip: false,
      identity: true,
    })
  })

  await t.test(
    'identity;q=0 with gzip not offered leaves nothing acceptable',
    () => {
      assert.deepEqual(negotiateEncoding('identity;q=0'), {
        gzip: false,
        identity: false,
      })
    },
  )

  await t.test('refusing br and gzip still leaves identity acceptable', () => {
    assert.deepEqual(negotiateEncoding('br;q=0, gzip;q=0'), {
      gzip: false,
      identity: true,
    })
    assert.equal(acceptsGzip('br;q=0, gzip;q=0'), false)
  })

  await t.test('an absent header leaves identity acceptable', () => {
    assert.deepEqual(negotiateEncoding(undefined), {
      gzip: false,
      identity: true,
    })
    assert.deepEqual(negotiateEncoding(null), { gzip: false, identity: true })
  })

  await t.test('an empty field value means no content coding', () => {
    assert.deepEqual(negotiateEncoding(''), { gzip: false, identity: true })
    assert.equal(acceptsGzip(''), false)
  })

  await t.test('malformed q values are conservatively refused', () => {
    assert.equal(acceptsGzip('gzip;q=abc'), false)
    assert.equal(acceptsGzip('gzip;q='), false)
    assert.equal(acceptsGzip('gzip;q=2'), false)
    assert.equal(acceptsGzip('gzip;q=1.0001'), false)
    // A malformed gzip parameter does not make identity unacceptable.
    assert.deepEqual(negotiateEncoding('gzip;q=abc'), {
      gzip: false,
      identity: true,
    })
  })

  await t.test('an unlisted coding is unacceptable without a wildcard', () => {
    assert.deepEqual(negotiateEncoding('br, deflate'), {
      gzip: false,
      identity: true,
    })
  })
})

test('cache and header helpers', async (t) => {
  await t.test(
    'cacheControlFor is immutable only for recorded hashed files',
    () => {
      assert.equal(cacheControlFor(true), IMMUTABLE_CACHE_CONTROL)
      assert.equal(cacheControlFor(false), REVALIDATE_CACHE_CONTROL)
      assert.match(IMMUTABLE_CACHE_CONTROL, /immutable/)
    },
  )

  await t.test('mergeVary unions tokens case-insensitively', () => {
    assert.equal(
      mergeVary('Cookie', 'Accept-Encoding'),
      'Cookie, Accept-Encoding',
    )
    assert.equal(
      mergeVary('cookie, Accept-Encoding', 'accept-encoding'),
      'cookie, Accept-Encoding',
    )
    assert.equal(mergeVary(undefined, 'Accept-Encoding'), 'Accept-Encoding')
    assert.equal(mergeVary('Cookie', undefined), 'Cookie')
    assert.equal(mergeVary(undefined, undefined), '')
  })

  await t.test('cacheControlRank orders restrictiveness', () => {
    assert.ok(cacheControlRank('no-store') > cacheControlRank('private'))
    assert.ok(
      cacheControlRank('private') > cacheControlRank('public, max-age=60'),
    )
    assert.ok(cacheControlRank('no-cache') > cacheControlRank('private'))
  })

  await t.test(
    'strictestCacheControl never weakens a private/no-store policy',
    () => {
      assert.match(
        strictestCacheControl('no-store', 'private, no-store'),
        /no-store/,
      )
      assert.equal(
        strictestCacheControl(
          'private, max-age=60',
          'public, max-age=31536000, immutable',
        ),
        'private, max-age=60',
      )
      assert.equal(
        strictestCacheControl(undefined, 'private, no-store'),
        'private, no-store',
      )
    },
  )
})
