import { VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { AppCard, type AppCardData } from '../AppCard'

const meta: Meta<typeof AppCard> = {
  title: 'Components/AppCard',
  component: AppCard,
}

export default meta

type Story = StoryObj<typeof AppCard>

const baseApp: AppCardData = {
  id: 1,
  team_slug: 'pensjondeployer',
  environment_name: 'prod-fss',
  app_name: 'pensjon-pen',
  active_repo: 'navikt/pensjon-pen',
  stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
  alertCount: 0,
}

export const Default: Story = {
  args: {
    app: baseApp,
  },
}

export const StatusOK: Story = {
  name: 'Status: OK',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
    },
  },
}

export const StatusMissing: Story = {
  name: 'Status: Mangler godkjenning (flertall)',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 3, pending_verification: 0 },
    },
  },
}

export const StatusMissingSingular: Story = {
  name: 'Status: Mangler godkjenning (entall)',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 1, pending_verification: 0 },
    },
  },
}

export const StatusPending: Story = {
  name: 'Status: Venter verifisering',
  args: {
    app: {
      ...baseApp,
      stats: { total: 42, without_four_eyes: 0, pending_verification: 5 },
    },
  },
}

export const StatusNoData: Story = {
  name: 'Status: Ingen data',
  args: {
    app: {
      ...baseApp,
      stats: { total: 0, without_four_eyes: 0, pending_verification: 0 },
    },
  },
}

export const WithAlerts: Story = {
  name: 'Med varsler',
  args: {
    app: {
      ...baseApp,
      alertCount: 2,
    },
  },
}

export const NoRepository: Story = {
  name: 'Uten aktivt repo',
  args: {
    app: {
      ...baseApp,
      active_repo: null,
    },
  },
}

export const HideEnvironment: Story = {
  name: 'Skjul miljø',
  args: {
    app: baseApp,
    showEnvironment: false,
  },
}

export const MultipleApps: Story = {
  name: 'Liste med flere apper',
  render: () => (
    <VStack gap="space-0">
      <AppCard
        app={{
          ...baseApp,
          id: 1,
          app_name: 'pensjon-pen',
          stats: { total: 42, without_four_eyes: 0, pending_verification: 0 },
        }}
      />
      <AppCard
        app={{
          ...baseApp,
          id: 2,
          app_name: 'pensjon-selvbetjening',
          stats: { total: 15, without_four_eyes: 2, pending_verification: 0 },
          alertCount: 1,
        }}
      />
      <AppCard
        app={{
          ...baseApp,
          id: 3,
          app_name: 'pensjon-opptjening',
          stats: { total: 8, without_four_eyes: 0, pending_verification: 3 },
        }}
      />
    </VStack>
  ),
}
