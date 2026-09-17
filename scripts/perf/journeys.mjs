/*
 * Representative page-load journeys for the production web app.
 *
 * `ready` is the route-ready milestone: a CSS selector for the primary control
 * or content the route exists to show. It is deliberately not "the skeleton
 * painted" and not a network-idle wait, because a skeleton is not a usable
 * page. Every id here is measured identically before and after a change.
 *
 * `clientNavFrom` measures the same target reached by an in-app link from an
 * already-loaded route, which is the cost a signed-in user actually pays for
 * most navigation.
 */
export const JOURNEYS = [
  {
    id: 'sign-in',
    path: '/sign-in',
    ready: 'form button[type="submit"]',
    public: true,
  },
  { id: 'home', path: '/', ready: 'main h1' },
  {
    id: 'settings',
    path: '/settings',
    ready: 'main h1',
    clientNavFrom: '/',
    clientNavName: 'Settings',
  },
  {
    id: 'search',
    path: '/search',
    ready: 'main h2',
    clientNavFrom: '/',
    clientNavName: 'Search',
  },
  {
    id: 'matters',
    path: '/matters',
    ready: 'main h1',
    clientNavFrom: '/',
    clientNavName: 'Matters',
  },
  {
    id: 'matter-detail',
    path: '/matters/{matterId}',
    ready: '[aria-label="Documents"]',
  },
  {
    id: 'document-editor',
    path: '/matters/{matterId}/documents/{documentId}',
    ready: '[aria-label="Document page"]',
  },
  {
    id: 'redact-list',
    path: '/redact',
    ready: 'main h1',
    clientNavFrom: '/',
    clientNavName: 'Redact',
  },
  {
    id: 'redact-review',
    path: '/redact/{redactionRunId}',
    ready: '[aria-label="Review queue"]',
  },
  { id: 'verify', path: '/verify', ready: 'main h1' },
  {
    id: 'case-law-document',
    path: '/cases/{caseDocumentId}',
    ready: 'main h1',
    // The id route resolves to its canonical slug and redirects there; either
    // landing is the same document.
    redirectsTo: [/^\/case\/[^/]+$/],
  },
]

/**
 * Substitute `{placeholders}` in a path from the run's fixture map. A missing
 * placeholder is a hard failure, not an empty route: measuring `/matters//`
 * would silently measure a 404 and report it as a fast page.
 */
export function resolvePath(path, fixtures) {
  return path.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = fixtures[key]
    if (!value) throw new Error(`journey fixture "${key}" is not configured`)
    return value
  })
}
