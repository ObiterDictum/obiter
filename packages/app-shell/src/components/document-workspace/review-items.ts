import type { DocumentChangeWire } from '@obiter/contracts'

export type ReviewItem =
  | { kind: 'change'; id: string; change: DocumentChangeWire }
  | {
      kind: 'move'
      id: string
      members: DocumentChangeWire[]
      lead: DocumentChangeWire
    }

export function reviewItems(
  changes: readonly DocumentChangeWire[],
): ReviewItem[] {
  const byId = new Map(changes.map((change) => [change.id, change]))
  const links = new Map<string, string[]>()
  for (const change of changes) {
    const partner =
      change.pairId === undefined ? undefined : byId.get(change.pairId)
    if (change.kind !== 'move' || partner?.kind !== 'move') continue
    for (const [from, to] of [
      [change.id, partner.id],
      [partner.id, change.id],
    ] as const) {
      const existing = links.get(from)
      if (!existing) links.set(from, [to])
      else if (!existing.includes(to)) existing.push(to)
    }
  }
  const claimed = new Set<string>()
  const items: ReviewItem[] = []
  for (const change of changes) {
    if (claimed.has(change.id)) continue
    claimed.add(change.id)
    const members: DocumentChangeWire[] = [change]
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index]
      if (!member) continue
      for (const next of links.get(member.id) ?? []) {
        if (claimed.has(next)) continue
        claimed.add(next)
        const linked = byId.get(next)
        if (linked) members.push(linked)
      }
    }
    items.push(
      change.kind === 'move'
        ? { kind: 'move', id: change.id, members, lead: change }
        : { kind: 'change', id: change.id, change },
    )
  }
  return mergeUnpairedMoves(items)
}

function mergeUnpairedMoves(items: ReviewItem[]): ReviewItem[] {
  const merged: ReviewItem[] = []
  for (const item of items) {
    if (
      item.kind !== 'move' ||
      item.members.length !== 1 ||
      item.members[0]?.pairId !== undefined
    ) {
      merged.push(item)
      continue
    }
    const twin = merged.find(
      (candidate): candidate is Extract<ReviewItem, { kind: 'move' }> =>
        candidate.kind === 'move' &&
        candidate.members.length === 1 &&
        candidate.members[0]?.pairId === undefined &&
        candidate.lead.text === item.lead.text,
    )
    if (!twin) {
      merged.push(item)
      continue
    }
    twin.members.push(item.lead)
  }
  return merged
}

export function itemChangeIds(item: ReviewItem) {
  return item.kind === 'change'
    ? [item.change.id]
    : item.members.map((m) => m.id)
}

export function itemUnpairable(item: ReviewItem) {
  return (
    item.kind === 'move' &&
    item.members.every((member) => member.pairId === undefined)
  )
}

export function itemDecidable(item: ReviewItem) {
  if (item.kind === 'change') return item.change.undecidable === undefined
  if (
    item.members.length > 1 &&
    item.members.every((m) => m.pairId === undefined)
  )
    return false
  return item.members.every((member) => member.undecidable === undefined)
}

export function itemLead(item: ReviewItem) {
  return item.kind === 'change' ? item.change : item.lead
}

export type ReviewCounts = {
  changes: number
  moves: number
  manualMoves: number
  undecidable: number
}

export function reviewCounts(items: readonly ReviewItem[]): ReviewCounts {
  const moves = items.filter((item) => item.kind === 'move')
  return {
    changes: items.length - moves.length,
    moves: moves.length,
    manualMoves: moves.filter((item) => !itemDecidable(item)).length,
    undecidable: items.filter((item) => !itemDecidable(item)).length,
  }
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${String(count)} ${count === 1 ? one : many}`
}

export function reviewCountsLabel(counts: ReviewCounts, comments: number) {
  const parts = [plural(counts.changes, 'change')]
  if (comments > 0) parts.push(plural(comments, 'comment'))
  if (counts.moves > 0) {
    parts.push(
      counts.manualMoves === counts.moves
        ? `${plural(counts.moves, 'move')} requiring manual review`
        : plural(counts.moves, 'move'),
    )
    if (counts.manualMoves > 0 && counts.manualMoves < counts.moves)
      parts[parts.length - 1] =
        `${plural(counts.moves, 'move')} (${String(counts.manualMoves)} requiring manual review)`
  }
  return parts.join(' · ')
}

export function itemKindLabel(item: ReviewItem) {
  if (item.kind === 'move') {
    const { lead } = item
    if (itemUnpairable(item)) return "Move · can't be paired"
    if (item.members.length > 1) return 'Move'
    return lead.kind === 'move' && lead.direction === 'from'
      ? 'Move · moved from'
      : 'Move · moved to'
  }
  switch (item.change.kind) {
    case 'insert':
      return 'Insertion'
    case 'delete':
      return 'Deletion'
    case 'property':
      return 'Formatting'
    case 'move':
      return 'Move'
  }
}
