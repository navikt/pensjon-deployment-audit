import { describe, expect, it } from 'vitest'
import { shouldUseCachedCommitResult } from '../commit-cache-decision'

describe('shouldUseCachedCommitResult', () => {
  describe('forceRecheck = true', () => {
    it('always returns recheck regardless of cache state', () => {
      expect(shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'review' }, true)).toBe('recheck')
      expect(shouldUseCachedCommitResult({ pr_approved: false, pr_approval_reason: 'no_pr' }, true)).toBe('recheck')
      expect(shouldUseCachedCommitResult({ pr_approved: null, pr_approval_reason: null }, true)).toBe('recheck')
    })
  })

  describe('forceRecheck = false', () => {
    it('returns recheck when no cached result (null)', () => {
      expect(shouldUseCachedCommitResult({ pr_approved: null, pr_approval_reason: null }, false)).toBe('recheck')
    })

    it('returns skip_verified when cached as approved', () => {
      expect(shouldUseCachedCommitResult({ pr_approved: true, pr_approval_reason: 'review' }, false)).toBe(
        'skip_verified',
      )
    })

    it('returns add_unverified when cached as not approved with specific reason', () => {
      expect(shouldUseCachedCommitResult({ pr_approved: false, pr_approval_reason: 'not_reviewer' }, false)).toBe(
        'add_unverified',
      )
    })

    it('returns add_unverified when reason is direct_push', () => {
      expect(shouldUseCachedCommitResult({ pr_approved: false, pr_approval_reason: 'direct_push' }, false)).toBe(
        'add_unverified',
      )
    })

    it('returns recheck when cached with no_pr reason (retry rebase matching)', () => {
      expect(shouldUseCachedCommitResult({ pr_approved: false, pr_approval_reason: 'no_pr' }, false)).toBe('recheck')
    })
  })
})
