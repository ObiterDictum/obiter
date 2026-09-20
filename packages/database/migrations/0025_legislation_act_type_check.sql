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
-- the data would not survive. The existence guard makes the file idempotent on
-- a fresh install, where 0020 created the constraint inline.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'legislation_documents_act_type_check'
      and conrelid = 'legislation_documents'::regclass
  ) then
    alter table legislation_documents
      add constraint legislation_documents_act_type_check check (act_type = 'ukpga') not valid;
  end if;
end
$$;

alter table legislation_documents
  validate constraint legislation_documents_act_type_check;
