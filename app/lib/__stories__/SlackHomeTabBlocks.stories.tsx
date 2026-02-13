import type { Meta, StoryObj } from '@storybook/react'
import { SlackBlockPreview } from '~/components/__stories__/SlackBlockPreview'
import { homeTabFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildHomeTabBlocks } from '~/lib/slack-blocks'

const meta: Meta<typeof SlackBlockPreview> = {
  title: 'Slack/Home Tab',
  component: SlackBlockPreview,
}

export default meta
type Story = StoryObj<typeof SlackBlockPreview>

export const WithIssues: Story = {
  name: '🔔 Med mangler',
  args: {
    blocks: buildHomeTabBlocks(homeTabFixtures.withIssues),
  },
}

export const NoIssues: Story = {
  name: '✅ Ingen mangler',
  args: {
    blocks: buildHomeTabBlocks(homeTabFixtures.noIssues),
  },
}

export const NoGithubUser: Story = {
  name: '👤 Uten GitHub-kobling',
  args: {
    blocks: buildHomeTabBlocks(homeTabFixtures.noGithubUser),
  },
}
