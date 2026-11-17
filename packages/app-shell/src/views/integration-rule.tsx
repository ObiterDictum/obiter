export function IntegrationRule({
  id,
  label,
  count,
}: {
  id: string
  label: string
  count: number
}) {
  return (
    <div className="flex items-center gap-3">
      <h3
        id={id}
        className="text-caption font-medium tracking-[0.08em] text-subtle uppercase"
      >
        {label}
      </h3>
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span className="text-caption tabular-nums text-subtle">{count}</span>
    </div>
  )
}
