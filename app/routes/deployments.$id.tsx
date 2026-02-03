import {
  ArrowsCirclepathIcon,
  ChatIcon,
  CheckmarkCircleIcon,
  CheckmarkIcon,
  CircleIcon,
  ClockIcon,
  ExclamationmarkTriangleIcon,
  MinusCircleIcon,
  TrashIcon,
  XMarkIcon,
  XMarkOctagonIcon,
} from '@navikt/aksel-icons'
import {
  Accordion,
  Alert,
  BodyShort,
  Box,
  Button,
  CopyButton,
  Detail,
  Heading,
  HGrid,
  HStack,
  Modal,
  Tag,
  Textarea,
  TextField,
  VStack,
} from '@navikt/ds-react'
import { useRef, useState } from 'react'
import { Form, Link, useSearchParams } from 'react-router'
import {
  createComment,
  deleteComment,
  deleteLegacyInfo,
  getCommentsByDeploymentId,
  getLegacyInfo,
  getManualApproval,
} from '~/db/comments.server'
import {
  type DeploymentNavFilters,
  getDeploymentById,
  getNextDeployment,
  getPreviousDeploymentForNav,
  updateDeploymentFourEyes,
  updateDeploymentLegacyData,
} from '~/db/deployments.server'
import { getMonitoredApplicationById } from '~/db/monitored-applications.server'
import { getUserMappings } from '~/db/user-mappings.server'
import { getNavIdent, getUserIdentity } from '~/lib/auth.server'
import { lookupLegacyByCommit, lookupLegacyByPR } from '~/lib/github.server'
import { verifyDeploymentFourEyes } from '~/lib/sync.server'
import { getDateRangeForPeriod, type TimePeriod } from '~/lib/time-periods'
import { getUserDisplayName, serializeUserMappings } from '~/lib/user-display'
import type { Route } from './+types/deployments.$id'

