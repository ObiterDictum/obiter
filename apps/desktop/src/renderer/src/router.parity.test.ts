// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QueryClient } from '@tanstack/react-query'
import { LegalSearchView, VerifyRouteView } from '@obiter/app-shell'
import { describe, expect, it } from 'vitest'
import {
  createAppRouter,
  DESKTOP_SHARED_VIEW_PATHS,
  DesktopVerifyRoute,
} from './router'
import { DesktopSearchPage } from '../../pages/search'

function collectSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return collectSources(path)
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) return []
    return /\.test\.tsx?$/u.test(entry.name) ? [] : [path]
  })
}

describe('desktop router parity with web shared views', () => {
  it('renders the shared LegalSearchView on the desktop search page', () => {
    // The schedule-corrective fix lands in app-shell; desktop must inherit it
    // rather than carry a parallel search view (as web does at /search).
    const element = DesktopSearchPage()
    expect(element.type).toBe(LegalSearchView)
  })

  it('renders the shared VerifyRouteView on the desktop verify page', () => {
    // Verification is one surface: the run panel and findings list must be the
    // app-shell implementation on desktop, not a desktop copy.
    const element = DesktopVerifyRoute()
    expect(element.type).toBe(VerifyRouteView)
  })

  it('registers every shared-view path the web app exposes', () => {
    const router = createAppRouter(new QueryClient())
    const registered = new Set(Object.keys(router.routesByPath))

    for (const path of DESKTOP_SHARED_VIEW_PATHS) {
      expect(registered.has(path), `missing desktop route for ${path}`).toBe(
        true,
      )
    }
  })

  it('renders the shared document detail view, with verification inside it', () => {
    // The verification interaction lives in the shared document workspace, so
    // the desktop document route must delegate to the app-shell view rather
    // than grow its own findings UI.
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './router.tsx'),
      'utf8',
    )
    expect(source).toContain('<DocumentDetailLayoutView')
    expect(source).not.toMatch(
      /VerificationRunPanel|VerificationDock|VerificationEvidencePanel|verification-findings/,
    )
  })

  it('inherits the shared document selection instead of a desktop copy', () => {
    // A cross-paragraph selection has one owner in the shared workspace: the
    // desktop renderer must not grow a parallel selection model, paragraph
    // editor or selection painting.
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const files = collectSources(resolve(root, './src'))
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(
        /data-selected-text|document-selection|ParagraphSelection[Bb]inding/,
      )
    }
  })

  it('registers /case/$caseSlug so canonical search links do not fall through', () => {
    const router = createAppRouter(new QueryClient())
    expect(router.routesByPath['/case/$caseSlug']).toBeDefined()
    expect(router.routesByPath['/cases/$caseId']).toBeDefined()
  })

  it('registers /ln/$ so provision search links do not fall through', () => {
    const router = createAppRouter(new QueryClient())
    expect(router.routesByPath['/ln/$']).toBeDefined()
  })

  it('registers /redact/$runId as a top-level sibling of /redact (not a nested child without Outlet)', () => {
    const router = createAppRouter(new QueryClient())
    const review = router.routesByPath['/redact/$runId']
    const runs = router.routesByPath['/redact']
    expect(review).toBeDefined()
    expect(runs).toBeDefined()
    expect(review.parentRoute.id).toBe(runs.parentRoute.id)
  })
})
