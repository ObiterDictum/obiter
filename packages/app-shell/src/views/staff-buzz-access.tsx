import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  buttonClassName,
  useToast,
} from '@obiter/ui'
import { CopySimple } from '@obiter/ui/icons'
import {
  staffBuzzKeyInputSchema,
  type StaffBuzzInviteResponse,
} from '@obiter/contracts'
import { ApiError } from '../api'
import { formatDate } from '../format'
import {
  staffBuzzInviteMutationOptions,
  staffBuzzKeyMutationOptions,
  staffBuzzUnlinkMutationOptions,
} from '../staff'
import { shortNpub } from '../staff-buzz-data'
import { ErrorNotice, SectionHeading } from './settings-fields'

const UNAVAILABLE_MESSAGE = 'Buzz is unavailable right now. Try again later.'

export function JoinWorkspace({
  notMember,
  onCheckAgain,
}: {
  notMember: boolean
  onCheckAgain: () => void
}) {
  const invite = useMutation(staffBuzzInviteMutationOptions())
  const [created, setCreated] = useState<StaffBuzzInviteResponse | null>(null)
  const { toast } = useToast()

  async function copy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      toast({ title: 'Copied' })
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Check clipboard permissions and try again.',
      })
    }
  }

  return (
    <section
      aria-labelledby="buzz-invite-heading"
      className="flex flex-col gap-4"
    >
      <SectionHeading
        id="buzz-invite-heading"
        title="Join the workspace"
        description="A single-use invite to the Obiter workspace on Buzz. It lasts seven days."
      />
      {notMember ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-meta text-muted">
            Your key is saved, but you haven't joined Buzz with your invite yet.
          </p>
          <Button variant="secondary" onClick={onCheckAgain}>
            Check again
          </Button>
        </div>
      ) : null}
      <div>
        <Button
          loading={invite.isPending}
          onClick={() => invite.mutate(undefined, { onSuccess: setCreated })}
        >
          Get an invite
        </Button>
      </div>
      {invite.isError ? (
        <ErrorNotice
          message={
            invite.error instanceof ApiError &&
            invite.error.code === 'buzz_unavailable'
              ? UNAVAILABLE_MESSAGE
              : 'Could not create an invite. Try again.'
          }
        />
      ) : null}
      {created ? (
        <div className="flex max-w-[560px] flex-col gap-2">
          <Input
            label="Invite link"
            readOnly
            value={created.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              Copy
            </Button>
            <a
              href={created.url}
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              Open
            </a>
          </div>
          <p className="text-caption text-subtle">
            Expires {formatDate(created.expiresAt)}
          </p>
          <p className="text-meta text-muted">
            Open it with the Buzz app installed to join the Obiter workspace.
          </p>
        </div>
      ) : null}
    </section>
  )
}

export function LinkKey() {
  const link = useMutation(staffBuzzKeyMutationOptions())
  const [npub, setNpub] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = staffBuzzKeyInputSchema.safeParse({ npub })
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          'Paste the npub from your Buzz profile.',
      )
      return
    }
    setError(null)
    link.mutate(parsed.data, {
      onError: (cause) =>
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not link that key. Try again.',
        ),
    })
  }

  return (
    <section aria-labelledby="buzz-key-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="buzz-key-heading"
        title="Link your key"
        description="Paste the npub from your Buzz profile to link this account."
      />
      <form
        className="flex max-w-[560px] flex-col items-start gap-3"
        onSubmit={submit}
      >
        <div className="w-full">
          <Input
            label="npub"
            value={npub}
            onChange={(event) => setNpub(event.target.value)}
            helperText="Copy it from your profile in Buzz"
            error={error ?? undefined}
          />
        </div>
        <Button type="submit" loading={link.isPending}>
          Link
        </Button>
      </form>
    </section>
  )
}

export function LinkedKey({ npub }: { npub: string }) {
  const unlink = useMutation(staffBuzzUnlinkMutationOptions())
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(npub)
      toast({ title: 'Copied' })
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Check clipboard permissions and try again.',
      })
    }
  }

  async function confirmUnlink() {
    setError(null)
    try {
      await unlink.mutateAsync()
      setConfirming(false)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not unlink that key. Try again.',
      )
    }
  }

  return (
    <section aria-labelledby="buzz-key-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="buzz-key-heading"
        title="Your key"
        description="Your Buzz identity, linked to this Obiter account."
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-meta text-ink" title={npub}>
          {shortNpub(npub)}
        </span>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Copy ${npub}`}
          iconStart={<CopySimple size={16} aria-hidden />}
          onClick={() => void copy()}
        >
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Unlink
        </Button>
      </div>
      {confirming ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !unlink.isPending) setConfirming(false)
          }}
        >
          <DialogContent size="sm">
            <DialogTitle>Unlink Buzz key?</DialogTitle>
            <DialogDescription>
              Your Buzz agents stop reaching you until you link a key again.
            </DialogDescription>
            {error ? <ErrorNotice message={error} /> : null}
            <div className="mt-6 flex justify-end gap-2">
              <DialogClose
                render={
                  <Button variant="ghost" disabled={unlink.isPending}>
                    Cancel
                  </Button>
                }
              />
              <Button
                variant="danger"
                loading={unlink.isPending}
                onClick={() => void confirmUnlink()}
              >
                Unlink key
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  )
}
