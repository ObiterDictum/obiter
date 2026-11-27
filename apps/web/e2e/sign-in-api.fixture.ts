export const fixtureAccount = {
  email: 'anchor-reader@obiter.test',
  password: 'Anchor-fixture-only1!',
}

const user = {
  id: 'anchor-reader',
  name: 'Anchor Reader',
  email: fixtureAccount.email,
  emailVerified: true,
  role: null,
}
const sessionCookie = 'obiter_anchor_fixture=authenticated'

if (import.meta.main) {
  Bun.serve({
    hostname: '127.0.0.1',
    port: Number(Bun.argv[2]),
    async fetch(request) {
      const path = new URL(request.url).pathname
      const signedIn = request.headers
        .get('cookie')
        ?.split(/;\s*/)
        .includes(sessionCookie)
      if (path === '/ready') return new Response('ready')
      if (path === '/api/me') {
        if (signedIn) return Response.json({ user, organisation: null })
        return Response.json(
          {
            error: {
              code: 'unauthenticated',
              message: 'Sign in is required.',
              requestId: 'req_fixture',
            },
          },
          { status: 401 },
        )
      }
      if (path === '/api/auth/sign-in/email' && request.method === 'POST') {
        const { email, password } = await request.json()
        if (
          email !== fixtureAccount.email ||
          password !== fixtureAccount.password
        )
          return Response.json(
            { message: 'Invalid email or password' },
            { status: 401 },
          )
        return Response.json(
          { user },
          {
            headers: {
              'Set-Cookie': `${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`,
            },
          },
        )
      }
      if (path === '/api/auth/get-session')
        return Response.json(
          signedIn
            ? { user, session: { id: 'fixture-session', userId: user.id } }
            : null,
        )
      if (path === '/api/search/legislation/acts')
        return Response.json({ acts: [] })
      if (path === '/api/matters') return Response.json({ matters: [] })
      if (path === '/api/verification-runs' || path === '/api/redaction-runs')
        return Response.json({ runs: [], nextCursor: null })
      return Response.json(
        {
          error: {
            code: 'not_found',
            message: 'Not found',
            requestId: 'req_fixture',
          },
        },
        { status: 404 },
      )
    },
  })
}
