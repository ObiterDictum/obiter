const saves = new Set<() => Promise<boolean>>()

export function registerUpdateSave(save: () => Promise<boolean>) {
  saves.add(save)
  return () => {
    saves.delete(save)
  }
}

export async function flushUpdateSaves(): Promise<boolean> {
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const results = await Promise.all([...saves].map((save) => save()))
  return results.every(Boolean)
}
