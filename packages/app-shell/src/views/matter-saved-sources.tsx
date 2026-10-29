import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { SavedMatterSource } from '@obiter/contracts'
import { Button, Card, CardBody, CardHead, useToast } from '@obiter/ui'
import { apiFetch } from '../api'
import { caseResultLocation } from '../case-navigation'
import { provisionResultLocation } from '../legislation-navigation'
import {
  savedSourcesKeys,
  splitLegislationSourceId,
  useSavedMatterSources,
} from '../saved-sources'

export function MatterSavedSources({ matterId }: { matterId: string }) {
  const saved = useSavedMatterSources(matterId)
  if (saved.isPending) {
    return (
      <Card aria-labelledby="matter-sources">
        <CardHead title="Sources" titleId="matter-sources" />
        <CardBody>
          <p className="text-meta text-muted" role="status">
            Loading saved sources…
          </p>
        </CardBody>
      </Card>
    )
  }
  if (saved.isError) {
    return (
      <Card aria-labelledby="matter-sources">
        <CardHead title="Sources" titleId="matter-sources" />
        <CardBody>
          <p className="text-meta text-muted">
            Saved sources could not be loaded.
          </p>
        </CardBody>
      </Card>
    )
  }
  return (
    <Card aria-labelledby="matter-sources">
      <CardHead title="Sources" titleId="matter-sources">
        <span className="text-meta text-subtle">{saved.data.length}</span>
      </CardHead>
      <CardBody>
        {saved.data.length === 0 ? (
          <p className="text-meta text-muted">
            No sources saved yet. Save a judgment or provision from Search to
            keep it with this matter.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {saved.data.map((source) => (
              <SavedSourceRow
                key={source.id}
                matterId={matterId}
                source={source}
              />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function SavedSourceRow({
  matterId,
  source,
}: {
  matterId: string
  source: SavedMatterSource
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  async function remove() {
    try {
      await apiFetch(`/api/matters/${matterId}/saved-sources/${source.id}`, {
        method: 'DELETE',
      })
      await queryClient.invalidateQueries({
        queryKey: savedSourcesKeys.forMatter(matterId),
      })
      toast({ title: 'Removed from this matter', description: source.title })
    } catch {
      toast({
        title: 'The source could not be removed',
        description: 'It is still filed with this matter.',
        tone: 'danger',
      })
    }
  }

  if (source.kind === 'legislation') {
    const { documentIdentity, labelPath } = splitLegislationSourceId(
      source.sourceId,
    )
    return (
      <li className="flex items-start justify-between gap-2 py-3">
        <span className="min-w-0">
          <Link
            {...provisionResultLocation({ documentIdentity, labelPath })}
            className="block truncate text-item text-ink underline-offset-2 hover:underline"
          >
            {source.title}
          </Link>
          <span className="text-caption text-subtle">
            {source.citation ?? 'Provision'}
          </span>
        </span>
        <RemoveButton onRemove={() => void remove()} title={source.title} />
      </li>
    )
  }
  return (
    <li className="flex items-start justify-between gap-2 py-3">
      <span className="min-w-0">
        <Link
          {...caseResultLocation({ id: source.sourceId })}
          className="block truncate text-item italic text-ink underline-offset-2 hover:underline"
        >
          {source.title}
        </Link>
        <span className="text-caption text-subtle">
          {source.citation ?? 'Judgment'}
        </span>
      </span>
      <RemoveButton onRemove={() => void remove()} title={source.title} />
    </li>
  )
}

function RemoveButton({
  onRemove,
  title,
}: {
  onRemove: () => void
  title: string
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Remove ${title} from this matter`}
      onClick={onRemove}
    >
      Remove
    </Button>
  )
}
