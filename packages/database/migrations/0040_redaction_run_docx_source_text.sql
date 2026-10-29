-- A DOCX run on a matter document stores Redact's own extracted text under
-- the run, so review coordinates match the burn. The matter version's stored
-- text stays untouched; older matter runs keep a null key and read it.
alter table redaction_runs
  drop constraint if exists redaction_runs_source_text_object_key_check;

alter table redaction_runs
  add constraint redaction_runs_source_text_object_key_check check (
    (source_text_object_key is null and matter_id is not null)
    or source_text_object_key = 'org/' || organisation_id || '/redaction-runs/' || id || '/source'
  );
