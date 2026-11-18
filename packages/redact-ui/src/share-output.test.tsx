import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, mock } from 'bun:test'
import { ShareOutput } from './share-output'

const props = {
  ready: true,
  getBlob: () => new Blob(['Synthetic output'], { type: 'text/plain' }),
  filename: 'letter (redacted).txt',
}

function nativeShare(
  share: Navigator['share'],
  canShare: Navigator['canShare'],
) {
  Object.defineProperties(navigator, {
    share: { configurable: true, value: share },
    canShare: { configurable: true, value: canShare },
  })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

it('shows confirmation when native sharing succeeds', async () => {
  const share = mock(async () => undefined)
  nativeShare(share, () => true)
  render(<ShareOutput {...props} />)

  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  expect(await screen.findByText('Copy shared.')).toBeTruthy()
  expect(share).toHaveBeenCalledWith({
    files: [expect.objectContaining({ name: props.filename })],
    title: props.filename,
  })
})

it('reports when native sharing cannot handle the file', () => {
  const share = mock(async () => undefined)
  nativeShare(share, () => false)
  render(<ShareOutput {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Share' }))
  expect(
    screen.getByText('Download the copy to share it manually.'),
  ).toBeTruthy()
  expect(share).not.toHaveBeenCalled()
})

it('omits Share without a native sharing interface', () => {
  render(<ShareOutput {...props} />)
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
})
