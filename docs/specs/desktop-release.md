# Desktop release packaging

Status: in progress (July 2026). This spec covers the packaged (production) Electron app: how it reaches the API, the Origin it sends, the typefaces it bundles, and how installers are built. See [deployment.md](./deployment.md) for the API/web deploy; this is desktop-only.

## What landed

1. **Configured API origin for the packaged app.** The main process owns the value and exposes it to the renderer through the preload bridge; `apiUrl()` and the better-auth client use it to build absolute URLs.
2. **A stable packaged Origin.** The renderer is served over a registered custom scheme (`obiter://desktop-auth`), so the `Origin` header is a stable exact-match value the API already trusts.
3. **Self-hosted typefaces.** Satoshi and JetBrains Mono woff2 files are vendored and served from the app bundle; no Fontshare CDN dependency.
4. **Installers and a release CI workflow.** electron-builder produces a Windows NSIS installer; CI builds it on push to `main`.

## API origin for packaged builds

The packaged app has no dev-server proxy, so relative `/api/...` paths have nowhere to go. The main process resolves an absolute origin once at boot:

```
packagedApiOrigin = app.isPackaged
  ? (process.env.OBITER_API_ORIGIN ?? <build-time default>)
  : null
```

- **Operator config:** set `OBITER_API_ORIGIN` on the launched process (no rebuild). Absent that, the build-time default applies (`https://api.obiter.dev`, injected by `electron.vite.config.ts` `define`; override at build time with `OBITER_API_ORIGIN_DEFAULT`).
- **Renderer read:** the preload resolves the value once via `ipcRenderer.sendSync` and exposes it as `window.obiterDesktop.apiOrigin` — a sync property, because `apiUrl()` and the better-auth client `baseURL` are synchronous.
- **Dev-desktop is unaffected:** `app.isPackaged` is false, so the bridge exposes `null` and `apiUrl()` keeps using relative `/api` paths through the Vite proxy. Web and SSR have no bridge at all.

## The packaged Origin and API trust

The packaged renderer is served from `obiter://desktop-auth` (a privileged, standard, secure scheme registered in the main entry). With those privileges, the renderer's `Origin` is the stable `obiter://desktop-auth`.

**Verified empirically** against the local API: the packaged renderer sends `Origin: obiter://desktop-auth` on every request. This is the API's existing default `OBITER_DESKTOP_ORIGIN`, so the exact-match trust in `services/api/src/client-origins.ts` is satisfied with **no wildcard and no trust loosening**. The API deploy sets:

```
OBITER_DESKTOP_ORIGIN=obiter://desktop-auth
```

(If a future build registers a different scheme host, update `OBITER_DESKTOP_ORIGIN` to match — it must be exact-match.)

## Cross-site cookies: the blocking finding (STOP)

better-auth uses cookie sessions (`sameSite: 'lax'`, `httpOnly`, `secure` in production). This works for the web app (same-domain routing) and for dev-desktop (`localhost:5173 → localhost:8787` is same-site — ports do not count for SameSite). The packaged app is different:

**Empirically confirmed:** the packaged renderer at `obiter://desktop-auth` calling the API at a different origin is **cross-site**. Chromium does not attach a `lax` cookie to cross-site `fetch` calls, so:

- `POST /api/auth/sign-in/email` succeeds server-side and `Set-Cookie` is returned.
- The immediate `GET /api/auth/get-session` carries **no cookie** → returns no session → the client treats sign-in as failed → retries in a loop. The renderer never leaves the sign-in screen.

This is not a trust-list problem (the Origin is trusted) — it is a fundamental browser cookie policy. No origin configuration fixes it. Two options were analyzed for the follow-up decision; **neither is implemented here** (both exceed the "configured desktop origin only" scope of this change and need a deliberate decision):

### Option A — better-auth bearer plugin (recommended)

The desktop client holds the session token and sends `Authorization: Bearer <token>` on every request. No cookies cross-site, no `SameSite=None` weakening, CSRF-irrelevant for the token channel. The web app keeps its same-site cookie flow unchanged.

- Requires the `bearer` plugin on the API's better-auth config and a desktop-side token store (where to persist the token — `safeStorage` / a config file — needs its own decision).
- This is an API behaviour change beyond a configured desktop origin, so it is out of scope here and deferred to a follow-up PR.

### Option B — `SameSite=None; Secure` for the desktop path

