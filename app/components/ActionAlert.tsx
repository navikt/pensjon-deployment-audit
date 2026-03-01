import { Alert } from '@navikt/ds-react'

/**
 * Displays success and/or error alerts based on action data.
 * Replaces the common pattern of two conditional Alert renders in routes.
 */
export function ActionAlert({ data }: { data?: Record<string, unknown> | null }) {
  if (!data) return null
  const success = typeof data.success === 'string' ? data.success : null
  const error = typeof data.error === 'string' ? data.error : null
  return (
    <>
      {success && <Alert variant="success">{success}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}
    </>
  )
}
