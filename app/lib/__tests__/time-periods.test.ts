import { describe, expect, it, vi } from 'vitest'
import { getDateRangeForPeriod, type TimePeriod } from '../time-periods'

function expectRange(period: TimePeriod) {
  const result = getDateRangeForPeriod(period)
  expect(result).not.toBeNull()
  return result as NonNullable<typeof result>
}

describe('getDateRangeForPeriod', () => {
  it('returns null for "all"', () => {
    expect(getDateRangeForPeriod('all')).toBeNull()
  })

  describe('last-week', () => {
    it('returns 7 days before now', () => {
      vi.useFakeTimers({ now: new Date(2026, 2, 15, 12, 0, 0) }) // March 15
      const result = expectRange('last-week')
      expect(result.startDate.getDate()).toBe(8)
      expect(result.startDate.getMonth()).toBe(2)
      expect(result.endDate.getDate()).toBe(15)
      vi.useRealTimers()
    })

    it('handles month boundary', () => {
      vi.useFakeTimers({ now: new Date(2026, 2, 3) }) // March 3
      const result = expectRange('last-week')
      expect(result.startDate.getMonth()).toBe(1) // February
      expect(result.startDate.getDate()).toBe(24)
      vi.useRealTimers()
    })
  })

  describe('current-month', () => {
    it('starts at first of current month', () => {
      vi.useFakeTimers({ now: new Date(2026, 5, 20) }) // June 20
      const result = expectRange('current-month')
      expect(result.startDate).toEqual(new Date(2026, 5, 1))
      vi.useRealTimers()
    })
  })

  describe('last-month', () => {
    it('returns previous month range', () => {
      vi.useFakeTimers({ now: new Date(2026, 5, 15) }) // June 15
      const result = expectRange('last-month')
      expect(result.startDate).toEqual(new Date(2026, 4, 1)) // May 1
      expect(result.endDate.getMonth()).toBe(4) // May
      expect(result.endDate.getDate()).toBe(31) // May has 31 days
    })

    it('wraps to previous year in January', () => {
      vi.useFakeTimers({ now: new Date(2026, 0, 15) }) // Jan 15
      const result = expectRange('last-month')
      expect(result.startDate).toEqual(new Date(2025, 11, 1)) // Dec 1, 2025
      expect(result.endDate.getFullYear()).toBe(2025)
      expect(result.endDate.getMonth()).toBe(11)
      expect(result.endDate.getDate()).toBe(31)
      vi.useRealTimers()
    })
  })

  describe('current-tertial', () => {
    it.each([
      { month: 0, label: 'Jan → T1', expectedStart: 0 },
      { month: 3, label: 'Apr → T1', expectedStart: 0 },
      { month: 4, label: 'May → T2', expectedStart: 4 },
      { month: 7, label: 'Aug → T2', expectedStart: 4 },
      { month: 8, label: 'Sep → T3', expectedStart: 8 },
      { month: 11, label: 'Dec → T3', expectedStart: 8 },
    ])('$label starts at month $expectedStart', ({ month, expectedStart }) => {
      vi.useFakeTimers({ now: new Date(2026, month, 15) })
      const result = expectRange('current-tertial')
      expect(result.startDate.getMonth()).toBe(expectedStart)
      expect(result.startDate.getDate()).toBe(1)
      vi.useRealTimers()
    })
  })

  describe('last-tertial', () => {
    it('T1 → previous year T3 (Sep-Dec)', () => {
      vi.useFakeTimers({ now: new Date(2026, 1, 10) }) // Feb = T1
      const result = expectRange('last-tertial')
      expect(result.startDate).toEqual(new Date(2025, 8, 1)) // Sep 1 2025
      expect(result.endDate.getMonth()).toBe(11) // December
      expect(result.endDate.getDate()).toBe(31)
      expect(result.endDate.getFullYear()).toBe(2025)
      vi.useRealTimers()
    })

    it('T2 → T1 (Jan-Apr)', () => {
      vi.useFakeTimers({ now: new Date(2026, 5, 10) }) // Jun = T2
      const result = expectRange('last-tertial')
      expect(result.startDate).toEqual(new Date(2026, 0, 1)) // Jan 1
      expect(result.endDate.getMonth()).toBe(3) // April
      expect(result.endDate.getDate()).toBe(30) // April has 30 days
      vi.useRealTimers()
    })

    it('T3 → T2 (May-Aug)', () => {
      vi.useFakeTimers({ now: new Date(2026, 9, 10) }) // Oct = T3
      const result = expectRange('last-tertial')
      expect(result.startDate).toEqual(new Date(2026, 4, 1)) // May 1
      expect(result.endDate.getMonth()).toBe(7) // August
      expect(result.endDate.getDate()).toBe(31)
      vi.useRealTimers()
    })
  })

  describe('year-to-date', () => {
    it('starts at Jan 1 of current year', () => {
      vi.useFakeTimers({ now: new Date(2026, 8, 20) })
      const result = expectRange('year-to-date')
      expect(result.startDate).toEqual(new Date(2026, 0, 1))
      vi.useRealTimers()
    })
  })

  describe('last-year', () => {
    it('returns full previous year', () => {
      vi.useFakeTimers({ now: new Date(2026, 5, 10) })
      const result = expectRange('last-year')
      expect(result.startDate).toEqual(new Date(2025, 0, 1))
      expect(result.endDate.getFullYear()).toBe(2025)
      expect(result.endDate.getMonth()).toBe(11)
      expect(result.endDate.getDate()).toBe(31)
      vi.useRealTimers()
    })
  })

  it('returns null for unknown period', () => {
    expect(getDateRangeForPeriod('invalid' as TimePeriod)).toBeNull()
  })
})
