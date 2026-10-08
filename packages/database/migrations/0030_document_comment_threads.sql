-- E8 comment threads: anchors may span paragraphs, comments accept replies
-- (to stored threads or to an imported w:comment identity), and create/reply
-- submissions carry a client key so a retry cannot duplicate a row.

alter table document_comments
  add column if not exists end_paragraph_id text,
  add column if not exists client_key text;

-- A single-paragraph anchor still requires end >= start; an anchor whose range
-- ends in a different paragraph has independent per-paragraph offsets.
alter table document_comments
  drop constraint if exists document_comments_end_offset_check;
alter table document_comments
  add constraint document_comments_end_offset_check check (
    end_offset >= 0
    and (
      (end_paragraph_id is not null and end_paragraph_id <> paragraph_id)
      or end_offset >= start_offset
    )
  );

alter table document_comments
  drop constraint if exists document_comments_end_paragraph_id_check;
alter table document_comments
  add constraint document_comments_end_paragraph_id_check check (
    end_paragraph_id is null
    or (length(btrim(end_paragraph_id)) > 0 and length(end_paragraph_id) <= 255)
  );

-- Scoped uniqueness so a reply's foreign key can prove the parent comment
-- belongs to the same organisation, matter and document. Created inside a
-- guard rather than drop-and-add: the replies table's foreign key depends on
-- this constraint, so dropping it on a re-apply would need cascade.
do $$
declare
  -- Resolved once, through the same search_path the ALTER below uses, so the
  -- guard and the DDL cannot disagree about the target relation: a same-named
  -- constraint on another schema's document_comments must not satisfy it.
  target_relation regclass := 'document_comments'::regclass;
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'document_comments_scoped_id_key'
      and conrelid = target_relation
  ) then
    alter table document_comments
      add constraint document_comments_scoped_id_key
        unique (id, document_id, matter_id, organisation_id);
  end if;
end $$;

-- A client key dedupes one user's resubmit; different authors' keys are
-- independent intents and must not collide. These unique indexes back the
-- idempotency semantics, so they are recreated rather than merely created
-- when absent: a draft index of the same name on different columns would
-- otherwise survive `if not exists` and silently change what a replay means.
drop index if exists document_comments_client_key_idx;
create unique index document_comments_client_key_idx
  on document_comments (document_id, author_id, client_key)
  where client_key is not null;

create table if not exists document_comment_replies (
  id text primary key default ('cmtr_' || gen_random_uuid()::text),
  organisation_id text not null,
  matter_id text not null,
  document_id text not null,
  comment_id text,
  imported_comment_id text,
  body text not null,
  author_id text not null,
  author_name text not null,
  client_key text,
  created_at timestamptz not null default now(),
  constraint document_comment_replies_id_prefix_check check (id like 'cmtr_%'),
  -- Exactly one parent: a stored comment or an imported `ooxml-<w:id>` thread.
  constraint document_comment_replies_parent_check check (
    (comment_id is null) <> (imported_comment_id is null)
  ),
  constraint document_comment_replies_imported_id_check check (
    imported_comment_id is null or length(imported_comment_id) <= 64
  ),
  constraint document_comment_replies_body_check check (
    length(btrim(body)) > 0 and length(body) <= 10000
  ),
  constraint document_comment_replies_author_name_check check (
    length(btrim(author_name)) > 0 and length(author_name) <= 200
  ),
  constraint document_comment_replies_client_key_check check (
    client_key is null
    or (length(btrim(client_key)) > 0 and length(client_key) <= 64)
  ),
  constraint document_comment_replies_matter_fk foreign key (matter_id, organisation_id)
    references matters(id, organisation_id),
  constraint document_comment_replies_document_fk foreign key (document_id, matter_id, organisation_id)
    references matter_documents(id, matter_id, organisation_id) on delete cascade,
  constraint document_comment_replies_comment_fk foreign key (
    comment_id, document_id, matter_id, organisation_id
  ) references document_comments(id, document_id, matter_id, organisation_id)
    on delete cascade,
  constraint document_comment_replies_author_fk foreign key (author_id)
    references users(id)
);

create index if not exists document_comment_replies_comment_idx
  on document_comment_replies (comment_id, created_at, id)
  where comment_id is not null;

create index if not exists document_comment_replies_imported_idx
  on document_comment_replies (document_id, imported_comment_id, created_at, id)
  where imported_comment_id is not null;

drop index if exists document_comment_replies_client_key_idx;
create unique index document_comment_replies_client_key_idx
  on document_comment_replies (document_id, author_id, client_key)
  where client_key is not null;
