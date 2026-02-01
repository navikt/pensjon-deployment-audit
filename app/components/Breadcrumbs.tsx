import { ChevronRightIcon, HouseIcon } from '@navikt/aksel-icons'
import { Box, Detail, HStack } from '@navikt/ds-react'
import { Link, useLocation, useMatches } from 'react-router'

interface BreadcrumbConfig {
  label: string
  labelKey?: string // Key to look for in loader data for dynamic label
}

// Static breadcrumb configuration
const breadcrumbConfig: Record<string, BreadcrumbConfig> = {
  '/': { label: 'Hjem' },
  '/apps/discover': { label: 'Oppdag applikasjoner' },
  '/admin': { label: 'Admin' },
  '/admin/users': { label: 'Brukermappinger' },
  '/admin/sync-jobs': { label: 'Sync Jobs' },
  '/admin/audit-reports': { label: 'Revisjonsbevis' },
}

// Pattern-based config for dynamic routes
const dynamicBreadcrumbs: Array<{
  pattern: RegExp
  getLabel: (matches: ReturnType<typeof useMatches>, pathname: string) => string
  parent: string
  getParentLabel?: (matches: ReturnType<typeof useMatches>, pathname: string) => string
}> = [
  // New semantic URL structure: /team/:team/env/:env/app/:app
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
    parent: '/',
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/deployments$/,
    getLabel: () => 'Deployments',
    parent: '/team/:team/env/:env/app/:app',
    getParentLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
  },
  {
    pattern: /^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)\/deployments\/(\d+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => m.pathname.match(/^\/team\/[^/]+\/env\/[^/]+\/app\/[^/]+\/deployments\/\d+$/))
      const data = match?.data as { deployment?: { commit_sha?: string } } | undefined
      const sha = data?.deployment?.commit_sha
      return sha ? sha.substring(0, 7) : 'Deployment'
    },
    parent: '/team/:team/env/:env/app/:app/deployments',
    getParentLabel: (_matches, pathname) => {
      const appName = pathname.split('/')[6]
      return appName || 'Applikasjon'
    },
  },
  {
    pattern: /^\/users\/([^/]+)$/,
    getLabel: (_matches, pathname) => {
      const username = pathname.split('/')[2]
      return username || 'Bruker'
    },
    parent: '/',
  },
]

interface Crumb {
  path: string | null // null = not clickable
  label: string
}

function buildBreadcrumbs(pathname: string, matches: ReturnType<typeof useMatches>): Crumb[] {
  const crumbs: Crumb[] = []

  // Always start with home (but we'll show icon instead of "Hjem")
  if (pathname !== '/') {
    crumbs.push({ path: '/', label: 'Hjem' })
  }

  // Check static config first
  if (breadcrumbConfig[pathname]) {
    // Build path segments
    const segments = pathname.split('/').filter(Boolean)
    let currentPath = ''

    for (const segment of segments) {
      currentPath += `/${segment}`
      const config = breadcrumbConfig[currentPath]
      if (config) {
        crumbs.push({ path: currentPath, label: config.label })
      }
    }
    return crumbs
  }

  // Check dynamic patterns
  for (const dynamic of dynamicBreadcrumbs) {
    if (dynamic.pattern.test(pathname)) {
      // Add parent breadcrumbs first
      // Semantic URL structure: /team/:team/env/:env/app/:app/deployments/:id
      if (dynamic.parent === '/team/:team/env/:env/app/:app/deployments') {
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env, app] = semanticMatch
          const appPath = `/team/${team}/env/${env}/app/${app}`
          // Add team and env as non-clickable context
          crumbs.push({ path: null, label: team })
          crumbs.push({ path: null, label: env })
          crumbs.push({ path: appPath, label: app })
          crumbs.push({ path: `${appPath}/deployments`, label: 'Deployments' })
        }
      } else if (dynamic.parent === '/team/:team/env/:env/app/:app') {
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env, app] = semanticMatch
          const appPath = `/team/${team}/env/${env}/app/${app}`
          // Add team and env as non-clickable context
          crumbs.push({ path: null, label: team })
          crumbs.push({ path: null, label: env })
          crumbs.push({ path: appPath, label: app })
        }
      } else if (dynamic.parent === '/' && pathname.startsWith('/team/')) {
        // App detail page: add team and env as non-clickable context
        const semanticMatch = pathname.match(/^\/team\/([^/]+)\/env\/([^/]+)\/app\/([^/]+)/)
        if (semanticMatch) {
          const [, team, env] = semanticMatch
          crumbs.push({ path: null, label: team })
          crumbs.push({ path: null, label: env })
        }
      } else if (dynamic.parent && dynamic.parent !== '/' && breadcrumbConfig[dynamic.parent]) {
        // Add static parent (but not home, that's already added)
        const parentSegments = dynamic.parent.split('/').filter(Boolean)
        let parentPath = ''
        for (const seg of parentSegments) {
          parentPath += `/${seg}`
          if (breadcrumbConfig[parentPath]) {
            crumbs.push({ path: parentPath, label: breadcrumbConfig[parentPath].label })
          }
        }
      }

      // Add current dynamic crumb
      crumbs.push({ path: pathname, label: dynamic.getLabel(matches, pathname) })
      return crumbs
    }
  }

  return crumbs
}

export function Breadcrumbs() {
  const location = useLocation()
  const matches = useMatches()

  // Don't show breadcrumbs on home page
  if (location.pathname === '/') {
    return null
  }

  const crumbs = buildBreadcrumbs(location.pathname, matches)

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
