import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'

export function textParagraph(
  id: string,
  text = 'text',
  xml: string[] = [],
): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: xml }],
    preservedXmlFragments: [],
  }
}

export function bodyStory(
  paragraphs: DocumentParagraphWire[],
): DocumentStoryWire {
  return {
    partName: 'word/document.xml',
    kind: 'document',
    paragraphs,
    preservedXmlFragments: [],
    fields: [],
    unanchoredFieldParagraphIds: [],
  }
}

export function wireModel(
  paragraphs: DocumentParagraphWire[],
  stories: DocumentStoryWire[] = [bodyStory(paragraphs)],
): DocumentModelWire {
  return {
    version: 1,
    stories,
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}
