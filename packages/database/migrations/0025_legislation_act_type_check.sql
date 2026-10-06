-- Restore the legislation act-type constraint on installations whose
-- legislation_documents table pre-existed 0020.
--
-- 0020 declares `legislation_documents_act_type_check check (act_type =
-- 'ukpga')` only inside `create table if not exists`, so a long-lived table
-- that already existed when 0020 ran never received it. The shared legal
-- corpus schema declares the constraint and the corpus migration requires it
-- on the target, so it has to be restored on existing installations, not only
-- on databases created fresh.
--
-- `add constraint ... not valid` takes a brief ACCESS EXCLUSIVE lock and does
-- not scan the table; the following `validate constraint` scans once and proves
-- every existing row satisfies the rule. All current rows are already
-- `act_type = 'ukpga'`, so validation rejects nothing today, but it fails the
-- migration loudly if any row does not, rather than recording a constraint that
-- the data would not survive.
--
-- The existence guard matches the constraint by relation, type and full
-- expression, not by name alone. A same-named constraint with a different
-- definition is an unknown state: validating it would record this migration as
-- applied while `act_type = 'ukpga'` stayed unenforced, and schema_migrations
-- would never retry. It is therefore a hard, transactional failure. Only the
-- relation the ALTER below targets is consulted, so a same-named constraint in
-- another schema or on another table cannot mask the missing rule.

do $$
declare
  -- Resolved once, through the same search_path the ALTER below uses, so the
  -- guard and the DDL cannot disagree about the target relation.
  target_relation regclass := 'legislation_documents'::regclass;
  existing pg_constraint%rowtype;
begin
  select * into existing
  from pg_constraint
  where conrelid = target_relation
    and conname = 'legislation_documents_act_type_check';

  if not found then
    alter table legislation_documents
      add constraint legislation_documents_act_type_check check (act_type = 'ukpga') not valid;
    return;
  end if;

  -- The two exact definitions a correct constraint can have: validated, and
  -- the `not valid` form this migration adds before validating it. Anything
  -- else (another expression, another type, deferrable, no inherit) fails.
  if existing.contype <> 'c'
    or pg_get_constraintdef(existing.oid) not in (
      'CHECK ((act_type = ''ukpga''::text))',
      'CHECK ((act_type = ''ukpga''::text)) NOT VALID'
    )
  then
    raise exception
      'legislation_documents_act_type_check on % has an unexpected definition (%); refusing to record this migration without the required rule',
      target_relation,
      pg_get_constraintdef(existing.oid);
  end if;
end
$$;

alter table legislation_documents
  validate constraint legislation_documents_act_type_check;
