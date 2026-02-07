import { CheckmarkIcon, ExclamationmarkTriangleIcon, XMarkIcon } from '@navikt/aksel-icons'
import { Tag } from '@navikt/ds-react'

interface DeploymentTagProps {
  github_pr_number: number | null
  four_eyes_status: string
  has_four_eyes: boolean
}

export function MethodTag({
  github_pr_number,
  four_eyes_status,
}: Pick<DeploymentTagProps, 'github_pr_number' | 'four_eyes_status'>) {
  if (github_pr_number) {
    return (
      <Tag data-color="info" variant="outline" size="small">
        Pull Request
      </Tag>
    )
  }
  if (four_eyes_status === 'legacy') {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Legacy
      </Tag>
    )
  }
  if (four_eyes_status === 'pending') {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Ukjent
      </Tag>
    )
  }
  return (
    <Tag data-color="warning" variant="outline" size="small">
      Direct Push
    </Tag>
  )
}

export function StatusTag({
  four_eyes_status,
  has_four_eyes,
}: Pick<DeploymentTagProps, 'four_eyes_status' | 'has_four_eyes'>) {
  if (has_four_eyes) {
    return (
      <Tag data-color="success" variant="outline" size="small" icon={<CheckmarkIcon aria-hidden />}>
        Godkjent
      </Tag>
    )
  }
  switch (four_eyes_status) {
    case 'pending':
      return (
        <Tag data-color="neutral" variant="outline" size="small">
          Venter
        </Tag>
      )
    case 'direct_push':
    case 'unverified_commits':
      return (
        <Tag data-color="warning" variant="outline" size="small" icon={<XMarkIcon aria-hidden />}>
          Ikke godkjent
        </Tag>
      )
    case 'approved_pr_with_unreviewed':
      return (
        <Tag data-color="warning" variant="outline" size="small" icon={<ExclamationmarkTriangleIcon aria-hidden />}>
          Ureviewed
        </Tag>
      )
    case 'error':
    case 'missing':
      return (
        <Tag data-color="danger" variant="outline" size="small" icon={<XMarkIcon aria-hidden />}>
          Feil
        </Tag>
      )
    case 'legacy':
      return (
        <Tag data-color="neutral" variant="outline" size="small">
          Legacy
        </Tag>
      )
    default:
      return (
        <Tag data-color="neutral" variant="outline" size="small">
          {four_eyes_status}
        </Tag>
      )
  }
}
