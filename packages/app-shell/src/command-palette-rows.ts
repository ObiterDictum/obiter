import { formatDateTime } from './format'
import type { ShellCommand } from './shell-shortcuts'

export type PaletteActionId =
  | 'send-feedback'
  | 'toggle-nav'
  | 'toggle-right-slot'
  | 'focus-mode'
  | 'toggle-theme'
  | 'settings-account'
  | 'settings-security'
  | 'settings-organisation'
  | 'settings-preferences'
  | 'settings-members'
  | 'settings-agent'
  | 'layout-sidebar'
  | 'layout-tabs'
  | 'layout-clean'

export type PaletteCreateId =
  'new-matter' | 'upload-document' | 'blank-document' | 'start-redaction'

type PaletteTarget =
  | { kind: 'matter'; matterId: string }
  | { kind: 'document'; matterId: string; documentId: string }
  | { kind: 'verify' }
  | { kind: 'redaction'; runId: string }
  | { kind: 'law'; query: string }
  | { kind: 'action'; id: PaletteActionId }
  | { kind: 'create'; id: PaletteCreateId; matterId?: string }

export interface PaletteRow {
  id: string
  label: string
  hint?: string
  shortcut?: ShellCommand
  target: PaletteTarget
}

export interface PaletteGroup {
  id: 'recent' | 'go-to' | 'create' | 'actions' | 'law'
  label: string
  rows: PaletteRow[]
}

export interface PaletteMatter {
  id: string
  name: string
  clientReference: string | null
  updatedAt: string
}

interface PaletteDocument {
  documentId: string
  matterId: string
  matterName: string
  filename: string
  openedAt: string
}

interface PaletteVerificationRun {
  id: string
  matterId: string
  documentId: string
  status: string
  createdAt: string
}

interface PaletteRedactionRun {
  id: string
  sourceFilename: string
  matterName?: string | null
  updatedAt: string
}

export interface PaletteInput {
  query: string
  matters: PaletteMatter[]
  documents: PaletteDocument[]
  verificationRuns: PaletteVerificationRun[]
  redactionRuns: PaletteRedactionRun[]
  recentlyOpenedDocumentId: string | null
  currentMatterName: string | null
  actions: PaletteRow[]
}

const RECENT_MATTER_LIMIT = 4
const GROUP_LIMIT = 5

function tokenScore(text: string, query: string): number | null {
  const position = text.indexOf(query)
  if (position >= 0) return 100 - position + (position === 0 ? 20 : 0)
  let cursor = -1
  let score = 0
  for (const character of query) {
    const found = text.indexOf(character, cursor + 1)
    if (found < 0) return null
    score += found === cursor + 1 ? 3 : 1
    cursor = found
  }
  return score
}

export function paletteScore(
  label: string,
  hint: string | undefined,
  query: string,
): number | null {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return 0
  const labelScore = tokenScore(label.toLowerCase(), trimmed)
  const hintScore = hint ? tokenScore(hint.toLowerCase(), trimmed) : null
  if (labelScore === null) return hintScore === null ? null : hintScore / 4
  return labelScore + (hintScore ?? 0) / 10
}

function rank<T>(
  items: T[],
  query: string,
  probe: (item: T) => { label: string; hint?: string },
  limit = GROUP_LIMIT,
): T[] {
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const { label, hint } = probe(item)
    const score = paletteScore(label, hint, query)
    if (score === null) continue
    scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((entry) => entry.item)
}

function matterRow(matter: PaletteMatter): PaletteRow {
  return {
    id: `matter-${matter.id}`,
    label: matter.name,
    hint: matter.clientReference ?? 'Matter',
    target: { kind: 'matter', matterId: matter.id },
  }
}

function documentRow(document: PaletteDocument): PaletteRow {
  return {
    id: `document-${document.documentId}`,
    label: document.filename,
    hint: document.matterName,
    target: {
      kind: 'document',
      matterId: document.matterId,
      documentId: document.documentId,
    },
  }
}

