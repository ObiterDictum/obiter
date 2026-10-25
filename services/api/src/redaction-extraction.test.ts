import { expect, it } from 'bun:test'
import JSZip from 'jszip'
import { createSyntheticDocx } from '@obiter/ooxml'
import { extractDocumentContent } from './document-extraction'
import { extractRedactionContent } from './redaction-extraction'

it('keeps dev matter extraction while Redact separates deleted text and exposes comments', async () => {
  const zip = await JSZip.loadAsync(await createSyntheticDocx(['fixture']))
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  zip.file('word/document.xml', `<w:document xmlns:w="${w}"><w:body><w:p><w:del w:id="1"><w:r><w:delText>Old Client Name</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>New Client</w:t></w:r></w:ins></w:p></w:body></w:document>`)
  zip.file('word/comments.xml', `<w:comments xmlns:w="${w}"><w:comment w:id="0"><w:p><w:r><w:t>Private review note</w:t></w:r></w:p></w:comment></w:comments>`)
  const bytes = Buffer.from(await zip.generateAsync({type: 'uint8array'}))
  // Literal dev oracle: Mammoth reads insertions, omits deletions and comments,
  // and retains its trailing paragraph separator.
  expect((await extractDocumentContent('docx', bytes)).text).toBe('New Client\n\n')
  const reviewed = (await extractRedactionContent('docx', bytes)).text
  expect(reviewed).toBe('[Deleted text]\n\nOld Client Name\n\n[End deleted text]\n\nNew Client\n\n[Comment 0] Private review note')
})
