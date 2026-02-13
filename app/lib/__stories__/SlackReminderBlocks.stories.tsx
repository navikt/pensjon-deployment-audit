import type { Meta, StoryObj } from '@storybook/react'
import { SlackBlockPreview } from '~/components/__stories__/SlackBlockPreview'
import { reminderFixtures } from '~/lib/__fixtures__/slack-fixtures'
import { buildReminderBlocks } from '~/lib/slack-blocks'

const meta: Meta<typeof SlackBlockPreview> = {
  title: 'Slack/Reminder Notification',
  component: SlackBlockPreview,
}

export default meta
type Story = StoryObj<typeof SlackBlockPreview>

export const SingleDeployment: Story = {
  name: '🔔 Én deployment',
  args: {
    blocks: buildReminderBlocks(reminderFixtures.singleDeployment),
  },
}

export const FewDeployments: Story = {
  name: '🔔 Få deployments (≤5, med detaljer)',
  args: {
    blocks: buildReminderBlocks(reminderFixtures.fewDeployments),
  },
}

export const ManyDeployments: Story = {
  name: '🔔 Mange deployments (>5, sammendrag)',
  args: {
    blocks: buildReminderBlocks(reminderFixtures.manyDeployments),
  },
}
