/**
 * Authentication utilities for extracting user identity from tokens.
 *
 * In production (Nais), Wonderwall login proxy adds Bearer tokens with NAV-ident claims.
 * In development, we fall back to a mock identity from environment variables.
 */

interface TokenPayload {
  NAVident?: string
  navident?: string
  name?: string
  preferred_username?: string
  email?: string
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
}

/**
 * Extract user identity from request.
 *
 * - In production: Parses Bearer token from Authorization header
 * - In development (outside cluster): Falls back to DEV_NAV_IDENT env var
 *
 * @returns UserIdentity if authenticated, null otherwise
 */
export function getUserIdentity(request: Request): UserIdentity | null {
  const authHeader = request.headers.get('Authorization')

  // Try to parse real token first (works in both dev and prod)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = parseTokenPayload(token)

    if (payload) {
      const navIdent = payload.NAVident || payload.navident
      if (navIdent) {
        return {
          navIdent,
          name: payload.name,
          email: payload.email || payload.preferred_username,
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
    if (devIdent) {
      console.warn('⚠️ DEV MODE: Using mock NAV-ident:', devIdent)
      return {
        navIdent: devIdent,
        name: 'Development User',
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
 * Require authentication - throws Response if not authenticated.
 *
 * @throws Response with 401 status if not authenticated
 */
export function requireAuth(request: Request): UserIdentity {
  const identity = getUserIdentity(request)
  if (!identity) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return identity
}
