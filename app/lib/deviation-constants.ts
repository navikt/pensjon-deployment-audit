export type DeviationIntent = 'malicious' | 'accidental' | 'unknown'
export type DeviationSeverity = 'low' | 'medium' | 'high' | 'critical'
export type DeviationFollowUpRole = 'product_lead' | 'delivery_lead' | 'section_lead'

export const DEVIATION_INTENT_LABELS: Record<DeviationIntent, string> = {
  malicious: 'Ondsinnet handling',
  accidental: 'Uheldig handling',
  unknown: 'Ukjent',
}

export const DEVIATION_SEVERITY_LABELS: Record<DeviationSeverity, string> = {
  low: 'Lav',
  medium: 'Middels',
  high: 'Høy',
  critical: 'Kritisk',
}

export const DEVIATION_FOLLOW_UP_ROLE_LABELS: Record<DeviationFollowUpRole, string> = {
  product_lead: 'Produktleder',
  delivery_lead: 'Leveranseleder',
  section_lead: 'Seksjonsleder',
}
