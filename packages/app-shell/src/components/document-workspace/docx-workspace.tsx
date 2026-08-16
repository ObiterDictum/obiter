import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '../../api'
import { useCurrentUser } from '../../current-user'
import {
  collectEditOperations,
  downloadBlob,
  isDraftDirty,
  selectedParagraphLength,
} from '../../document-edits'
import {
  documentFormatToolbar,
  formattedModel,
} from '../../document-format-edits'
import {
  clampFindIndex,
  findInDocument,
  findMatchLabel,
  nextFindIndex,
  previousFindIndex,
} from '../../document-find'
import { cursorForSelection, documentStory } from '../../document-model-text'
import { layoutDocument } from '../../document-page-engine'
import { documentImagePartNames } from '../../document-page-media'
import { documentDefaultFace } from '../../document-page-style'
import { blockText } from '../../document-word-edits'
import { handleDocumentWorkspaceKeys } from '../../document-workspace-keys'
import {
  useCollaborationMerge,
  useCreateDocumentComment,
  useDocumentCollaborationSync,
  useDocumentComments,
  useDocumentModel,
  useDocumentTrackedChanges,
  useEditDocument,
  useDocumentImageUrls,
  useResolveDocumentComment,
  useTrackedChangeDecision,
  fetchDocumentExport,
  workspaceKeys,
} from '../../document-workspace-api'
import { DocumentChangesPanel } from './changes-panel'
import { DocumentCommentsPanel } from './comments-panel'
import { DocumentModelPage } from './model-view'
import { DocumentWorkspaceToolbar } from './toolbar'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'
import { useWorkspaceDrafts } from './use-workspace-drafts'
import { DocumentDesk, DocumentPage } from './document-page'
import {
  ConflictBanner,
  LoadingBlock,
  QueryError,
  WorkspaceRibbon,
  WorkspaceShell,
  mutationError,
  type DocumentWorkspaceLayout,
} from './workspace-chrome'

