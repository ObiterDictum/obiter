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
    clientNavFrom: '/matters/{matterId}',
    clientNavName: '{documentName}',
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
    redirectsTo: [/^\/case\/[^/]+$/],
  },
]

export function resolvePath(path, fixtures) {
  return path.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = fixtures[key]
    if (!value) throw new Error(`journey fixture "${key}" is not configured`)
    return value
  })
}
