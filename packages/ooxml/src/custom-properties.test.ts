import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import { parseDocx, serialiseDocx, writeDocumentMarkings } from './index'

const CUSTOM_REL =
  '<Relationship Id="rIdCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="/docProps/custom.xml"/>'

/**
 * The fixture ships `docProps/custom.xml` without the `_rels/.rels`
 * declaration that would make it the custom-properties part. Declaring it is
 * the realistic shape; the package is otherwise untouched.
 */
async function withDeclaredCustomProperties(customXml?: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const rels = zip.file('_rels/.rels')
  if (!rels) throw new Error('Fixture part is missing.')
  zip.file(
    '_rels/.rels',
    (await rels.async('string')).replace(
      '</Relationships>',
      `${CUSTOM_REL}</Relationships>`,
    ),
  )
  if (customXml !== undefined) zip.file('docProps/custom.xml', customXml)
  return zip.generateAsync({ type: 'uint8array' })
}

function customPart(properties: string) {
  return `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${properties}</Properties>`
}

function property(pid: number, name: string, value: string) {
  return `<property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="${pid}" name="${name}">${value}</property>`
}

describe('document markings in docProps/custom.xml', () => {
  it('reads empty markings when no part is declared', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    expect(document.model.markings).toEqual({
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    })
  })

  it('reads markings and preserves an unknown document kind', async () => {
    const document = await parseDocx(
      await withDeclaredCustomProperties(
        customPart(
          property(
            2,
            'obiter.documentKind',
            '<vt:lpwstr>externally-authored-kind</vt:lpwstr>',
          ) + property(3, 'obiter.privileged', '<vt:bool>true</vt:bool>'),
        ),
      ),
    )
    expect(document.model.markings).toEqual({
      documentKind: 'externally-authored-kind',
      draft: false,
      privileged: true,
      withoutPrejudice: false,
    })
  })

  it('round-trips markings through serialise and re-parse', async () => {
    const document = await parseDocx(await withDeclaredCustomProperties())
    writeDocumentMarkings(document, {
      documentKind: 'particulars',
      draft: true,
      privileged: true,
      withoutPrejudice: false,
    })
    const reparsed = await parseDocx(await serialiseDocx(document))
    expect(reparsed.model.markings).toEqual({
      documentKind: 'particulars',
      draft: true,
      privileged: true,
      withoutPrejudice: false,
    })
  })

  it('creates the part, relationship and content type when absent', async () => {
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    zip.remove('docProps/custom.xml')
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    writeDocumentMarkings(document, {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: true,
    })
    const out = await JSZip.loadAsync(await serialiseDocx(document))
    const custom = await out.file('docProps/custom.xml')?.async('string')
    expect(custom).toContain('obiter.withoutPrejudice')
    const rels = await out.file('_rels/.rels')?.async('string')
    expect(rels).toContain('relationships/custom-properties')
    const types = await out.file('[Content_Types].xml')?.async('string')
    expect(types).toContain('custom-properties+xml')
  })

  it('leaves foreign properties untouched when writing markings', async () => {
    const document = await parseDocx(
      await withDeclaredCustomProperties(
        customPart(
          property(2, 'dms.matterRef', '<vt:lpwstr>DMS-44</vt:lpwstr>') +
            property(3, 'obiter.draft', '<vt:bool>false</vt:bool>'),
        ),
      ),
    )
    writeDocumentMarkings(document, {
      documentKind: 'letter',
      draft: true,
      privileged: false,
      withoutPrejudice: false,
    })
    const bytes = await serialiseDocx(document)
    const out = await JSZip.loadAsync(bytes)
    const custom = await out.file('docProps/custom.xml')?.async('string')
    expect(custom).toContain('dms.matterRef')
    expect(custom).toContain('DMS-44')
    const reparsed = await parseDocx(bytes)
    expect(reparsed.model.markings.documentKind).toBe('letter')
    expect(reparsed.model.markings.draft).toBe(true)
  })

  it('reads an empty kind string as unset', async () => {
    const document = await parseDocx(
      await withDeclaredCustomProperties(
        customPart(
          property(2, 'obiter.documentKind', '<vt:lpwstr>  </vt:lpwstr>'),
        ),
      ),
    )
    expect(document.model.markings.documentKind).toBeNull()
  })

  it('adopts an undeclared custom.xml file, keeping its foreign properties', async () => {
    // The raw fixture ships the file with no `_rels/.rels` declaration: the
    // write declares the existing part rather than discarding its contents
    // or shadowing it with a second part.
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    writeDocumentMarkings(document, {
      documentKind: 'order',
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    })
    const bytes = await serialiseDocx(document)
    const reparsed = await parseDocx(bytes)
    expect(reparsed.model.markings.documentKind).toBe('order')
    const out = await JSZip.loadAsync(bytes)
    const rels = await out.file('_rels/.rels')?.async('string')
    expect(rels?.match(/relationships\/custom-properties/gu)).toHaveLength(1)
  })

  it('does not duplicate the declaration on a second write', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    writeDocumentMarkings(document, {
      documentKind: 'order',
      draft: true,
      privileged: false,
      withoutPrejudice: false,
    })
    writeDocumentMarkings(document, {
      documentKind: 'order',
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    })
    const bytes = await serialiseDocx(document)
    const reparsed = await parseDocx(bytes)
    expect(reparsed.model.markings.draft).toBe(false)
    const out = await JSZip.loadAsync(bytes)
    const rels = await out.file('_rels/.rels')?.async('string')
    expect(rels?.match(/relationships\/custom-properties/gu)).toHaveLength(1)
  })

  it('refuses a duplicate marking property rather than picking a winner', async () => {
    await expect(
      parseDocx(
        await withDeclaredCustomProperties(
          customPart(
            property(2, 'obiter.draft', '<vt:bool>true</vt:bool>') +
              property(3, 'obiter.draft', '<vt:bool>false</vt:bool>'),
          ),
        ),
      ),
    ).rejects.toThrow()
  })
})
