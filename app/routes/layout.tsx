import { MenuHamburgerIcon, MoonIcon, SunIcon } from '@navikt/aksel-icons'
import { ActionMenu, Hide, InternalHeader, Show, Spacer } from '@navikt/ds-react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { useTheme } from '~/hooks/useTheme'
import styles from '../styles/common.module.css'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  const navItems = [
    { path: '/apps', label: 'Applikasjoner' },
    { path: '/deployments', label: 'Deployments' },
    { path: '/alerts', label: 'Varsler' },
    { path: '/admin', label: 'Admin' },
  ]

  return (
    <div className={styles.layoutContainer}>
      <InternalHeader>
        {/* Mobile: Hamburger menu on the left */}
        <Hide above="md">
          <ActionMenu>
            <ActionMenu.Trigger>
              <InternalHeader.Button>
                <MenuHamburgerIcon title="Meny" style={{ fontSize: '1.5rem' }} />
              </InternalHeader.Button>
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              <ActionMenu.Group label="Navigasjon">
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
        </Hide>

        <InternalHeader.Title as={Link} to="/">
          Pensjon Deployment Audit
        </InternalHeader.Title>
        <Spacer />

        {/* Desktop: Inline navigation */}
        <Show above="md">
          <nav className={styles.navContainer}>
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={isActive(item.path) ? styles.navLinkActive : styles.navLink}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </Show>

        <InternalHeader.Button onClick={toggleTheme}>
          {theme === 'light' ? (
            <MoonIcon title="Bytt til mørkt tema" style={{ fontSize: '1.5rem' }} />
          ) : (
            <SunIcon title="Bytt til lyst tema" style={{ fontSize: '1.5rem' }} />
          )}
        </InternalHeader.Button>
      </InternalHeader>

      <div className={styles.layoutMain}>
        <Outlet />
      </div>
    </div>
  )
}
