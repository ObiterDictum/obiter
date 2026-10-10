import { execFileSync } from 'node:child_process'

import { parseDocx } from '../../packages/ooxml/src/parse'
import { sha256 } from './manifest'

/**
 * The Microsoft Word leg's evidence. `--word-output` alone proves nothing —
 * a renamed copy of the cycle-1 export would read as "checked" — so the
 * harness opens the supplied package and reads `docProps/app.xml`, the part
 * every Word save writes. Only the canonical Word producer string passes;
 * a byte-identical copy, an unparsable file, a missing part or a
 * non-Word producer (LibreOffice included) is rejected and recorded.
 */
export type WordEvidence = {
  status: 'checked' | 'rejected'
  producer: string | null
  appVersion: string | null
  inputSha256: string
  reason?: string
}

export type WordProbe =
  | { status: 'word-detected'; path: string }
  | { status: 'not-checked'; reason: string }

/** What Word writes as its extended-properties producer string. */
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

/**
 * Inspect the operator-supplied DOCX for evidence Microsoft Word saved it.
 * `known` holds the hashes of artifacts this run produced; a byte-identical
 * match cannot have passed through Word — a save rewrites app.xml at least.
 */
export async function inspectWordOutput(
  bytes: Uint8Array,
  known: { fixtureSha256: string; cycle1Sha256: string },
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
      'carries no docProps/app.xml — every Word save writes the ' +
        'extended-properties part, so this file was not produced by Word',
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
  return {
    status: 'checked',
    producer: producer.trim(),
    appVersion,
    inputSha256,
  }
}

/** The operator instructions file written while the Word leg is pending. */
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
    'input fixture and the cycle-1 export, and its docProps/app.xml must name',
    'Microsoft Office Word as the producer.',
    '',
    `Word probe on this machine: ${JSON.stringify(probe)}`,
    '',
  ].join('\n')
}
