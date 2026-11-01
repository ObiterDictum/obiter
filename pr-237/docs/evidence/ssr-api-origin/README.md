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

## Fail-closed configuration (review follow-up)

The first review demonstrated two ways a dev server could still reach the shared
`8787` without naming an API. Both are fixed at head
`313a3d6a93ee3534e7e3104d3e7f80ff88ff52c9`:

1. `vite dev --port 3098` on an unconfigured worktree. The shared-default gate
   ran while the config function evaluated, before Vite merged `--port`, so the
   absent `OBITER_WEB_PORT` looked like the shared `3000` and the proxy and SSR
   both targeted `8787` while the server bound `3098`.
2. A supplied but invalid `OBITER_WEB_PORT` (`oops`, `0`). The lax
   `serve.mjs` parser fell back to `3000`, so the same shared default applied.

`config-decision.mjs` resolves the real `apps/web/vite.config.ts` through Vite's
`resolveConfig`, so it exercises the actual `configResolved` lifecycle rather
than a re-implementation. It reads the resolved config only: no server starts
and no API is contacted. `fail-closed.txt` records the decisions:

```bash
bun docs/evidence/ssr-api-origin/config-decision.mjs apps/web/vite.config.ts 3098
bun docs/evidence/ssr-api-origin/config-decision.mjs apps/web/vite.config.ts 3000 OBITER_WEB_PORT=oops
bun docs/evidence/ssr-api-origin/config-decision.mjs apps/web/vite.config.ts 3000 OBITER_WEB_PORT=0
bun docs/evidence/ssr-api-origin/config-decision.mjs apps/web/vite.config.ts 3000
```

Before, every row resolved `proxyTarget` and `ssrDefine` to
`http://localhost:8787`. After, the three misconfigurations are refused during
`configResolved`, before any listener or proxy target exists, and only the
genuine shared `--port 3000` keeps the `8787` default. The shared API was never
used as a sink.
