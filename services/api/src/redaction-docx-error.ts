export class RedactionDocxBurnError extends Error {
  constructor(
    message: string,
    readonly reason: 'burn_failed' | 'legacy_coordinates' = 'burn_failed',
  ) {
    super(message)
    this.name = 'RedactionDocxBurnError'
  }
}
