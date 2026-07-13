import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRendererPath } from './renderer-path'

/**
 * resolveRendererPath is the security boundary for the obiter:// protocol
 * handler: it must serve files inside the renderer root and reject every form
 * of escape. These cases pin that contract without booting Electron.
 */
describe('resolveRendererPath', () => {
  // A renderer root shaped like the real one (out/renderer) so the
  // sibling-prefix case is realistic.
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
    // decodeURIComponent runs in the handler before this function; simulate it
    // here so the encoded form is what the function actually sees.
    expect(
      resolveRendererPath(root, decodeURIComponent('/%2e%2e/%2e%2e/win.ini')),
    ).toBeNull()
  })

  it('accepts a path that resolves exactly to the root', () => {
    // The root itself maps to index.html at the "/" step; an empty/normalised
    // root must not be mistaken for an escape.
    expect(resolveRendererPath(root, '/')).toBe(join(root, 'index.html'))
  })

  it('rejects a traversal into a sibling whose name starts with the root basename', () => {
    // The startsWith-prefix trap: root ends in "renderer", an attacker targets
    // "../renderer-evil/x" — one level up into a directory the old
    // slice/startsWith guards would have accepted as "inside" the root.
    // relative() returns a ".."-prefixed path — rejected. URL pathnames only
    // ever arrive "/"-prefixed, so the traversal form is what the handler can
    // actually see; a platform-absolute pathname is not reachable through
    // new URL().pathname on POSIX (join nests it harmlessly inside the root),
    // and the win32 absolute form is covered by the drive-change case below.
    expect(resolveRendererPath(root, '/../renderer-evil/index.html')).toBeNull()
  })

  it('rejects an absolute path on a different root (drive change on Windows)', () => {
    // On Windows an absolute path under a different drive is a different root.
    // On POSIX there is no second drive, so only assert the escape on win32.
    if (process.platform === 'win32') {
      expect(resolveRendererPath(root, 'Z:/Windows/win.ini')).toBeNull()
    }
  })
})
