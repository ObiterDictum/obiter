# Desktop release packaging

Status: in progress (July 2026). This spec covers the packaged (production) Electron app: how it reaches the API, the Origin it sends, the typefaces it bundles, and how installers are built. See [deployment.md](./deployment.md) for the API/web deploy; this is desktop-only.

## What landed

1. **Configured API origin for the packaged app.** The main process owns the value and exposes it to the renderer through the preload bridge; `apiUrl()` and the better-auth client use it to build absolute URLs.
2. **A stable packaged Origin.** The renderer is served over a registered custom scheme (`obiter://desktop-auth`), so the `Origin` header is a stable exact-match value the API already trusts.
3. **Self-hosted typefaces.** Satoshi and JetBrains Mono woff2 files are vendored and served from the app bundle; no Fontshare CDN dependency.
4. **Installers and a release CI workflow.** electron-builder produces a Windows NSIS installer; CI builds it on push to `main` and publishes a GitHub Release for each new version.
5. **Auto-update on Windows.** The packaged app checks the GitHub Releases feed with electron-updater, downloads in the background, and offers "Restart to update".

## API origin for packaged builds

The packaged app has no dev-server proxy, so relative `/api/...` paths have nowhere to go. The main process resolves an absolute origin once at boot:

```
packagedApiOrigin = app.isPackaged
  ? (process.env.OBITER_API_ORIGIN ?? <build-time default>)
  : null
```

- **Operator config:** set `OBITER_API_ORIGIN` on the launched process (no rebuild). Absent that, the build-time default applies (`https://app.obiter.si`, the production API, injected by `electron.vite.config.ts` `define`; override at build time with `OBITER_API_ORIGIN_DEFAULT`).
- **Renderer read:** the preload resolves the value once via `ipcRenderer.sendSync` and exposes it as `window.obiterDesktop.apiOrigin` — a sync property, because `apiUrl()` and the better-auth client `baseURL` are synchronous.
- **Dev-desktop is unaffected:** `app.isPackaged` is false, so the bridge exposes `null` and `apiUrl()` keeps using relative `/api` paths through the Vite proxy. Web and SSR have no bridge at all.

## The packaged Origin and API trust

The packaged renderer is served from `obiter://desktop-auth` (a privileged, standard, secure scheme registered in the main entry). With those privileges, the renderer's `Origin` is the stable `obiter://desktop-auth`.

**Verified empirically** against the local API: the packaged renderer sends `Origin: obiter://desktop-auth` on every request. This is the API's existing default `OBITER_DESKTOP_ORIGIN`, so the exact-match trust in `backend/services/api/src/client-origins.ts` is satisfied with **no wildcard and no trust loosening**. The API deploy sets:

```
OBITER_DESKTOP_ORIGIN=obiter://desktop-auth
```

(If a future build registers a different scheme host, update `OBITER_DESKTOP_ORIGIN` to match — it must be exact-match.)

## Cross-site cookies and bearer sign-in

better-auth uses cookie sessions (`sameSite: 'lax'`, `httpOnly`, `secure` in production). The packaged renderer at `obiter://desktop-auth` calling the API at another origin is cross-site, so Chromium does not attach those cookies to its requests: sign-in succeeded on the server but the next session check carried no cookie, and the packaged app never left the sign-in screen.

The packaged app now uses bearer sessions instead. The API enables better-auth's `bearer` plugin and returns the session token at sign-in; the desktop main process keeps it encrypted with Electron `safeStorage` (`apps/desktop/src/main/auth-token-store.ts`) and `apiFetch` sends `Authorization: Bearer <token>` on every request. No cookie crosses sites and the web app keeps its same-site cookie flow. Loosening the cookie to `SameSite=None` was rejected because it would weaken the cookie for every client.

## Magic-link and password-reset handoff

