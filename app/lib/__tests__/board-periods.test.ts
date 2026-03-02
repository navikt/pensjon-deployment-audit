import { describe, expect, it } from 'vitest'
import { getCurrentPeriod, getPeriodsForYear } from '../board-periods'

describe('getCurrentPeriod', () => {
  describe('tertiary', () => {
    it.each([
      { date: new Date(2026, 0, 15), label: 'T1 2026', start: '2026-01-01', end: '2026-04-30' },
      { date: new Date(2026, 3, 30), label: 'T1 2026', start: '2026-01-01', end: '2026-04-30' },
      { date: new Date(2026, 4, 1), label: 'T2 2026', start: '2026-05-01', end: '2026-08-31' },
      { date: new Date(2026, 7, 31), label: 'T2 2026', start: '2026-05-01', end: '2026-08-31' },
      { date: new Date(2026, 8, 1), label: 'T3 2026', start: '2026-09-01', end: '2026-12-31' },
      { date: new Date(2026, 11, 31), label: 'T3 2026', start: '2026-09-01', end: '2026-12-31' },
    ])('$label for month $date.getMonth()', ({ date, label, start, end }) => {
      const result = getCurrentPeriod('tertiary', date)
      expect(result.label).toBe(label)
      expect(result.start).toBe(start)
      expect(result.end).toBe(end)
    })
  })

  describe('quarterly', () => {
    it.each([
      { date: new Date(2026, 0, 15), label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
      { date: new Date(2026, 2, 31), label: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
      { date: new Date(2026, 3, 1), label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30' },
      { date: new Date(2026, 5, 30), label: 'Q2 2026', start: '2026-04-01', end: '2026-06-30' },
      { date: new Date(2026, 6, 1), label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
      { date: new Date(2026, 8, 30), label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
      { date: new Date(2026, 9, 1), label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' },
      { date: new Date(2026, 11, 31), label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31' },
    ])('$label for month $date.getMonth()', ({ date, label, start, end }) => {
      const result = getCurrentPeriod('quarterly', date)
      expect(result.label).toBe(label)
      expect(result.start).toBe(start)
      expect(result.end).toBe(end)
    })
  })

  it('defaults to current date when none provided', () => {
    const result = getCurrentPeriod('quarterly')
    expect(result.label).toMatch(/^Q[1-4] \d{4}$/)
    expect(result.start).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe('getPeriodsForYear', () => {
  it('returns 3 tertiary periods', () => {
    const periods = getPeriodsForYear('tertiary', 2026)
    expect(periods).toHaveLength(3)
    expect(periods.map((p) => p.label)).toEqual(['T1 2026', 'T2 2026', 'T3 2026'])
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[1].start).toBe('2026-05-01')
    expect(periods[2].start).toBe('2026-09-01')
  })

  it('returns 4 quarterly periods', () => {
    const periods = getPeriodsForYear('quarterly', 2026)
    expect(periods).toHaveLength(4)
    expect(periods.map((p) => p.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'])
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[1].start).toBe('2026-04-01')
    expect(periods[2].start).toBe('2026-07-01')
    expect(periods[3].start).toBe('2026-10-01')
  })

  it('has continuous date ranges (no gaps)', () => {
    const periods = getPeriodsForYear('tertiary', 2026)
    for (let i = 1; i < periods.length; i++) {
      const prevEnd = new Date(periods[i - 1].end)
      const currStart = new Date(periods[i].start)
      // Next day after end should equal next period's start
      prevEnd.setDate(prevEnd.getDate() + 1)
      expect(prevEnd.toISOString().split('T')[0]).toBe(currStart.toISOString().split('T')[0])
    }
  })

  it('covers full year for tertiary', () => {
    const periods = getPeriodsForYear('tertiary', 2026)
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[2].end).toBe('2026-12-31')
  })

  it('covers full year for quarterly', () => {
    const periods = getPeriodsForYear('quarterly', 2026)
    expect(periods[0].start).toBe('2026-01-01')
    expect(periods[3].end).toBe('2026-12-31')
  })
})