export async function loader({ params, request }: Route.LoaderArgs) {
  const deploymentId = parseInt(params.id, 10)
  const deployment = await getDeploymentById(deploymentId)

  if (!deployment) {
    throw new Response('Deployment not found', { status: 404 })
  }

  // Get app info for building semantic URLs
  const app = await getMonitoredApplicationById(deployment.monitored_app_id)
  if (!app) {
    throw new Response('Application not found', { status: 404 })
  }
  const appUrl = `/team/${app.team_slug}/env/${app.environment_name}/app/${app.app_name}`

  // Redirect to app-scoped URL if accessed via /deployments/:id directly
  // Check if this is a direct request (not from the app-scoped re-export)
  const url = new URL(request.url)
  if (url.pathname === `/deployments/${deploymentId}`) {
    const searchParams = url.searchParams.toString()
    const redirectUrl = `${appUrl}/deployments/${deploymentId}${searchParams ? `?${searchParams}` : ''}`
    return Response.redirect(new URL(redirectUrl, url.origin), 302)
  }

  // Parse filter params for navigation
  const status = url.searchParams.get('status') || undefined
  const method = url.searchParams.get('method') as 'pr' | 'direct_push' | 'legacy' | undefined
  const deployer = url.searchParams.get('deployer') || undefined
  const sha = url.searchParams.get('sha') || undefined
  const period = (url.searchParams.get('period') || 'last-week') as TimePeriod

  const range = getDateRangeForPeriod(period)

  const navFilters: DeploymentNavFilters = {
    four_eyes_status: status,
    method: method && ['pr', 'direct_push', 'legacy'].includes(method) ? method : undefined,
    deployer_username: deployer,
    commit_sha: sha,
    start_date: range?.startDate,
    end_date: range?.endDate,
    audit_start_year: app.audit_start_year,
  }

  const comments = await getCommentsByDeploymentId(deploymentId)
  const manualApproval = await getManualApproval(deploymentId)
  const legacyInfo = await getLegacyInfo(deploymentId)

  // Get previous and next deployments for navigation (respecting filters)
  const previousDeployment = await getPreviousDeploymentForNav(deploymentId, deployment.monitored_app_id, navFilters)
  const nextDeployment = await getNextDeployment(deploymentId, deployment.monitored_app_id, navFilters)

  // Collect all GitHub usernames we need to look up
  const usernames: string[] = []
  if (deployment.deployer_username) usernames.push(deployment.deployer_username)
  if (deployment.github_pr_data?.creator?.username) usernames.push(deployment.github_pr_data.creator.username)
  if (deployment.github_pr_data?.merger?.username) usernames.push(deployment.github_pr_data.merger.username)
  // Include assignees
  if (deployment.github_pr_data?.assignees) {
    for (const assignee of deployment.github_pr_data.assignees) {
      if (assignee.username && !usernames.includes(assignee.username)) {
        usernames.push(assignee.username)
      }
    }
  }
  // Include reviewers
  if (deployment.github_pr_data?.reviewers) {
    for (const reviewer of deployment.github_pr_data.reviewers) {
      if (reviewer.username && !usernames.includes(reviewer.username)) {
        usernames.push(reviewer.username)
      }
    }
  }
  // Include requested reviewers
  if (deployment.github_pr_data?.requested_reviewers) {
    for (const reviewer of deployment.github_pr_data.requested_reviewers) {
      if (reviewer.username && !usernames.includes(reviewer.username)) {
        usernames.push(reviewer.username)
      }
    }
  }
  // Include PR commits authors
  if (deployment.github_pr_data?.commits) {
    for (const commit of deployment.github_pr_data.commits) {
      if (commit.author?.username && !usernames.includes(commit.author.username)) {
        usernames.push(commit.author.username)
      }
    }
  }
  // Include PR comments authors
  if (deployment.github_pr_data?.comments) {
    for (const comment of deployment.github_pr_data.comments) {
      if (comment.user?.username && !usernames.includes(comment.user.username)) {
        usernames.push(comment.user.username)
      }
    }
  }
  // Include unverified commit authors
  if (deployment.unverified_commits) {
    for (const commit of deployment.unverified_commits) {
      if (commit.author && !usernames.includes(commit.author)) {
        usernames.push(commit.author)
      }
    }
  }

  // Get all user mappings in one query
  const userMappings = await getUserMappings(usernames)

  // Check if current user is involved in this deployment (for four-eyes validation)
  const currentUser = getUserIdentity(request)
  let isCurrentUserInvolved = false
  let involvementReason: string | null = null

  if (currentUser?.navIdent) {
    const currentNavIdent = currentUser.navIdent.toUpperCase()

    // Check if user is PR creator
    const prCreatorUsername = deployment.github_pr_data?.creator?.username
    if (prCreatorUsername) {
      const prCreatorMapping = userMappings.get(prCreatorUsername)
      if (prCreatorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        isCurrentUserInvolved = true
        involvementReason = 'Du opprettet pull requesten for denne deploymenten'
      }
    }

    // Check if user is author of the last unverified commit (relaxed four-eyes check)
    if (!isCurrentUserInvolved && deployment.unverified_commits && deployment.unverified_commits.length > 0) {
      const lastCommit = deployment.unverified_commits[deployment.unverified_commits.length - 1]
      const lastCommitAuthorMapping = userMappings.get(lastCommit.author)
      if (lastCommitAuthorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        isCurrentUserInvolved = true
        involvementReason = 'Du er forfatter av siste commit i denne deploymenten'
      }
    }
  }

  return {
    deployment,
    comments,
    manualApproval,
    legacyInfo,
    previousDeployment,
    nextDeployment,
    userMappings: serializeUserMappings(userMappings),
    appUrl,
    currentUserNavIdent: currentUser?.navIdent || null,
    isCurrentUserInvolved,
    involvementReason,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const deploymentId = parseInt(params.id, 10)
  const formData = await request.formData()
  const intent = formData.get('intent')

  if (intent === 'add_comment') {
    const commentText = formData.get('comment_text') as string
    const slackLink = formData.get('slack_link') as string

    if (!commentText || commentText.trim() === '') {
      return { error: 'Kommentar kan ikke være tom' }
    }

    try {
      await createComment({
        deployment_id: deploymentId,
        comment_text: commentText.trim(),
        slack_link: slackLink || undefined,
      })
      return { success: 'Kommentar lagt til' }
    } catch (_error) {
      return { error: 'Kunne ikke legge til kommentar' }
    }
  }

  if (intent === 'manual_approval') {
    const identity = getUserIdentity(request)
    const reason = formData.get('reason') as string
    const slackLink = formData.get('slack_link') as string

    if (!identity?.navIdent) {
      return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
    }

    if (!slackLink || slackLink.trim() === '') {
      return { error: 'Slack-lenke er påkrevd for manuell godkjenning' }
    }

    // Validate four-eyes principle: user cannot approve their own work
    const deployment = await getDeploymentById(deploymentId)
    if (!deployment) {
      return { error: 'Deployment ikke funnet' }
    }

    // Collect GitHub usernames to check
    const usernamesToCheck: string[] = []
    if (deployment.github_pr_data?.creator?.username) {
      usernamesToCheck.push(deployment.github_pr_data.creator.username)
    }
    if (deployment.unverified_commits) {
      for (const commit of deployment.unverified_commits) {
        if (commit.author && !usernamesToCheck.includes(commit.author)) {
          usernamesToCheck.push(commit.author)
        }
      }
    }

    const userMappings = await getUserMappings(usernamesToCheck)
    const currentNavIdent = identity.navIdent.toUpperCase()

    // Check if user is PR creator
    const prCreatorUsername = deployment.github_pr_data?.creator?.username
    if (prCreatorUsername) {
      const prCreatorMapping = userMappings.get(prCreatorUsername)
      if (prCreatorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        return {
          error:
            'Du kan ikke godkjenne din egen pull request. Fire-øyne-prinsippet krever at en annen person godkjenner.',
        }
      }
    }

    // Check if user is author of the last unverified commit (relaxed four-eyes check)
    if (deployment.unverified_commits && deployment.unverified_commits.length > 0) {
      const lastCommit = deployment.unverified_commits[deployment.unverified_commits.length - 1]
      const lastCommitAuthorMapping = userMappings.get(lastCommit.author)
      if (lastCommitAuthorMapping?.nav_ident?.toUpperCase() === currentNavIdent) {
        return {
          error:
            'Du kan ikke godkjenne en deployment der du har siste commit. Fire-øyne-prinsippet krever at en annen person godkjenner.',
        }
      }
    }

    try {
      // Create manual approval comment with slack link
      await createComment({
        deployment_id: deploymentId,
        comment_text: reason || 'Manuelt godkjent etter gjennomgang',
        slack_link: slackLink.trim(),
        comment_type: 'manual_approval',
        approved_by: identity.navIdent,
      })

      // Update deployment to mark as manually approved
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'manually_approved',
        githubPrNumber: null,
        githubPrUrl: null,
      })

      return { success: 'Deployment manuelt godkjent' }
    } catch (_error) {
      return { error: 'Kunne ikke godkjenne deployment' }
    }
  }

  // Step 1: Look up GitHub data for legacy deployment
  if (intent === 'lookup_legacy_github') {
    const searchType = formData.get('search_type') as string
    const searchValue = formData.get('search_value') as string
    const slackLink = formData.get('slack_link') as string
    const navIdent = getNavIdent(request)

    if (!navIdent) {
      return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
    }

    if (!slackLink || slackLink.trim() === '') {
      return { error: 'Slack-lenke er påkrevd' }
    }

    if (!searchValue || searchValue.trim() === '') {
      return { error: searchType === 'sha' ? 'Commit SHA må oppgis' : 'PR-nummer må oppgis' }
    }

    const deployment = await getDeploymentById(deploymentId)
    if (!deployment) {
      return { error: 'Deployment ikke funnet' }
    }

    const owner = deployment.detected_github_owner
    const repo = deployment.detected_github_repo_name

    if (!owner || !repo) {
      return { error: 'Repository info mangler på deployment' }
    }

    try {
      const result =
        searchType === 'pr'
          ? await lookupLegacyByPR(owner, repo, parseInt(searchValue.trim(), 10), deployment.created_at)
          : await lookupLegacyByCommit(owner, repo, searchValue.trim(), deployment.created_at)

      if (!result.success || !result.data) {
        return { error: result.error || 'Kunne ikke finne data på GitHub' }
      }

      // Return the lookup data for preview
      return {
        legacyLookup: {
          ...result.data,
          slackLink: slackLink.trim(),
          registeredBy: navIdent,
        },
      }
    } catch (error) {
      console.error('Legacy lookup error:', error)
      return { error: `Feil ved oppslag: ${error instanceof Error ? error.message : 'Ukjent feil'}` }
    }
  }

  // Step 2: Confirm and save the looked up data
  if (intent === 'confirm_legacy_lookup') {
    const slackLink = formData.get('slack_link') as string
    const commitSha = formData.get('commit_sha') as string
    const commitMessage = formData.get('commit_message') as string
    const commitAuthor = formData.get('commit_author') as string
    const prNumber = formData.get('pr_number') as string
    const prTitle = formData.get('pr_title') as string
    const prUrl = formData.get('pr_url') as string
    const prAuthor = formData.get('pr_author') as string
    const prMergedAt = formData.get('pr_merged_at') as string
    const mergedBy = formData.get('merged_by') as string
    const reviewersJson = formData.get('reviewers') as string
    const navIdent = getNavIdent(request)

    if (!navIdent) {
      return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
    }

    try {
      // Parse reviewers
      const reviewers = reviewersJson ? JSON.parse(reviewersJson) : []

      // Build description - use mergedBy as deployer if available
      const effectiveDeployer = mergedBy || commitAuthor
      const parts: string[] = []
      if (effectiveDeployer) parts.push(`Deployer: ${effectiveDeployer}`)
      if (commitSha) parts.push(`SHA: ${commitSha.substring(0, 7)}`)
      if (prNumber) parts.push(`PR: #${prNumber}`)
      const infoText = parts.length > 0 ? `GitHub-verifisert: ${parts.join(', ')}` : 'Legacy info fra GitHub'

      // Create comment with legacy info
      await createComment({
        deployment_id: deploymentId,
        comment_text: infoText,
        slack_link: slackLink,
        comment_type: 'legacy_info',
        registered_by: navIdent,
      })

      // Update deployment with GitHub data (mergedBy will be used as deployer)
      await updateDeploymentLegacyData(deploymentId, {
        commitSha: commitSha || null,
        commitMessage: commitMessage || null,
        deployer: commitAuthor || null,
        mergedBy: mergedBy || null,
        prNumber: prNumber ? parseInt(prNumber, 10) : null,
        prUrl: prUrl || null,
        prTitle: prTitle || null,
        prAuthor: prAuthor || null,
        prMergedAt: prMergedAt || null,
        reviewers,
      })

      // Run full GitHub verification to fetch all PR data (comments, reviews, etc.)
      let updatedDeployment = await getDeploymentById(deploymentId)
      if (updatedDeployment && commitSha) {
        console.log(`🔄 Running full GitHub verification for legacy deployment ${deploymentId}`)
        const repository = `${updatedDeployment.detected_github_owner}/${updatedDeployment.detected_github_repo_name}`
        await verifyDeploymentFourEyes(
          deploymentId,
          commitSha,
          repository,
          updatedDeployment.environment_name,
          undefined,
          updatedDeployment.default_branch || 'main',
          updatedDeployment.monitored_app_id,
        )

        // Reload deployment to get the updated PR data from verification
        updatedDeployment = await getDeploymentById(deploymentId)
      }

      // Set status to legacy_pending but PRESERVE the github_pr_data from verification
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'legacy_pending',
        githubPrNumber: updatedDeployment?.github_pr_number || (prNumber ? parseInt(prNumber, 10) : null),
        githubPrUrl: updatedDeployment?.github_pr_url || prUrl || null,
        // Keep the PR data from verifyDeploymentFourEyes - don't overwrite it
        githubPrData: updatedDeployment?.github_pr_data || undefined,
        title: updatedDeployment?.title || prTitle || commitMessage || null,
      })

      return { success: 'GitHub-data lagret - venter på godkjenning fra annen person' }
    } catch (error) {
      console.error('Error saving legacy data:', error)
      return { error: 'Kunne ikke lagre data' }
    }
  }

  // Legacy: Manual registration without GitHub lookup (keep for backwards compatibility)
  if (intent === 'register_legacy_info') {
    const slackLink = formData.get('slack_link') as string
    const deployer = formData.get('deployer') as string
    const commitSha = formData.get('commit_sha') as string
    const prNumber = formData.get('pr_number') as string
    const navIdent = getNavIdent(request)

    if (!navIdent) {
      return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
    }

    if (!slackLink || slackLink.trim() === '') {
      return { error: 'Slack-lenke er påkrevd' }
    }

    try {
      // Build description of what was registered
      const parts: string[] = []
      if (deployer) parts.push(`Deployer: ${deployer.trim()}`)
      if (commitSha) parts.push(`SHA: ${commitSha.trim()}`)
      if (prNumber) parts.push(`PR: #${prNumber.trim()}`)
      const infoText = parts.length > 0 ? parts.join(', ') : 'Legacy info registrert'

      await createComment({
        deployment_id: deploymentId,
        comment_text: infoText,
        slack_link: slackLink.trim(),
        comment_type: 'legacy_info',
        registered_by: navIdent,
      })

      // Update deployment with provided info
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'pending_approval',
        githubPrNumber: prNumber ? parseInt(prNumber, 10) : null,
        githubPrUrl: null,
      })

      return { success: 'Legacy info registrert - venter på godkjenning fra annen person' }
    } catch (_error) {
      return { error: 'Kunne ikke registrere legacy info' }
    }
  }

  if (intent === 'approve_legacy') {
    const navIdent = getNavIdent(request)
    const legacyInfo = await getLegacyInfo(deploymentId)

    if (!navIdent) {
      return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
    }

    if (!legacyInfo) {
      return { error: 'Ingen legacy info å godkjenne' }
    }

    // Check that approver is different from registerer
    if (legacyInfo.registered_by?.toLowerCase() === navIdent.toLowerCase()) {
      return { error: 'Godkjenner kan ikke være samme person som registrerte info' }
    }

    try {
      // Get current deployment to preserve GitHub data
      const currentDeployment = await getDeploymentById(deploymentId)

      await createComment({
        deployment_id: deploymentId,
        comment_text: 'Legacy deployment godkjent etter gjennomgang',
        slack_link: legacyInfo.slack_link || undefined,
        comment_type: 'manual_approval',
        approved_by: navIdent,
      })

      // Preserve existing GitHub data when approving
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'manually_approved',
        githubPrNumber: currentDeployment?.github_pr_number || null,
        githubPrUrl: currentDeployment?.github_pr_url || null,
        githubPrData: currentDeployment?.github_pr_data || undefined,
        title: currentDeployment?.title || null,
      })

      return { success: 'Legacy deployment godkjent' }
    } catch (_error) {
      return { error: 'Kunne ikke godkjenne legacy deployment' }
    }
  }

  if (intent === 'reject_legacy') {
    const navIdent = getNavIdent(request)
    const reason = formData.get('reason') as string

    if (!navIdent) {
      return { error: 'Kunne ikke identifisere bruker. Vennligst logg inn på nytt.' }
    }

    try {
      // Delete the legacy_info comment
      await deleteLegacyInfo(deploymentId)

      // Add a rejection comment
      await createComment({
        deployment_id: deploymentId,
        comment_text: `Legacy-verifisering avvist av ${navIdent}${reason ? `: ${reason}` : ''}`,
        comment_type: 'comment',
      })

      // Reset status back to legacy
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: false,
        fourEyesStatus: 'legacy',
        githubPrNumber: null,
        githubPrUrl: null,
      })

      return { success: 'Legacy-verifisering avvist - kan registreres på nytt' }
    } catch (_error) {
      return { error: 'Kunne ikke avvise verifisering' }
    }
  }

  if (intent === 'delete_comment') {
    const commentId = parseInt(formData.get('comment_id') as string, 10)
    try {
      await deleteComment(commentId)
      return { success: 'Kommentar slettet' }
    } catch (_error) {
      return { error: 'Kunne ikke slette kommentar' }
    }
  }

  if (intent === 'verify_four_eyes') {
    const deployment = await getDeploymentById(deploymentId)

    if (!deployment) {
      return { error: 'Deployment ikke funnet' }
    }

    // Check if deployment has required data
    if (!deployment.commit_sha) {
      return { error: 'Kan ikke verifisere: deployment mangler commit SHA' }
    }

    if (!deployment.detected_github_owner || !deployment.detected_github_repo_name) {
      return { error: 'Kan ikke verifisere: deployment mangler repository info' }
    }

    try {
      console.log(`🔍 Manually verifying deployment ${deployment.nais_deployment_id}...`)

      const success = await verifyDeploymentFourEyes(
        deployment.id,
        deployment.commit_sha,
        `${deployment.detected_github_owner}/${deployment.detected_github_repo_name}`,
        deployment.environment_name,
        deployment.trigger_url,
        deployment.default_branch || 'main',
        deployment.monitored_app_id,
      )

      if (success) {
        return { success: 'Four-eyes status verifisert og oppdatert' }
      } else {
        return { error: 'Verifisering feilet - se logger for detaljer' }
      }
    } catch (error) {
      console.error('Verification error:', error)
      if (error instanceof Error && error.message.includes('rate limit')) {
        return { error: 'GitHub rate limit nådd. Prøv igjen senere.' }
      }
      return {
        error: `Kunne ikke verifisere: ${error instanceof Error ? error.message : 'Ukjent feil'}`,
      }
    }
  }

  if (intent === 'approve_baseline') {
    try {
      await updateDeploymentFourEyes(deploymentId, {
        hasFourEyes: true,
        fourEyesStatus: 'baseline',
        githubPrNumber: null,
        githubPrUrl: null,
      })
      return { success: 'Deployment godkjent som baseline' }
    } catch (_error) {
      return { error: 'Kunne ikke godkjenne baseline' }
    }
  }

  return null
}

