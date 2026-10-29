import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  useToast,
} from '@obiter/ui'
import type { CitationTarget, SavedMatterSource } from '@obiter/contracts'
import { apiFetch } from '../../api'
import { useCitationTargets } from '../../documents'
import { workspaceKind } from '../../document-kind'
import { useMattersList } from '../../matters'
import { requestCitation } from '../../pending-citation'
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
 * The citation as it is written: the authority's own name with its citation —
 * "Wood v Capita Insurance Services Ltd [2017] UKSC 24", "Equality Act 2010,
 * s. 13(3)". One formatter for "Copy citation" and "Cite in document", so the
 * copied text and the inserted text can never drift apart.
 */
export function sourceCitation(source: SaveableSource) {
  if (!source.citation) return source.title
  return source.kind === 'legislation'
    ? `${source.title}, ${source.citation}`
    : `${source.title} ${source.citation}`
}

/**
 * Why a document cannot take the citation, or null when it can. The editor
 * only writes Word documents, and only for a person who may edit the matter;
 * both answers come from the API beside the document, so the menu never offers
 * an insertion the document would refuse.
 */
export function citationTargetRefusal(target: CitationTarget): string | null {
  if (!target.canEdit) return 'You have view-only access to this matter'
  const kind = workspaceKind(target.fileType)
  if (kind === 'docx') return null
  if (kind === 'pdf') return 'PDF documents open read-only'
  if (kind === 'txt') return 'Text documents open read-only'
  return 'This document cannot be edited'
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
 * "Cite in document" carries the citation to a document the reader has opened.
 * The citation is inserted in the editor, at the caret, never here: this page
 * cannot know where the sentence goes, and a citation dropped at an arbitrary
 * position is worse than one not inserted. Choosing a document only opens it
 * with the citation pending, and the editor asks where it goes.
 */
export function SourceActions({ source }: { source: SaveableSource }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const matters = useMattersList()
  const targets = useCitationTargets()
  const citation = sourceCitation(source)

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

  function citeIn(target: CitationTarget) {
    // The citation is left for that one document, then the document opens.
    // Nothing is inserted here: the editor owns the caret and asks where the
    // citation goes.
    requestCitation(target.documentId, citation)
    navigate({
      to: '/matters/$matterId/documents/$documentId',
      params: { matterId: target.matterId, documentId: target.documentId },
    })
  }

  const mattersReady = matters.data !== undefined && matters.data.length > 0
  const targetRows = targets.data ?? []

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
      <Menu>
        <MenuTrigger
          render={
            <Button variant="secondary" size="md" loading={targets.isPending}>
              Cite in document
            </Button>
          }
        />
        <MenuContent aria-label="Cite in document">
          {targets.isError ? (
            <MenuItem disabled>Your documents could not be loaded</MenuItem>
          ) : targets.isPending ? (
            <MenuItem disabled>Loading documents…</MenuItem>
          ) : targetRows.length === 0 ? (
            <MenuItem disabled>
              No documents opened yet — open a Word document first
            </MenuItem>
          ) : (
            targetRows.map((target) => {
              const refusal = citationTargetRefusal(target)
              return (
                <MenuItem
                  key={target.documentId}
                  disabled={refusal !== null}
                  onClick={() => citeIn(target)}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{target.filename}</span>
                    <span className="truncate text-caption text-subtle">
                      {refusal ?? target.matterName}
                    </span>
                  </span>
                </MenuItem>
              )
            })
          )}
        </MenuContent>
      </Menu>
      <Button variant="ghost" size="md" onClick={() => void copyCitation()}>
        Copy citation
      </Button>
    </>
  )
}
