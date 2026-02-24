import { ChevronDownIcon, MenuHamburgerIcon, MoonIcon, SunIcon } from '@navikt/aksel-icons'
import {
  ActionMenu,
  Alert,
  BodyShort,
  Detail,
  Hide,
  HStack,
  InternalHeader,
  Page,
  Show,
  Spacer,
  VStack,
} from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { isRouteErrorResponse, Link, Outlet, useLocation, useNavigate, useRouteError } from 'react-router'
import { Breadcrumbs } from '~/components/Breadcrumbs'
import { SearchDialog } from '~/components/SearchDialog'
import { getUserMappingByNavIdent } from '~/db/user-mappings.server'
import { useTheme } from '~/hooks/useTheme'
import { requireUser } from '~/lib/auth.server'
import styles from '../styles/common.module.css'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const identity = await requireUser(request)

  // Try to get display name from user mappings
  const userMapping = await getUserMappingByNavIdent(identity.navIdent)

  return {
    user: {
      navIdent: identity.navIdent,
      displayName: userMapping?.display_name || identity.name || identity.navIdent,
      email: userMapping?.nav_email || identity.email || null,
      role: identity.role,
    },
  }
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const [_searchQuery, setSearchQuery] = useState('')

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  // Only show admin nav item for admin users
  const navItems = user.role === 'admin' ? [{ path: '/admin', label: 'Admin' }] : []

  // Clear search on navigation
  const prevPathRef = useRef(location.pathname)
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setSearchQuery('')
      prevPathRef.current = location.pathname
    }
  })

  return (
    <div className={styles.layoutContainer}>
      <InternalHeader>
        {/* Mobile: Hamburger menu on the left */}
        <ActionMenu>
          <Hide above="md" asChild>
            <ActionMenu.Trigger>
              <InternalHeader.Button>
                <MenuHamburgerIcon title="Meny" style={{ fontSize: '1.5rem' }} />
              </InternalHeader.Button>
            </ActionMenu.Trigger>
          </Hide>
          <ActionMenu.Content>
            <ActionMenu.Group label="Navigasjon">
              <ActionMenu.Item
                onSelect={() => navigate('/search')}
                className={isActive('/search') ? styles.navLinkActive : undefined}
              >
                Søk
              </ActionMenu.Item>
              {navItems.map((item) => (
                <ActionMenu.Item
                  key={item.path}
                  onSelect={() => navigate(item.path)}
                  className={isActive(item.path) ? styles.navLinkActive : undefined}
                >
                  {item.label}
                </ActionMenu.Item>
              ))}
            </ActionMenu.Group>
          </ActionMenu.Content>
        </ActionMenu>

        <InternalHeader.Title as={Link} to="/">
          Pensjon Deployment Audit
        </InternalHeader.Title>

        {/* Global search dialog */}
        <Show above="md" asChild>
          <HStack align="center" style={{ alignSelf: 'center', paddingInline: 'var(--ax-space-20)' }}>
            <SearchDialog />
          </HStack>
        </Show>

        <Spacer />

        {/* Desktop: Inline navigation */}
        {navItems.map((item) => (
          <Show key={item.path} above="md" asChild>
            <InternalHeader.Title
              as={Link}
              to={item.path}
              className={isActive(item.path) ? styles.navLinkActive : styles.navLink}
            >
              {item.label}
            </InternalHeader.Title>
          </Show>
        ))}

        {/* User menu */}
        {user ? (
          <ActionMenu>
            <ActionMenu.Trigger>
              <InternalHeader.Button
                style={{
                  paddingRight: 'var(--ax-space-16)',
                  paddingLeft: 'var(--ax-space-16)',
                  gap: 'var(--ax-space-8)',
                }}
              >
                <BodyShort size="small">{user.displayName}</BodyShort>
                <ChevronDownIcon title="Brukermeny" />
              </InternalHeader.Button>
            </ActionMenu.Trigger>
            <ActionMenu.Content align="end">
              <ActionMenu.Label>
                <dl style={{ margin: 0 }}>
                  <BodyShort as="dt" size="small" weight="semibold">
                    {user.displayName}
                  </BodyShort>
                  <Detail as="dd" style={{ margin: 0 }}>
                    {user.navIdent}
                  </Detail>
                </dl>
              </ActionMenu.Label>
              <ActionMenu.Divider />
              <ActionMenu.Group label="Tema">
                <ActionMenu.Item
                  onSelect={() => setTheme('light')}
                  disabled={theme === 'light'}
                  icon={<SunIcon aria-hidden style={{ fontSize: '1.5rem' }} />}
                >
                  Lyst tema
                </ActionMenu.Item>
                <ActionMenu.Item
                  onSelect={() => setTheme('dark')}
                  disabled={theme === 'dark'}
                  icon={<MoonIcon aria-hidden style={{ fontSize: '1.5rem' }} />}
                >
                  Mørkt tema
                </ActionMenu.Item>
              </ActionMenu.Group>
            </ActionMenu.Content>
          </ActionMenu>
        ) : (
          <InternalHeader.Button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? (
              <MoonIcon title="Bytt til mørkt tema" style={{ fontSize: '1.5rem' }} />
            ) : (
              <SunIcon title="Bytt til lyst tema" style={{ fontSize: '1.5rem' }} />
            )}
          </InternalHeader.Button>
        )}
      </InternalHeader>

      <Page>
        <VStack gap="space-32">
          <Breadcrumbs />
          <Page.Block as="main" width="2xl" gutters>
            <Outlet />
          </Page.Block>
        </VStack>
      </Page>
    </div>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()

  let title = 'Noe gikk galt'
  let message = 'En uventet feil oppstod.'

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Siden ble ikke funnet' : `Feil ${error.status}`
    message = error.status === 404 ? 'Siden du leter etter finnes ikke.' : error.statusText || message
  } else if (error instanceof Error) {
    message = error.message
  }

  return (
    <div className={styles.layoutContainer}>
      <Page>
        <Page.Block as="main" width="2xl" gutters>
          <VStack gap="space-16">
            <Alert variant="error">
              <VStack gap="space-8">
                <strong>{title}</strong>
                <span>{message}</span>
              </VStack>
            </Alert>
          </VStack>
        </Page.Block>
      </Page>
    </div>
  )
}