function getFourEyesStatus(deployment: any): {
  text: string
  variant: 'success' | 'warning' | 'error' | 'info'
  description: string
} {
  // Check specific statuses first, before generic has_four_eyes check
  switch (deployment.four_eyes_status) {
    case 'approved':
    case 'approved_pr':
      return {
        text: 'Godkjent',
        variant: 'success',
        description: 'Dette deploymentet har blitt godkjent via en approved PR.',
      }
    case 'baseline':
      return {
        text: 'Baseline',
        variant: 'success',
        description: 'Første deployment for dette miljøet. Brukes som utgangspunkt for verifisering.',
      }
    case 'pending_baseline':
      return {
        text: 'Foreslått baseline',
        variant: 'warning',
        description: 'Første deployment for dette miljøet. Må godkjennes manuelt som baseline før videre verifisering.',
      }
    case 'no_changes':
      return {
        text: 'Ingen endringer',
        variant: 'success',
        description: 'Samme commit som forrige deployment.',
      }
    case 'unverified_commits':
      return {
        text: 'Ikke-verifiserte commits',
        variant: 'error',
        description:
          'Det finnes commits mellom forrige og dette deploymentet som ikke har godkjent PR. Se detaljer under.',
      }
    case 'approved_pr_with_unreviewed':
      return {
        text: 'Ureviewed commits i merge',
        variant: 'error',
        description:
          'PR var godkjent, men det ble merget inn commits fra main som ikke har godkjenning. Se detaljer under.',
      }
    case 'legacy':
    case 'legacy_pending':
      return {
        text: deployment.four_eyes_status === 'legacy_pending' ? 'Legacy (venter)' : 'Legacy',
        variant: deployment.four_eyes_status === 'legacy_pending' ? 'warning' : 'success',
        description:
          deployment.four_eyes_status === 'legacy_pending'
            ? 'GitHub-data hentet. Venter på godkjenning fra en annen person.'
            : 'Dette deploymentet har ugyldig eller mangelfull data fra Nais API, som skyldes endringer i Nais sitt skjema.',
      }
    case 'manually_approved':
      return {
        text: 'Manuelt godkjent',
        variant: 'success',
        description: 'Dette deploymentet er manuelt godkjent med dokumentasjon i Slack.',
      }
    case 'implicitly_approved':
      return {
        text: 'Implisitt godkjent',
        variant: 'success',
        description:
          'Dette deploymentet er implisitt godkjent fordi den som merget PR-en verken opprettet PR-en eller har siste commit.',
      }
    case 'direct_push':
      return {
        text: 'Direct push',
        variant: 'warning',
        description: 'Dette var en direct push til main. Legg til Slack-lenke som bevis på review.',
      }
    case 'missing':
      return {
        text: 'Mangler godkjenning',
        variant: 'error',
        description: 'PR-en var ikke godkjent etter siste commit, eller godkjenningen kom før siste commit.',
      }
    case 'error':
      return {
        text: 'Feil ved verifisering',
        variant: 'error',
        description: 'Det oppstod en feil ved sjekk av GitHub.',
      }
    case 'pending':
      return {
        text: 'Venter på verifisering',
        variant: 'info',
        description: 'Deploymentet er ikke verifisert ennå.',
      }
  }

  // Fallback for has_four_eyes without specific status
  if (deployment.has_four_eyes) {
    return {
      text: 'Godkjent',
      variant: 'success',
      description: 'Dette deploymentet har blitt godkjent.',
    }
  }

  return {
    text: 'Ukjent status',
    variant: 'info',
    description: `Godkjenningsstatus kunne ikke fastslås (${deployment.four_eyes_status}).`,
  }
}

