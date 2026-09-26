# SSR and Vite-proxy API-origin isolation evidence

Companion evidence for the change that makes the web dev server resolve one API
origin for both its Vite proxy and its in-process TanStack Start SSR handler.

Two synthetic HTTP targets isolate the defect. Both are disposable and neither is
the shared dev API on `8787`.

- Target A (`127.0.0.1:9891`): the intended lane backend. `GET /api/me` returns a
  valid `MeResponse`; `GET /api/auth/get-session` returns a synthetic session.
- Target B (`127.0.0.1:9892`): the "other backend" sink. `GET /api/me` returns a
  realistic `401 unauthenticated` envelope; get-session returns `null`.

`fake-api.mjs` is the harness. The worktree `.env` sets
`OBITER_API_ORIGIN=http://localhost:9891` (A) and nothing exports it. The web dev
server is launched with `BETTER_AUTH_URL=http://localhost:9892` in its process
environment only, so the pre-fix SSR fallback lands on synthetic B rather than
the shared API. That is the cross-stack symptom without touching shared data.

## Request routing

| run | SSR `GET /settings` | browser `GET /api/me?probe=proxy` |
| --- | --- | --- |
| Before (`origin/dev` `1320f90`) | B | A |
| After (this branch) | A | A |

`requests-before.txt`:

```
B GET /api/me
A GET /api/me?probe=proxy
```

`requests-after.txt`:

```
A GET /api/me
A GET /api/me?probe=proxy
```

After the fix, target B receives zero requests. The browser was always correct;
only SSR moved.

## Screenshots

Both captured with headless Chromium against `http://localhost:3002/settings`,
with a synthetic `better-auth.session_token` cookie.

- `before-settings.png`: SSR resolves B, `GET /api/me` returns 401, and the
  guarded loader redirects to `/sign-in` even though the browser's session
  resolves against A.
- `after-settings-hydrated.png`: SSR and the hydrated client both reach A and
  `/settings` renders.

Screenshots alone do not prove backend isolation; the request logs above do. The
after screenshot is captured with JavaScript enabled (hydration completes); the
before is captured with JavaScript disabled so the screenshot shows the SSR
redirect decision rather than a later client-side recovery.

## Reproduce

```bash
node fake-api.mjs A 9891 /tmp/obiter-ssr-api-origin/logs/requests.log &
node fake-api.mjs B 9892 /tmp/obiter-ssr-api-origin/logs/requests.log &

# .env in the worktree: OBITER_API_ORIGIN=http://localhost:9891
cd <worktree>
BETTER_AUTH_URL=http://localhost:9892 bun run dev:web &

# request-routing evidence
: > logs/requests.log
curl -s -o /dev/null -H 'Cookie: better-auth.session_token=x' \
  http://localhost:3002/settings
curl -s -o /dev/null 'http://localhost:3002/api/me?probe=proxy'
cat logs/requests.log
```

Run the same commands once on `origin/dev` and once on the branch to get the
before/after pair. `curl` returns the SSR redirect as `307` on the before run and
`200` on the after run.
