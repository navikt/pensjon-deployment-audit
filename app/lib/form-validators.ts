const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAV_IDENT_REGEX = /^[a-zA-Z]\d{6}$/
const SLACK_CHANNEL_REGEX = /^(C[A-Z0-9]+|#[\w-]+)$/i

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value)
}

export function isValidNavIdent(value: string): boolean {
  return NAV_IDENT_REGEX.test(value)
}

export function isValidSlackChannel(value: string): boolean {
  return SLACK_CHANNEL_REGEX.test(value)
}
