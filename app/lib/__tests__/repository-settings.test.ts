import { describe, expect, it } from 'vitest'
import { resolveEffectiveSettings } from '~/lib/repository-settings'

describe('resolveEffectiveSettings', () => {
  const appSettings = {
    defaultBranch: 'master',
  }

  it('returns null audit start year and off implicit approval when no repository row is linked', () => {
    expect(resolveEffectiveSettings(null, appSettings)).toEqual({
      repositoryId: null,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'master',
    })
  })

  it('prefers the repository values when linked', () => {
    expect(
      resolveEffectiveSettings(
        {
          repositoryId: 7,
          auditStartYear: 2024,
          implicitApprovalMode: 'off',
          defaultBranch: 'main',
        },
        appSettings,
      ),
    ).toEqual({
      repositoryId: 7,
      auditStartYear: 2024,
      implicitApprovalSettings: { mode: 'off' },
      defaultBranch: 'main',
    })
  })

  it('uses the repository default branch fallback and treats audit_start_year as authoritative (even when null) once linked', () => {
    expect(
      resolveEffectiveSettings(
        {
          repositoryId: 7,
          auditStartYear: null,
          implicitApprovalMode: 'dependabot_only',
          defaultBranch: null,
        },
        appSettings,
      ),
    ).toEqual({
      repositoryId: 7,
      auditStartYear: null,
      implicitApprovalSettings: { mode: 'dependabot_only' },
      defaultBranch: 'master',
    })
  })

  it('does not fall back for implicit approval since the repository column is never null', () => {
    const effective = resolveEffectiveSettings(
      {
        repositoryId: 7,
        auditStartYear: 2024,
        implicitApprovalMode: 'off',
        defaultBranch: 'main',
      },
      appSettings,
    )
    expect(effective.implicitApprovalSettings.mode).toBe('off')
  })
})
