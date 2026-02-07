import { ChevronRightIcon, HouseIcon } from '@navikt/aksel-icons'
import { Box, Detail, HStack } from '@navikt/ds-react'
import type { Meta, StoryObj } from '@storybook/react'
import { Link, MemoryRouter } from 'react-router'

/**
 * Breadcrumbs viser brødsmulesti basert på nåværende rute.
 *
 * Siden den faktiske komponenten bruker useMatches (data router),
 * viser vi her mockede breadcrumbs for å demonstrere utseendet.
 */
const meta: Meta = {
  title: 'Components/Breadcrumbs',
  parameters: {
    router: { skip: true }, // Skip global MemoryRouter, we provide our own
  },
}

export default meta

type Story = StoryObj

interface Crumb {
  path: string | null
  label: string
}

function MockBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length <= 1) {
    return null
  }

  return (
    <Box paddingInline={{ xs: 'space-16', md: 'space-24' }} paddingBlock="space-12" background="sunken">
      <nav aria-label="Brødsmuler">
        <HStack gap="space-4" align="center" wrap>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1
            const isHome = crumb.path === '/'
            const isClickable = crumb.path !== null

            return (
              <HStack key={`${crumb.label}-${index}`} gap="space-4" align="center">
                {index > 0 && <ChevronRightIcon aria-hidden fontSize="1rem" />}
                {isLast ? (
                  <Detail aria-current="page">{isHome ? <HouseIcon aria-label="Hjem" /> : crumb.label}</Detail>
                ) : isClickable && crumb.path ? (
                  <Link to={crumb.path} style={{ textDecoration: 'none' }}>
                    <Detail className="breadcrumb-link">
                      {isHome ? <HouseIcon aria-label="Hjem" fontSize="1rem" /> : crumb.label}
                    </Detail>
                  </Link>
                ) : (
                  <Detail textColor="subtle">{crumb.label}</Detail>
                )}
              </HStack>
            )
          })}
        </HStack>
      </nav>
    </Box>
  )
}

export const Home: Story = {
  name: 'Hjem (ingen breadcrumbs)',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs crumbs={[{ path: '/', label: 'Hjem' }]} />
    </MemoryRouter>
  ),
}

export const AddApp: Story = {
  name: 'Legg til app',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs
        crumbs={[
          { path: '/', label: 'Hjem' },
          { path: '/apps/add', label: 'Legg til applikasjon' },
        ]}
      />
    </MemoryRouter>
  ),
}

export const Admin: Story = {
  name: 'Admin',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs
        crumbs={[
          { path: '/', label: 'Hjem' },
          { path: '/admin', label: 'Admin' },
        ]}
      />
    </MemoryRouter>
  ),
}

export const AdminUsers: Story = {
  name: 'Admin > Brukere',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs
        crumbs={[
          { path: '/', label: 'Hjem' },
          { path: '/admin', label: 'Admin' },
          { path: '/admin/users', label: 'Brukermappinger' },
        ]}
      />
    </MemoryRouter>
  ),
}

export const AppPage: Story = {
  name: 'App-side',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs
        crumbs={[
          { path: '/', label: 'Hjem' },
          { path: null, label: 'pensjondeployer' },
          { path: null, label: 'prod-fss' },
          { path: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen', label: 'pensjon-pen' },
        ]}
      />
    </MemoryRouter>
  ),
}

export const AppDeployments: Story = {
  name: 'App > Deployments',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs
        crumbs={[
          { path: '/', label: 'Hjem' },
          { path: null, label: 'pensjondeployer' },
          { path: null, label: 'prod-fss' },
          { path: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen', label: 'pensjon-pen' },
          { path: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments', label: 'Deployments' },
        ]}
      />
    </MemoryRouter>
  ),
}

export const DeploymentDetail: Story = {
  name: 'App > Deployments > Commit',
  render: () => (
    <MemoryRouter>
      <MockBreadcrumbs
        crumbs={[
          { path: '/', label: 'Hjem' },
          { path: null, label: 'pensjondeployer' },
          { path: null, label: 'prod-fss' },
          { path: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen', label: 'pensjon-pen' },
          { path: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments', label: 'Deployments' },
          { path: '/team/pensjondeployer/env/prod-fss/app/pensjon-pen/deployments/123', label: 'abc1234' },
        ]}
      />
    </MemoryRouter>
  ),
}
