import { expect, it } from 'bun:test'
import { redactMessage, routePattern, sourceFile } from './error-reporting'
it('removes emails quoted text long digits and long words before truncation',() => {
 expect(redactMessage(`Failed "Smith.docx" 'Jones' ‘Matter’ “Document” jane@firm.co.uk 12345678 ${'x'.repeat(41)}`)).toBe('Failed [quoted] [quoted] [quoted] [quoted] [email] [number] [long]')
 expect(redactMessage('failed '.repeat(100))).toHaveLength(300)
})
it('replaces ids and unknown route values and removes query strings and fragments',() => {
 expect(routePattern('https://app.obiter.si/api/matters/12345678/documents/doc_abc?secret=yes#secret')).toBe('/api/matters/:value/documents/:value')
})
it('keeps only a code file basename from stack locations',() => {
 expect(sourceFile('https://app.obiter.si/assets/editor.js?token=secret')).toBe('editor.js')
 expect(sourceFile('/private/Smith.docx')).toBe('[file]')
})
