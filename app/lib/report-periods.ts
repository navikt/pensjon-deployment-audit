/**
 * Report period utilities for yearly, quarterly, and monthly reports.
 * Shared between server and client code.
 */

export type ReportPeriodType = 'yearly' | 'quarterly' | 'monthly'

export interface ReportPeriod {
  type: ReportPeriodType
  label: string
  year: number
  startDate: Date
  endDate: Date
}

const QUARTER_LABELS: Record<number, string> = {
  0: 'Q1',
  1: 'Q2',
  2: 'Q3',
  3: 'Q4',
}

const MONTH_LABELS = [
  'Januar',
  'Februar',
  'Mars',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Desember',
]

/**
 * Get completed periods of a given type up to the reference date.
 * Only returns periods that are fully completed (end date is in the past).
 */
export function getCompletedPeriods(type: ReportPeriodType, referenceDate: Date = new Date()): ReportPeriod[] {
  const periods: ReportPeriod[] = []
  const startYear = 2024 // Earliest year with data

  if (type === 'yearly') {
    for (let year = referenceDate.getFullYear() - 1; year >= startYear; year--) {
      periods.push({
        type: 'yearly',
        label: String(year),
        year,
        startDate: new Date(year, 0, 1),
        endDate: new Date(year, 11, 31, 23, 59, 59, 999),
      })
    }
  } else if (type === 'quarterly') {
    const currentQuarter = Math.floor(referenceDate.getMonth() / 3)
    const currentYear = referenceDate.getFullYear()

    for (let year = currentYear; year >= startYear; year--) {
      const maxQ = year === currentYear ? currentQuarter - 1 : 3
      for (let q = maxQ; q >= 0; q--) {
        const startMonth = q * 3
        periods.push({
          type: 'quarterly',
          label: `${QUARTER_LABELS[q]} ${year}`,
          year,
          startDate: new Date(year, startMonth, 1),
          endDate: new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
        })
      }
    }
  } else if (type === 'monthly') {
    const currentYear = referenceDate.getFullYear()
    const currentMonth = referenceDate.getMonth()

    for (let year = currentYear; year >= startYear; year--) {
      const maxMonth = year === currentYear ? currentMonth - 1 : 11
      for (let month = maxMonth; month >= 0; month--) {
        periods.push({
          type: 'monthly',
          label: `${MONTH_LABELS[month]} ${year}`,
          year,
          startDate: new Date(year, month, 1),
          endDate: new Date(year, month + 1, 0, 23, 59, 59, 999),
        })
      }
    }
  }

  return periods
}

/**
 * Check if a period is completed (fully in the past).
 */
export function isPeriodCompleted(period: ReportPeriod, referenceDate: Date = new Date()): boolean {
  return period.endDate < referenceDate
}

/**
 * Generate a report ID incorporating the period type.
 */
export function generateReportId(
  _periodType: ReportPeriodType,
  periodLabel: string,
  appName: string,
  environment: string,
  hash: string,
): string {
  const shortHash = hash.substring(0, 8)
  const sanitizedLabel = periodLabel.replace(/\s+/g, '-')
  return `AUDIT-${sanitizedLabel}-${appName}-${environment}-${shortHash}`
}

export const REPORT_PERIOD_TYPE_LABELS: Record<ReportPeriodType, string> = {
  yearly: 'Årlig',
  quarterly: 'Kvartalsvis',
  monthly: 'Månedlig',
}
