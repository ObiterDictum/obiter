import { useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  useToast,
} from '@obiter/ui'
import type { SavedMatterSource } from '@obiter/contracts'
import { apiFetch } from '../../api'
import { useMattersList } from '../../matters'
import { savedSourcesKeys } from '../../saved-sources'

/**
 * The one source a page is showing, in the shape a matter files. `sourceId` is
 * the corpus identity, so a saved entry always reads the same stored source
 * the page does.
 */
export interface SaveableSource {
  kind: 'judgment' | 'legislation'
  sourceId: string
  title: string
  citation: string | null
  sourceUrl: string | null
}

/**
 * Keep a source with a matter, and take its citation away.
 *
 * The home page promises a matter keeps the sources you find, so this is the
 * action that makes that true: the source is filed against one matter the
 * reader can edit, under the API's own matter access check. The matter is
 * chosen from a menu rather than a dialog — the choice is one of a short list
 * the reader already knows, and picking one is the whole interaction.
 *
 * "Copy citation" stands in for a document citation action because there is no
 * editor entry point a source page can drive: the editor owns insertion, and
 * its only route in is editing the open document.
 */
export function SourceActions({ source }: { source: SaveableSource }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const matters = useMattersList()
  const citation = source.citation ?? source.title

  async function save(matterId: string, matterName: string) {
    try {
      await apiFetch<{ savedSource: SavedMatterSource }>(
        `/api/matters/${matterId}/saved-sources`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: source.kind,
            sourceId: source.sourceId,
            title: source.title,
            citation: source.citation,
            sourceUrl: source.sourceUrl,
          }),
        },
      )
      toast({
        title: `Saved to ${matterName}`,
        description: citation,
        tone: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: savedSourcesKeys.forMatter(matterId),
      })
    } catch {
      toast({
        title: 'The source could not be saved',
        description: 'Nothing was filed. Try again in a moment.',
        tone: 'danger',
      })
    }
  }

  async function copyCitation() {
    try {
      await navigator.clipboard.writeText(citation)
      toast({ title: 'Citation copied', description: citation })
    } catch {
      toast({
        title: 'The citation could not be copied',
        description: citation,
        tone: 'danger',
      })
    }
  }

  const mattersReady = matters.data !== undefined && matters.data.length > 0

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button variant="secondary" size="md" loading={matters.isPending}>
              Save to matter
            </Button>
          }
        />
        <MenuContent aria-label="Save to matter">
          {mattersReady ? (
            matters.data.map((matter) => (
              <MenuItem
                key={matter.id}
                onClick={() => void save(matter.id, matter.name)}
              >
                {matter.name}
                {matter.clientReference ? (
                  <span className="ml-2 text-caption text-subtle">
                    {matter.clientReference}
                  </span>
                ) : null}
              </MenuItem>
            ))
          ) : (
            <MenuItem disabled>
              {matters.isError
                ? 'Your matters could not be loaded'
                : matters.isPending
                  ? 'Loading matters…'
                  : 'No matters yet — create one first'}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      <Button variant="ghost" size="md" onClick={() => void copyCitation()}>
        Copy citation
      </Button>
    </>
  )
}
