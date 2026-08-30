export function matterAccessPredicate(
  userParameter: `$${number}`,
  requiredLevelExpression: `$${number}` | "'view'" | "'edit'",
) {
  return `(
    matter.created_by = ${userParameter}
    or exists (
      select 1 from matter_shares share
      where share.matter_id = matter.id
        and share.organisation_id = matter.organisation_id
        and share.grantee_user_id = ${userParameter}
        and (${requiredLevelExpression} = 'view' or share.access_level = 'edit')
    )
  )`
}

export function redactionRunAccessPredicate(
  userParameter: `$${number}`,
  requiredLevelExpression: `$${number}` | "'view'" | "'edit'",
) {
  return `(
    (
      run.matter_id is null
      and run.created_by = ${userParameter}
    )
    or (
      run.matter_id is not null
      and matter.deleted_at is null
      and ${matterAccessPredicate(userParameter, requiredLevelExpression)}
    )
  )`
}
