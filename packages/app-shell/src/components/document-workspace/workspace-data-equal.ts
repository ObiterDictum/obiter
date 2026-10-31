import { isValidElement } from 'react'

export function workspaceDataEqual(prev: unknown, next: unknown): boolean {
  if (Object.is(prev, next)) return true
  if (typeof prev !== typeof next) return false
  if (
    prev === null ||
    next === null ||
    typeof prev !== 'object' ||
    typeof next !== 'object'
  ) {
    return false
  }
  if (isValidElement(prev) || isValidElement(next)) {
    return (
      isValidElement(prev) &&
      isValidElement(next) &&
      prev.type === next.type &&
      prev.key === next.key
    )
  }
  if (Array.isArray(prev) || Array.isArray(next)) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return false
    return (
      prev.length === next.length &&
      prev.every((item, index) => workspaceDataEqual(item, next[index]))
    )
  }
  if (prev instanceof Map || next instanceof Map) {
    if (!(prev instanceof Map) || !(next instanceof Map)) return false
    if (prev.size !== next.size) return false
    for (const [key, value] of prev) {
      if (!next.has(key) || !workspaceDataEqual(value, next.get(key))) {
        return false
      }
    }
    return true
  }
  if (prev instanceof Set || next instanceof Set) {
    if (!(prev instanceof Set) || !(next instanceof Set)) return false
    if (prev.size !== next.size) return false
    for (const value of prev) if (!next.has(value)) return false
    return true
  }
  if (prev instanceof Date || next instanceof Date) {
    return (
      prev instanceof Date &&
      next instanceof Date &&
      prev.getTime() === next.getTime()
    )
  }
  const prevEntries = Object.entries(prev)
  const nextValues = new Map(Object.entries(next))
  if (prevEntries.length !== nextValues.size) return false
  return prevEntries.every(
    ([key, value]) =>
      nextValues.has(key) && workspaceDataEqual(value, nextValues.get(key)),
  )
}
