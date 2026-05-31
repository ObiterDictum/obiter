export interface CaseLawParagraph {
  id: string
  paragraphNumber: number
  text: string
}

export interface CaseLawSnippet {
  paragraphNumber: number
  text: string
}

export interface LegalSearchResult {
  id: string
  title: string
  neutralCitation: string | null
  court: string
  dateDecided: string
  sourceUrl: string
  snippets?: CaseLawSnippet[]
  paragraphs?: CaseLawParagraph[]
}

export interface LegalSearchFetchResponse {
  hits: LegalSearchResult[]
  cached: boolean
  indexedCount: number
  skippedCount: number
  hydrationQueued?: boolean
}

export interface LegalSearchRequestFilters {
  court: string
  dateFrom: string
  dateTo: string
}

export interface CourtOption {
  code: string
  label: string
}

export interface CourtOptionGroup {
  label: string
  options: CourtOption[]
}

export type LegalSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'results'; query: string; response: LegalSearchFetchResponse }
  | { status: 'empty'; query: string; hydrationQueued?: boolean }
  | { status: 'error'; query: string; message: string }

export const courtOptionGroups: CourtOptionGroup[] = [
  {
    label: 'Supreme courts',
    options: [
      { code: 'uksc', label: 'UK Supreme Court' },
      { code: 'ukpc', label: 'Privy Council' },
    ],
  },
  {
    label: 'Court of Appeal',
    options: [
      { code: 'ewca/civ', label: 'Court of Appeal Civil Division' },
      { code: 'ewca/crim', label: 'Court of Appeal Criminal Division' },
    ],
  },
  {
    label: 'High Court',
    options: [
      { code: 'ewhc/admin', label: 'Administrative Court' },
      { code: 'ewhc/admlty', label: 'Admiralty Court' },
      { code: 'ewhc/ch', label: 'Chancery Division' },
      { code: 'ewhc/comm', label: 'Commercial Court' },
      { code: 'ewhc/fam', label: 'Family Division' },
      { code: 'ewhc/ipec', label: 'Intellectual Property Enterprise Court' },
      { code: 'ewhc/kb', label: "King's Bench Division" },
      { code: 'ewhc/mercantile', label: 'Mercantile Court' },
      { code: 'ewhc/pat', label: 'Patents Court' },
      { code: 'ewhc/scco', label: 'Senior Courts Costs Office' },
      { code: 'ewhc/tcc', label: 'Technology and Construction Court' },
    ],
  },
  {
    label: 'England and Wales courts',
    options: [
      { code: 'ewcr', label: 'Crown Court' },
      { code: 'ewcc', label: 'County Court' },
      { code: 'ewfc', label: 'Family Court' },
      { code: 'ewcop', label: 'Court of Protection' },
    ],
  },
  {
    label: 'Tribunals and commissions',
    options: [
      { code: 'eat', label: 'Employment Appeal Tribunal' },
      { code: 'ukiptrib', label: 'Investigatory Powers Tribunal' },
      { code: 'siac', label: 'Special Immigration Appeals Commission' },
      { code: 'ukist', label: 'Immigration Services Tribunal' },
      { code: 'ukut/aac', label: 'Upper Tribunal Administrative Appeals Chamber' },
      { code: 'ukut/iac', label: 'Upper Tribunal Immigration and Asylum Chamber' },
      { code: 'ukut/lc', label: 'Upper Tribunal Lands Chamber' },
      { code: 'ukut/tcc', label: 'Upper Tribunal Tax and Chancery Chamber' },
      { code: 'ukftt/credit', label: 'First-tier Tribunal Consumer Credit' },
      { code: 'ukftt/estate', label: 'First-tier Tribunal Estate Agents' },
      { code: 'ukftt/grc', label: 'First-tier Tribunal General Regulatory Chamber' },
      { code: 'ukftt/hesc', label: 'First-tier Tribunal Health, Education and Social Care' },
      { code: 'ukftt/tc', label: 'First-tier Tribunal Tax Chamber' },
      { code: 'ftt/claims', label: 'First-tier Tribunal Claims Management' },
      { code: 'ftt/pc', label: 'First-tier Tribunal Land Registration Division (Property Chamber)' },
      { code: 'ftt/phl', label: 'First-tier Tribunal Primary Health Lists' },
      { code: 'ftt/transport', label: 'First-tier Tribunal Transport' },
    ],
  },
]

export function getCourtLabel(code: string) {
  if (!code) return 'All courts and tribunals'

  for (const group of courtOptionGroups) {
    const option = group.options.find((courtOption) => courtOption.code === code)
    if (option) return option.label
  }

  return code
}
