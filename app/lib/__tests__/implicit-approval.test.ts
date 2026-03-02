import { describe, expect, it } from 'vitest'
import { checkImplicitApproval } from '../verification/verify'

describe('checkImplicitApproval', () => {
  const baseParams = {
    prCreator: 'alice',
    lastCommitAuthor: 'alice',
    mergedBy: 'bob',
    allCommitAuthors: ['alice'],
  }

  describe('mode: off', () => {
    it('never qualifies', () => {
      const result = checkImplicitApproval({
        ...baseParams,
        settings: { mode: 'off' },
      })
      expect(result.qualifies).toBe(false)
    })
  })

  describe('mode: dependabot_only', () => {
    it('qualifies when Dependabot PR with only Dependabot commits, merged by human', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'dependabot_only' },
        prCreator: 'dependabot[bot]',
        lastCommitAuthor: 'dependabot[bot]',
        mergedBy: 'alice',
        allCommitAuthors: ['dependabot[bot]'],
      })
      expect(result.qualifies).toBe(true)
      expect(result.reason).toContain('Dependabot')
    })

    it('qualifies with mixed dependabot/dependabot[bot] commit authors', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'dependabot_only' },
        prCreator: 'dependabot[bot]',
        lastCommitAuthor: 'dependabot',
        mergedBy: 'alice',
        allCommitAuthors: ['dependabot[bot]', 'dependabot'],
      })
      expect(result.qualifies).toBe(true)
    })

    it('does not qualify when human has commits', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'dependabot_only' },
        prCreator: 'dependabot[bot]',
        lastCommitAuthor: 'alice',
        mergedBy: 'bob',
        allCommitAuthors: ['dependabot[bot]', 'alice'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('does not qualify when PR creator is not dependabot', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'dependabot_only' },
        prCreator: 'alice',
        lastCommitAuthor: 'alice',
        mergedBy: 'bob',
        allCommitAuthors: ['alice'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('does not qualify when merged by dependabot itself', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'dependabot_only' },
        prCreator: 'dependabot[bot]',
        lastCommitAuthor: 'dependabot[bot]',
        mergedBy: 'dependabot[bot]',
        allCommitAuthors: ['dependabot[bot]'],
      })
      expect(result.qualifies).toBe(false)
    })
  })

  describe('mode: all', () => {
    it('qualifies when merger is neither creator nor last commit author', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'all' },
        prCreator: 'alice',
        lastCommitAuthor: 'alice',
        mergedBy: 'bob',
        allCommitAuthors: ['alice'],
      })
      expect(result.qualifies).toBe(true)
      expect(result.reason).toContain('bob')
      expect(result.reason).toContain('alice')
    })

    it('does not qualify when merger is the PR creator', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'all' },
        prCreator: 'alice',
        lastCommitAuthor: 'bob',
        mergedBy: 'alice',
        allCommitAuthors: ['bob'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('does not qualify when merger is the last commit author', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'all' },
        prCreator: 'alice',
        lastCommitAuthor: 'bob',
        mergedBy: 'bob',
        allCommitAuthors: ['alice', 'bob'],
      })
      expect(result.qualifies).toBe(false)
    })

    it('is case-insensitive', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'all' },
        prCreator: 'Alice',
        lastCommitAuthor: 'ALICE',
        mergedBy: 'BOB',
        allCommitAuthors: ['Alice'],
      })
      expect(result.qualifies).toBe(true)
    })

    it('does not qualify when merger matches creator (case-insensitive)', () => {
      const result = checkImplicitApproval({
        settings: { mode: 'all' },
        prCreator: 'Alice',
        lastCommitAuthor: 'bob',
        mergedBy: 'ALICE',
        allCommitAuthors: ['bob'],
      })
      expect(result.qualifies).toBe(false)
    })
  })
})
