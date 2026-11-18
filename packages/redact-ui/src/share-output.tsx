import { useState } from 'react'
import { Button } from '@obiter/ui'
import { ShareNetwork } from '@obiter/ui/icons'

export function ShareOutput({
  filename,
  ready,
  getBlob,
}: {
  filename: string
  ready: boolean
  getBlob: () => Blob | null
}) {
  const [status, setStatus] = useState('')
  if (
    typeof navigator === 'undefined' ||
    !navigator.share ||
    !navigator.canShare
  )
    return null

  async function share() {
    const blob = getBlob()
    if (!blob) return
    setStatus('')
    const file = new File([blob], filename, { type: blob.type })
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename })
        setStatus('Copy shared.')
      } else {
        setStatus('Download the copy to share it manually.')
      }
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Sharing cancelled.'
          : 'The copy could not be shared. Download it to share it manually.',
      )
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={!ready}
        onClick={() => void share()}
        iconStart={<ShareNetwork size={16} aria-hidden="true" />}
      >
        Share
      </Button>
      <span className="text-caption text-subtle" role="status">
        {status}
      </span>
    </>
  )
}
