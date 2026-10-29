// need to hide from static analysis in tests, and avoids @ts-ignore /

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
