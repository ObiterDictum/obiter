/* Identity gates: authentication, authorization, CORS, auth cookies. */
import { fixtureIds } from '../../../load/provision.mjs'
import {
  bearer,
  group,
  rawRequest,
  record,
  signSessionCookie,
} from './harness.mjs'

export async function checkAuthentication({ origin, ids }) {
  // ---- authentication: cookie, bearer, and no-credential refusals
  group('authentication')

  const meBearer = await fetch(`${origin}/api/me`, {
    headers: bearer(ids.sessionToken),
  })
  const meBearerBody = await meBearer.json().catch(() => null)
  record(
    'bearer session authenticates /api/me',
    meBearer.status === 200 && meBearerBody?.user?.id === ids.userId,
    `status=${meBearer.status} user=${meBearerBody?.user?.id ?? 'none'}`,
  )

  const signedCookie = await signSessionCookie(ids.sessionToken)
  const meCookie = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `better-auth.session_token=${signedCookie}` },
  })
  const meCookieBody = await meCookie.json().catch(() => null)
  record(
    'signed better-auth cookie authenticates /api/me',
    meCookie.status === 200 && meCookieBody?.user?.id === ids.userId,
    `status=${meCookie.status} user=${meCookieBody?.user?.id ?? 'none'}`,
  )

  const tampered = `${signedCookie.slice(0, -4)}AAAA`
  const meTampered = await fetch(`${origin}/api/me`, {
    headers: { Cookie: `better-auth.session_token=${tampered}` },
  })
  record(
    'tampered session cookie is refused',
    meTampered.status === 401,
    `status=${meTampered.status}`,
  )

  const meAnon = await fetch(`${origin}/api/me`)
  record(
    'unauthenticated /api/me is 401',
    meAnon.status === 401,
    `status=${meAnon.status}`,
  )

  const emptyCookie = await fetch(`${origin}/api/me`, {
    headers: { Cookie: 'better-auth.session_token=' },
  })
  record(
    'empty session cookie is refused, not accepted as anonymous',
    emptyCookie.status === 401,
    `status=${emptyCookie.status}`,
  )

  const weirdCookie = await fetch(`${origin}/api/me`, {
    headers: {
      Cookie: 'better-auth.session_token="quoted;value"; junk; other=a=b',
    },
  })
  record(
    'malformed cookie header does not 500',
    weirdCookie.status === 401,
    `status=${weirdCookie.status}`,
  )
}

export async function checkAuthorization({ origin, ids, querier }) {
  // ---- authorization: cross-tenant refusal and non-enumeration
  group('authorization')

  const crossMatter = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}`,
    {
      headers: bearer(ids.sessionToken),
    },
  )
  const crossMatterBody = await crossMatter.json().catch(() => null)
  record(
    'cross-tenant matter read is 404 and leaks no name',
    crossMatter.status === 404 &&
      !JSON.stringify(crossMatterBody ?? {}).includes(ids.otherMatterName),
    `status=${crossMatter.status}`,
  )

  const crossDocuments = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}/documents`,
    { headers: bearer(ids.sessionToken) },
  )
  record(
    'cross-tenant document list is 404',
    crossDocuments.status === 404,
    `status=${crossDocuments.status}`,
  )

  const otherSeesOwn = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}`,
    {
      headers: bearer(ids.otherSessionToken),
    },
  )
  record(
    'the other tenant can read its own matter (the refusal is tenancy, not a broken route)',
    otherSeesOwn.status === 200,
    `status=${otherSeesOwn.status}`,
  )

  const absentMatter = await fetch(`${origin}/api/matters/mtr_does-not-exist`, {
    headers: bearer(ids.sessionToken),
  })
  record(
    'absent matter is 404',
    absentMatter.status === 404,
    `status=${absentMatter.status}`,
  )

  const anonUpload = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    {
      method: 'POST',
      body: new FormData(),
    },
  )
  record(
    'anonymous upload is 401',
    anonUpload.status === 401,
    `status=${anonUpload.status}`,
  )

  const otherMatterUpload = await fetch(
    `${origin}/api/matters/${ids.otherMatterId}/documents`,
    { method: 'POST', headers: bearer(ids.sessionToken), body: new FormData() },
  )
  record(
    'upload into another tenant’s matter is 404',
    otherMatterUpload.status === 404,
    `status=${otherMatterUpload.status}`,
  )

  // A cross-tenant *document* id, not just a matter id: the two are different
  // authorization paths and both must refuse.
  const foreignDocument = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select d.id as document_id, v.id as version_id
      from matter_documents d
      join document_versions v on v.id = d.current_version_id
      where d.organisation_id = '${ids.otherOrganisationId}' and v.document_status = 'ready'
      limit 1
    ) r`)
  if (foreignDocument.length > 0) {
    const foreignRead = await fetch(
      `${origin}/api/documents/${foreignDocument[0].document_id}`,
      { headers: bearer(ids.sessionToken) },
    )
    record(
      'cross-tenant document read is 404',
      foreignRead.status === 404,
      `status=${foreignRead.status}`,
    )
    const foreignDownload = await fetch(
      `${origin}/api/documents/${foreignDocument[0].document_id}/download`,
      { headers: bearer(ids.sessionToken) },
    )
    record(
      'cross-tenant document download is 404',
      foreignDownload.status === 404,
      `status=${foreignDownload.status}`,
    )
  } else {
    record(
      'cross-tenant document read is 404',
      false,
      'no ready document in the other tenant',
    )
  }
}