- **Password reset** links are derived server-side and always target the configured web origin (`OBITER_WEB_ORIGIN`) — unchanged (confirmed in PR #28). They open in the user's browser.
- **Magic-link** sign-in uses the renderer origin as `callbackURL`. Under `obiter://desktop-auth` the emailed link opens in the default browser (the existing `setWindowOpenHandler → shell.openExternal`), which cannot complete a desktop session. **Magic-link sign-in is web-only for packaged desktop**; password sign-in is the desktop path.

## Self-hosted fonts

Satoshi and JetBrains Mono were previously loaded from the Fontshare CDN via a `<link>` in both the desktop renderer `index.html` and the web app `__root` route. A packaged app must not depend on a CDN. The woff2 files are vendored under `packages/ui/src/fonts/` and served via `@font-face` in `packages/ui/src/fonts.css`, imported once from `tailwind.css`.

- **Satoshi** — ITF Free Font License (FFL). Free for commercial use and self-hosting; not open source (no resale/redistribution of the font files). Canonical text: <https://www.fontshare.com/licenses/itf-ffl>.
- **JetBrains Mono** — SIL Open Font License 1.1 (full text vendored at `packages/ui/src/fonts/jetbrains-mono/LICENSE.txt`). Source: official JetBrains Mono release v2.304.

Weights vendored match what the CDN actually served: Satoshi 400/500/700 (there is no 600 cut — the prior `@600` request was a silent no-op; the tokens' `--obiter-font-weight-semibold: 600` stays browser-synthesized) and JetBrains Mono 400/500. Verified: a web build and a packaged build both emit the five woff2 as assets and reference them in `@font-face`; no `fontshare` reference remains in source or build output.

## Installer build

electron-builder config lives in `apps/desktop/electron-builder.yml` (kept out of `package.json` for clarity). Windows NSIS is the primary target.

```
bun run --filter @obiter/desktop package:win
```

Produces `apps/desktop/release/Obiter-Setup-<version>.exe`, its `.blockmap`, and `latest.yml`. The artifact name has no spaces so the file names on the GitHub Release match the names `latest.yml` points at (GitHub rewrites spaces in asset names). Packaging always runs with `--publish never`; the workflow uploads the files itself. The desktop app has **no runtime npm dependencies**: the main/preload bundles import only `electron` and `node:` built-ins, and electron-updater (a dev dependency) is bundled into a lazily imported main chunk. The renderer is a fully bundled static asset set, so `node_modules` is excluded from the asar to keep the installer lean. The redaction model is **not** bundled — inference runs server-side in `backend/services/api`, so no `onnxruntime` packaging.

`apps/desktop/package.json` scripts: `package` (current platform) and `package:win` (Windows). mac/linux targets are configured in the yml but not built or verified in this PR.

### Unsigned-build caveat

Builds are **unsigned** for now. Windows SmartScreen will warn on first launch of an unsigned installer ("Windows protected your PC"), requiring the user to click "More info → Run anyway". Code signing (EV or standard certificate) is a future decision with its own procurement and key-management work; it is deferred here. This is the single biggest user-facing rough edge of the current installer.

### Application icon

electron-builder uses the default Electron icon (the config points at `build/icon.{ico,icns,png}` but those files do not exist yet). Shipping a real app icon is a small follow-up once a multi-resolution `.ico`/`.icns`/512px PNG is produced from the brand assets in `docs/brand/`.

## CI release workflow

`.github/workflows/desktop-release.yml` builds the Windows installer on push to `main` (consistent with the docker-image policy in `ci.yml`: `main` is the release branch, `dev` is integration) and uploads it as a workflow artifact. When the version in `apps/desktop/package.json` has no `desktop-v<version>` release yet, the workflow also publishes a GitHub Release with that tag and the installer, its blockmap and `latest.yml` attached, marked as the latest release. A push to `main` without a version bump rebuilds the artifact but publishes nothing, so bump the version in the same change that should ship to testers.

## Auto-update

The packaged Windows app updates itself from this repository's GitHub Releases (`apps/desktop/src/main/updates.ts`, wired in `src/main/index.ts`).

- **Feed.** `electron-builder.yml` `publish` names the GitHub provider for `ObiterDictum/obiter`. electron-builder writes it into `resources/app-update.yml`. electron-updater asks GitHub for the release marked latest, whatever its tag (`desktop-v<version>` works), downloads that release's `latest.yml`, and compares its `version` with the running app's. Prereleases and downgrades are refused.
- **When.** At start and every 4 hours, only when `app.isPackaged` and on Windows. Development runs and other platforms never check. Checks stop once an update has downloaded.
- **Download and install.** The update downloads in the background (a differential download from the blockmap when the previous installer's blockmap is cached, else the full installer). electron-updater verifies the file against the sha512 in `latest.yml`. The main process then tells the renderer, which shows "A new version of Obiter is ready." with "Restart to update" and Later. Nothing restarts until the person clicks Restart; that runs the installer silently and relaunches the app. An update that has downloaded but was put off installs when the person next quits the app (`autoInstallOnAppQuit`), which never interrupts them.
- **Failures.** A failed check or download is logged by the main process and shown nowhere; the next check retries.
- **Bridge.** The preload exposes `onUpdateReady(listener)` and `restartToUpdate()`. `onUpdateReady` also asks the main process for an update that downloaded before the renderer subscribed, so a fast download is not missed.

### Unsigned updates: the trade-off

electron-updater verifies an update's Authenticode signature on Windows only when `app-update.yml` carries a `publisherName`, which electron-builder writes only for a signed build. Our installer is not signed, so there is nothing to verify against. `startDesktopUpdates` also sets `verifyUpdateCodeSignature` to accept explicitly, so the decision is visible in code and does not depend on the generated file.

What still protects an update: it is fetched over HTTPS from github.com, and the installer must match the sha512 in `latest.yml` from the same release. What does not: anyone who can publish a release on this repository (repository write access, or the release workflow's token) can ship code that every installed app will run on its next check, and nothing on the user's machine checks who built it. The release workflow only publishes from `main`. Once a signing certificate exists, set `win.signtoolOptions.publisherName`, remove the explicit accept in `updates.ts`, and electron-updater will refuse any installer not signed by that publisher.

### Raising the main-process budget

electron-updater is about 365 kB minified in the lazily loaded main chunk. The main-process budget in `scripts/perf/desktop-budget.mjs` moved from 12 kB to 380 kB to cover it, and the main bundle is now minified. The chunk is read from the local asar after the window opens, so it does not delay the first paint.

### First release with auto-update

Installs older than the first release that carries this change have no updater and must install that release by hand. From then on each `desktop-v<version>` release with `latest.yml` attached updates them. A release published without `latest.yml` breaks update checks until the next one.

## Deferred

- Cross-site session resolution (Option A or B above) — the blocking follow-up.
- Code signing and notarization (Windows cert; macOS hardened runtime + notarization).
- mac/linux build verification.
- Auto-update for macOS and Linux, and code signing of updates.
- A real application icon set.
