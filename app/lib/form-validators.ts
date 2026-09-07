const NAV_IDENT_REGEX = /^[a-zA-Z]\d{6}$/
const SLACK_CHANNEL_REGEX = /^(C[A-Z0-9]+|#[\w-]+)$/i
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9]))*$/

export function isValidNavIdent(value: string): boolean {
  return NAV_IDENT_REGEX.test(value)
}

export function isValidSlackChannel(value: string): boolean {
  return SLACK_CHANNEL_REGEX.test(value)
}

export function isValidGitHubUsername(value: string): boolean {
  return value.length <= 39 && GITHUB_USERNAME_REGEX.test(value)
}

export function getFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : null
}
