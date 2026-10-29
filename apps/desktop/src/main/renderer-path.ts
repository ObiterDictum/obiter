import { isAbsolute, join, relative, resolve } from 'node:path'

export function resolveRendererPath(
  rendererRoot: string,
  pathname: string,
): string | null {
  const normalizedPath =
    pathname === '/' || pathname === '' ? '/index.html' : pathname

  const resolved = resolve(join(rendererRoot, normalizedPath))
  const relativePath = relative(rendererRoot, resolved)

  if (relativePath === '') {
    return resolved
  }
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null
  }

  return resolved
}
