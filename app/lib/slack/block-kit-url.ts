import type { KnownBlock } from '@slack/types'

const BLOCK_KIT_BUILDER_BASE = 'https://app.slack.com/block-kit-builder'

/**
 * Build a Slack Block Kit Builder URL that opens with the given blocks pre-loaded.
 *
 * The Block Kit Builder accepts the full payload as a URL fragment (after #),
 * JSON-encoded and URI-encoded.
 */
export function buildBlockKitBuilderUrl(blocks: KnownBlock[], mode: 'message' | 'modal' = 'message'): string {
  const payload =
    mode === 'modal' ? { type: 'modal', title: { type: 'plain_text', text: 'Preview' }, blocks } : { blocks }

  return `${BLOCK_KIT_BUILDER_BASE}#${encodeURIComponent(JSON.stringify(payload))}`
}

/** Max safe URL length (~16KB). Block Kit Builder may not load URLs beyond this. */
const MAX_URL_LENGTH = 16_000

export function isUrlTooLong(url: string): boolean {
  return url.length > MAX_URL_LENGTH
}
