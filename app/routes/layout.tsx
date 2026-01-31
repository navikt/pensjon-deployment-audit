import { MenuHamburgerIcon, MoonIcon, SunIcon } from '@navikt/aksel-icons'
import { ActionMenu, Button, Hide, InternalHeader, Show, Spacer } from '@navikt/ds-react'
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
    { path: '/admin/users', label: 'Admin' },
  ]

  return (
    <div className={styles.layoutContainer}>
      <InternalHeader>
        <InternalHeader.Title as={Link} to="/">
          Pensjon Deployment Audit
        </InternalHeader.Title>
        <Spacer />

        {/* Desktop: Inline navigation */}
        <Show above="md" asChild>
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

        {/* Mobile: Hamburger menu */}
        <Hide above="md" asChild>
          <ActionMenu>
            <ActionMenu.Trigger>
              <InternalHeader.Button>
                <MenuHamburgerIcon title="Meny" style={{ fontSize: '1.5rem' }} />
              </InternalHeader.Button>
            </ActionMenu.Trigger>
            <ActionMenu.Content align="end">
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

        <Button
          variant="tertiary-neutral"
          size="small"
          icon={theme === 'light' ? <MoonIcon title="Bytt til mørkt tema" /> : <SunIcon title="Bytt til lyst tema" />}
          onClick={toggleTheme}
        />
      </InternalHeader>

      <div className={styles.layoutMain}>
        <Outlet />
      </div>
    </div>
  )
}
