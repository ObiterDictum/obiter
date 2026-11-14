import { useState } from 'react'
import { Button } from '@obiter/ui'

export function BackupCodesPanel({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
    } catch {}
  }

  function downloadCodes() {
    const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'obiter-backup-codes.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex max-w-[480px] flex-col gap-3">
      <p className="text-meta text-muted">
        Store these backup codes somewhere safe. Each one works once if you lose
        access to your authenticator app.
      </p>
      <ul className="grid grid-cols-2 gap-1 rounded-md border border-line bg-raised p-3 font-mono text-meta text-ink">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={copyCodes}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={downloadCodes}
        >
          Download (.txt)
        </Button>
      </div>
    </div>
  )
}
