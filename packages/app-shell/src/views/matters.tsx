import { Link } from '@tanstack/react-router'
import { Folders, Plus } from '@phosphor-icons/react'
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Input,
  Skeleton,
  useToast,
} from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useState, type FormEvent } from 'react'
import {
  mattersListQueryOptions,
  useCreateMatter,
  useMattersList,
  type CreateMatterInput,
} from '../matters'

/**
 * Matters list — backed by GET /api/matters via TanStack Query. Loading, empty,
 * and error states use @obiter/ui (Skeleton, EmptyState). Matter creation posts
 * to the real API and appears in the list via cache invalidation.
 */
export function MattersRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const list = useMattersList()
  const data = list.data ?? []

  const showError =
    list.isError && !list.isLoading
      ? 'Matters could not be loaded. Check your connection and try again.'
      : null

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 sm:px-6">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold text-ink">Matters</h1>
          <p className="text-xs text-muted">
            Private workspaces for documents, review, and artifacts
          </p>
        </div>
        <CreateMatterDialog />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showError ? (
          <div className="p-6">
            <EmptyState title="Couldn’t load matters" body={showError} />
          </div>
        ) : list.isLoading ? (
          <MattersListSkeleton />
        ) : data.length > 0 ? (
          <section aria-label="Matters">
            <p className="px-5 pb-1 pt-3 text-[11px] font-medium tracking-wide text-muted sm:px-6">
              {data.length} {data.length === 1 ? 'matter' : 'matters'}
            </p>
            <ul className="flex flex-col gap-0.5 px-2 pb-4 sm:px-3">
              {data.map((matter) => (
                <li key={matter.id}>
                  <Link
                    to="/matters/$matterId"
                    params={{ matterId: matter.id }}
                    className="group flex items-center justify-between gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-raised"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-medium text-ink">
                        {matter.name}
                      </strong>
                      <small className="mt-0.5 block truncate text-[11px] text-muted">
                        {matter.clientReference || 'No reference'}
                        {matter.primaryJurisdiction
                          ? ` · ${matter.primaryJurisdiction}`
                          : ''}
                      </small>
                    </span>
                    <Badge
                      tone={matter.status === 'active' ? 'success' : 'neutral'}
                    >
                      {matter.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={<Folders aria-hidden="true" size={24} weight="regular" />}
              title="No matters yet"
              body="Create your first matter to start organising legal documents, review state, and artifacts."
              action={<CreateMatterDialog trigger="Create your first matter" />}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MattersListSkeleton() {
  return (
    <section
      className="flex flex-col gap-0.5 px-2 pt-3 sm:px-3"
      aria-busy="true"
      aria-label="Loading matters"
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 rounded-md px-3 py-2.5"
        >
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </span>
          <Skeleton className="h-5 w-14 rounded-md" />
        </div>
      ))}
    </section>
  )
}

function CreateMatterDialog({
  trigger = 'Create matter',
}: {
  trigger?: string
}) {
  const { toast } = useToast()
  const createMatter = useCreateMatter()
  const [name, setName] = useState('')
  const [clientReference, setClientReference] = useState('')
  const [primaryJurisdiction, setPrimaryJurisdiction] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!name.trim() || !primaryJurisdiction.trim()) {
      setError('Matter name and primary jurisdiction are required.')
      return
    }

    const input: CreateMatterInput = {
      name: name.trim(),
      primaryJurisdiction: primaryJurisdiction.trim(),
      clientReference: clientReference.trim() || undefined,
    }

    try {
      const matter = await createMatter.mutateAsync(input)
      toast({
        title: 'Matter created',
        description: `"${matter.name}" is ready.`,
        tone: 'success',
      })
      setName('')
      setClientReference('')
      setPrimaryJurisdiction('')
    } catch {
      setError('Could not create the matter. Please try again.')
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="primary"
            size="sm"
            iconStart={<Plus size={14} weight="bold" aria-hidden="true" />}
          >
            {trigger}
          </Button>
        }
      />
      <DialogContent size="md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <DialogTitle>Create a matter</DialogTitle>
            <DialogDescription>
              Matters are private workspaces scoped to your organisation.
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <Input
            label="Matter name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Acme Ltd v Beta Corp"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Client reference"
              value={clientReference}
              onChange={(event) => setClientReference(event.target.value)}
              placeholder="e.g. ACME-2026-001"
            />
            <Input
              label="Primary jurisdiction"
              required
              value={primaryJurisdiction}
              onChange={(event) => setPrimaryJurisdiction(event.target.value)}
              placeholder="e.g. England & Wales"
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex items-center justify-end gap-2">
            <DialogClose
              render={
                <Button variant="ghost" type="button">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" loading={createMatter.isPending}>
              Create matter
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { mattersListQueryOptions }
