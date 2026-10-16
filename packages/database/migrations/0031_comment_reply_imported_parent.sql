-- A reply to an imported comment stores a fingerprint of the thread head it
-- was validated against. A bare `ooxml-<w:id>` is only a slot: a re-uploaded
-- version whose comments part reallocates `w:id` values could place a
-- different comment in it, and a reply bound to the slot alone would
-- silently reattach to the wrong thread. The fingerprint lets serving and
-- export bind the reply to the comment it was written against and orphan it
-- honestly when the slot now holds something else. Rows without a
-- fingerprint carry no validated identity and do not reattach.
alter table document_comment_replies
  add column if not exists imported_parent_fingerprint text;

alter table document_comment_replies
  drop constraint if exists document_comment_replies_fingerprint_check;
alter table document_comment_replies
  add constraint document_comment_replies_fingerprint_check check (
    imported_parent_fingerprint is null
    or length(imported_parent_fingerprint) = 64
  );
