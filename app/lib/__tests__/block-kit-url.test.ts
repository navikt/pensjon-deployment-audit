import type { KnownBlock } from '@slack/types'
import { describe, expect, it } from 'vitest'
import { buildBlockKitBuilderUrl, isUrlTooLong } from '../slack/block-kit-url'

describe('buildBlockKitBuilderUrl', () => {
  const sectionBlock: KnownBlock = {
    type: 'section',
    text: { type: 'mrkdwn', text: 'Hello' },
  }

  it('produces a valid Block Kit Builder URL', () => {
    const url = buildBlockKitBuilderUrl([sectionBlock])
    expect(url.startsWith('https://app.slack.com/block-kit-builder#')).toBe(true)
  })

  it('encodes blocks as JSON in the fragment', () => {
    const url = buildBlockKitBuilderUrl([sectionBlock])
    const fragment = url.split('#')[1]
    const decoded = JSON.parse(decodeURIComponent(fragment))
    expect(decoded.blocks).toEqual([sectionBlock])
  })

  it('defaults to message mode (no type field)', () => {
    const url = buildBlockKitBuilderUrl([sectionBlock])
    const fragment = url.split('#')[1]
    const decoded = JSON.parse(decodeURIComponent(fragment))
    expect(decoded.type).toBeUndefined()
  })

  it('includes modal wrapper when mode is modal', () => {
    const url = buildBlockKitBuilderUrl([sectionBlock], 'modal')
    const fragment = url.split('#')[1]
    const decoded = JSON.parse(decodeURIComponent(fragment))
    expect(decoded.type).toBe('modal')
    expect(decoded.title).toEqual({ type: 'plain_text', text: 'Preview' })
  })
})

describe('isUrlTooLong', () => {
  it('returns false for short URLs', () => {
    expect(isUrlTooLong('https://example.com')).toBe(false)
  })

  it('returns true for URLs exceeding 16000 chars', () => {
    const longUrl = 'x'.repeat(16_001)
    expect(isUrlTooLong(longUrl)).toBe(true)
  })

  it('returns false for exactly 16000 chars', () => {
    const url = 'x'.repeat(16_000)
    expect(isUrlTooLong(url)).toBe(false)
  })
})
