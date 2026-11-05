import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { Tabs, TabsList, TabsTrigger } from './tabs'

afterEach(() => cleanup())

describe('TabsTrigger', () => {
  it('styles the selected tab from aria-selected, the attribute the tab actually carries', () => {
    render(
      <Tabs defaultValue="b">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const selected = screen.getByRole('tab', { name: 'B' })
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(selected.className).toContain('aria-selected:bg-raised')
    expect(selected.className).toContain('aria-selected:ring-1')
  })
})
