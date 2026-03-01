import { CheckmarkIcon, ExclamationmarkTriangleIcon, XMarkIcon } from '@navikt/aksel-icons'
import { Tag } from '@navikt/ds-react'
import { type FourEyesStatus, isLegacyStatus, isPendingStatus } from '~/lib/four-eyes-status'

interface DeploymentTagProps {
  github_pr_number: number | null
  four_eyes_status: FourEyesStatus
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
  if (isLegacyStatus(four_eyes_status)) {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Legacy
      </Tag>
    )
  }
  if (isPendingStatus(four_eyes_status)) {
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
  // Godkjent - har passert fire-øyne prinsippet
  if (has_four_eyes) {
    return (
      <Tag data-color="success" variant="outline" size="small" icon={<CheckmarkIcon aria-hidden />}>
        Godkjent
      </Tag>
    )
  }

  // Legacy deployments
  if (isLegacyStatus(four_eyes_status)) {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Legacy
      </Tag>
    )
  }

  // Venter på verifisering
  if (isPendingStatus(four_eyes_status)) {
    return (
      <Tag data-color="neutral" variant="outline" size="small">
        Venter
      </Tag>
    )
  }

  // Spesifikke ikke-godkjente statuser
  switch (four_eyes_status) {
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
    case 'repository_mismatch':
    case 'unauthorized_repository':
      return (
        <Tag data-color="danger" variant="outline" size="small" icon={<XMarkIcon aria-hidden />}>
          {four_eyes_status === 'unauthorized_repository' ? 'Ikke godkjent repo' : 'Feil'}
        </Tag>
      )
    default:
      // Fallback for uventede statuser - vis status-tekst
      return (
        <Tag data-color="neutral" variant="outline" size="small">
          {four_eyes_status}
        </Tag>
      )
  }
}
