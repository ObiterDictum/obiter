import { describe, expect, it } from 'vitest'
import { formatProvisionLabel, parseClmlDocument } from './legislation-clml'

const sampleClml = `<?xml version="1.0" encoding="utf-8"?>
<Legislation xmlns="http://www.legislation.gov.uk/namespaces/legislation" DocumentURI="http://www.legislation.gov.uk/ukpga/2020/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/1" NumberOfProvisions="3" RestrictExtent="E+W">
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