function recentRows(input: PaletteInput): PaletteRow[] {
  if (input.query.trim()) return []
  const opened = input.documents.find(
    (document) => document.documentId === input.recentlyOpenedDocumentId,
  )
  const matters = [...input.matters]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_MATTER_LIMIT)
  return [...(opened ? [documentRow(opened)] : []), ...matters.map(matterRow)]
}

function goToRows(input: PaletteInput): PaletteRow[] {
  const query = input.query
  const fileNames = new Map(
    input.documents.map((document) => [document.documentId, document.filename]),
  )
  const matterNames = new Map(
    input.matters.map((matter) => [matter.id, matter.name]),
  )
  const verifyRows = rank(
    input.verificationRuns,
    query,
    (run) => ({
      label:
        fileNames.get(run.documentId) ??
        matterNames.get(run.matterId) ??
        'Verify run',
      hint: `Verify · ${run.status}`,
    }),
    3,
  ).map<PaletteRow>((run) => ({
    id: `verify-${run.id}`,
    label:
      fileNames.get(run.documentId) ??
      matterNames.get(run.matterId) ??
      'Verify run',
    hint: `Verify · ${run.status}`,
    target: { kind: 'verify' },
  }))
  const redactionRows = rank(
    input.redactionRuns,
    query,
    (run) => ({ label: run.sourceFilename, hint: run.matterName ?? 'Redact' }),
    3,
  ).map<PaletteRow>((run) => ({
    id: `redaction-${run.id}`,
    label: run.sourceFilename,
    hint: `${run.matterName ?? 'Redaction run'} · ${formatDateTime(run.updatedAt)}`,
    target: { kind: 'redaction', runId: run.id },
  }))

  return [
    ...rank(input.matters, query, (matter) => ({
      label: matter.name,
      hint: matter.clientReference ?? undefined,
    })).map(matterRow),
    ...rank(input.documents, query, (document) => ({
      label: document.filename,
      hint: document.matterName,
    })).map(documentRow),
    ...verifyRows,
    ...redactionRows,
  ]
}

function createRows(input: PaletteInput): PaletteRow[] {
  const matterHint = input.currentMatterName
    ? `Into ${input.currentMatterName}`
    : 'Choose a matter'
  return rank(
    [
      {
        id: 'new-matter',
        label: 'New matter',
        hint: 'Create a matter in this workspace',
        target: { kind: 'create', id: 'new-matter' },
      },
      {
        id: 'upload-document',
        label: 'Upload document',
        hint: matterHint,
        target: { kind: 'create', id: 'upload-document' },
      },
      {
        id: 'blank-document',
        label: 'New blank document',
        hint: matterHint,
        target: { kind: 'create', id: 'blank-document' },
      },
      {
        id: 'start-redaction',
        label: 'Start redaction',
        hint: 'Open Redact',
        target: { kind: 'create', id: 'start-redaction' },
      },
    ] satisfies PaletteRow[],
    input.query,
    (row) => ({ label: row.label, hint: row.hint }),
  )
}

export function buildPalette(input: PaletteInput): PaletteGroup[] {
  const query = input.query.trim()
  const groups: PaletteGroup[] = [
    { id: 'recent', label: 'Recent', rows: recentRows(input) },
    {
      id: 'go-to',
      label: 'Go to',
      rows: query ? goToRows(input) : [],
    },
    { id: 'create', label: 'Create', rows: createRows(input) },
    {
      id: 'actions',
      label: 'Actions',
      rows: rank(input.actions, query, (row) => ({
        label: row.label,
        hint: row.hint,
      })),
    },
    {
      id: 'law',
      label: 'Search',
      rows: query
        ? [
            {
              id: 'law-search',
              label: `Case law and legislation for “${query}”`,
              hint: 'Search the law',
              target: { kind: 'law', query },
            },
          ]
        : [],
    },
  ]
  return groups.filter((group) => group.rows.length > 0)
}

export function flattenPalette(groups: PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((group) => group.rows)
}
