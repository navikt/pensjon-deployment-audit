import type { Meta, StoryObj } from '@storybook/react'
import { SlackBlockPreview } from '~/components/__stories__/SlackBlockPreview'
import { deviationFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildDeviationBlocks } from '~/lib/slack'

const meta: Meta<typeof SlackBlockPreview> = {
  title: 'Slack/Deviation Notification',
  component: SlackBlockPreview,
}

export default meta
type Story = StoryObj<typeof SlackBlockPreview>

export const Standard: Story = {
  name: '⚠️ Avvik registrert',
  args: {
    blocks: buildDeviationBlocks(deviationFixtures.standard),
  },
}

export const ShortReason: Story = {
  name: '⚠️ Minimal (kun beskrivelse)',
  args: {
    blocks: buildDeviationBlocks(deviationFixtures.shortReason),
  },
}

export const Critical: Story = {
  name: '🚨 Kritisk avvik',
  args: {
    blocks: buildDeviationBlocks(deviationFixtures.critical),
  },
}