export function DocxWorkspace({
  documentId,
  versionId,
  matterId,
  filename,
  layout = 'page',
}: {
  documentId: string
  versionId: string
  matterId: string
  filename: string
  layout?: DocumentWorkspaceLayout
}) {
  const queryClient = useQueryClient()
  const { data: me } = useCurrentUser()
  const modelQuery = useDocumentModel(documentId)
  const commentsQuery = useDocumentComments(documentId)
  const changesQuery = useDocumentTrackedChanges(documentId)
  const [savedVersion, setSavedVersion] = useState<{
    documentId: string
    versionId: string
  } | null>(null)
  const baseVersionId =
    savedVersion?.documentId === documentId
      ? savedVersion.versionId
      : (modelQuery.data?.versionId ?? versionId)
  const syncQuery = useDocumentCollaborationSync(documentId, baseVersionId)
  const createComment = useCreateDocumentComment(documentId)
  const resolveComment = useResolveDocumentComment(documentId)
  const editDocument = useEditDocument(documentId, matterId)
  const mergeDocument = useCollaborationMerge(documentId, matterId)
  const decideChange = useTrackedChangeDecision(documentId, matterId)
  const drafts = useWorkspaceDrafts()

  const [zoom, setZoom] = useState(100)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [trackChanges, setTrackChanges] = useState(false)
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(
    null,
  )
  const [restoreCaret, setRestoreCaret] = useState<{
    paragraphId: string
    offset: number
  } | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIndex, setFindIndex] = useState(-1)

  const model = modelQuery.data?.model
  const painted = model ? formattedModel(model, drafts.format) : undefined
  const pages = painted
    ? layoutDocument(painted, drafts.drafts, drafts.inserts, drafts.extraRuns)
    : []
  const imageUrls = useDocumentImageUrls(
    documentId,
    model ? documentImagePartNames(model) : [],
  )
  const dirty = model
    ? isDraftDirty(
        model,
        drafts.drafts,
        drafts.inserts,
        drafts.deletedParagraphIds,
        drafts.extraRuns,
        drafts.format,
      )
    : false
  const saving = editDocument.isPending || mergeDocument.isPending
  const cursor =
    selectedParagraphId && model
      ? cursorForSelection(model, selectedParagraphId)
      : null

  useDocumentPresenceHeartbeat(documentId, cursor, true)
  const presence = syncQuery.data?.participants ?? []
  const remoteChange = syncQuery.data?.changed === true
  const findHits = model
    ? findInDocument(
        model,
        drafts.drafts,
        drafts.inserts,
        drafts.deletedParagraphIds,
        drafts.extraRuns,
        findQuery,
      )
    : []
  // Clamp the stored index to the current hit set so edits that shrink the
  // hits cannot leave the label or navigation on a stale position.
  const activeFindIndex = clampFindIndex(findIndex, findHits.length)

  function selectParagraph(paragraphId: string, offset?: number) {
    setSelectedParagraphId(paragraphId)
    setRestoreCaret(offset == null ? null : { paragraphId, offset })
  }

  function jumpToHit(index: number) {
    const hit = findHits[index]
    if (!hit) return
    setFindIndex(index)
    selectParagraph(hit.paragraphId, hit.start)
  }

  function undoDocument() {
    const beforeInserts = drafts.inserts
    const restored = drafts.undoDraft()
    if (!restored || !model) return
    // Undoing a split/insert removes the paragraph the caret was on. Move
    // selection back to the paragraph the removed insert was anchored after
    // so the user is not left with nothing selected.
    const target = restoreCaret?.paragraphId ?? selectedParagraphId
    if (!target) return
    const removed = beforeInserts.find((item) => item.clientId === target)
    // Only redirect when the insert the caret was on is actually gone after
    // the undo. An insert that survived (e.g. undoing a text edit inside
    // it) must keep the caret; the editor clamps the offset to its text.
    if (!removed || restored.inserts.some((item) => item.clientId === target)) {
      return
    }
    selectParagraph(
      removed.afterParagraphId,
      blockText(model, restored, removed.afterParagraphId).length,
    )
  }

  async function reload() {
    drafts.resetDrafts()
    setStale(false)
    setBanner(null)
    setSavedVersion(null)
    await queryClient.invalidateQueries({
      queryKey: workspaceKeys.model(documentId),
    })
    await queryClient.invalidateQueries({
      queryKey: workspaceKeys.sync(documentId),
    })
  }

  async function exportDocx() {
    try {
      const { blob, skippedCommentCount } =
        await fetchDocumentExport(documentId)
      downloadBlob(
        /\.docx$/iu.test(filename) ? filename : `${filename}.docx`,
        blob,
      )
      if (skippedCommentCount > 0) {
        setBanner(skippedCommentsMessage(skippedCommentCount))
      }
    } catch (error) {
      setBanner(mutationError(error))
    }
  }

  async function save() {
    if (!model || !dirty) return
    const operations = collectEditOperations(
      model,
      drafts.drafts,
      drafts.inserts,
      drafts.deletedParagraphIds,
      drafts.extraRuns,
      drafts.format,
    )
    const collaborators = presence.some((item) => item.userId !== me?.user.id)
    const merge = collaborators || remoteChange
    try {
      let versionIdAfterSave: string
      let mergedToAvoidOverwrite = false
      if (merge) {
        const saved = await mergeDocument.mutateAsync({
          baseVersionId,
          syncId: crypto.randomUUID(),
          operations,
          trackChanges,
        })
        versionIdAfterSave = saved.versionId
        mergedToAvoidOverwrite = remoteChange
      } else {
        try {
          const saved = await editDocument.mutateAsync({
            baseVersionId,
            operations,
            trackChanges,
          })
          versionIdAfterSave = saved.versionId
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.code !== 'conflict_detected'
          ) {
            throw error
          }
          const saved = await mergeDocument.mutateAsync({
            baseVersionId,
            syncId: crypto.randomUUID(),
            operations,
            trackChanges,
          })
          versionIdAfterSave = saved.versionId
          mergedToAvoidOverwrite = true
        }
      }
      setSavedVersion({ documentId, versionId: versionIdAfterSave })
      drafts.resetDrafts()
      setStale(false)
      if (mergedToAvoidOverwrite) {
        setBanner(
          "Your changes were saved as a new version to avoid overwriting a colleague's work",
        )
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict_detected') {
        setStale(true)
        return
      }
      setBanner(error instanceof Error ? error.message : 'Save failed.')
    }
  }

  return (
    <WorkspaceShell
      layout={layout}
      onKeyDown={(event) =>
        handleDocumentWorkspaceKeys(event, {
          save: () => void save(),
          undo: undoDocument,
          focusFind: () => document.getElementById('document-find')?.focus(),
        })
      }
    >
      <WorkspaceRibbon>
        <DocumentWorkspaceToolbar
          kind="docx"
          dirty={dirty}
          saving={saving}
          trackChanges={trackChanges}
          zoom={zoom}
          commentsOpen={commentsOpen}
          changesOpen={changesOpen}
          commentCount={commentsQuery.data?.comments.length ?? 0}
          changeCount={changesQuery.data?.changes.length ?? 0}
          presence={presence}
          currentUserId={me?.user.id}
          canEdit
          canUndo={drafts.canUndo}
          onToggleComments={() => setCommentsOpen((value) => !value)}
          onToggleChanges={() => setChangesOpen((value) => !value)}
          onToggleTrackChanges={() => setTrackChanges((value) => !value)}
          onZoom={setZoom}
          onExportText={() => {
            void exportDocx()
          }}
          onSave={() => void save()}
          onUndo={undoDocument}
          onInsertParagraph={() => {
            if (!selectedParagraphId) return
            selectParagraph(drafts.insertAfter(selectedParagraphId), 0)
          }}
          onDeleteParagraph={() => {
            if (!selectedParagraphId) return
            const selectId = drafts.deleteParagraph(selectedParagraphId)
            if (selectId) selectParagraph(selectId)
          }}
          format={
            painted
              ? documentFormatToolbar(
                  painted,
                  drafts.format,
                  selectedParagraphId,
                  drafts.setFormat,
                )
              : undefined
          }
          find={{
            query: findQuery,
            matchLabel: findMatchLabel(activeFindIndex, findHits.length),
            onQuery: (query) => {
              setFindQuery(query)
              setFindIndex(-1)
            },
            onNext: () => jumpToHit(nextFindIndex(findHits, activeFindIndex)),
            onPrevious: () =>
              jumpToHit(previousFindIndex(findHits, activeFindIndex)),
          }}
        />
        {stale ? (
          <ConflictBanner
            body="The document has changed since editing began."
            actionLabel="Reload"
            onAction={() => void reload()}
          />
        ) : null}
        {remoteChange && dirty && !stale ? (
          <ConflictBanner
            body="A colleague saved a newer version. Reload before saving, or save to merge disjoint edits."
            actionLabel="Reload"
            onAction={() => void reload()}
          />
        ) : null}
        {banner ? (
          <p className="mt-2 text-sm text-ink" role="status">
            {banner}
          </p>
        ) : null}
      </WorkspaceRibbon>
      {modelQuery.isLoading ? (
        <LoadingBlock label="Loading document model" />
      ) : modelQuery.isError ? (
        <QueryError
          error={modelQuery.error}
          fallback="The document model could not be loaded."
        />
      ) : model ? (
        <DocumentDesk>
          <div className="mx-auto flex w-max max-w-full flex-col items-start gap-6 lg:flex-row">
            <div className="flex flex-col gap-6">
              {pages.map((laid, index) => (
                <DocumentPage
                  key={`page-${index + 1}`}
                  zoom={zoom}
                  width={laid.box.widthPx}
                  height={laid.box.heightPx}
                  fontFamily={documentDefaultFace(model.styles).fontFamily}
                >
                  <DocumentModelPage
                    model={model}
                    pageNumber={index + 1}
                    pageBlocks={laid.blocks}
                    pageFloats={laid.floats}
                    pageTextBoxes={laid.textBoxes}
                    pageColumns={laid.columns}
                    selectedParagraphId={selectedParagraphId}
                    onSelectParagraph={(paragraphId, offset) =>
                      selectParagraph(paragraphId, offset)
                    }
                    drafts={drafts.drafts}
                    onRunTextChange={(runId, text) =>
                      drafts.setDrafts((current) => ({
                        ...current,
                        [runId]: text,
                      }))
                    }
                    editing
                    presence={presence}
                    currentUserId={me?.user.id}
                    inserts={drafts.inserts}
                    deletedParagraphIds={drafts.deletedParagraphIds}
                    imageUrls={imageUrls}
                    onInsertTextChange={(clientId, text) =>
                      drafts.setInserts((current) =>
                        current.map((item) =>
                          item.clientId === clientId ? { ...item, text } : item,
                        ),
                      )
                    }
                    onInsertParagraph={(afterParagraphId) =>
                      selectParagraph(drafts.insertAfter(afterParagraphId), 0)
                    }
                    onDeleteParagraph={(paragraphId) => {
                      const selectId = drafts.deleteParagraph(paragraphId)
                      if (selectId) selectParagraph(selectId)
                    }}
                    onWordEdit={(edit) => {
                      const caret = drafts.handleWordEdit(model, edit)
                      if (caret) {
                        selectParagraph(caret.paragraphId, caret.offset)
                      }
                    }}
                    restoreCaret={restoreCaret}
                  />
                </DocumentPage>
              ))}
            </div>
            {commentsOpen ? (
              <div className="w-full rounded-md bg-surface p-4 lg:w-80">
                <DocumentCommentsPanel
                  comments={commentsQuery.data?.comments ?? []}
                  selectedParagraphId={
                    documentStory(model)?.paragraphs.some(
                      (paragraph) => paragraph.id === selectedParagraphId,
                    )
                      ? selectedParagraphId
                      : null
                  }
                  selectedParagraphLength={selectedParagraphLength(
                    model,
                    selectedParagraphId,
                  )}
                  canEdit
                  pending={createComment.isPending || resolveComment.isPending}
                  error={mutationError(
                    createComment.error ?? resolveComment.error,
                  )}
                  onCreate={(input) => {
                    createComment.mutate({
                      body: input.body,
                      anchor: {
                        paragraphId: input.paragraphId,
                        startOffset: 0,
                        endOffset: input.endOffset,
                      },
                    })
                  }}
                  onResolve={(commentId) => resolveComment.mutate(commentId)}
                />
              </div>
            ) : null}
            {changesOpen ? (
              <div className="w-full rounded-md bg-surface p-4 lg:w-80">
                <DocumentChangesPanel
                  changes={changesQuery.data?.changes ?? []}
                  pending={decideChange.isPending || saving}
                  error={mutationError(decideChange.error)}
                  onDecide={(action, changeId) => {
                    decideChange.mutate({
                      baseVersionId,
                      action,
                      changeIds: [changeId],
                    })
                  }}
                />
              </div>
            ) : null}
          </div>
        </DocumentDesk>
      ) : null}
    </WorkspaceShell>
  )
}

function skippedCommentsMessage(count: number) {
  return count === 1
    ? '1 comment could not be placed in the exported document and was skipped.'
    : `${count} comments could not be placed in the exported document and were skipped.`
}