export default function DeploymentDetail({ loaderData, actionData }: Route.ComponentProps) {
  const {
    deployment,
    comments,
    manualApproval,
    legacyInfo,
    previousDeployment,
    nextDeployment,
    userMappings,
    appUrl,
    isCurrentUserInvolved,
    involvementReason,
  } = loaderData
  const [searchParams] = useSearchParams()
  const [commentText, setCommentText] = useState('')
  const [slackLink, setSlackLink] = useState('')
  const [approvalReason, setApprovalReason] = useState('')
  const [approvalSlackLink, setApprovalSlackLink] = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)
  const [showLegacyForm, setShowLegacyForm] = useState(false)
  const [legacySearchType, setLegacySearchType] = useState<'sha' | 'pr'>('sha')
  const [legacySearchValue, setLegacySearchValue] = useState('')
  const [legacySlackLink, setLegacySlackLink] = useState('')

  // Reset legacy form to initial state
  const resetLegacyForm = () => {
    setShowLegacyForm(false)
    setLegacySearchType('sha')
    setLegacySearchValue('')
    setLegacySlackLink('')
  }

  // Statuses that require manual approval (when no manualApproval exists)
  const statusesRequiringApproval = [
    'direct_push',
    'missing',
    'unverified_commits',
    'approved_pr_with_unreviewed',
    'error',
    'pending',
    'pr_not_approved',
  ]
  const isLegacy = deployment.four_eyes_status === 'legacy'
  const isLegacyPending = deployment.four_eyes_status === 'legacy_pending'
  const isPendingApproval = deployment.four_eyes_status === 'pending_approval' || isLegacyPending
  const requiresManualApproval =
    statusesRequiringApproval.includes(deployment.four_eyes_status ?? '') && !manualApproval
  const commentDialogRef = useRef<HTMLDialogElement>(null)

  const status = getFourEyesStatus(deployment)

  // Helper to get user display info (falls back to username if no mapping)
  const getUserDisplay = (githubUsername: string | undefined | null) => getUserDisplayName(githubUsername, userMappings)

  return (
    <VStack gap="space-32">
      {/* Navigation buttons */}
      <HStack justify="end" gap="space-8">
        {previousDeployment ? (
          <Button
            as={Link}
            to={`${appUrl}/deployments/${previousDeployment.id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
            variant="tertiary"
            size="xsmall"
          >
            ← Forrige
          </Button>
        ) : (
          <Button variant="tertiary" size="xsmall" disabled>
            ← Forrige
          </Button>
        )}
        <Button
          as={Link}
          to={`${appUrl}/deployments${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
          variant="tertiary"
          size="xsmall"
        >
          Alle
        </Button>
        {nextDeployment ? (
          <Button
            as={Link}
            to={`${appUrl}/deployments/${nextDeployment.id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`}
            variant="tertiary"
            size="xsmall"
          >
            Neste →
          </Button>
        ) : (
          <Button variant="tertiary" size="xsmall" disabled>
            Neste →
          </Button>
        )}
      </HStack>
      {/* Main header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Heading size="large" style={{ flex: 1 }}>
            {deployment.github_pr_data?.title || `${deployment.app_name} @ ${deployment.environment_name}`}
          </Heading>
          <HStack gap="space-8" align="center">
            {/* Godkjenning status tag (only shown for OK/approved states) */}
            {(deployment.four_eyes_status === 'approved' ||
              deployment.four_eyes_status === 'manually_approved' ||
              deployment.four_eyes_status === 'implicitly_approved') && (
              <Tag data-color="success" variant="outline" size="small">
                {deployment.four_eyes_status === 'implicitly_approved' ? 'Implisitt godkjent' : 'Godkjent'}
              </Tag>
            )}
            {/* Method tag */}
            {deployment.github_pr_number ? (
              <Tag data-color="info" variant="outline" size="small">
                Pull Request
              </Tag>
            ) : deployment.four_eyes_status === 'direct_push' ||
              deployment.four_eyes_status === 'unverified_commits' ? (
              <Tag data-color="warning" variant="outline" size="small">
                Direct Push
              </Tag>
            ) : deployment.four_eyes_status === 'legacy' ? (
              <Tag data-color="neutral" variant="outline" size="small">
                Legacy
              </Tag>
            ) : null}
            {/* Verify button for non-OK states */}
            {deployment.commit_sha &&
              [
                'pending',
                'error',
                'missing',
                'direct_push',
                'unverified_commits',
                'pr_not_approved',
                'approved_pr_with_unreviewed',
                'baseline',
                'no_changes',
                'pending_baseline',
              ].includes(deployment.four_eyes_status) && (
                <Form method="post" style={{ display: 'inline' }}>
                  <input type="hidden" name="intent" value="verify_four_eyes" />
                  <Button
                    type="submit"
                    size="small"
                    variant="tertiary"
                    icon={<ArrowsCirclepathIcon aria-hidden />}
                    title="Verifiser godkjenningsstatus mot GitHub"
                  >
                    Verifiser
                  </Button>
                </Form>
              )}
            {/* Approve baseline button */}
            {deployment.four_eyes_status === 'pending_baseline' && (
              <Form method="post" style={{ display: 'inline' }}>
                <input type="hidden" name="intent" value="approve_baseline" />
                <Button
                  type="submit"
                  size="small"
                  variant="primary"
                  icon={<CheckmarkCircleIcon aria-hidden />}
                  title="Godkjenn dette deploymentet som baseline"
                >
                  Godkjenn baseline
                </Button>
              </Form>
            )}
          </HStack>
        </div>
        <BodyShort textColor="subtle">
          {new Date(deployment.created_at).toLocaleString('no-NO', {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
          {deployment.github_pr_number && deployment.github_pr_url && (
            <>
              {' '}
              via{' '}
              <Link to={deployment.github_pr_url} target="_blank">
                #{deployment.github_pr_number}
              </Link>
            </>
          )}
        </BodyShort>
      </div>
      {actionData?.success && <Alert variant="success">{actionData.success}</Alert>}
      {actionData?.error && <Alert variant="error">{actionData.error}</Alert>}
      {/* Four-eyes Alert - only shown for non-OK states */}
      {deployment.four_eyes_status !== 'approved' &&
        deployment.four_eyes_status !== 'manually_approved' &&
        deployment.four_eyes_status !== 'implicitly_approved' && (
          <Alert variant={status.variant}>
            <Heading size="small" spacing>
              {status.text}
            </Heading>
            <BodyShort>
              {status.description}
              {(deployment.four_eyes_status === 'unverified_commits' ||
                deployment.four_eyes_status === 'approved_pr_with_unreviewed') &&
                previousDeployment?.commit_sha &&
                deployment.commit_sha && (
                  <>
                    {' '}
                    <a
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeployment.commit_sha}...${deployment.commit_sha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Se endringer på GitHub
                    </a>
                  </>
                )}
            </BodyShort>
          </Alert>
        )}
      {/* Unverified commits section */}
      {(() => {
        // Filter out commits that are already shown in the PR commits accordion or are the merge commit
        const prCommitShas = new Set(deployment.github_pr_data?.commits?.map((c: any) => c.sha) || [])
        const mergeCommitSha = deployment.github_pr_data?.merge_commit_sha
        const filteredUnverifiedCommits =
          deployment.unverified_commits?.filter(
            (commit: any) => !prCommitShas.has(commit.sha) && commit.sha !== mergeCommitSha,
          ) || []

        return (
          filteredUnverifiedCommits.length > 0 && (
            <Alert variant="error">
              <Heading size="small" spacing>
                Ikke-verifiserte commits ({filteredUnverifiedCommits.length})
              </Heading>
              <BodyShort spacing>
                Følgende commits mellom forrige og dette deploymentet har ikke godkjent PR.
                {previousDeployment?.commit_sha && deployment.commit_sha && (
                  <>
                    {' '}
                    <a
                      href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeployment.commit_sha}...${deployment.commit_sha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Se endringer på GitHub
                    </a>
                  </>
                )}
              </BodyShort>
              <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                {filteredUnverifiedCommits.map((commit: any) => (
                  <li key={commit.sha} style={{ marginBottom: '0.5rem' }}>
                    <a
                      href={commit.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                    >
                      {commit.sha.substring(0, 7)}
                    </a>{' '}
                    - {commit.message}
                    <br />
                    <Detail>
                      av {commit.author} •{' '}
                      {commit.pr_number ? `PR #${commit.pr_number} ikke godkjent` : 'Ingen PR (direkte push)'}
                    </Detail>
                  </li>
                ))}
              </ul>
            </Alert>
          )
        )
      })()}
      {/* Deployment Details Section */}
      <Heading size="medium">Detaljer</Heading>
      <HGrid gap="space-16" columns={{ xs: 1, sm: 2, md: 3 }}>
        <VStack gap="space-4">
          <Detail>Deployer</Detail>
          <BodyShort>
            {deployment.deployer_username ? (
              <a href={`https://github.com/${deployment.deployer_username}`} target="_blank" rel="noopener noreferrer">
                {getUserDisplay(deployment.deployer_username)}
              </a>
            ) : (
              '(ukjent)'
            )}
          </BodyShort>
        </VStack>

        <VStack gap="space-4">
          <Detail>Commit SHA</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              {deployment.commit_sha ? (
                <a
                  href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.commit_sha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                >
                  {deployment.commit_sha.substring(0, 7)}
                </a>
              ) : (
                <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>(ukjent)</span>
              )}
            </BodyShort>
            {deployment.commit_sha && <CopyButton copyText={deployment.commit_sha} size="small" title="Kopier SHA" />}
          </HStack>
        </VStack>

        {deployment.branch_name && (
          <VStack gap="space-4">
            <Detail>Branch</Detail>
            <BodyShort>
              <a
                href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/tree/${deployment.branch_name}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
              >
                {deployment.branch_name}
              </a>
            </BodyShort>
          </VStack>
        )}

        {deployment.parent_commits && deployment.parent_commits.length > 1 && (
          <VStack gap="space-4">
            <Detail>Merge commit (parents)</Detail>
            <BodyShort>
              {deployment.parent_commits.map((parent, index) => (
                <span key={parent.sha}>
                  <a
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${parent.sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                  >
                    {parent.sha.substring(0, 7)}
                  </a>
                  {index < (deployment.parent_commits?.length ?? 0) - 1 && ', '}
                </span>
              ))}
            </BodyShort>
          </VStack>
        )}

        {deployment.trigger_url && (
          <VStack gap="space-4">
            <Detail>GitHub Actions</Detail>
            <BodyShort>
              <a href={deployment.trigger_url} target="_blank" rel="noopener noreferrer">
                Se workflow run
              </a>
            </BodyShort>
          </VStack>
        )}

        <VStack gap="space-4">
          <Detail>Nais Deployment ID</Detail>
          <HStack gap="space-8" align="center">
            <BodyShort>
              <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{deployment.nais_deployment_id}</code>
            </BodyShort>
            <CopyButton copyText={deployment.nais_deployment_id} size="small" title="Kopier deployment ID" />
          </HStack>
        </VStack>

        {/* PR-specific fields in same grid */}

        {deployment.github_pr_data && (
          <>
            <VStack gap="space-4">
              <Detail>PR Opprettet av</Detail>
              <BodyShort>
                <a
                  href={`https://github.com/${deployment.github_pr_data.creator.username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {getUserDisplay(deployment.github_pr_data.creator.username)}
                </a>
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merger && (
              <VStack gap="space-4">
                <Detail>Merget av</Detail>
                <BodyShort>
                  <a
                    href={`https://github.com/${deployment.github_pr_data.merger.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {getUserDisplay(deployment.github_pr_data.merger.username)}
                  </a>
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Opprettet</Detail>
              <BodyShort>
                {new Date(deployment.github_pr_data.created_at).toLocaleString('no-NO', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </BodyShort>
            </VStack>

            {deployment.github_pr_data.merged_at && (
              <VStack gap="space-4">
                <Detail>Merget</Detail>
                <BodyShort>
                  {new Date(deployment.github_pr_data.merged_at).toLocaleString('no-NO', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>Base branch</Detail>
              <BodyShort>{deployment.github_pr_data.base_branch}</BodyShort>
            </VStack>

            {deployment.github_pr_data.head_branch && (
              <VStack gap="space-4">
                <Detail>Head branch</Detail>
                <BodyShort>{deployment.github_pr_data.head_branch}</BodyShort>
              </VStack>
            )}

            {deployment.github_pr_data.merge_commit_sha && (
              <VStack gap="space-4">
                <Detail>Merge commit</Detail>
                <BodyShort>
                  <a
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/commit/${deployment.github_pr_data.merge_commit_sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {deployment.github_pr_data.merge_commit_sha.substring(0, 7)}
                  </a>
                </BodyShort>
              </VStack>
            )}

            <VStack gap="space-4">
              <Detail>PR Status</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.draft && (
                  <Tag data-color="warning" variant="outline" size="small">
                    Draft
                  </Tag>
                )}
                {deployment.github_pr_data.locked && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    🔒 Låst
                  </Tag>
                )}
                {deployment.github_pr_data.auto_merge && (
                  <Tag data-color="info" variant="outline" size="small">
                    Auto-merge ({deployment.github_pr_data.auto_merge.merge_method})
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === true && (
                  <Tag data-color="neutral" variant="outline" size="small">
                    <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} /> Checks OK
                  </Tag>
                )}
                {deployment.github_pr_data.checks_passed === false && (
                  <Tag data-color="danger" variant="outline" size="small">
                    <XMarkIcon aria-hidden /> Checks failed
                  </Tag>
                )}
              </HStack>
            </VStack>

            {deployment.github_pr_data.assignees && deployment.github_pr_data.assignees.length > 0 && (
              <VStack gap="space-4">
                <Detail>Tildelt</Detail>
                <HStack gap="space-8" wrap>
                  {deployment.github_pr_data.assignees.map((a) => (
                    <Tag data-color="neutral" key={a.username} variant="outline" size="small">
                      {getUserDisplay(a.username)}
                    </Tag>
                  ))}
                </HStack>
              </VStack>
            )}

            {deployment.github_pr_data.milestone && (
              <VStack gap="space-4">
                <Detail>Milestone</Detail>
                <Tag data-color="info" variant="outline" size="small">
                  {deployment.github_pr_data.milestone.title} ({deployment.github_pr_data.milestone.state})
                </Tag>
              </VStack>
            )}
          </>
        )}
      </HGrid>
      {/* PR Details Accordion - Reviewers, Checks, Commits */}
      {deployment.github_pr_data && (
        <Accordion>
          {/* Reviewers - includes requested and completed reviews */}
          {((deployment.github_pr_data.reviewers && deployment.github_pr_data.reviewers.length > 0) ||
            (deployment.github_pr_data.requested_reviewers &&
              deployment.github_pr_data.requested_reviewers.length > 0) ||
            (deployment.github_pr_data.requested_teams && deployment.github_pr_data.requested_teams.length > 0)) && (
            <Accordion.Item>
              <Accordion.Header>
                Reviewers (
                {(deployment.github_pr_data.reviewers?.length || 0) +
                  (deployment.github_pr_data.requested_reviewers?.length || 0) +
                  (deployment.github_pr_data.requested_teams?.length || 0)}
                )
              </Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-8">
                  {/* Completed reviews */}
                  {deployment.github_pr_data.reviewers?.map((reviewer) => (
                    <HStack key={`${reviewer.username}:${reviewer.submitted_at}`} gap="space-8" align="center">
                      {reviewer.state === 'APPROVED' && (
                        <CheckmarkIcon aria-hidden style={{ color: 'var(--ax-text-success)' }} />
                      )}
                      {reviewer.state === 'CHANGES_REQUESTED' && (
                        <XMarkIcon aria-hidden style={{ color: 'var(--ax-text-danger)' }} />
                      )}
                      {reviewer.state === 'COMMENTED' && (
                        <ChatIcon aria-hidden style={{ color: 'var(--ax-text-neutral-subtle)' }} />
                      )}
                      <a href={`https://github.com/${reviewer.username}`} target="_blank" rel="noopener noreferrer">
                        {getUserDisplay(reviewer.username)}
                      </a>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(reviewer.submitted_at).toLocaleString('no-NO', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    </HStack>
                  ))}

                  {/* Requested reviewers (pending) */}
                  {deployment.github_pr_data.requested_reviewers?.map((r) => (
                    <HStack key={`pending:${r.username}`} gap="space-8" align="center">
                      <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                      <a href={`https://github.com/${r.username}`} target="_blank" rel="noopener noreferrer">
                        {getUserDisplay(r.username)}
                      </a>
                    </HStack>
                  ))}

                  {/* Requested teams (pending) */}
                  {deployment.github_pr_data.requested_teams?.map((t) => (
                    <HStack key={`team:${t.slug}`} gap="space-8" align="center">
                      <CircleIcon aria-hidden style={{ color: 'var(--ax-text-warning)' }} />
                      <span>{t.name}</span>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* GitHub Checks */}
          {deployment.github_pr_data.checks && deployment.github_pr_data.checks.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>GitHub Checks ({deployment.github_pr_data.checks.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-8">
                  {deployment.github_pr_data.checks.map((check) => {
                    const isSuccess = check.conclusion === 'success'
                    const isFailure =
                      check.conclusion === 'failure' ||
                      check.conclusion === 'timed_out' ||
                      check.conclusion === 'action_required'
                    const isSkipped =
                      check.conclusion === 'skipped' ||
                      check.conclusion === 'neutral' ||
                      check.conclusion === 'cancelled'
                    const isInProgress = check.status === 'in_progress' || check.status === 'queued'

                    return (
                      <HStack key={check.html_url} gap="space-8" align="center">
                        {isSuccess && <CheckmarkCircleIcon style={{ color: 'var(--ax-text-success)' }} />}
                        {isFailure && <XMarkOctagonIcon style={{ color: 'var(--ax-text-danger)' }} />}
                        {isSkipped && <MinusCircleIcon style={{ color: 'var(--ax-text-neutral-subtle)' }} />}
                        {isInProgress && <ClockIcon style={{ color: 'var(--ax-text-warning)' }} />}

                        {check.html_url ? (
                          <a href={check.html_url} target="_blank" rel="noopener noreferrer">
                            {check.name}
                          </a>
                        ) : (
                          <span>{check.name}</span>
                        )}

                        <Tag
                          variant={isSuccess ? 'success' : isFailure ? 'error' : isSkipped ? 'neutral' : 'warning'}
                          size="small"
                        >
                          {check.conclusion || check.status}
                        </Tag>

                        {check.completed_at && (
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(check.completed_at).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        )}
                      </HStack>
                    )
                  })}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* PR Commits */}
          {deployment.github_pr_data.commits && deployment.github_pr_data.commits.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>Commits ({deployment.github_pr_data.commits.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.commits.map((commit) => (
                    <HStack key={commit.sha} gap="space-12" align="start">
                      {commit.author.avatar_url && (
                        <img
                          src={commit.author.avatar_url}
                          alt={getUserDisplay(commit.author.username) ?? ''}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <VStack gap="space-4">
                        <HStack gap="space-8" align="baseline" wrap>
                          <a
                            href={commit.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                          >
                            {commit.sha.substring(0, 7)}
                          </a>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {getUserDisplay(commit.author.username)}
                          </span>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(commit.date).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                        </HStack>
                        <BodyShort>{commit.message.split('\n')[0]}</BodyShort>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}

          {/* GitHub Comments */}
          {deployment.github_pr_data.comments && deployment.github_pr_data.comments.length > 0 && (
            <Accordion.Item>
              <Accordion.Header>Kommentarer ({deployment.github_pr_data.comments.length})</Accordion.Header>
              <Accordion.Content>
                <VStack gap="space-12">
                  {deployment.github_pr_data.comments.map((comment) => (
                    <HStack key={comment.id} gap="space-12" align="start">
                      {comment.user.avatar_url && (
                        <img
                          src={comment.user.avatar_url}
                          alt={getUserDisplay(comment.user.username) ?? ''}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <VStack gap="space-4" style={{ flex: 1 }}>
                        <HStack gap="space-8" align="baseline" wrap>
                          <a
                            href={`https://github.com/${comment.user.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {getUserDisplay(comment.user.username)}
                          </a>
                          <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                            {new Date(comment.created_at).toLocaleString('no-NO', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </span>
                          <a
                            href={comment.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'var(--ax-text-neutral-subtle)' }}
                          >
                            vis på GitHub
                          </a>
                        </HStack>
                        <BodyShort style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</BodyShort>
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              </Accordion.Content>
            </Accordion.Item>
          )}
        </Accordion>
      )}
      {/* Resources section */}
      {deployment.resources && deployment.resources.length > 0 && (
        <div>
          <Heading size="small" spacing>
            Kubernetes Resources
          </Heading>
          <HStack gap="space-8" wrap>
            {deployment.resources.map((resource: any) => (
              <Tag data-color="info" key={`${resource.kind}:${resource.name}`} variant="outline" size="small">
                {resource.kind}: {resource.name}
              </Tag>
            ))}
          </HStack>
        </div>
      )}
      {/* PR Details section */}
      {deployment.github_pr_data && (
        <VStack gap="space-16">
          {deployment.github_pr_data.body && (
            <div>
              <Heading size="medium">Beskrivelse</Heading>
              <Box background="neutral-soft" padding="space-16" borderRadius="12" marginBlock="space-8 space-0">
                <BodyShort style={{ whiteSpace: 'pre-wrap' }}>
                  {/* biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub PR body contains safe markdown HTML */}
                  <div dangerouslySetInnerHTML={{ __html: deployment.github_pr_data.body }} />
                </BodyShort>
              </Box>
            </div>
          )}

          {/* PR Stats */}
          <HGrid gap="space-16" columns={{ xs: 2, sm: 3, md: 6 }}>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Commits</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.commits_count}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Filer endret</Detail>
                <BodyShort>
                  <strong>{deployment.github_pr_data.changed_files}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Linjer lagt til</Detail>
                <BodyShort style={{ color: 'var(--ax-text-success)' }}>
                  <strong>+{deployment.github_pr_data.additions}</strong>
                </BodyShort>
              </VStack>
            </Box>
            <Box padding="space-12" borderRadius="8" background="sunken">
              <VStack gap="space-4">
                <Detail textColor="subtle">Linjer fjernet</Detail>
                <BodyShort style={{ color: 'var(--ax-text-danger)' }}>
                  <strong>-{deployment.github_pr_data.deletions}</strong>
                </BodyShort>
              </VStack>
            </Box>
            {deployment.github_pr_data.comments_count !== undefined && (
              <Box padding="space-12" borderRadius="8" background="sunken">
                <VStack gap="space-4">
                  <Detail textColor="subtle">Kommentarer</Detail>
                  <BodyShort>
                    <strong>{deployment.github_pr_data.comments_count}</strong>
                  </BodyShort>
                </VStack>
              </Box>
            )}
            {deployment.github_pr_data.review_comments_count !== undefined && (
              <Box padding="space-12" borderRadius="8" background="sunken">
                <VStack gap="space-4">
                  <Detail textColor="subtle">Review-kommentarer</Detail>
                  <BodyShort>
                    <strong>{deployment.github_pr_data.review_comments_count}</strong>
                  </BodyShort>
                </VStack>
              </Box>
            )}
          </HGrid>

          {/* Labels */}
          {deployment.github_pr_data.labels && deployment.github_pr_data.labels.length > 0 && (
            <VStack gap="space-8">
              <Detail textColor="subtle">Labels</Detail>
              <HStack gap="space-8" wrap>
                {deployment.github_pr_data.labels.map((label) => (
                  <Tag data-color="neutral" key={label} variant="outline" size="small">
                    {label}
                  </Tag>
                ))}
              </HStack>
            </VStack>
          )}
        </VStack>
      )}
      {/* Unreviewed commits warning */}
      {deployment.github_pr_data?.unreviewed_commits && deployment.github_pr_data.unreviewed_commits.length > 0 && (
        <div>
          <Alert variant="error">
            <Heading size="small" spacing>
              <ExclamationmarkTriangleIcon aria-hidden /> Ureviewed commits funnet
            </Heading>
            <BodyShort spacing>
              Følgende commits var på main mellom PR base og merge, men mangler godkjenning:
            </BodyShort>
          </Alert>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {deployment.github_pr_data.unreviewed_commits.map((commit) => (
              <Box
                key={commit.sha}
                background="danger-soft"
                padding="space-16"
                borderRadius="8"
                borderWidth="1"
                borderColor="danger-subtleA"
              >
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                      }}
                    >
                      <a
                        href={commit.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                      >
                        {commit.sha.substring(0, 7)}
                      </a>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>{commit.author}</span>
                      <span style={{ color: 'var(--ax-text-neutral-subtle)' }}>
                        {new Date(commit.date).toLocaleDateString('no-NO', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <BodyShort size="small" style={{ marginTop: '0.25rem' }}>
                      {commit.message.split('\n')[0]}
                    </BodyShort>
                    <Detail style={{ marginTop: '0.5rem', color: 'var(--ax-text-danger)' }}>{commit.reason}</Detail>
                  </div>
                </div>
              </Box>
            ))}
          </div>
        </div>
      )}
      {/* Manual approval section - for deployments needing manual approval */}
      {requiresManualApproval && (
        <Box background="warning-moderate" padding="space-24" borderRadius="8">
          <VStack gap="space-16">
            <Heading size="small">
              <ExclamationmarkTriangleIcon aria-hidden /> Krever manuell godkjenning
            </Heading>
            <BodyShort>
              Dette deploymentet har status "{status.text}" og krever manuell godkjenning for å oppfylle
              fire-øyne-prinsippet. Legg ved Slack-lenke som dokumenterer at koden er blitt reviewet.
              {previousDeployment?.commit_sha && deployment.commit_sha && (
                <>
                  {' '}
                  <a
                    href={`https://github.com/${deployment.detected_github_owner}/${deployment.detected_github_repo_name}/compare/${previousDeployment.commit_sha}...${deployment.commit_sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Se endringer på GitHub
                  </a>
                </>
              )}
            </BodyShort>

            {isCurrentUserInvolved ? (
              <Alert variant="warning">
                <Heading size="xsmall" spacing>
                  Du kan ikke godkjenne dette deploymentet
                </Heading>
                <BodyShort>{involvementReason}</BodyShort>
                <BodyShort style={{ marginTop: 'var(--ax-space-8)' }}>
                  Fire-øyne-prinsippet krever at en annen person godkjenner.
                </BodyShort>
              </Alert>
            ) : !showApprovalForm ? (
              <Button variant="primary" onClick={() => setShowApprovalForm(true)}>
                Godkjenn manuelt
              </Button>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="manual_approval" />
                <VStack gap="space-16">
                  <TextField
                    label="Slack-lenke"
                    name="slack_link"
                    value={approvalSlackLink}
                    onChange={(e) => setApprovalSlackLink(e.target.value)}
                    description="Lenke til Slack-tråd hvor kode-review er dokumentert"
                    size="small"
                    required
                  />
                  <Textarea
                    label="Begrunnelse (valgfritt)"
                    name="reason"
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    description="F.eks: 'Hotfix reviewet i Slack av kollega'"
                    size="small"
                    rows={2}
                  />
                  <HStack gap="space-8">
                    <Button type="submit" variant="primary" size="small">
                      Godkjenn
                    </Button>
                    <Button type="button" variant="secondary" size="small" onClick={() => setShowApprovalForm(false)}>
                      Avbryt
                    </Button>
                  </HStack>
                </VStack>
              </Form>
            )}
          </VStack>
        </Box>
      )}

      {/* Legacy deployment - GitHub lookup section */}
      {isLegacy && !legacyInfo && !manualApproval && (
        <Box background="info-moderate" padding="space-24" borderRadius="8">
          <VStack gap="space-16">
            <Heading size="small">
              <ClockIcon aria-hidden /> Legacy deployment - hent data fra GitHub
            </Heading>
            <BodyShort>
              Søk opp data fra GitHub ved hjelp av commit SHA eller PR-nummer. Tidspunktet må være innenfor 30 minutter
              av deployment-tidspunktet. En annen person må deretter godkjenne.
            </BodyShort>

            {actionData?.error && showLegacyForm && <Alert variant="error">{actionData.error}</Alert>}
            {actionData?.success && showLegacyForm && <Alert variant="success">{actionData.success}</Alert>}

            {!showLegacyForm ? (
              <Button variant="primary" onClick={() => setShowLegacyForm(true)}>
                Hent fra GitHub
              </Button>
            ) : actionData?.legacyLookup ? (
              // Show preview of looked up data
              <VStack gap="space-16">
                <Alert variant={actionData.legacyLookup.isWithinThreshold ? 'success' : 'warning'}>
                  <Heading size="xsmall">
                    {actionData.legacyLookup.isWithinThreshold ? 'Data funnet!' : 'Data funnet, men tidspunkt avviker'}
                  </Heading>
                  <BodyShort>
                    Tidsforskjell: {actionData.legacyLookup.timeDifferenceMinutes} minutter
                    {!actionData.legacyLookup.isWithinThreshold && ' (over 30 min grense)'}
                  </BodyShort>
                </Alert>

                <Box background="default" padding="space-16" borderRadius="4">
                  <VStack gap="space-8">
                    <Detail>
                      <strong>Commit:</strong> {actionData.legacyLookup.commitSha?.substring(0, 7)}
                    </Detail>
                    <Detail>
                      <strong>Melding:</strong> {actionData.legacyLookup.commitMessage}
                    </Detail>
                    <Detail>
                      <strong>Forfatter:</strong> {actionData.legacyLookup.commitAuthor}
                    </Detail>
                    {actionData.legacyLookup.mergedBy && (
                      <Detail>
                        <strong>Merget av:</strong> {actionData.legacyLookup.mergedBy}
                      </Detail>
                    )}
                    {actionData.legacyLookup.prNumber && (
                      <>
                        <Detail>
                          <strong>PR:</strong> #{actionData.legacyLookup.prNumber} - {actionData.legacyLookup.prTitle}
                        </Detail>
                        <Detail>
                          <strong>Godkjennere:</strong>{' '}
                          {actionData.legacyLookup.reviewers
                            ?.filter((r: { state: string }) => r.state === 'APPROVED')
                            .map((r: { username: string }) => r.username)
                            .join(', ') || 'Ingen'}
                        </Detail>
                      </>
                    )}
                  </VStack>
                </Box>

                <HStack gap="space-8">
                  <Form method="post" onSubmit={resetLegacyForm}>
                    <input type="hidden" name="intent" value="confirm_legacy_lookup" />
                    <input type="hidden" name="slack_link" value={actionData.legacyLookup.slackLink} />
                    <input type="hidden" name="commit_sha" value={actionData.legacyLookup.commitSha || ''} />
                    <input type="hidden" name="commit_message" value={actionData.legacyLookup.commitMessage || ''} />
                    <input type="hidden" name="commit_author" value={actionData.legacyLookup.commitAuthor || ''} />
                    <input type="hidden" name="pr_number" value={actionData.legacyLookup.prNumber || ''} />
                    <input type="hidden" name="pr_title" value={actionData.legacyLookup.prTitle || ''} />
                    <input type="hidden" name="pr_url" value={actionData.legacyLookup.prUrl || ''} />
                    <input type="hidden" name="pr_author" value={actionData.legacyLookup.prAuthor || ''} />
                    <input type="hidden" name="merged_by" value={actionData.legacyLookup.mergedBy || ''} />
                    <input
                      type="hidden"
                      name="pr_merged_at"
                      value={
                        actionData.legacyLookup.prMergedAt
                          ? new Date(actionData.legacyLookup.prMergedAt).toISOString()
                          : ''
                      }
                    />
                    <input
                      type="hidden"
                      name="reviewers"
                      value={JSON.stringify(actionData.legacyLookup.reviewers || [])}
                    />
                    <Button type="submit" variant="primary" size="small">
                      Bekreft og lagre
                    </Button>
                  </Form>
                  <Button variant="secondary" size="small" onClick={resetLegacyForm}>
                    Avbryt
                  </Button>
                </HStack>
              </VStack>
            ) : (
              // Show search form
              <Form method="post">
                <input type="hidden" name="intent" value="lookup_legacy_github" />
                <VStack gap="space-16">
                  <TextField
                    label="Slack-lenke"
                    name="slack_link"
                    value={legacySlackLink}
                    onChange={(e) => setLegacySlackLink(e.target.value)}
                    description="Lenke til Slack-melding for denne deployen"
                    size="small"
                    required
                  />
                  <HStack gap="space-8" align="end">
                    <div>
                      <BodyShort size="small" weight="semibold" spacing>
                        Søk på
                      </BodyShort>
                      <HStack gap="space-8">
                        <Button
                          type="button"
                          variant={legacySearchType === 'sha' ? 'primary' : 'secondary'}
                          size="small"
                          onClick={() => setLegacySearchType('sha')}
                        >
                          Commit SHA
                        </Button>
                        <Button
                          type="button"
                          variant={legacySearchType === 'pr' ? 'primary' : 'secondary'}
                          size="small"
                          onClick={() => setLegacySearchType('pr')}
                        >
                          PR-nummer
                        </Button>
                      </HStack>
                    </div>
                  </HStack>
                  <input type="hidden" name="search_type" value={legacySearchType} />
                  <TextField
                    label={legacySearchType === 'sha' ? 'Commit SHA' : 'PR-nummer'}
                    name="search_value"
                    value={legacySearchValue}
                    onChange={(e) => setLegacySearchValue(e.target.value)}
                    description={legacySearchType === 'sha' ? 'Full eller delvis SHA' : 'F.eks. 1234'}
                    size="small"
                    required
                  />
                  <HStack gap="space-8">
                    <Button type="submit" variant="primary" size="small">
                      Søk på GitHub
                    </Button>
                    <Button type="button" variant="secondary" size="small" onClick={resetLegacyForm}>
                      Avbryt
                    </Button>
                  </HStack>
                </VStack>
              </Form>
            )}
          </VStack>
        </Box>
      )}

      {/* Legacy deployment - pending approval (registered but needs approval from someone else) */}
      {(isPendingApproval || (legacyInfo && !manualApproval)) && (
        <Box background="warning-moderate" padding="space-24" borderRadius="8">
          <VStack gap="space-16">
            <Heading size="small">
              <ExclamationmarkTriangleIcon aria-hidden /> Venter på godkjenning
            </Heading>
            <BodyShort>
              Info ble registrert av <strong>{legacyInfo?.registered_by}</strong> den{' '}
              {legacyInfo?.created_at
                ? new Date(legacyInfo.created_at).toLocaleDateString('no-NO', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'ukjent dato'}
              .
            </BodyShort>
            {legacyInfo?.comment_text && (
              <BodyShort style={{ fontStyle: 'italic' }}>"{legacyInfo.comment_text}"</BodyShort>
            )}
            {legacyInfo?.slack_link && (
              <BodyShort size="small">
                <a href={legacyInfo.slack_link} target="_blank" rel="noopener noreferrer">
                  Se Slack-melding
                </a>
              </BodyShort>
            )}
            <Alert variant="info" size="small">
              En annen person enn {legacyInfo?.registered_by} må godkjenne.
            </Alert>

            <HStack gap="space-16" wrap>
              <Form method="post">
                <input type="hidden" name="intent" value="approve_legacy" />
                <Button type="submit" variant="primary" size="small">
                  Godkjenn
                </Button>
              </Form>

              <Form method="post">
                <input type="hidden" name="intent" value="reject_legacy" />
                <VStack gap="space-16">
                  <TextField label="Begrunnelse (valgfritt)" name="reason" size="small" />
                  <Button type="submit" variant="danger" size="small">
                    Avvis
                  </Button>
                </VStack>
              </Form>
            </HStack>
          </VStack>
        </Box>
      )}
      {/* Show existing manual approval if present */}
      {manualApproval && (
        <Alert variant="success">
          <Heading size="small">
            <CheckmarkIcon aria-hidden /> Manuelt godkjent
          </Heading>
          <BodyShort>
            Godkjent av <strong>{manualApproval.approved_by}</strong> den{' '}
            {manualApproval.approved_at
              ? new Date(manualApproval.approved_at).toLocaleDateString('no-NO', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'ukjent dato'}
          </BodyShort>
          {manualApproval.comment_text && (
            <BodyShort style={{ marginTop: '0.5rem', fontStyle: 'italic' }}>"{manualApproval.comment_text}"</BodyShort>
          )}
          {manualApproval.slack_link && (
            <BodyShort size="small" style={{ marginTop: '0.5rem' }}>
              <a href={manualApproval.slack_link} target="_blank" rel="noopener noreferrer">
                Se Slack-dokumentasjon
              </a>
            </BodyShort>
          )}
        </Alert>
      )}
      {/* Comments section */}
      <VStack gap="space-16">
        <Heading size="medium">Kommentarer</Heading>

        {comments.length === 0 ? (
          <BodyShort textColor="subtle" style={{ fontStyle: 'italic' }}>
            Ingen kommentarer ennå.
          </BodyShort>
        ) : (
          <VStack gap="space-12">
            {comments.map((comment) => (
              <Box
                key={comment.id}
                padding="space-16"
                borderRadius="8"
                background="raised"
                borderColor="neutral-subtle"
                borderWidth="1"
              >
                <HStack justify="space-between" align="start">
                  <VStack gap="space-4">
                    <Detail textColor="subtle">
                      {new Date(comment.created_at).toLocaleString('no-NO', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </Detail>
                    <BodyShort>{comment.comment_text}</BodyShort>
                    {comment.slack_link && (
                      <BodyShort size="small">
                        <Link to={comment.slack_link} target="_blank">
                          🔗 Slack-lenke
                        </Link>
                      </BodyShort>
                    )}
                  </VStack>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete_comment" />
                    <input type="hidden" name="comment_id" value={comment.id} />
                    <Button type="submit" size="small" variant="tertiary" icon={<TrashIcon aria-hidden />}>
                      Slett
                    </Button>
                  </Form>
                </HStack>
              </Box>
            ))}
          </VStack>
        )}
      </VStack>
      <Button variant="tertiary" icon={<ChatIcon aria-hidden />} onClick={() => commentDialogRef.current?.showModal()}>
        Legg til kommentar
      </Button>
      <Modal ref={commentDialogRef} header={{ heading: 'Legg til kommentar' }} closeOnBackdropClick>
        <Modal.Body>
          <Form method="post" onSubmit={() => commentDialogRef.current?.close()}>
            <input type="hidden" name="intent" value="add_comment" />
            <VStack gap="space-16">
              <Textarea
                label="Kommentar"
                name="comment_text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                description="F.eks. forklaring av direct push eller andre notater"
              />
              <TextField
                label="Slack-lenke (valgfritt)"
                name="slack_link"
                value={slackLink}
                onChange={(e) => setSlackLink(e.target.value)}
                description="Lenke til Slack-tråd med code review dokumentasjon"
              />
            </VStack>
            <Modal.Footer>
              <Button type="submit">Legg til</Button>
              <Button variant="secondary" type="button" onClick={() => commentDialogRef.current?.close()}>
                Avbryt
              </Button>
            </Modal.Footer>
          </Form>
        </Modal.Body>
      </Modal>
    </VStack>
  )
}
