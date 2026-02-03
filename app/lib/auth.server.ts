/**
 * Authentication utilities for extracting user identity from tokens.
 *
 * In production (Nais), Wonderwall login proxy adds Bearer tokens with NAV-ident claims.
 * In development, we fall back to a mock identity from environment variables.
 */

// Entra ID group IDs
const GROUP_ADMIN = '1e97cbc6-0687-4d23-aebd-c611035279c1' // pensjon-revisjon
const GROUP_USER = '415d3817-c83d-44c9-a52b-5116757f8fa8' // teampensjon

export type UserRole = 'admin' | 'user'

interface TokenPayload {
  NAVident?: string
  navident?: string
  name?: string
  preferred_username?: string
  email?: string
  groups?: string[]
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development'
}

function isInNaisCluster(): boolean {
  return !!process.env.NAIS_CLUSTER_NAME
}

/**
 * Parse JWT payload without verification.
 * In production, token is already verified by Wonderwall.
 */
function parseTokenPayload(token: string): TokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload
  } catch {
    return null
  }
}

export interface UserIdentity {
  navIdent: string
  name?: string
  email?: string
  role: UserRole
}

/**
 * Determine user role from group memberships.
 * Admin takes precedence if user is in both groups.
 */
function getRoleFromGroups(groups: string[] | undefined): UserRole | null {
  if (!groups || groups.length === 0) return null
  if (groups.includes(GROUP_ADMIN)) return 'admin'
  if (groups.includes(GROUP_USER)) return 'user'
  return null
}

/**
 * Extract user identity from request.
 *
 * - In production: Parses Bearer token from Authorization header
 * - In development (outside cluster): Falls back to DEV_NAV_IDENT and DEV_USER_ROLE env vars
 *
 * @returns UserIdentity if authenticated and authorized, null otherwise
 */
export function getUserIdentity(request: Request): UserIdentity | null {
  const authHeader = request.headers.get('Authorization')

  // Try to parse real token first (works in both dev and prod)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = parseTokenPayload(token)

    if (payload) {
      const navIdent = payload.NAVident || payload.navident
      const role = getRoleFromGroups(payload.groups)

      if (navIdent && role) {
        return {
          navIdent,
          name: payload.name,
          email: payload.email || payload.preferred_username,
          role,
        }
      }
    }
  }

  // Development fallback - ONLY when:
  // 1. No valid token found AND
  // 2. Running in development mode AND
  // 3. NOT running in a Nais cluster
  if (isDevelopment() && !isInNaisCluster()) {
    const devIdent = process.env.DEV_NAV_IDENT
    const devRole = process.env.DEV_USER_ROLE as UserRole | undefined

    if (devIdent && devRole && (devRole === 'admin' || devRole === 'user')) {
      console.warn(`⚠️ DEV MODE: Using mock identity - NAV-ident: ${devIdent}, role: ${devRole}`)
      return {
        navIdent: devIdent,
        name: 'Development User',
        role: devRole,
      }
    }
  }

  return null
}

/**
 * Get NAV-ident from request (convenience function).
 *
 * @returns NAV-ident string if authenticated, null otherwise
 */
export function getNavIdent(request: Request): string | null {
  return getUserIdentity(request)?.navIdent || null
}

/**
 * Require user to be authenticated with at least 'user' role.
 * Throws 403 Response if not authorized.
 */
export function requireUser(request: Request): UserIdentity {
  const user = getUserIdentity(request)
  if (!user) {
    throw new Response('Forbidden - no valid authorization', { status: 403 })
  }
  return user
}

/**
 * Require user to be authenticated with 'admin' role.
 * Throws 403 Response if not authorized.
 */
export function requireAdmin(request: Request): UserIdentity {
  const user = getUserIdentity(request)
  if (!user || user.role !== 'admin') {
    throw new Response('Forbidden - admin access required', { status: 403 })
  }
  return user
}
