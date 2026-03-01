import { describe, expect, it } from 'vitest'
import type { PrCommit, PrMetadata, PrReview, VerificationInput } from '../verification/types'
import { verifyDeployment } from '../verification/verify'

/**
 * Tests closing coverage gaps in verifyDeployment.
 *
 * Covers:
 * - Case 1: pending_baseline (no previousDeployment)
 * - Case 2: no_changes (empty commitsBetween)
 * - Case 5: approved via base branch merge (integration)
 * - Case 6: implicitly_approved via mode 'all' (integration)
 * - Deployed PR with approval_before_last_commit reason propagation
 */

// =============================================================================
// Test Helpers (same shape as four-eyes-verification.test.ts)
// =============================================================================

function makePrCommit(overrides: Partial<PrCommit> = {}): PrCommit {
  return {
    sha: 'default-commit-sha',
    message: 'Default commit message',
    authorUsername: 'developer-a',
    authorDate: '2026-02-27T12:00:00Z',
    committerDate: '2026-02-27T12:00:00Z',
    isMergeCommit: false,
    parentShas: [],
    ...overrides,
  }
}

function makePrReview(overrides: Partial<PrReview> = {}): PrReview {
  return {
    id: 1,
    username: 'reviewer-b',
    state: 'APPROVED',
    submittedAt: '2026-02-27T13:00:00Z',
    body: null,
    ...overrides,
  }
}

function makePrMetadata(overrides: Partial<PrMetadata> = {}): PrMetadata {
  return {
    number: 100,
    title: 'Test PR',
    body: null,
    state: 'closed',
    merged: true,
    draft: false,
    createdAt: '2026-02-27T10:00:00Z',
    updatedAt: '2026-02-27T14:00:00Z',
    mergedAt: '2026-02-27T14:00:00Z',
    closedAt: '2026-02-27T14:00:00Z',
    baseBranch: 'main',
    baseSha: 'base-sha-000',
    headBranch: 'feature/test',
    headSha: 'head-sha-000',
    mergeCommitSha: 'merge-sha-000',
    author: { username: 'developer-a' },
    mergedBy: { username: 'reviewer-b' },
    labels: [],
    commitsCount: 1,
    changedFiles: 1,
    additions: 5,
    deletions: 2,
    ...overrides,
  }
}

function makeBaseInput(overrides: Partial<VerificationInput> = {}): VerificationInput {
  return {
    deploymentId: 1000,
    commitSha: 'deploy-sha-1000',
    repository: 'navikt/test-app',
    environmentName: 'prod-fss',
    baseBranch: 'main',
    auditStartYear: 2025,
    implicitApprovalSettings: { mode: 'off' },
    previousDeployment: {
      id: 999,
      commitSha: 'deploy-sha-999',
      createdAt: '2026-02-26T10:00:00Z',
    },
    deployedPr: null,
    commitsBetween: [],
    dataFreshness: {
      deployedPrFetchedAt: new Date('2026-02-28T10:00:00Z'),
      commitsFetchedAt: new Date('2026-02-28T10:00:00Z'),
      schemaVersion: 2,
    },
    ...overrides,
  }
}

// =============================================================================
// Case 1: pending_baseline
// =============================================================================

