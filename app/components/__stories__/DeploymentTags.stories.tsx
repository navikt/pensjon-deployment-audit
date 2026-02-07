import type { Meta, StoryObj } from '@storybook/react'
import { MethodTag, StatusTag } from '../deployment-tags'

const meta: Meta = {
  title: 'Components/DeploymentTags',
}

export default meta

type Story = StoryObj

/**
 * MethodTag viser hvordan en deployment ble gjort (PR, Direct Push, Legacy)
 */
export const MethodTagVariants: Story = {
  name: 'MethodTag - Alle varianter',
  render: () => (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <MethodTag github_pr_number={123} four_eyes_status="approved" />
      <MethodTag github_pr_number={null} four_eyes_status="direct_push" />
      <MethodTag github_pr_number={null} four_eyes_status="legacy" />
      <MethodTag github_pr_number={null} four_eyes_status="pending" />
    </div>
  ),
}

/**
 * StatusTag viser godkjenningsstatus for en deployment
 */
export const StatusTagApproved: Story = {
  name: 'StatusTag - Godkjent',
  render: () => <StatusTag four_eyes_status="approved" has_four_eyes={true} />,
}

export const StatusTagPending: Story = {
  name: 'StatusTag - Venter',
  render: () => <StatusTag four_eyes_status="pending" has_four_eyes={false} />,
}

export const StatusTagDirectPush: Story = {
  name: 'StatusTag - Direct Push (ikke godkjent)',
  render: () => <StatusTag four_eyes_status="direct_push" has_four_eyes={false} />,
}

export const StatusTagUnverifiedCommits: Story = {
  name: 'StatusTag - Uverifiserte commits',
  render: () => <StatusTag four_eyes_status="unverified_commits" has_four_eyes={false} />,
}

export const StatusTagUnreviewed: Story = {
  name: 'StatusTag - Godkjent PR med ureviewed commits',
  render: () => <StatusTag four_eyes_status="approved_pr_with_unreviewed" has_four_eyes={false} />,
}

export const StatusTagError: Story = {
  name: 'StatusTag - Feil',
  render: () => <StatusTag four_eyes_status="error" has_four_eyes={false} />,
}

export const StatusTagLegacy: Story = {
  name: 'StatusTag - Legacy',
  render: () => <StatusTag four_eyes_status="legacy" has_four_eyes={false} />,
}

export const AllStatusTags: Story = {
  name: 'StatusTag - Alle varianter',
  render: () => (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <StatusTag four_eyes_status="approved" has_four_eyes={true} />
      <StatusTag four_eyes_status="pending" has_four_eyes={false} />
      <StatusTag four_eyes_status="direct_push" has_four_eyes={false} />
      <StatusTag four_eyes_status="unverified_commits" has_four_eyes={false} />
      <StatusTag four_eyes_status="approved_pr_with_unreviewed" has_four_eyes={false} />
      <StatusTag four_eyes_status="error" has_four_eyes={false} />
      <StatusTag four_eyes_status="legacy" has_four_eyes={false} />
    </div>
  ),
}