export async function checkCors({ port }) {
  const originHeader = 'http://localhost:3004'
  // ---- CORS
  group('cors')

  const preflight = await rawRequest({
    port,
    path: '/api/matters',
    method: 'OPTIONS',
    headers: {
      Origin: originHeader,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization',
    },
  })
  record(
    'preflight from an allowed origin is 204 with credentials',
    (preflight.status === 204 || preflight.status === 200) &&
      preflight.headers['access-control-allow-origin'] === originHeader &&
      preflight.headers['access-control-allow-credentials'] === 'true',
    `status=${preflight.status} allow-origin=${preflight.headers['access-control-allow-origin']} credentials=${preflight.headers['access-control-allow-credentials']}`,
  )

  const hostile = await rawRequest({
    port,
    path: '/api/matters',
    method: 'OPTIONS',
    headers: {
      Origin: 'http://evil.example.test',
      'Access-Control-Request-Method': 'GET',
    },
  })
  record(
    'preflight from an unknown origin gets no allow-origin',
    hostile.headers['access-control-allow-origin'] === undefined,
    `allow-origin=${hostile.headers['access-control-allow-origin'] ?? 'absent'}`,
  )

  const simpleHostile = await rawRequest({
    port,
    path: '/api/health',
    headers: { Origin: 'http://evil.example.test' },
  })
  record(
    'simple request from an unknown origin gets no allow-origin',
    simpleHostile.headers['access-control-allow-origin'] === undefined,
    `allow-origin=${simpleHostile.headers['access-control-allow-origin'] ?? 'absent'}`,
  )
}

export async function checkAuthCookies({ port, querier, runTag }) {
  // better-auth clears several cookies on sign-out, which is the only
  // multi-`Set-Cookie` response this API produces without an email flow. The
  // session used is a disposable third one, so the measured sessions survive.
  group('auth cookies')

  const disposable = fixtureIds(`${runTag}x`)
  querier.exec(`
    insert into organisations (id, name) values ('${disposable.organisationId}', 'gate disposable');
    insert into users (id, name, email, "emailVerified", "organisationId", role)
      values ('${disposable.userId}', 'disposable', '${disposable.email}', true, '${disposable.organisationId}', 'owner');
    insert into sessions (id, "expiresAt", token, "userId", "userAgent")
      values ('${disposable.sessionId}', now() + interval '1 hour', '${disposable.sessionToken}', '${disposable.userId}', 'gate');`)

  const signedOut = await rawRequest({
    port,
    path: '/api/auth/sign-out',
    method: 'POST',
    headers: {
      ...bearer(disposable.sessionToken),
      'Content-Type': 'application/json',
    },
    body: Buffer.from('{}'),
  })
  const setCookies = signedOut.rawHeaders.filter(
    (value, index) =>
      signedOut.rawHeaders[index - 1]?.toLowerCase() === 'set-cookie',
  )
  record(
    'sign-out preserves multiple Set-Cookie headers as distinct lines',
    signedOut.status === 200 && setCookies.length >= 2,
    `status=${signedOut.status} setCookieLines=${setCookies.length}`,
  )
  record(
    'sign-out clears the session cookie with an expiring attribute',
    setCookies.some((value) =>
      /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(value),
    ),
    `setCookie=${setCookies.map((value) => value.slice(0, 60)).join(' | ') || 'none'}`,
  )
  const sessionRows = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from sessions where token = '${disposable.sessionToken}'
    ) r`)
  record(
    'sign-out deletes the session row',
    sessionRows[0]?.count === 0,
    `sessionRows=${sessionRows[0]?.count}`,
  )
  const signedOutAudit = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from audit_logs
      where organisation_id = '${disposable.organisationId}' and action = 'auth.sign_out'
    ) r`)
  record(
    'sign-out appends its audit row',
    signedOutAudit[0]?.count === 1,
    `authSignOutRows=${signedOutAudit[0]?.count}`,
  )
}
