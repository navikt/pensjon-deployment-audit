import { MenuHamburgerIcon, MoonIcon, SunIcon } from '@navikt/aksel-icons'
import { ActionMenu, Hide, HStack, InternalHeader, Search, Show, Spacer } from '@navikt/ds-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { Breadcrumbs } from '~/components/Breadcrumbs'
import { useTheme } from '~/hooks/useTheme'
import styles from '../styles/common.module.css'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [searchQuery, setSearchQuery] = useState('')

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  const navItems = [{ path: '/admin', label: 'Admin' }]

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

        {/* Global search */}
        <Show above="md" asChild>
          <HStack
            as="form"
            paddingInline="space-20"
            align="center"
            onSubmit={(e) => {
              e.preventDefault()
              if (searchQuery.trim()) {
                navigate(`/search?q=${encodeURIComponent(searchQuery)}`)
              }
            }}
          >
            <Search
              label="Søk"
              size="small"
              variant="simple"
              placeholder="Søk bruker, SHA, ID..."
              value={searchQuery}
              onChange={setSearchQuery}
              autoComplete="off"
            />
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

        <InternalHeader.Button onClick={toggleTheme}>
          {theme === 'light' ? (
            <MoonIcon title="Bytt til mørkt tema" style={{ fontSize: '1.5rem' }} />
          ) : (
            <SunIcon title="Bytt til lyst tema" style={{ fontSize: '1.5rem' }} />
          )}
        </InternalHeader.Button>
      </InternalHeader>

      <Breadcrumbs />

      <div className={styles.layoutMain}>
        <Outlet />
      </div>
    </div>
  )
}
