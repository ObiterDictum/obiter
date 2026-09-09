/**
 * Pure parser for the legislation.gov.uk affected-changes feed behind
 * `/changes/affected/{type}/{year}/{number}/data.feed`.
 *
 * One feed page carries up to 50 entries (`results-count=50`); further pages
 * follow `rel="next"` links. The server offers no per-provision filter, so
 * callers page through the whole feed and filter client-side on the
 * `ukm:AffectedProvisions/ukm:Section` references of each `ukm:Effect`.
 * A filtered query (e.g. `?affected-provision=s.40`) is silently ignored:
 * the whole-Act feed returns, and 16 of its effects were once misread as
 * s.40's. Only Section URIs scoped to the requested document attribute an
 * effect to a provision.
 * The `Applied` attribute on `ukm:Effect` is the source of truth: the HTML
 * yet-to-be-applied heading is whole-Act level (verified identical whether
 * the query names an amended or an unamended section), so it cannot answer
 * a per-provision question and is never read here.
 *
 * No network, no storage. Fetching and paging live in legislation-ingest.ts.
 */

export interface LegislationEffectReference {
  /** Hyphen form from ukm:Section Ref, e.g. section-182-4. */
  ref: string
  /** Label path from the Section URI suffix, e.g. section/182/4. Null when
   * the URI is absent or names a different document. */
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
  /** Absolute URL of the rel="next" page, or null on the last page. */
  nextPageUrl: string | null
}

function readAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return match ? match[1] : null
}

function decodeXmlEntities(value: string): string {
  // &amp; decodes last: a single pass must not turn `&amp;lt;` into `<`.
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

/**
 * Unapplied effects touching a provision, matched client-side. Matching is
 * bidirectional on the label path: an amendment to s. 13 makes s. 13(2)
 * stale, and an amendment to s. 13(2)(a) makes the served s. 13 text stale.
 * Either direction withholds the text, so uncertainty always resolves
 * towards the amended-not-held state, never towards serving text.
 */
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
