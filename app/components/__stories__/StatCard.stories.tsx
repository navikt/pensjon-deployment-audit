import { HGrid } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { StatCard } from '../StatCard'

const meta: Meta<typeof StatCard> = {
  title: 'Components/StatCard',
  component: StatCard,
}

export default meta

type Story = StoryObj<typeof StatCard>

export const Default: Story = {
  args: {
    label: 'Totalt deployments',
    value: 42,
  },
}

export const WithSubtitle: Story = {
  args: {
    label: 'Totalt deployments',
    value: 42,
    subtitle: 'Siste 7 dager',
  },
}

export const SuccessVariant: Story = {
  name: 'Variant: Success',
  args: {
    label: 'Godkjente',
    value: 38,
    variant: 'success',
  },
}

export const DangerVariant: Story = {
  name: 'Variant: Danger',
  args: {
    label: 'Avviste',
    value: 2,
    variant: 'danger',
  },
}

export const WarningVariant: Story = {
  name: 'Variant: Warning',
  args: {
    label: 'Venter godkjenning',
    value: 5,
    variant: 'warning',
  },
}

export const Selected: Story = {
  name: 'Selected state',
  args: {
    label: 'Alle deployments',
    value: 42,
    selected: true,
  },
}

export const Compact: Story = {
  args: {
    label: 'Deployments',
    value: 12,
    compact: true,
  },
}

export const AsLink: Story = {
  name: 'Som lenke',
  args: {
    label: 'Se alle deployments',
    value: 42,
    to: '/deployments',
  },
}

export const AsButton: Story = {
  name: 'Som knapp',
  args: {
    label: 'Filtrer på godkjente',
    value: 38,
    variant: 'success',
    onClick: () => alert('Klikket!'),
  },
}

export const Grid: Story = {
  name: 'I et grid',
  render: () => (
    <HGrid columns={{ xs: 2, md: 4 }} gap="space-16">
      <StatCard label="Totalt" value={42} />
      <StatCard label="Godkjente" value={38} variant="success" />
      <StatCard label="Venter" value={2} variant="warning" />
      <StatCard label="Avviste" value={2} variant="danger" />
    </HGrid>
  ),
}

export const AllVariants: Story = {
  name: 'Alle varianter',
  render: () => (
    <HGrid columns={{ xs: 2, md: 4 }} gap="space-16">
      <StatCard label="Default" value={100} />
      <StatCard label="Success" value={80} variant="success" />
      <StatCard label="Warning" value={15} variant="warning" />
      <StatCard label="Danger" value={5} variant="danger" />
    </HGrid>
  ),
}
