import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  browserPrint,
  documentPrintPageRule,
  requestDocumentPrint,
} from './document-print'

describe('document print outcome', () => {
  it('reports printed once the platform print dialog opens', () => {
    const print = vi.fn()
    expect(requestDocumentPrint(print)).toEqual({ status: 'printed' })
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported instead of throwing when the platform has no print', () => {
    expect(requestDocumentPrint(undefined)).toEqual({ status: 'unsupported' })
  })

  it('reports a visible failure message when printing throws', () => {
    const print = vi.fn(() => {
      throw new Error('printer offline')
    })
    expect(requestDocumentPrint(print)).toEqual({
      status: 'failed',
      message: 'printer offline',
    })
  })

  it('reports a generic failure message for a non-Error throw', () => {
    const print = vi.fn(() => {
      throw 'not an error'
    })
    expect(requestDocumentPrint(print)).toEqual({
      status: 'failed',
      message: 'Printing failed.',
    })
  })
})

describe('browser print capability', () => {
  it('returns the bound print function when the platform exposes one', () => {
    expect(typeof browserPrint()).toBe('function')
  })

  it('returns undefined when the platform has no print function', () => {
    const original = window.print
    Object.defineProperty(window, 'print', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    try {
      expect(browserPrint()).toBeUndefined()
    } finally {
      Object.defineProperty(window, 'print', {
        value: original,
        configurable: true,
        writable: true,
      })
    }
  })
})

describe('document print page rule', () => {
  it('sizes the printed sheet to the document page box, not an assumed A4', () => {
    expect(documentPrintPageRule({ widthPx: 794, heightPx: 1123 })).toBe(
      '@page{size:8.2708in 11.6979in;margin:0}',
    )
    expect(documentPrintPageRule({ widthPx: 816, heightPx: 1056 })).toBe(
      '@page{size:8.5in 11in;margin:0}',
    )
  })
})
