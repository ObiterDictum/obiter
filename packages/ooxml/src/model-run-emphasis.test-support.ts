import type { DocumentModelWire } from '@obiter/contracts'
import JSZip from 'jszip'

import { buildOoxmlFixture } from '../fixtures/builder'
import { parseDocx, serialiseDocx } from './index'

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const TAG: Record<string, string> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
}

export const FLAG_VALUE = {
  bold: { bold: true },
  italic: { italic: true },
  underline: { underline: true },
} as const

export async function load(paragraphXml: string) {
  const base = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const zip = await JSZip.loadAsync(base)
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="${WORD}"><w:body>${paragraphXml}</w:body></w:document>`,
  )
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
}

export async function save(document: Awaited<ReturnType<typeof parseDocx>>) {
  return parseDocx(await serialiseDocx(document))
}

export async function documentXml(
  document: Awaited<ReturnType<typeof parseDocx>>,
) {
  const zip = await JSZip.loadAsync(await serialiseDocx(document))
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('word/document.xml is missing.')
  return entry.async('string')
}

export function paragraphs(document: { model: DocumentModelWire }) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}

export function fragments(run: { preservedXmlFragments: string[] }) {
  return run.preservedXmlFragments.join('')
}

export function flag(run: { preservedXmlFragments: string[] }, name: string) {
  const tag = TAG[name] ?? name
  return new RegExp(`<w:${tag}\\b(?![^>]*w:val="0")`, 'u').test(fragments(run))
}
