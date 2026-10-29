-- Sources fix-up: provision headings, section-own text, and the retrieval
-- date.
--
-- An Act's contents read "s. 13 Direct discrimination" only when the
-- section's heading is stored. CLML carries it on the enclosing P1group
-- <Title>, never on the P1 itself, so the ingestor had nowhere to put it and
-- the tree rendered bare labels.
--
-- `own_text` is the text written directly inside one provision element,
-- excluding nested subsections. `provision_text` deliberately concatenates
-- descendants so a section row answers its subsections' terms in search; that
-- same concatentation is unusable for nested rendering, where the section
-- would repeat every subsection beneath it. NULL means a row predating this
-- migration: the provision page then falls back to the flat `provision_text`
-- it serves today until the document is re-parsed, rather than guessing a
-- split of the concatenated text.
--
-- `acquired_at` is when this process read the Act's data.xml: the retrieval
-- date the source pages show. It is not derived from `updated_at`, which
-- moves on every effects check. NULL is "not recorded" and stays visible as
-- such.

alter table if exists legislation_provisions
  add column if not exists heading text not null default '',
  add column if not exists own_text text;

alter table if exists legislation_documents
  add column if not exists acquired_at timestamptz;
