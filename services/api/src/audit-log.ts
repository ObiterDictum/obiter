import type { Queryable } from './database-rows'

export interface AuditRecordInput {
  organisationId: string | null
  userId: string | null
  entityType: string
  entityId: string
  action:
    | 'auth.sign_in'
    | 'auth.sign_up'
    | 'auth.sign_out'
    | 'organisation.create'
    | 'organisation.rename'
    | 'organisation.invite_create'
    | 'organisation.invite_accept'
    | 'organisation.invite_revoke'
    | 'matter.create'
    | 'matter.update'
    | 'matter.delete'
    | 'matter.restore'
    | 'matter.share_grant'
    | 'matter.share_update'
    | 'matter.share_revoke'
    | 'matter.source_save'
    | 'matter.source_remove'
    | 'document.upload'
    | 'document.version_create'
    | 'document.edit'
    | 'document.collaboration_merge'
    | 'document.tracked_change_accept'
    | 'document.tracked_change_reject'
    | 'document.delete'
    | 'document.restore'
    | 'document.comment_create'
    | 'document.comment_reply'
    | 'document.comment_resolve'
    | 'document.comment_reopen'
    | 'document.export'
    | 'document.export_refused'
    | 'document.markings'
    | 'redaction.run_create'
    | 'redaction.run_retry'
    | 'redaction.detection_complete'
    | 'redaction.run_redetect'
    | 'redaction.span_decision'
    | 'redaction.finalize'
    | 'redaction.finalize_failed'
    | 'redaction.coverage_unchecked'
    | 'redaction.token_map_access'
    | 'redaction.return_to_document'
    | 'redaction.saved_to_matter'
    | 'redaction_run.delete'
    | 'redaction_run.restore'
    | 'verification.run_create'
    | 'verification.run_complete'
    | 'verification.run_fail'
    | 'verification.finding_undismissed'
    | 'user.profile_update'
    | 'auth.password_changed'
  metadata: Record<string, string | number | boolean | null | string[]>
  requestId: string
}

export async function appendAuditLog(
  client: Queryable,
  input: AuditRecordInput,
) {
  await client['query'](
    `
      insert into audit_logs (
        id,
        organisation_id,
        user_id,
        entity_type,
        entity_id,
        action,
        metadata_json,
        request_id,
        created_at
      )
      values (
        gen_random_uuid()::text,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7,
        now()
      )
    `,
    [
      input.organisationId,
      input.userId,
      input.entityType,
      input.entityId,
      input.action,
      JSON.stringify(input.metadata),
      input.requestId,
    ],
  )
}
