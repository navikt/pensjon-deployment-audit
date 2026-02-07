import { Button, Heading, HStack, VStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'

/**
 * Generelle Aksel-eksempler.
 *
 * Se egne stories for prosjektspesifikke komponenter:
 * - DeploymentTags - MethodTag og StatusTag
 * - StatCard - Statistikk-kort
 * - Breadcrumbs - Brødsmulesti
 * - SearchDialog - Global søk
 */
const meta: Meta = {
  title: 'Aksel/Examples',
}

export default meta

type Story = StoryObj

export const ButtonVariants: Story = {
  name: 'Button Variants',
  render: () => (
    <VStack gap="space-16">
      <Heading size="small">Knappevarianter</Heading>
      <HStack gap="space-8">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="tertiary">Tertiary</Button>
        <Button variant="danger">Danger</Button>
      </HStack>
      <HStack gap="space-8">
        <Button variant="primary" size="small">
          Small
        </Button>
        <Button variant="primary" size="medium">
          Medium
        </Button>
      </HStack>
    </VStack>
  ),
}
