import JSZip from 'jszip'

import {
  commentsXml,
  contentTypesXml,
  documentRelationshipsXml,
  documentXml,
  endnotesXml,
  fixedPngBytes,
  footnotesXml,
  multiLevelListDocumentXml,
  numberingXml,
  opaqueXmlParts,
  relationshipsXml,
  rootRelationshipsXml,
  storyXml,
  stylesXml,
} from './fixture-parts'
import { ooxmlFixtureManifest, type OoxmlFixtureName } from './manifest'

const FIXED_DATE = new Date('2026-08-10T00:00:00.000Z')
const IMAGE_RELATIONSHIP = ['rId1', 'image', 'media/image1.png'] as const

export async function buildOoxmlFixture(name: OoxmlFixtureName) {
  const fixture = ooxmlFixtureManifest.find(
    (candidate) => candidate.name === name,
  )
  if (!fixture) throw new Error('Unknown OOXML fixture')
  const zip = new JSZip()
  const sourceDocumentXml =
    fixture.name === 'multi-level-list'
      ? multiLevelListDocumentXml
      : documentXml
  const fixedDocumentXml = fixture.hasW14Ids
    ? sourceDocumentXml
    : sourceDocumentXml.replace(/ w14:(?:paraId|textId)="[^"]+"/gu, '')

  const xmlParts: Readonly<Record<string, string>> = {
    '[Content_Types].xml': contentTypesXml,
    '_rels/.rels': rootRelationshipsXml,
    'word/document.xml': fixedDocumentXml,
    'word/_rels/document.xml.rels': documentRelationshipsXml,
    'word/styles.xml': stylesXml,
    'word/numbering.xml': numberingXml,
    'word/header1.xml': storyXml('hdr', 'Alice Example first header'),
    'word/header2.xml': storyXml('hdr', 'Jane Example second header'),
    'word/footer1.xml': storyXml('ftr', 'First footer'),
    'word/footer2.xml': storyXml('ftr', 'Second footer'),
    'word/footnotes.xml': footnotesXml,
    'word/endnotes.xml': endnotesXml,
    'word/comments.xml': commentsXml,
    'word/_rels/header1.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    'word/_rels/header2.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    'word/_rels/footer1.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    'word/_rels/footer2.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    'word/_rels/footnotes.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    'word/_rels/endnotes.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    'word/_rels/comments.xml.rels': relationshipsXml(...IMAGE_RELATIONSHIP),
    ...opaqueXmlParts,
  }

  for (const [partName, source] of Object.entries(xmlParts)) {
    zip.file(partName, source, { date: FIXED_DATE })
  }
  zip.file('word/media/image1.png', fixedPngBytes, {
    binary: true,
    date: FIXED_DATE,
  })

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}
