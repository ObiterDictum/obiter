import type { DocumentChangeWire } from '@obiter/contracts'

/**
 * One row of the review panel. A move is a row, not two: the engine names the
 * halves of a decidable move by a mutual `pairId` and decides the group as one,
 * so a panel that listed them separately would offer two decisions over one
 * outcome — and, for the replacement Word writes as an insert plus a delete,
 * would hide the move behind a silent pair.
 */
export type ReviewItem =
  | { kind: 'change'; id: string; change: DocumentChangeWire }
  | {
      kind: 'move'
      id: string
      /** The move's revisions; one when the parser could not pair the halves. */
      members: DocumentChangeWire[]
      /** The revision the row reads its author, date and text from. */
      lead: DocumentChangeWire
    }

/**
 * The panel's rows, in document order. A move half the parser could not pair
 * carries no `pairId` (the wire only resolves one for a decidable pair), so it
 * stays its own row — labelled as a move, never as an insert or a delete,
 * because the panel cannot honestly claim which half belongs with which.
 */
export function reviewItems(
  changes: readonly DocumentChangeWire[],
): ReviewItem[] {
  const byId = new Map(changes.map((change) => [change.id, change]))
  // `pairId` is mutual but not total: Word names a move by its range
  // containers, so one move can hold several wrappers whose pair ids point at
  // a shared half. Linking both ends and claiming each component keeps the
  // whole move in one row.
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

/**
 * The parser names a move's halves by a mutual `pairId`; without one, each
 * half arrives as its own row and the panel showed the same words twice with
 * no explanation. Two unpairable halves carrying the same text are one move
 * the engine cannot decide here, so they read as one row that says why.
 */
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

/** Every wire id a decision on this row has to name. */
export function itemChangeIds(item: ReviewItem) {
  return item.kind === 'change'
    ? [item.change.id]
    : item.members.map((m) => m.id)
}

/**
 * Whether the engine can decide this row at all. A move whose halves the
 * parser never paired is decided as a pair or not at all, so merging the two
 * display rows must not make one decidable.
 */
export function itemDecidable(item: ReviewItem) {
  if (item.kind === 'change') return item.change.undecidable === undefined
  if (item.members.length > 1 && item.members.every((m) => m.pairId === undefined))
    return false
  return item.members.every((member) => member.undecidable === undefined)
}

/** The revision the row is about, for its author, date and text. */
export function itemLead(item: ReviewItem) {
  return item.kind === 'change' ? item.change : item.lead
}

export type ReviewCounts = {
  /** Rows that are a single revision: insertions, deletions, formatting. */
  changes: number
  /** Rows that are a move, paired or not. */
  moves: number
  /** Move rows no decision can run on. */
  manualMoves: number
  /** Rows of any kind no decision can run on. */
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

/**
 * The counts line the panel leads with. Changes, comments and moves are counted
 * apart because they are decided apart: a bulk decision reaches changes only,
 * and a move no decision can run on is never folded into their number.
 */
export function reviewCountsLabel(counts: ReviewCounts, comments: number) {
  const parts = [plural(counts.changes, 'change')]
  if (comments > 0) parts.push(plural(comments, 'comment'))
  if (counts.moves > 0) {
    // A move no decision can run on is the one count a reader must not miss,
    // so it is named in the same line rather than left for the list to show.
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

/** What the row is, in the words the reason and the decision bar share. */
export function itemKindLabel(item: ReviewItem) {
  if (item.kind === 'move') {
    const { lead } = item
    if (
      item.members.length > 1 &&
      item.members.every((member) => member.pairId === undefined)
    ) {
      return 'Move · cannot be paired'
    }
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
      // A move is always a move row; this only keeps the switch exhaustive
      // over the wire's own union.
      return 'Move'
  }
}
