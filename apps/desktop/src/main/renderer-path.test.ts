import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { resolveRendererPath } from './renderer-path'

describe('resolveRendererPath', () => {
  const root = join(process.cwd(), 'out', 'renderer')

  it('resolves a plain file inside the root', () => {
    const resolved = resolveRendererPath(root, '/index.html')
    expect(resolved).toBe(join(root, 'index.html'))
  })

  it('resolves a nested file inside the root', () => {
    const resolved = resolveRendererPath(root, '/assets/app.js')
    expect(resolved).toBe(join(root, 'assets', 'app.js'))
  })

  it('maps the bare root to index.html', () => {
    expect(resolveRendererPath(root, '/')).toBe(join(root, 'index.html'))
    expect(resolveRendererPath(root, '')).toBe(join(root, 'index.html'))
  })

  it('rejects a literal .. escape above the root', () => {
    expect(resolveRendererPath(root, '/../../../../Windows/win.ini')).toBeNull()
    expect(resolveRendererPath(root, '/../../../etc/passwd')).toBeNull()
  })

  it('rejects an encoded %2e%2e escape', () => {
    expect(
      resolveRendererPath(root, decodeURIComponent('/%2e%2e/%2e%2e/win.ini')),
    ).toBeNull()
  })

  it('accepts a path that resolves exactly to the root', () => {
    expect(resolveRendererPath(root, '/')).toBe(join(root, 'index.html'))
  })

  it('rejects a traversal into a sibling whose name starts with the root basename', () => {
    expect(resolveRendererPath(root, '/../renderer-evil/index.html')).toBeNull()
  })

  it('rejects an absolute path on a different root (drive change on Windows)', () => {
    if (process.platform === 'win32') {
      expect(resolveRendererPath(root, 'Z:/Windows/win.ini')).toBeNull()
    }
  })
})
