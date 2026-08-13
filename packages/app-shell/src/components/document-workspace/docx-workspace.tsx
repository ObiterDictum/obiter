import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { DocumentCursor, DocumentModelWire } from '@obiter/contracts'
import { ApiError } from '../../api'
import { useCurrentUser } from '../../current-user'
import {
  collectEditOperations,
  downloadBlob,
  isDraftDirty,
  removeInsert,
  selectedParagraphLength,
  type LocalInsert,
} from '../../document-edits'
import {
  applyDeleteBackward,
  applyDeleteForward,
  applyLineBreak,
  applyReplaceRange,
  applySplitParagraph,
  type EditorResult,
  type EditorState,
  type ExtraRuns,
} from '../../document-word-edits'
import { documentStory } from '../../document-model-text'
import { layoutDocument } from '../../document-page-engine'
import { documentImagePartNames } from '../../document-page-media'
import { documentDefaultFace } from '../../document-page-style'
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
import type { ParagraphWordEdit } from './model-paragraph'
import { DocumentWorkspaceToolbar } from './toolbar'
import { useDocumentPresenceHeartbeat } from './use-presence-heartbeat'
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

  const [zoom, setZoom] = useState(100)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const [trackChanges, setTrackChanges] = useState(false)
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(
    null,
  )
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [inserts, setInserts] = useState<LocalInsert[]>([])
  const [deletedParagraphIds, setDeletedParagraphIds] = useState<string[]>([])
  const [extraRuns, setExtraRuns] = useState<ExtraRuns>({})
  const [restoreCaret, setRestoreCaret] = useState<{
    paragraphId: string
    offset: number
  } | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const model = modelQuery.data?.model
  const pages = model ? layoutDocument(model, drafts, inserts, extraRuns) : []
  const imageUrls = useDocumentImageUrls(
    documentId,
    model ? documentImagePartNames(model) : [],
  )
  const dirty = model
    ? isDraftDirty(model, drafts, inserts, deletedParagraphIds, extraRuns)
    : false
  const saving = editDocument.isPending || mergeDocument.isPending
  const cursor =
    selectedParagraphId && model
      ? cursorForSelection(model, selectedParagraphId)
      : null

  useDocumentPresenceHeartbeat(documentId, cursor, true)
  const presence = syncQuery.data?.participants ?? []
  const remoteChange = syncQuery.data?.changed === true

  async function reload() {
    setDrafts({})
    setInserts([])
    setDeletedParagraphIds([])
    setExtraRuns({})
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
      const blob = await fetchDocumentExport(documentId)
      downloadBlob(
        /\.docx$/iu.test(filename) ? filename : `${filename}.docx`,
        blob,
      )
    } catch (error) {
      setBanner(mutationError(error))
    }
  }

  async function save() {
    if (!model || !dirty) return
    const operations = collectEditOperations(
      model,
      drafts,
      inserts,
      deletedParagraphIds,
      extraRuns,
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
      setDrafts({})
      setInserts([])
      setDeletedParagraphIds([])
      setExtraRuns({})
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

  function selectParagraph(paragraphId: string, offset?: number) {
    setSelectedParagraphId(paragraphId)
    setRestoreCaret(offset == null ? null : { paragraphId, offset })
  }

  function deleteParagraph(paragraphId: string) {
    const removed = removeInsert(inserts, paragraphId)
    if (removed) {
      setInserts(removed.inserts)
      selectParagraph(removed.selectId)
      return
    }
    setDeletedParagraphIds((current) =>
      current.includes(paragraphId) ? current : [...current, paragraphId],
    )
  }

  function editorState(): EditorState {
    return { drafts, inserts, deletedParagraphIds, extraRuns }
  }

  function commitEditor(result: EditorResult) {
    setDrafts(result.state.drafts)
    setInserts(result.state.inserts)
    setDeletedParagraphIds(result.state.deletedParagraphIds)
    setExtraRuns(result.state.extraRuns)
    selectParagraph(result.caret.paragraphId, result.caret.offset)
  }

  function handleWordEdit(edit: ParagraphWordEdit) {
    if (!model) return
    const state = editorState()
    const caret = { paragraphId: edit.paragraphId, offset: edit.offset }
    const result =
      edit.type === 'replace'
        ? applyReplaceRange(
            model,
            state,
            edit.paragraphId,
            edit.from ?? edit.offset,
            edit.to ?? edit.offset,
            edit.insert ?? '',
          )
        : edit.type === 'deleteBackward'
          ? applyDeleteBackward(model, state, caret)
          : edit.type === 'deleteForward'
            ? applyDeleteForward(model, state, caret)
            : edit.type === 'split'
              ? applySplitParagraph(model, state, caret, crypto.randomUUID())
              : applyLineBreak(model, state, caret)
    if (result) commitEditor(result)
  }

  return (
    <WorkspaceShell
      layout={layout}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === 's'
        ) {
          event.preventDefault()
          void save()
        }
      }}
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
          onToggleComments={() => setCommentsOpen((value) => !value)}
          onToggleChanges={() => setChangesOpen((value) => !value)}
          onToggleTrackChanges={() => setTrackChanges((value) => !value)}
          onZoom={setZoom}
          onExportText={() => {
            void exportDocx()
          }}
          onSave={() => void save()}
          onInsertParagraph={() => {
            if (!selectedParagraphId || !model) return
            const clientId = crypto.randomUUID()
            setInserts((current) => [
              ...current,
              {
                clientId,
                afterParagraphId: selectedParagraphId,
                text: '',
              },
            ])
            selectParagraph(clientId, 0)
          }}
          onDeleteParagraph={() => {
            if (!selectedParagraphId) return
            deleteParagraph(selectedParagraphId)
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
                    drafts={drafts}
                    onRunTextChange={(runId, text) =>
                      setDrafts((current) => ({ ...current, [runId]: text }))
                    }
                    editing
                    presence={presence}
                    currentUserId={me?.user.id}
                    inserts={inserts}
                    deletedParagraphIds={deletedParagraphIds}
                    imageUrls={imageUrls}
                    onInsertTextChange={(clientId, text) =>
                      setInserts((current) =>
                        current.map((item) =>
                          item.clientId === clientId ? { ...item, text } : item,
                        ),
                      )
                    }
                    onInsertParagraph={(afterParagraphId) => {
                      const clientId = crypto.randomUUID()
                      setInserts((current) => [
                        ...current,
                        { clientId, afterParagraphId, text: '' },
                      ])
                      selectParagraph(clientId, 0)
                    }}
                    onDeleteParagraph={deleteParagraph}
                    onWordEdit={handleWordEdit}
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

function cursorForSelection(
  model: DocumentModelWire,
  paragraphId: string,
): DocumentCursor | null {
  const paragraph = documentStory(model)?.paragraphs.find(
    (item) => item.id === paragraphId,
  )
  const run = paragraph?.runs[0]
  if (!paragraph || !run) return null
  return { paragraphId: paragraph.id, runId: run.id, offset: 0 }
}
