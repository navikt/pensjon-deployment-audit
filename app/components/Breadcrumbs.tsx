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
  '/apps': { label: 'Applikasjoner' },
  '/apps/discover': { label: 'Oppdag' },
  '/deployments': { label: 'Deployments' },
  '/deployments/verify': { label: 'Verifiser' },
  '/alerts': { label: 'Varsler' },
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
  getParentLabel?: (matches: ReturnType<typeof useMatches>) => string
}> = [
  {
    pattern: /^\/apps\/(\d+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => m.pathname.match(/^\/apps\/\d+$/))
      const data = match?.data as { app?: { app_name?: string } } | undefined
      return data?.app?.app_name || 'Applikasjon'
    },
    parent: '/apps',
  },
  {
    pattern: /^\/apps\/(\d+)\/deployments$/,
    getLabel: () => 'Deployments',
    parent: '/apps/:id',
    getParentLabel: (matches) => {
      // Find the match that has app data (the deployments route itself has app in loader)
      const match = matches.find((m) => m.pathname.match(/^\/apps\/\d+\/deployments$/))
      const data = match?.data as { app?: { app_name?: string } } | undefined
      return data?.app?.app_name || 'Applikasjon'
    },
  },
  {
    pattern: /^\/deployments\/(\d+)$/,
    getLabel: (matches) => {
      const match = matches.find((m) => m.pathname.match(/^\/deployments\/\d+$/))
      const data = match?.data as { deployment?: { commit_sha?: string } } | undefined
      const sha = data?.deployment?.commit_sha
      return sha ? sha.substring(0, 7) : 'Deployment'
    },
    parent: '/deployments',
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
  path: string
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
      if (dynamic.parent === '/apps/:id') {
        // Special case: need to get app breadcrumb first
        const appMatch = pathname.match(/^\/apps\/(\d+)/)
        if (appMatch) {
          crumbs.push({ path: '/apps', label: 'Applikasjoner' })
          const appPath = `/apps/${appMatch[1]}`
          // Use getParentLabel if available, otherwise fallback to first dynamic config
          const appLabel = dynamic.getParentLabel
            ? dynamic.getParentLabel(matches)
            : dynamicBreadcrumbs[0].getLabel(matches, appPath)
          crumbs.push({ path: appPath, label: appLabel })
        }
      } else if (dynamic.parent && breadcrumbConfig[dynamic.parent]) {
        // Add static parent
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

            return (
              <HStack key={crumb.path} gap="space-4" align="center">
                {index > 0 && <ChevronRightIcon aria-hidden fontSize="1rem" />}
                {isLast ? (
                  <Detail aria-current="page">{isHome ? <HouseIcon aria-label="Hjem" /> : crumb.label}</Detail>
                ) : (
                  <Link to={crumb.path} style={{ textDecoration: 'none' }}>
                    <Detail className="breadcrumb-link">
                      {isHome ? <HouseIcon aria-label="Hjem" fontSize="1rem" /> : crumb.label}
                    </Detail>
                  </Link>
                )}
              </HStack>
            )
          })}
        </HStack>
      </nav>
    </Box>
  )
}
