import { describe, expect, it } from 'vitest'
import {
  parseEffectsFeed,
  provisionLabelPathFromSectionUri,
  unappliedEffectsForProvision,
} from './legislation-effects'

const feedPage1 = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata">
<openSearch:totalResults xmlns:openSearch="http://a9.com/-/spec/opensearch/1.1/">3</openSearch:totalResults>
<link rel="next" type="application/atom+xml" href="http://www.legislation.gov.uk/changes/affected/ukpga/2020/1/data.feed?results-count=50&amp;sort=modified&amp;page=2"/>
<entry>
<id>http://www.legislation.gov.uk/changes/affected/ukpga/2020/1/effect-1</id>
<content type="text/xml">
<ukm:Effect Applied="false" Type="words inserted" EffectId="effect-1" AffectedProvisions="s. 13(2)" AffectingYear="2021" AffectedYear="2020" AffectedNumber="1" AffectedURI="http://www.legislation.gov.uk/id/ukpga/2020/1" AffectingURI="http://www.legislation.gov.uk/id/ukpga/2021/2"><ukm:AffectedTitle>Sample Act 2020</ukm:AffectedTitle><ukm:AffectedProvisions><ukm:Section Ref="section-13-2" URI="http://www.legislation.gov.uk/id/ukpga/2020/1/section/13/2">s. 13(2)</ukm:Section></ukm:AffectedProvisions><ukm:AffectingTitle>Later Act 2021</ukm:AffectingTitle><ukm:AffectingProvisions><ukm:Section Ref="section-9" URI="http://www.legislation.gov.uk/id/ukpga/2021/2/section/9">s. 9</ukm:Section></ukm:AffectingProvisions></ukm:Effect>
</content>
</entry>
<entry>
<id>http://www.legislation.gov.uk/changes/affected/ukpga/2020/1/effect-2</id>
<content type="text/xml">
<ukm:Effect Applied="true" Type="words substituted" EffectId="effect-2" AffectedProvisions="s. 7" AffectingYear="2021" AffectedYear="2020" AffectedNumber="1" AffectedURI="http://www.legislation.gov.uk/id/ukpga/2020/1" AffectingURI="http://www.legislation.gov.uk/id/ukpga/2021/2"><ukm:AffectedTitle>Sample Act 2020</ukm:AffectedTitle><ukm:AffectedProvisions><ukm:Section Ref="section-7" URI="http://www.legislation.gov.uk/id/ukpga/2020/1/section/7">s. 7</ukm:Section></ukm:AffectedProvisions><ukm:AffectingTitle>Later Act 2021</ukm:AffectingTitle></ukm:Effect>
</content>
</entry>
<entry>
<id>http://www.legislation.gov.uk/changes/affected/ukpga/2020/1/effect-3</id>
<content type="text/xml">
<ukm:Effect Applied="false" Type="section repealed" EffectId="effect-3" AffectedProvisions="Sch. 2 para. 4" AffectingYear="2022" AffectedYear="2020" AffectedNumber="1" AffectedURI="http://www.legislation.gov.uk/id/ukpga/2020/1" AffectingURI="http://www.legislation.gov.uk/id/ukpga/2022/5"><ukm:AffectedTitle>Sample Act 2020</ukm:AffectedTitle><ukm:AffectedProvisions><ukm:Section Ref="schedule-2-paragraph-4" URI="http://www.legislation.gov.uk/id/ukpga/2020/1/schedule/2/paragraph/4">Sch. 2 para. 4</ukm:Section></ukm:AffectedProvisions><ukm:AffectingTitle>Newer Act 2022</ukm:AffectingTitle></ukm:Effect>
</content>
</entry>
</feed>`

describe('parseEffectsFeed', () => {
  it('reads Applied, references, and the next page link', () => {
    const parsed = parseEffectsFeed(feedPage1, 'ukpga/2020/1')
    expect(parsed.effects).toHaveLength(3)
    expect(parsed.effects[0]?.applied).toBe(false)
    expect(parsed.effects[1]?.applied).toBe(true)
    expect(parsed.effects[0]?.affected[0]?.labelPath).toBe('section/13/2')
    expect(parsed.effects[0]?.affected[0]?.ref).toBe('section-13-2')
    expect(parsed.nextPageUrl).toBe(
      'http://www.legislation.gov.uk/changes/affected/ukpga/2020/1/data.feed?results-count=50&sort=modified&page=2',
    )
  })

  it('returns a null next page on the last page', () => {
    const parsed = parseEffectsFeed(
      '<feed xmlns="http://www.w3.org/2005/Atom"><entry><content><ukm:Effect xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata" Applied="true" EffectId="x"/></content></entry></feed>',
      'ukpga/2020/1',
    )
    expect(parsed.effects).toHaveLength(1)
    expect(parsed.nextPageUrl).toBeNull()
  })

  it('scopes Section URIs to the requested document', () => {
    expect(
      provisionLabelPathFromSectionUri(
        'http://www.legislation.gov.uk/id/ukpga/2020/1/section/13/2',
        'ukpga/2020/1',
      ),
    ).toBe('section/13/2')
    expect(
      provisionLabelPathFromSectionUri(
        'http://www.legislation.gov.uk/id/ukpga/2021/2/section/9',
        'ukpga/2020/1',
      ),
    ).toBeNull()
  })
})

describe('unappliedEffectsForProvision', () => {
  const parsed = parseEffectsFeed(feedPage1, 'ukpga/2020/1')

  it('matches the exact provision and ignores applied effects', () => {
    const hits = unappliedEffectsForProvision(parsed.effects, 'section/13/2')
    expect(hits.map((effect) => effect.effectId)).toEqual(['effect-1'])
    expect(unappliedEffectsForProvision(parsed.effects, 'section/7')).toEqual(
      [],
    )
  })

  it('withholds ancestors and descendants of an amended provision', () => {
    expect(
      unappliedEffectsForProvision(parsed.effects, 'section/13').map(
        (effect) => effect.effectId,
      ),
    ).toEqual(['effect-1'])
    expect(
      unappliedEffectsForProvision(parsed.effects, 'section/13/2/a').map(
        (effect) => effect.effectId,
      ),
    ).toEqual(['effect-1'])
  })

  it('matches schedule label paths', () => {
    expect(
      unappliedEffectsForProvision(
        parsed.effects,
        'schedule/2/paragraph/4',
      ).map((effect) => effect.effectId),
    ).toEqual(['effect-3'])
  })

  it('matches nothing for an unaffected provision', () => {
    expect(unappliedEffectsForProvision(parsed.effects, 'section/40')).toEqual(
      [],
    )
  })
})
