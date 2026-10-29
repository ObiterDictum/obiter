import { describe, expect, it } from 'bun:test'

import { versionQuery, workspaceKeys } from './document-workspace-queries'

describe('workspace query keys', () => {
  it('caches every version-aware read under the version id, never the current key', () => {
    const versionAware = [
      workspaceKeys.model,
      workspaceKeys.pdfView,
      workspaceKeys.text,
      workspaceKeys.trackedChanges,
      workspaceKeys.media,
    ]

    for (const build of versionAware) {
      expect(build('doc_1', 'ver_2')).not.toEqual(build('doc_1'))
    }
  })

  it('encodes the version selector so a version id cannot alter the path', () => {
    expect(versionQuery('ver/2 x')).toBe('?versionId=ver%2F2%20x')
    expect(versionQuery(undefined)).toBe('')
  })
})
