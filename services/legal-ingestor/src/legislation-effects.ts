export interface LegislationEffectReference {
  ref: string
  labelPath: string | null
  display: string
}

export interface LegislationEffect {
  effectId: string
  applied: boolean
  type: string
  affectedDisplay: string
  affectingTitle: string
  affected: LegislationEffectReference[]
}

export interface ParsedEffectsFeed {
  effects: LegislationEffect[]
  nextPageUrl: string | null
}

function readAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? match[1] : null
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Derives the provision label path from an /id/ Section URI, scoped to the
 * expected document so a cross-reference to another Act never matches.
 * `http://www.legislation.gov.uk/id/ukpga/2010/15/section/182/4` with
 * document identity `ukpga/2010/15` yields `section/182/4`.
 */
export function provisionLabelPathFromSectionUri(
  uri: string,
  documentIdentity: string,
): string | null {
  const marker = `/id/${documentIdentity}/`
  const index = uri.indexOf(marker)
  if (index === -1) return null
  const path = uri.slice(index + marker.length).replace(/\/$/, '')
  if (!path || /[<>"\s]/.test(path)) return null
  return path
}

function parseEffectReferences(
  effectInner: string,
  documentIdentity: string,
): LegislationEffectReference[] {
  const provisionsBlock = effectInner.match(
    /<ukm:AffectedProvisions\b[\s\S]*?<\/ukm:AffectedProvisions>/i,
  )
  if (!provisionsBlock) return []
  return Array.from(
    provisionsBlock[0].matchAll(
      /<ukm:Section\b([^>]*)>([\s\S]*?)<\/ukm:Section>/gi,
    ),
  ).map((match) => {
    const ref = readAttribute(match[1] ?? '', 'Ref') ?? ''
    const uri = readAttribute(match[1] ?? '', 'URI') ?? ''
    return {
      ref,
      labelPath: uri
        ? provisionLabelPathFromSectionUri(uri, documentIdentity)
        : null,
      display: decodeXmlEntities((match[2] ?? '').trim()),
    }
  })
}

export function parseEffectsFeed(
  xml: string,
  documentIdentity: string,
): ParsedEffectsFeed {
  const effects: LegislationEffect[] = []
  for (const entry of xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)) {
    const entryXml = entry[0]
    const effectOpen = entryXml.match(/<ukm:Effect\b([^>]*)>/i)
    if (!effectOpen) continue
    const attrs = effectOpen[1] ?? ''
    const inner =
      entryXml.match(/<ukm:Effect\b[^>]*>([\s\S]*?)<\/ukm:Effect>/i)?.[1] ?? ''
    effects.push({
      effectId: readAttribute(attrs, 'EffectId') ?? '',
      applied: readAttribute(attrs, 'Applied')?.toLowerCase() === 'true',
      type: readAttribute(attrs, 'Type') ?? '',
      affectedDisplay: readAttribute(attrs, 'AffectedProvisions') ?? '',
      affectingTitle: decodeXmlEntities(
        inner
          .match(
            /<ukm:AffectingTitle\b[^>]*>([\s\S]*?)<\/ukm:AffectingTitle>/i,
          )?.[1]
          ?.trim() ?? '',
      ),
      affected: parseEffectReferences(entryXml, documentIdentity),
    })
  }
  const nextHref = Array.from(xml.matchAll(/<link\b([^>]*)\/>/gi))
    .map((match) => match[1] ?? '')
    .find((attrs) => readAttribute(attrs, 'rel') === 'next')
  const nextPageUrl = nextHref
    ? decodeXmlEntities(readAttribute(nextHref, 'href') ?? '') || null
    : null
  return { effects, nextPageUrl }
}

function isPathOrAncestor(candidate: string, provision: string): boolean {
  return (
    candidate === provision ||
    candidate.startsWith(`${provision}/`) ||
    provision.startsWith(`${candidate}/`)
  )
}

export function unappliedEffectsForProvision(
  effects: LegislationEffect[],
  labelPath: string,
): LegislationEffect[] {
  return effects.filter(
    (effect) =>
      !effect.applied &&
      effect.affected.some(
        (ref) =>
          ref.labelPath !== null && isPathOrAncestor(ref.labelPath, labelPath),
      ),
  )
}
