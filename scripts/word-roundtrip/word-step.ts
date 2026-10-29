import { execFileSync } from 'node:child_process'

import { parseDocx } from '../../packages/ooxml/src/parse'
import { sha256 } from './manifest'
import { documentBodyText } from './summary'

export type WordEvidence =
  | {
      status: 'rejected'
      producer: string | null
      appVersion: string | null
      inputSha256: string
      reason: string
    }
  | {
      status: 'observed-producer-evidence'
      producer: string
      appVersion: string | null
      inputSha256: string
    }

export type WordRecord =
  | {
      status: 'rejected'
      reason: string
      claimedVersion: string
      observedProducer: string | null
      observedAppVersion: string | null
      inputSha256: string
      correlatedWith: { artifact: string; sha256: string }
    }
  | {
      status: 'manual-reported'
      verification: 'externally-unverified'
      claimedVersion: string
      observedProducer: string
      observedAppVersion: string | null
      inputSha256: string
      correlatedWith: { artifact: string; sha256: string }
      limits: string
    }

export type WordProbe =
  | { status: 'word-detected'; path: string }
  | { status: 'not-checked'; reason: string }

export type WordAcceptance = 'not-checked' | 'checked'

const WORD_PRODUCER = /^microsoft office word$/i

export function detectWord(): WordProbe {
  if (process.platform === 'win32') {
    for (const command of ['WINWORD.EXE', 'winword']) {
      try {
        const found = execFileSync('where', [command], { encoding: 'utf8' })
        if (found.trim()) return { status: 'word-detected', path: found.trim() }
      } catch {
        /* not on PATH */
      }
    }
  } else if (process.platform === 'darwin') {
    try {
      const found = execFileSync(
        'mdfind',
        ['kMDItemCFBundleIdentifier == "com.microsoft.Word"'],
        { encoding: 'utf8' },
      )
      if (found.trim()) return { status: 'word-detected', path: found.trim() }
    } catch {
      /* no Word */
    }
  }
  for (const command of ['libreoffice', 'soffice']) {
    try {
      execFileSync('which', [command], { stdio: 'pipe' })
      return {
        status: 'not-checked',
        reason: `Only ${command} was found; LibreOffice is not Microsoft Word and does not satisfy the gate.`,
      }
    } catch {
      /* continue */
    }
  }
  return {
    status: 'not-checked',
    reason: 'No Microsoft Word installation is reachable on this machine.',
  }
}

export async function inspectWordOutput(
  bytes: Uint8Array,
  known: {
    fixtureSha256: string
    cycle1Sha256: string
    cycle1BodyText: string
  },
): Promise<WordEvidence> {
  const inputSha256 = sha256(bytes)
  const reject = (
    reason: string,
    producer: string | null = null,
  ): WordEvidence => ({
    status: 'rejected',
    producer,
    appVersion: null,
    inputSha256,
    reason,
  })

  if (inputSha256 === known.fixtureSha256) {
    return reject(
      'byte-identical to the synthetic input fixture — Word never wrote this file',
    )
  }
  if (inputSha256 === known.cycle1Sha256) {
    return reject(
      'byte-identical to the cycle-1 Obiter export — Word never wrote this file',
    )
  }

  let doc: Awaited<ReturnType<typeof parseDocx>>
  try {
    doc = await parseDocx(bytes)
  } catch {
    return reject('not a DOCX package the pipeline can parse')
  }
  const appPart = doc.sourceParts.get('docProps/app.xml')
  if (!appPart) {
    return reject(
      'carries no docProps/app.xml — Word desktop writes the ' +
        'extended-properties part on save, so its absence is evidence ' +
        'against a Word save',
    )
  }
  const xml = new TextDecoder().decode(appPart.originalPayload)
  const producer = /<Application>([^<]*)<\/Application>/.exec(xml)?.[1] ?? null
  const appVersion = /<AppVersion>([^<]*)<\/AppVersion>/.exec(xml)?.[1] ?? null
  if (producer === null) {
    return reject('docProps/app.xml names no <Application> producer')
  }
  if (!WORD_PRODUCER.test(producer.trim())) {
    return reject(
      `docProps/app.xml declares producer "${producer}", not Microsoft ` +
        'Office Word — LibreOffice, Word Online and other producers do not ' +
        'satisfy the acceptance gate',
      producer,
    )
  }
  if (documentBodyText(doc) !== known.cycle1BodyText) {
    return reject(
      'names Microsoft Office Word but its body text does not match the ' +
        'cycle-1 export — an unrelated document, not this document saved ' +
        'by Word',
      producer.trim(),
    )
  }
  return {
    status: 'observed-producer-evidence',
    producer: producer.trim(),
    appVersion,
    inputSha256,
  }
}

export function wordRecord(
  evidence: WordEvidence,
  claimedVersion: string,
  correlatedWith: { artifact: string; sha256: string },
): WordRecord {
  if (evidence.status === 'rejected') {
    return {
      status: 'rejected',
      reason: evidence.reason,
      claimedVersion,
      observedProducer: evidence.producer,
      observedAppVersion: evidence.appVersion,
      inputSha256: evidence.inputSha256,
      correlatedWith,
    }
  }
  return {
    status: 'manual-reported',
    verification: 'externally-unverified',
    claimedVersion,
    observedProducer: evidence.producer,
    observedAppVersion: evidence.appVersion,
    inputSha256: evidence.inputSha256,
    correlatedWith,
    limits:
      'docProps/app.xml is operator-mutable metadata: it is evidence ' +
      'consistent with a Word save, not verification of one. The release ' +
      'gate needs recorded external evidence — open without repair, save, ' +
      'visual comparison — which this run cannot produce.',
  }
}

export function wordStepInstructions(probe: WordProbe): string {
  return [
    '# Microsoft Word step (manual)',
    '',
    'The Obiter side of the round-trip is complete. To run the Word leg:',
    '',
    '1. Open `cycle-1-obiter-export.docx` in a licensed Microsoft Word',
    '   (Windows or macOS desktop — not Word Online, not LibreOffice).',
    '2. Confirm the document opens without a repair prompt. Note headings,',
    '   lists, tables, images, headers/footers, footnotes and tracked marks.',
    '3. Use File > Save As to write `word-saved.docx` into this directory.',
    '4. Re-run this harness with:',
    '     --word-output <this dir>/word-saved.docx \\',
    '     --word-version "<Word product/version string>"',
    '',
    'The harness checks the file it is given: it must differ from both the',
    'input fixture and the cycle-1 export, carry the same body text as the',
    'cycle-1 export, and its docProps/app.xml must name Microsoft Office',
    'Word as the producer. That is evidence, not proof: app.xml is editable,',
    'so the manifest records the observed producer and keeps the release',
    'gate at not-checked. A real run also records the operator observation —',
    'open without a repair prompt and a visual comparison — in the PR.',
    '',
    `Word probe on this machine: ${JSON.stringify(probe)}`,
    '',
  ].join('\n')
}
