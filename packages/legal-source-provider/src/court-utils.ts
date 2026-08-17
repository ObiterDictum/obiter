const findCaseLawJurisdiction = 'england-and-wales'
const supportedFindCaseLawCourts = new Set([
  'eat',
  'uksc',
  'ukpc',
  'ewca-civ',
  'ewca-crim',
  'ewcr',
  'ewhc-admin',
  'ewhc-admlty',
  'ewhc-ch',
  'ewhc-comm',
  'ewhc-fam',
  'ewhc-ipec',
  'ewhc-kb',
  'ewhc-mercantile',
  'ewhc-pat',
  'ewhc-scco',
  'ewhc-tcc',
  'ewfc',
  'ewcop',
  'ewcc',
  'ukiptrib',
  'siac',
  'ukist',
  'ukut-aac',
  'ukut-iac',
  'ukut-lc',
  'ukut-tcc',
  'ukftt-credit',
  'ukftt-estate',
  'ukftt-grc',
  'ukftt-hesc',
  'ukftt-tc',
  'ftt-claims',
  'ftt-pc',
  'ftt-phl',
  'ftt-transport',
])

const findCaseLawCourtParamByCourt = new Map<string, string>(
  Array.from(
    supportedFindCaseLawCourts,
    (court) => [court, court.replace(/-/g, '/')] as const,
  ),
)
const findCaseLawCourtPathAliases = new Map<string, string>([
  ['ukftt/claims', 'ftt-claims'],
  ['ukftt/pc', 'ftt-pc'],
  ['ukftt/phl', 'ftt-phl'],
  ['ukftt/transport', 'ftt-transport'],
])
const findCaseLawCourtByPath = new Map<string, string>([
  ...Array.from(
    findCaseLawCourtParamByCourt,
    ([court, path]) => [path, court] as const,
  ),
  ...findCaseLawCourtPathAliases,
])

const citationDivisionCourtByBaseCourt = new Map<string, Map<string, string>>([
  [
    'ewhc',
    new Map([
      ['admin', 'ewhc-admin'],
      ['admlty', 'ewhc-admlty'],
      ['ch', 'ewhc-ch'],
      ['comm', 'ewhc-comm'],
      ['fam', 'ewhc-fam'],
      ['ipec', 'ewhc-ipec'],
      ['kb', 'ewhc-kb'],
      ['mercantile', 'ewhc-mercantile'],
      ['pat', 'ewhc-pat'],
      ['scco', 'ewhc-scco'],
      ['tcc', 'ewhc-tcc'],
    ]),
  ],
  [
    'ukut',
    new Map([
      ['aac', 'ukut-aac'],
      ['iac', 'ukut-iac'],
      ['lc', 'ukut-lc'],
      ['tcc', 'ukut-tcc'],
    ]),
  ],
  [
    'ukftt',
    new Map([
      ['credit', 'ukftt-credit'],
      ['estate', 'ukftt-estate'],
      ['grc', 'ukftt-grc'],
      ['hesc', 'ukftt-hesc'],
      ['claims', 'ftt-claims'],
      ['pc', 'ftt-pc'],
      ['phl', 'ftt-phl'],
      ['tc', 'ukftt-tc'],
      ['transport', 'ftt-transport'],
    ]),
  ],
  [
    'ftt',
    new Map([
      ['claims', 'ftt-claims'],
      ['pc', 'ftt-pc'],
      ['phl', 'ftt-phl'],
      ['transport', 'ftt-transport'],
    ]),
  ],
])

function courtFromFindCaseLawPath(uri: string | null) {
  if (!uri) return null

  const path = uri.replace(/^\/+/, '').toLowerCase()
  const match = Array.from(findCaseLawCourtByPath)
    .sort((left, right) => right[0].length - left[0].length)
    .find(
      ([courtPath]) => path === courtPath || path.startsWith(`${courtPath}/`),
    )

  return match?.[1] ?? null
}

function courtFromCitation(citation: string) {
  const match = citation.match(
    /^\[\d{4}\]\s+([A-Za-z][A-Za-z0-9 ]*?)\s+\d+(?:\s+\(([A-Za-z][A-Za-z0-9 ]*)\))?$/,
  )
  const token = match?.[1]
  const division = match?.[2]

  if (!token) return null

  const court = slugifyCourtToken(token)

  if (division) {
    const divisionCourt = citationDivisionCourtByBaseCourt
      .get(court)
      ?.get(slugifyCourtToken(division))
    if (divisionCourt) return divisionCourt
  }

  return court && supportedFindCaseLawCourts.has(court) ? court : null
}

function slugifyCourtToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeCourtCode(value: string) {
  return value.toLowerCase().replace(/\//g, '-')
}

function toFindCaseLawCourtParam(court: string) {
  return findCaseLawCourtParamByCourt.get(court) ?? court
}

export {
  findCaseLawJurisdiction,
  supportedFindCaseLawCourts,
  courtFromFindCaseLawPath,
  courtFromCitation,
  normalizeCourtCode,
  toFindCaseLawCourtParam,
}
