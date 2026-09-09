import { describe, expect, it } from 'vitest'
import {
  formatProvisionLabel,
  parseClmlDocument,
  provisionCountNote,
} from './legislation-clml'

const sampleClml = `<?xml version="1.0" encoding="utf-8"?>
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation" DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1" NumberOfProvisions="2" RestrictExtent="E+W">
<ukm:Metadata xmlns:ukm="http://www.legislation.gov.uk/namespaces/metadata"><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Sample Act 2020</dc:title></ukm:Metadata>
<Primary><Pblock><Title>General</Title>
<P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1/section/13" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1/section/13" id="section-13"><Pnumber>13</Pnumber><P1para><Text>Main duties apply.</Text></P1para>
<P2 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1/section/13/2" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1/section/13/2" id="section-13-2"><Pnumber>2</Pnumber><P2para><Text>Duties extend to agents.</Text>
<P3 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1/section/13/2/a" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1/section/13/2/a" id="section-13-2-a"><Pnumber>a</Pnumber><P3para><Text>Agents acting openly.</Text></P3para></P3>
</P2para></P2>
</P1>
</Pblock></Primary>
<Schedules><Schedule DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1/schedule/2" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1/schedule/2" id="schedule-2"><Number>2</Number><Title>Lists</Title><ScheduleBody>
<P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1/schedule/2/paragraph/4" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1/schedule/2/paragraph/4" id="schedule-2-paragraph-4"><Pnumber>4</Pnumber><P1para><Text>Listed matters.</Text></P1para></P1>
</ScheduleBody></Schedule></Schedules>
</Legislation>`

const ref = {
  actType: 'ukpga',
  year: 2020,
  number: 1,
  title: 'Sample Act 2020',
}

describe('parseClmlDocument', () => {
  it('emits one row per addressable provision in document order', () => {
    const parsed = parseClmlDocument(sampleClml, ref)
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    expect(parsed.identity).toBe('ukpga/2020/1')
    expect(parsed.title).toBe('Sample Act 2020')
    expect(parsed.extent).toBe('E+W')
    expect(parsed.provisions.map((provision) => provision.labelPath)).toEqual([
      'section/13',
      'section/13/2',
      'section/13/2/a',
      'schedule/2/paragraph/4',
    ])
    expect(parsed.provisions.map((provision) => provision.label)).toEqual([
      's. 13',
      's. 13(2)',
      's. 13(2)(a)',
      'Sch. 2 para. 4',
    ])
    expect(parsed.provisions[0]?.text).toBe(
      'Main duties apply. Duties extend to agents. Agents acting openly.',
    )
    // The declaration counts P1 opens (both are P1 here), not total rows:
    // P2/P3 sub-provisions are rows but never declared provisions.
    expect(parsed.declaredProvisions).toBe(2)
    expect(parsed.p1Seen).toBe(2)
    expect(parsed.p1Rows).toBe(2)
    expect(provisionCountNote(parsed)).toBeNull()
    // Nested text is included so a section row answers subsection terms.
    expect(parsed.provisions[1]?.text).toContain('Agents acting openly.')
    expect(
      parsed.provisions.map((provision, index) => provision.docOrder === index),
    ).toEqual([true, true, true, true])
  })

  it('skips documents without the expected identity', () => {
    const parsed = parseClmlDocument('<Legislation></Legislation>', ref)
    expect(parsed).toEqual({
      skipped: 'data.xml does not carry this Act identity',
    })
  })

  it('strips comments whole, even with > inside', () => {
    // The old tag regex stopped at the first `>`, leaving ` comment -->`
    // residue in the text. Comments arrive in character data (the tag
    // tokenizer does not match `<!--`), so the stripper must skip them.
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9" NumberOfProvisions="1">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Comment Act</dc:title></ukm:Metadata>
<P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9/section/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9/section/1" id="section-1"><Pnumber>1</Pnumber><P1para><Text>Kept <!-- a > comment --> text.</Text></P1para></P1>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 9 })
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    expect(parsed.provisions[0]?.text).toBe('Kept text.')
  })

  it('flags the BlockAmendment-insert gap instead of failing', () => {
    // Two P1 opens declared, one addressable: the bare P1 is a quoted
    // insert for another Act (no document IdURI, correctly never a row).
    // Real Acts look like this (ukpga/2020/7: 579 declared, 15 inserts),
    // so the gap stores flagged, it never fails the document.
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9" NumberOfProvisions="2">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Gap Act</dc:title></ukm:Metadata>
<Primary><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9/section/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9/section/1" id="section-1"><Pnumber>1</Pnumber><P1para><Text>Only row.</Text></P1para></P1></Primary>
<BlockAmendment><P1><Pnumber>i</Pnumber><P1para><Text>Quoted insert, not this Act.</Text></P1para></P1></BlockAmendment>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 9 })
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    expect(parsed.provisions).toHaveLength(1)
    expect(parsed.declaredProvisions).toBe(2)
    expect(parsed.p1Seen).toBe(2)
    expect(parsed.p1Rows).toBe(1)
    expect(provisionCountNote(parsed)).toContain('1 P1 without an emitted row')
  })
})

describe('formatProvisionLabel', () => {
  it('formats sections, subsections, and schedules', () => {
    expect(formatProvisionLabel('section/6', '6')).toBe('s. 6')
    expect(formatProvisionLabel('section/13/2/a', 'a')).toBe('s. 13(2)(a)')
    expect(formatProvisionLabel('schedule/2/paragraph/4', '4')).toBe(
      'Sch. 2 para. 4',
    )
  })
})

describe('provisionCountNote', () => {
  it('reports a missing declaration instead of staying silent', () => {
    expect(
      provisionCountNote({ declaredProvisions: null, p1Seen: 1, p1Rows: 1 }),
    ).toBe('upstream declared no NumberOfProvisions')
  })

  it('reports tokenizer drift against the declaration', () => {
    expect(
      provisionCountNote({ declaredProvisions: 5, p1Seen: 4, p1Rows: 4 }),
    ).toContain('tokenizer saw 4 P1 opens but upstream declared 5')
  })
})