describe('verifyDeployment - Case 1: pending_baseline', () => {
  it('should return pending_baseline when there is no previous deployment', () => {
    const input = makeBaseInput({ previousDeployment: null })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(0)
    expect(result.approvalDetails.method).toBe('pending_baseline')
  })

  it('should still include deployed PR info when pending_baseline', () => {
    const input = makeBaseInput({
      previousDeployment: null,
      deployedPr: {
        number: 100,
        url: 'https://github.com/navikt/test-app/pull/100',
        metadata: makePrMetadata(),
        reviews: [makePrReview()],
        commits: [makePrCommit()],
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('pending_baseline')
    expect(result.deployedPr).not.toBeNull()
    expect(result.deployedPr?.number).toBe(100)
  })
})

// =============================================================================
// Case 2: no_changes
// =============================================================================

describe('verifyDeployment - Case 2: no_changes', () => {
  it('should return no_changes when commitsBetween is empty', () => {
    const input = makeBaseInput({ commitsBetween: [] })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.hasFourEyes).toBe(true)
    expect(result.unverifiedCommits).toHaveLength(0)
    expect(result.approvalDetails.method).toBe('no_changes')
  })

  it('should still include deployed PR info when no_changes', () => {
    const input = makeBaseInput({
      commitsBetween: [],
      deployedPr: {
        number: 100,
        url: 'https://github.com/navikt/test-app/pull/100',
        metadata: makePrMetadata(),
        reviews: [makePrReview()],
        commits: [makePrCommit()],
      },
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('no_changes')
    expect(result.deployedPr).not.toBeNull()
  })
})

// =============================================================================
// Case 5: approved via base branch merge (integration through verifyDeployment)
// =============================================================================

describe('verifyDeployment - Case 5: base branch merge approval', () => {
  it('should return approved when unverified commits are explained by base merge', () => {
    // Scenario:
    // 1. Developer makes feature commit at 09:00
    // 2. Reviewer approves at 10:00
    // 3. Main is merged into feature branch at 12:00, bringing a commit from 11:00
    // 4. verifyFourEyesFromPrData sees last real commit (from-main) at 11:00 > approval at 10:00
    //    → hasFourEyes = false (approval_before_last_commit)
    // 5. shouldApproveWithBaseMerge sees all unverified commits are before merge at 12:00
    //    → approved via base_merge
    const input = makeBaseInput({
      deployedPr: {
        number: 200,
        url: 'https://github.com/navikt/test-app/pull/200',
        metadata: makePrMetadata({
          number: 200,
          mergeCommitSha: 'deploy-sha-1000',
          author: { username: 'developer-a' },
          mergedBy: { username: 'developer-a' }, // Same as commit author — merger path won't help
        }),
        reviews: [makePrReview({ submittedAt: '2026-02-25T10:00:00Z' })],
        commits: [
          makePrCommit({
            sha: 'feature-commit-1',
            authorUsername: 'developer-a',
            authorDate: '2026-02-25T09:00:00Z',
            message: 'Feature work',
          }),
          // Commit from main brought in by merge — date is AFTER approval
          makePrCommit({
            sha: 'from-main-1',
            authorUsername: 'other-dev',
            authorDate: '2026-02-25T11:00:00Z',
            message: 'Other feature from main',
          }),
          // The merge commit bringing main into feature
          makePrCommit({
            sha: 'base-merge-commit',
            authorUsername: 'developer-a',
            authorDate: '2026-02-25T12:00:00Z',
            message: "Merge branch 'main' into feature/test",
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'feature-commit-1',
          message: 'Feature work',
          authorUsername: 'developer-a',
          authorDate: '2026-02-25T09:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
        {
          sha: 'from-main-1',
          message: 'Other feature from main',
          authorUsername: 'other-dev',
          authorDate: '2026-02-25T11:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
        {
          sha: 'base-merge-commit',
          message: "Merge branch 'main' into feature/test",
          authorUsername: 'developer-a',
          authorDate: '2026-02-25T12:00:00Z',
          isMergeCommit: true,
          parentShas: ['p1', 'p2'],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('approved')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.method).toBe('base_merge')
    expect(result.unverifiedCommits).toHaveLength(0)
  })
})

// =============================================================================
// Case 6: implicitly_approved via mode 'all' (integration through verifyDeployment)
// =============================================================================

describe('verifyDeployment - Case 6: implicit approval mode all', () => {
  it('should return implicitly_approved when merger differs from creator and last committer', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'all' },
      deployedPr: {
        number: 300,
        url: 'https://github.com/navikt/test-app/pull/300',
        metadata: makePrMetadata({
          number: 300,
          mergeCommitSha: 'squash-sha-300',
          author: { username: 'developer-a' },
          mergedBy: { username: 'merger-c' },
        }),
        reviews: [], // No reviews — implicit approval kicks in
        commits: [
          makePrCommit({
            sha: 'commit-in-pr',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T12:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-300',
          message: 'Feature (#300)',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T13:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('implicitly_approved')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.method).toBe('implicit')
    expect(result.approvalDetails.approvers).toContain('merger-c')
  })

  it('should NOT implicitly approve when merger is same as creator', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'all' },
      deployedPr: {
        number: 301,
        url: 'https://github.com/navikt/test-app/pull/301',
        metadata: makePrMetadata({
          number: 301,
          mergeCommitSha: 'squash-sha-301',
          author: { username: 'developer-a' },
          mergedBy: { username: 'developer-a' },
        }),
        reviews: [],
        commits: [
          makePrCommit({
            sha: 'commit-in-pr',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T12:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-301',
          message: 'Feature (#301)',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T13:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
  })
})

// =============================================================================
// Case 6b: implicitly_approved via mode 'dependabot_only' (integration)
// =============================================================================

describe('verifyDeployment - Case 6: implicit approval mode dependabot_only', () => {
  it('should return implicitly_approved for dependabot PR merged by another user', () => {
    // Dependabot PR with no reviews, merged by a human.
    // The commit in commitsBetween does NOT match mergeCommitSha or PR commit SHAs,
    // so it falls through to commit.pr path → no reviews → unverified.
    // Then implicit approval (dependabot_only) kicks in.
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'dependabot_only' },
      deployedPr: {
        number: 350,
        url: 'https://github.com/navikt/test-app/pull/350',
        metadata: makePrMetadata({
          number: 350,
          mergeCommitSha: 'squash-sha-350',
          author: { username: 'dependabot[bot]' },
          mergedBy: { username: 'human-dev' },
        }),
        reviews: [], // No reviews
        commits: [
          makePrCommit({
            sha: 'dep-commit-sha',
            authorUsername: 'dependabot[bot]',
            authorDate: '2026-02-27T10:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-350',
          message: 'Bump axios from 1.6.0 to 1.7.0 (#350)',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T11:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('implicitly_approved')
    expect(result.hasFourEyes).toBe(true)
    expect(result.approvalDetails.method).toBe('implicit')
    expect(result.approvalDetails.reason).toContain('Dependabot')
  })

  it('should NOT implicitly approve dependabot PR when merged by dependabot itself', () => {
    const input = makeBaseInput({
      implicitApprovalSettings: { mode: 'dependabot_only' },
      deployedPr: {
        number: 351,
        url: 'https://github.com/navikt/test-app/pull/351',
        metadata: makePrMetadata({
          number: 351,
          mergeCommitSha: 'squash-sha-351',
          author: { username: 'dependabot[bot]' },
          mergedBy: { username: 'dependabot[bot]' }, // Same as creator
        }),
        reviews: [],
        commits: [
          makePrCommit({
            sha: 'dep-commit-sha-2',
            authorUsername: 'dependabot[bot]',
            authorDate: '2026-02-27T10:00:00Z',
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'squash-sha-351',
          message: 'Bump axios from 1.6.0 to 1.7.0 (#351)',
          authorUsername: 'dependabot[bot]',
          authorDate: '2026-02-27T11:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: '',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
  })
})

describe('verifyDeployment - deployed PR approval before last commit', () => {
  it('should propagate approval_before_last_commit reason for deployed PR commits', () => {
    // Deployed PR was approved, then a new commit was pushed.
    // Commits matched via deployedPrCommitShas should get the correct reason.
    const input = makeBaseInput({
      deployedPr: {
        number: 400,
        url: 'https://github.com/navikt/test-app/pull/400',
        metadata: makePrMetadata({
          number: 400,
          mergeCommitSha: null,
          headSha: 'late-commit-sha',
          author: { username: 'developer-a' },
          mergedBy: { username: 'developer-a' }, // Same as commit author — merger path won't help
        }),
        reviews: [
          makePrReview({
            username: 'reviewer-b',
            submittedAt: '2026-02-27T11:00:00Z', // Before last commit
          }),
        ],
        commits: [
          makePrCommit({
            sha: 'early-commit-sha',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T10:00:00Z',
          }),
          makePrCommit({
            sha: 'late-commit-sha',
            authorUsername: 'developer-a',
            authorDate: '2026-02-27T12:00:00Z', // After approval
          }),
        ],
      },
      commitsBetween: [
        {
          sha: 'early-commit-sha',
          message: 'Initial work',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T10:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: 'https://github.com/navikt/test-app/commit/early',
          pr: null,
        },
        {
          sha: 'late-commit-sha',
          message: 'Pushed after approval',
          authorUsername: 'developer-a',
          authorDate: '2026-02-27T12:00:00Z',
          isMergeCommit: false,
          parentShas: [],
          htmlUrl: 'https://github.com/navikt/test-app/commit/late',
          pr: null,
        },
      ],
    })

    const result = verifyDeployment(input)

    expect(result.status).toBe('unverified_commits')
    expect(result.hasFourEyes).toBe(false)
    expect(result.unverifiedCommits).toHaveLength(2)

    for (const commit of result.unverifiedCommits) {
      expect(commit.reason).toBe('approval_before_last_commit')
      expect(commit.prNumber).toBe(400)
    }
  })
})
