import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'
import './app.css'
import '@navikt/ds-css'
import { Page, Theme } from '@navikt/ds-react'
import { ThemeProvider, useTheme } from './hooks/useTheme'

// Server-side initialization (runs once on server startup)
if (typeof window === 'undefined') {
  import('./init.server').then(({ initializeServer }) => initializeServer())
}

export const links: Route.LinksFunction = () => []

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="no">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

function ThemedApp() {
  const { theme } = useTheme()
  return (
    <Theme theme={theme}>
      <Outlet />
    </Theme>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!'
  let details = 'An unexpected error occurred.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details = error.status === 404 ? 'The requested page could not be found.' : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <Theme theme="light">
      <Page>
        <Page.Block as="main" width="xl" gutters>
          <h1>{message}</h1>
          <p>{details}</p>
          {stack && (
            <pre className="error-stack">
              <code>{stack}</code>
            </pre>
          )}
        </Page.Block>
      </Page>
    </Theme>
  )
}
