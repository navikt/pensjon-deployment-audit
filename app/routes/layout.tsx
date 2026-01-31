import { MoonIcon, SunIcon } from '@navikt/aksel-icons'
import { Button, InternalHeader, Spacer } from '@navikt/ds-react'
import { Link, Outlet, useLocation } from 'react-router'
import { useTheme } from '~/hooks/useTheme'
import styles from '../styles/common.module.css'

export default function Layout() {
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/'
    }
    return location.pathname.startsWith(path)
  }

  return (
    <div className={styles.layoutContainer}>
      <InternalHeader>
        <InternalHeader.Title as={Link} to="/">
          Pensjon Deployment Audit
        </InternalHeader.Title>
        <Spacer />
        <nav className={styles.navContainer}>
          <Link to="/apps" className={isActive('/apps') ? styles.navLinkActive : styles.navLink}>
            Applikasjoner
          </Link>
          <Link to="/deployments" className={isActive('/deployments') ? styles.navLinkActive : styles.navLink}>
            Deployments
          </Link>
          <Link to="/alerts" className={isActive('/alerts') ? styles.navLinkActive : styles.navLink}>
            Varsler
          </Link>
          <Link to="/admin/users" className={isActive('/admin') ? styles.navLinkActive : styles.navLink}>
            Admin
          </Link>
        </nav>
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
