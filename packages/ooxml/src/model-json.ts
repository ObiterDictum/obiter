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
  return parsed.data
}
