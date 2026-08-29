// Provider for the incoming SSR request. The web app sets this at startup
// via setServerRequestGetter(getRequest) where getRequest comes from
// '@tanstack/react-start/server' — a dependency only the web app has.
// This keeps app-shell free of a direct import that Vite would otherwise
// need to hide from static analysis in tests, and avoids @ts-ignore /
// prefix+suffix obfuscation.

let getter: (() => Request) | undefined

export function setServerRequestGetter(fn: (() => Request) | undefined): void {
  getter = fn
}

export function getServerRequest(): Request | undefined {
  if (!getter) return undefined
  return getter()
}

export function clearServerRequestGetter(): void {
  getter = undefined
}
