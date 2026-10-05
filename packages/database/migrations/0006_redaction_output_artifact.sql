alter table artifacts
  drop constraint if exists artifacts_type_check;

alter table artifacts
  add constraint artifacts_type_check check (
    artifact_type in (
      'document_text',
      'upload_receipt',
      'processing_log',
      'redaction_report',
      'redaction_output',
      'verification_report',
      'research_memo'
    )
  );
