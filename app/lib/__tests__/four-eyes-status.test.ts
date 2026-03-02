import { describe, expect, it } from 'vitest'
import {
  APPROVED_STATUSES,
  FOUR_EYES_STATUS_LABELS,
  FOUR_EYES_STATUSES,
  getFourEyesStatusLabel,
  isApprovedStatus,
  isLegacyStatus,
  isNotApprovedStatus,
  isPendingStatus,
  LEGACY_STATUSES,
  NOT_APPROVED_STATUSES,
  PENDING_STATUSES,
} from '../four-eyes-status'

describe('status categorization', () => {
  it('every status belongs to exactly one category', () => {
    const categories = [APPROVED_STATUSES, NOT_APPROVED_STATUSES, PENDING_STATUSES, LEGACY_STATUSES]
    // "error" and "repository_mismatch" are intentionally uncategorized
    const uncategorized = ['error', 'repository_mismatch']

    for (const status of FOUR_EYES_STATUSES) {
      const count = categories.filter((cat) => cat.includes(status)).length
      if (uncategorized.includes(status)) {
        expect(count, `${status} should be in 0 categories`).toBe(0)
      } else {
        expect(count, `${status} should be in exactly 1 category`).toBe(1)
      }
    }
  })
})

describe('isApprovedStatus', () => {
  it.each(['approved', 'approved_pr', 'implicitly_approved', 'manually_approved'])('returns true for %s', (status) => {
    expect(isApprovedStatus(status)).toBe(true)
  })

  it.each(['pending', 'direct_push', 'unknown', 'error', 'legacy'])('returns false for %s', (status) => {
    expect(isApprovedStatus(status)).toBe(false)
  })
})

describe('isNotApprovedStatus', () => {
  it.each([
    'direct_push',
    'unverified_commits',
    'approved_pr_with_unreviewed',
    'unauthorized_repository',
    'unauthorized_branch',
  ])('returns true for %s', (status) => {
    expect(isNotApprovedStatus(status)).toBe(true)
  })

  it('returns false for approved statuses', () => {
    expect(isNotApprovedStatus('approved')).toBe(false)
  })
})

describe('isPendingStatus', () => {
  it.each(['pending', 'pending_baseline', 'pending_approval', 'unknown'])('returns true for %s', (status) => {
    expect(isPendingStatus(status)).toBe(true)
  })

  it('returns false for approved', () => {
    expect(isPendingStatus('approved')).toBe(false)
  })
})

describe('isLegacyStatus', () => {
  it.each(['legacy', 'legacy_pending'])('returns true for %s', (status) => {
    expect(isLegacyStatus(status)).toBe(true)
  })

  it('returns false for non-legacy', () => {
    expect(isLegacyStatus('approved')).toBe(false)
  })
})

describe('getFourEyesStatusLabel', () => {
  it('returns Norwegian label for known statuses', () => {
    expect(getFourEyesStatusLabel('approved')).toBe('Godkjent')
    expect(getFourEyesStatusLabel('pending')).toBe('Venter')
    expect(getFourEyesStatusLabel('direct_push')).toBe('Direkte push')
  })

  it('every status has a label', () => {
    for (const status of FOUR_EYES_STATUSES) {
      expect(FOUR_EYES_STATUS_LABELS[status]).toBeTruthy()
    }
  })

  it('returns raw string for unknown status', () => {
    expect(getFourEyesStatusLabel('some_new_status')).toBe('some_new_status')
  })
})
