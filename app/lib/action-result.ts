/**
 * Standardized action response type for route actions.
 *
 * All actions should return ActionResult so that ActionAlert
 * can display feedback consistently.
 */
export type ActionResult = {
  success?: string
  error?: string
}

/** Return a success result */
export function ok(message: string): ActionResult {
  return { success: message }
}

/** Return an error result */
export function fail(message: string): ActionResult {
  return { error: message }
}
