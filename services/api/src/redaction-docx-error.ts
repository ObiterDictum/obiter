/** Refusal shared by editable DOCX and the hard-PDF pre-render boundary. */
export class RedactionDocxBurnError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedactionDocxBurnError'
  }
}
