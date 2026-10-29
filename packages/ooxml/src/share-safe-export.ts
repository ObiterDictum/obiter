import type { OoxmlDocument } from './model'
import { serialiseDocx, cloneDocument } from './serialise'
import { planShareSafeCopy } from './share-safe-inventory'
import { refuseShareSafe, ShareSafeRefusal } from './share-safe-refusal'
import { applyShareSafePlan } from './share-safe-transform'
import { verifyShareSafePackage } from './share-safe-verify'

export { ShareSafeRefusal }

export async function buildShareSafeDocx(
  document: OoxmlDocument,
): Promise<Uint8Array> {
  const copy = cloneDocument(document)
  const plan = planShareSafeCopy(copy)
  try {
    applyShareSafePlan(copy, plan)
  } catch (error) {
    if (error instanceof ShareSafeRefusal) throw error
    refuseShareSafe(
      'unverifiable-output',
      'the sanitising transform could not be applied',
    )
  }
  const bytes = await serialiseDocx(copy)
  await verifyShareSafePackage(bytes)
  return bytes
}
