import { documentModelWireSchema } from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument } from './model'

export function serialiseModelJson(document: OoxmlDocument) {
  try {
    return JSON.stringify(
      documentModelWireSchema.strict().parse(document.model),
    )
  } catch {
    throw new OoxmlError('serialisation-failed')
  }
}

export function parseModelJson(json: string) {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new OoxmlError('invalid-model-json')
  }

  const parsed = documentModelWireSchema.safeParse(value)
  if (!parsed.success) throw new OoxmlError('invalid-model-json')
  // Live clients tolerate older API wires; stored projections must regenerate
  // source-ordered segments rather than keep losing nested revision text.
  if (
    parsed.data.changes.some(
      (change) => change.inlinePosition && !change.inlinePosition.segments,
    )
  )
    throw new OoxmlError('invalid-model-json')
  if (
    parsed.data.stories.some((story) =>
      story.paragraphs.some((paragraph) =>
        paragraph.runs.some(
          (run) =>
            run.textRevisionEligible === undefined ||
            (!run.textRevisionEligible &&
              (!run.textRevisionTokens ||
                run.textRevisionTextRanges === undefined)),
        ),
      ),
    )
  )
    throw new OoxmlError('invalid-model-json')
  return parsed.data
}
