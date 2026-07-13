import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Resolve an obiter:// request pathname to an absolute filesystem path inside
 * the renderer root, or null if it escapes that root.
 *
 * Pure (no Electron, no fs) so it can be unit-tested without booting the app.
 * The obiter:// protocol handler maps the URL pathname onto the packaged
 * renderer bundle (out/renderer); this function owns the two responsibilities
 * that keep that safe:
 *
 * - map the bare root ("/") to the document entry (index.html);
 * - reject traversal: a result that climbs above the renderer root returns null.
 *
 * URL pathnames begin with "/", which path.resolve treats as absolute from the
 * drive root — discarding rendererRoot entirely. join() instead treats a
 * leading-slash segment as relative, so the pathname attaches under the root
 * and ".." still normalises. Containment is then checked with path.relative:
 * relative(rendererRoot, resolved) returns ".." for anything that climbed above
 * the root, and a non-empty relative path for a sibling whose name starts with
 * the root basename (the startsWith-prefix trap). This avoids the broken
 * slice- and startsWith-based guards that join()'s pre-normalisation defeats.
 *
 * Returns null for escapes; the caller turns that into a 403.
 */
export function resolveRendererPath(
  rendererRoot: string,
  pathname: string,
): string | null {
  // Treat the directory root as the document entry. decodeURIComponent has
  // already run in the handler; pathname is a decoded URL path here.
  const normalizedPath =
    pathname === '/' || pathname === '' ? '/index.html' : pathname

  // join attaches the (leading-slash) pathname under the root and normalises
  // ".."; resolve then produces a canonical absolute path. join alone leaves a
  // trailing-normalised form; resolve guarantees an absolute, "."-free result
  // for the relative() comparison below.
  const resolved = resolve(join(rendererRoot, normalizedPath))
  const relativePath = relative(rendererRoot, resolved)

  // relativePath is "" only when resolved === rendererRoot (the root itself).
  // ".." means the path climbed above the root; isAbsolute means a different
  // root entirely (a platform-absolute pathname join carried through). Both
  // are escapes — return null for a 403.
  if (relativePath === '') {
    return resolved
  }
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null
  }

  return resolved
}
