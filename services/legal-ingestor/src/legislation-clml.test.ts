import { describe, expect, it } from 'vitest'
import {
  formatContainerLabel,
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
  it('emits rows per addressable element in document order', () => {
    const parsed = parseClmlDocument(sampleClml, ref)
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    expect(parsed.identity).toBe('ukpga/2020/1')
    expect(parsed.title).toBe('Sample Act 2020')
    expect(parsed.extent).toBe('E+W')
    // The sample Schedule carries an IdURI, so the container emits too:
    // Act pages render Schedule rows as headings that carry their
    // paragraphs. The sample Pblock carries no IdURI and is not a row
    // (addressability is the row criterion everywhere).
    expect(parsed.provisions.map((provision) => provision.labelPath)).toEqual([
      'section/13',
      'section/13/2',
      'section/13/2/a',
      'schedule/2',
      'schedule/2/paragraph/4',
    ])
    expect(parsed.provisions.map((provision) => provision.label)).toEqual([
      's. 13',
      's. 13(2)',
      's. 13(2)(a)',
      'Schedule 2',
      'Sch. 2 para. 4',
    ])
    expect(parsed.provisions.map((provision) => provision.kind)).toEqual([
      'P1',
      'P2',
      'P3',
      'schedule',
      'P1',
    ])
    // Parents come from CLML nesting: the paragraph belongs to its
    // Schedule container even though its label path is not a prefix of
    // the paragraph's (schedule/2 vs schedule/2/paragraph/4 is a prefix
    // here; the real reason is inserted provisions, see the part-prefix
    // test below). Roots are sections not in any part or crossheading.
    expect(
      parsed.provisions.map((provision) => provision.parentLabelPath),
    ).toEqual([null, 'section/13', 'section/13/2', null, 'schedule/2'])
    // A container row's text is its heading; provisions keep descendant text.
    expect(parsed.provisions[3]?.text).toBe('Lists')
    expect(parsed.provisions[0]?.text).toBe(
      'Main duties apply. Duties extend to agents. Agents acting openly.',
    )
    // The declaration counts P1 opens (both are P1 here), not total rows:
    // P2/P3 sub-provisions are rows but never declared provisions, and the
    // Schedule container is not a P1 either.
    expect(parsed.declaredProvisions).toBe(2)
    expect(parsed.p1Seen).toBe(2)
    expect(parsed.p1Rows).toBe(2)
    expect(provisionCountNote(parsed)).toBeNull()
    // Nested text is included so a section row answers subsection terms.
    expect(parsed.provisions[1]?.text).toContain('Agents acting openly.')
    expect(
      parsed.provisions.map((provision, index) => provision.docOrder === index),
    ).toEqual([true, true, true, true, true])
  })

  it('emits Part, Chapter and crossheading containers with headings', () => {
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2" NumberOfProvisions="4" RestrictExtent="E+W">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Parts Act</dc:title></ukm:Metadata>
<Primary><Body>
<Pblock IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/crossheading/intro" id="crossheading-intro"><Title>Introduction</Title><P1group><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/section/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/section/1" id="section-1"><Pnumber>1</Pnumber><P1para><Text>First.</Text></P1para></P1></P1group></Pblock>
<Part DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/part/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/part/1" id="part-1"><Number><Strong>Part 1</Strong></Number><Title>Main duties</Title>
<Chapter DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/part/1/chapter/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/part/1/chapter/1" id="part-1-chapter-1"><Number>Chapter 1</Number><Title>Protected</Title>
<P1group><Title>Group heading, not a row</Title><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/section/2" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/section/2" id="section-2"><Pnumber>2</Pnumber><P1para><Text>Second.</Text></P1para></P1></P1group>
</Chapter>
<Pblock DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/part/1/crossheading/misc" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/part/1/crossheading/misc" id="part-1-crossheading-misc"><Title>Miscellaneous</Title><P1group><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/section/3" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/section/3" id="section-3"><Pnumber>3</Pnumber><P1para><Text>Third.</Text></P1para></P1></P1group></Pblock>
</Part>
</Body></Primary>
<Schedules><Schedule DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/schedule/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/schedule/1" id="schedule-1"><Number>SCHEDULE 1</Number><TitleBlock><Title>Scheduled</Title></TitleBlock><ScheduleBody>
<P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/2/schedule/1/paragraph/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/2/schedule/1/paragraph/1" id="schedule-1-paragraph-1"><Pnumber>1</Pnumber><P1para><Text>Scheduled matter.</Text></P1para></P1>
</ScheduleBody></Schedule></Schedules>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 2 })
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    const rows = parsed.provisions
    expect(rows.map((row) => [row.kind, row.labelPath])).toEqual([
      ['crossheading', 'crossheading/intro'],
      ['P1', 'section/1'],
      ['part', 'part/1'],
      ['chapter', 'part/1/chapter/1'],
      ['P1', 'section/2'],
      ['crossheading', 'part/1/crossheading/misc'],
      ['P1', 'section/3'],
      ['schedule', 'schedule/1'],
      ['P1', 'schedule/1/paragraph/1'],
    ])
    expect(rows.map((row) => row.label)).toEqual([
      'Introduction',
      's. 1',
      'Part 1',
      'Chapter 1',
      's. 2',
      'Miscellaneous',
      's. 3',
      'Schedule 1',
      'Sch. 1 para. 1',
    ])
    expect(rows.map((row) => row.text)).toEqual([
      'Introduction',
      'First.',
      'Main duties',
      'Protected',
      'Second.',
      'Miscellaneous',
      'Third.',
      'Scheduled',
      'Scheduled matter.',
    ])
    // Section 2 nests in Chapter 1 in the Part; section 3 sits under the
    // crossheading inside the Part; the P1group heading above section 2 is
    // not addressable and never becomes a row.
    expect(rows[4]?.parentLabelPath).toBe('part/1/chapter/1')
    expect(rows[6]?.parentLabelPath).toBe('part/1/crossheading/misc')
    expect(rows[3]?.parentLabelPath).toBe('part/1')
    expect(rows[5]?.parentLabelPath).toBe('part/1')
    expect(rows[8]?.parentLabelPath).toBe('schedule/1')
    // Document order interleaves containers with their content.
    expect(rows.map((row, index) => row.docOrder === index)).toEqual(
      rows.map(() => true),
    )
    // Census untouched by containers: all three sections and the schedule
    // paragraph are the four declared P1 opens.
    expect(parsed.p1Seen).toBe(4)
    expect(parsed.p1Rows).toBe(4)
    expect(provisionCountNote(parsed)).toBeNull()
  })

  it('keeps inserted provisions parented by nesting, not label prefixes', () => {
    // Base provisions carry flat IdURIs (section/100); inserted-amendment
    // lettered paragraphs carry hierarchical ones (part/2/section/100/kn1).
    // The parent of both is the innermost addressable ancestor in the XML.
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/3" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/3" NumberOfProvisions="1">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Insertion Act</dc:title></ukm:Metadata>
<Primary><Body><Part IdURI="http://www.legislation.gov.uk/id/ukpga/2020/3/part/2"><Number>Part 2</Number><Title>Duties</Title>
<P1group><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/3/section/100" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/3/section/100" id="section-100"><Pnumber>100</Pnumber><P1para><Text>Base text.</Text>
<P3 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/3/part/2/section/100/kn1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/3/part/2/section/100/kn1" id="part-2-section-100-kn1" shortId="section-100-k"><Pnumber>k</Pnumber><P3para><Text>Inserted paragraph.</Text></P3para></P3>
</P1para></P1></P1group></Part></Body></Primary>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 3 })
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    const rows = parsed.provisions
    expect(rows.map((row) => [row.kind, row.labelPath])).toEqual([
      ['part', 'part/2'],
      ['P1', 'section/100'],
      ['P3', 'part/2/section/100/kn1'],
    ])
    // The inserted P3 nests under the section that physically contains it,
    // never under the part even though its label path starts with part/2.
    expect(rows[2]?.parentLabelPath).toBe('section/100')
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

  it('stays quiet on the BlockAmendment-insert gap', () => {
    // Two P1 opens declared, one addressable: the bare P1 is a quoted
    // insert for another Act (no document IdURI, correctly never a row).
    // Real Acts look like this (ukpga/2020/7: 579 declared, 15 inserts),
    // so the fully-explained gap stores unflagged, it never fails the
    // document and never lands in the mismatch list.
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
    expect(parsed.p1BlockAmendment).toBe(1)
    expect(parsed.p1NoIdUriOther).toBe(0)
    expect(parsed.p1EmptyText).toBe(0)
    // The gap is fully explained by the quoted insert: quiet.
    expect(provisionCountNote(parsed)).toBeNull()
  })

  it('stays loud on a no-IdURI P1 outside BlockAmendment', () => {
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9" NumberOfProvisions="2">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Stray Act</dc:title></ukm:Metadata>
<Primary><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9/section/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9/section/1" id="section-1"><Pnumber>1</Pnumber><P1para><Text>Only row.</Text></P1para></P1></Primary>
<P1><Pnumber>i</Pnumber><P1para><Text>Stray insert, no BlockAmendment home.</Text></P1para></P1>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 9 })
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    expect(parsed.p1Seen).toBe(2)
    expect(parsed.p1BlockAmendment).toBe(0)
    expect(parsed.p1NoIdUriOther).toBe(1)
    expect(provisionCountNote(parsed)).toContain('outside BlockAmendment')
  })

  it('stays loud on an addressable P1 with no emitted row', () => {
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9" NumberOfProvisions="1">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Empty Act</dc:title></ukm:Metadata>
<Primary><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9/section/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9/section/1" id="section-1"><Pnumber>1</Pnumber><P1para></P1para></P1></Primary>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 9 })
    // No rows at all: the document-level skip fires before the census.
    expect(parsed).toEqual({
      skipped: 'no addressable provision text in data.xml',
    })
  })

  it('stays loud when an addressable P1 beside rows emits nothing', () => {
    const xml = `<?xml version="1.0"?>
<Legislation DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9" NumberOfProvisions="2">
<ukm:Metadata xmlns:ukm="x"><dc:title xmlns:dc="x">Half-empty Act</dc:title></ukm:Metadata>
<Primary><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9/section/1" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9/section/1" id="section-1"><Pnumber>1</Pnumber><P1para><Text>Kept.</Text></P1para></P1><P1 DocumentURI="http://www.legislation.gov.uk/ukpga/2020/9/section/2" IdURI="http://www.legislation.gov.uk/id/ukpga/2020/9/section/2" id="section-2"><Pnumber>2</Pnumber><P1para></P1para></P1></Primary>
</Legislation>`
    const parsed = parseClmlDocument(xml, { ...ref, year: 2020, number: 9 })
    if ('skipped' in parsed)
      throw new Error(`unexpected skip: ${parsed.skipped}`)
    expect(parsed.p1Seen).toBe(2)
    expect(parsed.p1Rows).toBe(1)
    expect(parsed.p1EmptyText).toBe(1)
    expect(provisionCountNote(parsed)).toContain('emitted no row')
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

describe('formatContainerLabel', () => {
  it('normalises upstream Number casing and keeps chapter verbatim forms', () => {
    expect(formatContainerLabel('part', 'Part 2', 'Duties', 'part/2')).toBe(
      'Part 2',
    )
    expect(
      formatContainerLabel('part', 'PART 6ZA', '', 'schedule/1/part/6ZA'),
    ).toBe('Part 6ZA')
    expect(
      formatContainerLabel(
        'chapter',
        'Chapter 1',
        'Protected',
        'part/1/chapter/1',
      ),
    ).toBe('Chapter 1')
    // ECHR-style schedules number chapters as "Article 2": the verbatim
    // published label wins over the forced prefix.
    expect(
      formatContainerLabel(
        'chapter',
        'Article 2',
        'Right to life',
        'schedule/1/part/I/chapter/1',
      ),
    ).toBe('Article 2')
    expect(
      formatContainerLabel('schedule', 'SCHEDULE 1', '', 'schedule/1'),
    ).toBe('Schedule 1')
    expect(
      formatContainerLabel(
        'crossheading',
        '',
        'Introduction',
        'crossheading/introduction',
      ),
    ).toBe('Introduction')
    expect(
      formatContainerLabel(
        'crossheading',
        '',
        '',
        'part/1/crossheading/general',
      ),
    ).toBe('General')
    expect(formatContainerLabel('schedule', '', '', 'schedule')).toBe(
      'Schedule',
    )
  })
})

describe('provisionCountNote', () => {
  const healthy = {
    p1Addressable: 1,
    p1BlockAmendment: 0,
    p1NoIdUriOther: 0,
    p1EmptyText: 0,
  }

  it('reports a missing declaration instead of staying silent', () => {
    expect(
      provisionCountNote({
        ...healthy,
        declaredProvisions: null,
        p1Seen: 1,
        p1Rows: 1,
      }),
    ).toBe('upstream declared no NumberOfProvisions')
  })

  it('reports tokenizer drift against the declaration', () => {
    expect(
      provisionCountNote({
        ...healthy,
        p1Addressable: 4,
        declaredProvisions: 5,
        p1Seen: 4,
        p1Rows: 4,
      }),
    ).toContain('tokenizer saw 4 P1 opens but upstream declared 5')
  })

  it('stays quiet when inserts explain the whole gap', () => {
    expect(
      provisionCountNote({
        declaredProvisions: 3,
        p1Seen: 3,
        p1Rows: 2,
        p1Addressable: 2,
        p1BlockAmendment: 1,
        p1NoIdUriOther: 0,
        p1EmptyText: 0,
      }),
    ).toBeNull()
  })
})