Loosen the cookie so cross-site fetch carries it. Requires an HTTPS API (Secure cookies need HTTPS), and leans on the exact-match `trustedOrigins`/CORS gate as the CSRF defence. This is the loosening the task constraint flags as a STOP — it weakens the cookie posture for all clients unless scoped carefully (e.g. per-origin cookie attributes, which better-auth does not natively branch on), so it is the trade-off alternative, not the default.

### What does work in the packaged app today

Everything except authenticated API calls: the renderer loads over `obiter://`, styled UI renders, self-hosted fonts load (no network fetch), and the better-auth client reaches the API with the correct absolute URL and Origin. The session cookie is the sole blocker.

## Magic-link and password-reset handoff

- **Password reset** links are derived server-side and always target the configured web origin (`OBITER_WEB_ORIGIN`) — unchanged (confirmed in PR #28). They open in the user's browser.
- **Magic-link** sign-in uses the renderer origin as `callbackURL`. Under `obiter://desktop-auth` the emailed link opens in the default browser (the existing `setWindowOpenHandler → shell.openExternal`), which cannot complete a desktop session. **Magic-link sign-in is web-only for packaged desktop** until the session problem above is resolved; password sign-in is the desktop path (modulo the cookie finding).

## Self-hosted fonts

Satoshi and JetBrains Mono were previously loaded from the Fontshare CDN via a `<link>` in both the desktop renderer `index.html` and the web app `__root` route. A packaged app must not depend on a CDN. The woff2 files are vendored under `packages/ui/src/fonts/` and served via `@font-face` in `packages/ui/src/fonts.css`, imported once from `tailwind.css`.

- **Satoshi** — ITF Free Font License (FFL). Free for commercial use and self-hosting; not open source (no resale/redistribution of the font files). Canonical text: <https://www.fontshare.com/licenses/itf-ffl>.
- **JetBrains Mono** — SIL Open Font License 1.1 (full text vendored at `packages/ui/src/fonts/jetbrains-mono/LICENSE.txt`). Source: official JetBrains Mono release v2.304.

Weights vendored match what the CDN actually served: Satoshi 400/500/700 (there is no 600 cut — the prior `@600` request was a silent no-op; the tokens' `--obiter-font-weight-semibold: 600` stays browser-synthesized) and JetBrains Mono 400/500. Verified: a web build and a packaged build both emit the five woff2 as assets and reference them in `@font-face`; no `fontshare` reference remains in source or build output.

## Installer build

electron-builder config lives in `apps/desktop/electron-builder.yml` (kept out of `package.json` for clarity). Windows NSIS is the primary target.

```
pnpm --filter @obiter/desktop package:win
```

Produces `apps/desktop/release/Obiter Setup <version>.exe`. The desktop app has **no runtime npm dependencies** (the main/preload bundles import only `electron` and `node:` built-ins; the renderer is a fully bundled static asset set), so `node_modules` is excluded from the asar to keep the installer lean. The redaction model is **not** bundled — inference runs server-side in `services/api`, so no `onnxruntime` packaging.

`apps/desktop/package.json` scripts: `package` (current platform) and `package:win` (Windows). mac/linux targets are configured in the yml but not built or verified in this PR.

### Unsigned-build caveat

Builds are **unsigned** for now. Windows SmartScreen will warn on first launch of an unsigned installer ("Windows protected your PC"), requiring the user to click "More info → Run anyway". Code signing (EV or standard certificate) is a future decision with its own procurement and key-management work; it is deferred here. This is the single biggest user-facing rough edge of the current installer.

### Application icon

electron-builder uses the default Electron icon (the config points at `build/icon.{ico,icns,png}` but those files do not exist yet). Shipping a real app icon is a small follow-up once a multi-resolution `.ico`/`.icns`/512px PNG is produced from the brand assets in `docs/brand/`.

## CI release workflow

`.github/workflows/desktop-release.yml` builds the Windows installer on push to `main` (consistent with the docker-image policy in `ci.yml`: `main` is the release branch, `dev` is integration). The installer is uploaded as a workflow artifact via `actions/upload-artifact`. **No release publishing** — artifacts only. The workflow first executes on the next `dev → main` promotion.

## Deferred

- Cross-site session resolution (Option A or B above) — the blocking follow-up.
- Code signing and notarization (Windows cert; macOS hardened runtime + notarization).
- mac/linux build verification.
- Auto-update (electron-updater) — needs a release feed and signing first.
- A real application icon set.
