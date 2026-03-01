import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { logger } from '~/lib/logger.server'

let octokit: Octokit | null = null
let requestCount = 0

/**
 * Get GitHub client - supports both GitHub App and PAT authentication
 * GitHub App is preferred (higher rate limits, better security)
 */
export function getGitHubClient(): Octokit {
  if (!octokit) {
    const appId = process.env.GITHUB_APP_ID
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID
    const pat = process.env.GITHUB_TOKEN

    // Prefer GitHub App authentication
    if (appId && privateKey && installationId) {
      logger.info('🔐 Using GitHub App authentication')

      // Handle private key - can be base64 encoded or raw PEM
      let decodedPrivateKey = privateKey
      if (!privateKey.includes('-----BEGIN')) {
        // Assume base64 encoded
        decodedPrivateKey = Buffer.from(privateKey, 'base64').toString('utf-8')
      }

      octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: parseInt(appId, 10),
          privateKey: decodedPrivateKey,
          installationId: parseInt(installationId, 10),
        },
        log: {
          debug: () => {},
          info: () => {},
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
        },
      })
    } else if (pat) {
      // Fallback to Personal Access Token
      logger.info('🔑 Using Personal Access Token authentication')

      octokit = new Octokit({
        auth: pat,
        log: {
          debug: () => {},
          info: () => {},
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
        },
      })
    } else {
      throw new Error(
        'GitHub authentication not configured. Set either GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + GITHUB_APP_INSTALLATION_ID, or GITHUB_TOKEN',
      )
    }

    // Add request hook for logging
    octokit.hook.before('request', (options) => {
      requestCount++
      const method = options.method || 'GET'
      let url = options.url?.replace('https://api.github.com', '') || options.baseUrl || ''

      // Replace template variables with actual values for debug logging
      if (options.owner) url = url.replace('{owner}', options.owner as string)
      if (options.repo) url = url.replace('{repo}', options.repo as string)
      if (options.pull_number) url = url.replace('{pull_number}', String(options.pull_number))
      if (options.commit_sha) url = url.replace('{commit_sha}', (options.commit_sha as string).substring(0, 7))
      if (options.ref) url = url.replace('{ref}', (options.ref as string).substring(0, 7))
      if (options.issue_number) url = url.replace('{issue_number}', String(options.issue_number))
      if (options.base && options.head) {
        url = url.replace('{base}', (options.base as string).substring(0, 7))
        url = url.replace('{head}', (options.head as string).substring(0, 7))
      }

      // Add page number if paginating
      const pageInfo = options.page ? ` (page ${options.page})` : ''

      logger.info(`🌐 [GitHub #${requestCount}] ${method} ${url}${pageInfo}`)
    })

    // Add response hook for rate limit info
    octokit.hook.after('request', (response, _options) => {
      const remaining = response.headers['x-ratelimit-remaining']
      const limit = response.headers['x-ratelimit-limit']
      if (remaining && parseInt(remaining, 10) < 100) {
        logger.warn(`⚠️  GitHub rate limit: ${remaining}/${limit} remaining`)
      }
    })
  }

  return octokit
}
