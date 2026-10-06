import { createBlankDocx } from '@obiter/ooxml'

export async function blankDocumentFile() {
  const bytes = await createBlankDocx()
  return new File([new Uint8Array(bytes)], 'Untitled.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
