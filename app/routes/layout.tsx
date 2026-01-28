import {InternalHeader, Spacer, Theme} from '@navikt/ds-react';
import { Link, Outlet, useLocation } from 'react-router';

export default function Layout() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <InternalHeader>
        <InternalHeader.Title as={Link} to="/">
          Pensjon Deployment Audit
        </InternalHeader.Title>
        <Spacer />
        <nav style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link
            to="/repos"
            style={{
              textDecoration: 'none',
              color: isActive('/repos') ? '#0067C5' : 'inherit',
              fontWeight: isActive('/repos') ? 600 : 400,
            }}
          >
            Repositories
          </Link>
          <Link
            to="/deployments"
            style={{
              textDecoration: 'none',
              color: isActive('/deployments') ? '#0067C5' : 'inherit',
              fontWeight: isActive('/deployments') ? 600 : 400,
            }}
          >
            Deployments
          </Link>
          <Link
            to="/tertial-boards"
            style={{
              textDecoration: 'none',
              color: isActive('/tertial-boards') ? '#0067C5' : 'inherit',
              fontWeight: isActive('/tertial-boards') ? 600 : 400,
            }}
          >
            Tertialtavler
          </Link>
        </nav>
      </InternalHeader>

      <div
        style={{ flex: 1, padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto' }}
      >
        <Theme theme='light'>

        <Outlet />
        </Theme>
      </div>
    </div>
  );
}
