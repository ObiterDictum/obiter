import { createBlankDocx } from '@obiter/ooxml'

export async function blankDocumentFile(name: string) {
  const bytes = await createBlankDocx()
  return new File([new Uint8Array(bytes)], `${name}.docx`, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}
