import { useState, type FormEvent } from 'react'
import { feedbackRequestSchema } from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@obiter/ui'
import { apiFetch } from './api'
import { readDesktopBridge } from './lib/desktop-bridge'

declare const __OBITER_BUILD_COMMIT__: string | null

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState('problem')
  const [message, setMessage] = useState('')
  const [includePage, setIncludePage] = useState(true)
  const [state, setState] = useState<'editing' | 'sending' | 'sent'>('editing')
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (state === 'sending') return
    setState('sending')
    setError(null)
    const bridge = readDesktopBridge()
    const os =
      bridge?.osPlatform ??
      (/Mac/u.test(navigator.platform)
        ? 'macOS'
        : /Win/u.test(navigator.platform)
          ? 'Windows'
          : /Linux/u.test(navigator.platform)
            ? 'Linux'
            : 'other')
    try {
      const payload = feedbackRequestSchema.parse({
        kind,
        message,
        ...(includePage
          ? {
              path: window.location.pathname,
              appVersion:
                bridge?.shellVersion ??
                (typeof __OBITER_BUILD_COMMIT__ === 'string'
                  ? __OBITER_BUILD_COMMIT__
                  : 'development'),
              platform: `${bridge ? 'desktop' : 'web'} / ${os}`,
            }
          : {}),
      })
      await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setState('sent')
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not send feedback. Please try again.',
      )
      setState('editing')
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && state !== 'sending') onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>
          Tell us what went wrong or what could be clearer. Please leave out
          confidential information.
        </DialogDescription>
        {state === 'sent' ? (
          <div className="space-y-4">
            <p role="status">Thanks. We read every message.</p>
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <label className="block text-item">
              Kind
              <select
                aria-label="Kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="mt-1 block w-full rounded-md border border-line bg-raised p-2 text-ink focus-visible:outline-2 focus-visible:outline-ring"
              >
                <option value="problem">Problem</option>
                <option value="idea">Idea</option>
                <option value="question">Question</option>
              </select>
            </label>
            <label className="block text-item">
              Message
              <textarea
                required
                maxLength={4000}
                aria-label="Message"
                aria-describedby="feedback-count"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="mt-1 block min-h-36 w-full rounded-md border border-line bg-raised p-3 text-ink focus-visible:outline-2 focus-visible:outline-ring"
              />
            </label>
            <p
              id="feedback-count"
              className="text-right text-caption text-subtle"
            >
              {message.length} / 4,000
            </p>
            <label className="flex items-center gap-2 text-item">
              <input
                type="checkbox"
                checked={includePage}
                onChange={(event) => setIncludePage(event.target.checked)}
              />
              Include the page I'm on
            </label>
            <p className="text-caption text-subtle">
              Includes only the page path, app version and platform. No document
              text, filenames, matter names or selection contents.
            </p>
            {error ? (
              <p role="alert" className="text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={state === 'sending'}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!message.trim() || state === 'sending'}
              >
                {state === 'sending' ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
