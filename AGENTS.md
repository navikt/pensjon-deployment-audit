# Agent Instructions

## Before Committing

Run all checks before committing changes:

```bash
npm run lint && npm run check && npm test && npm run build && npm run build-storybook
```

This runs:

1. **Lint** (`biome check .`) — code formatting and linting
2. **Check** (`npm run lint && npm run typecheck`) — lint + TypeScript type checking
3. **Test** (`vitest run`) — unit and integration tests
4. **Build** (`react-router build`) — production build
5. **Build Storybook** (`storybook build`) — Storybook build

All must pass before committing.

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope?): subject
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

## Server/Client Boundary

This is a React Router app with server/client code splitting. Files ending in `.server.ts` are server-only and **cannot** be imported in client-side code (component default exports, hooks, etc.). Shared constants must live in non-server files (e.g., `app/db/sync-job-types.ts`).

## Four-Eyes Verification Architecture

There are **two independent verification code paths** (V1 and V2). Both must be kept in sync when fixing bugs or adding features.

### V1 — `verifyDeploymentFourEyes` (sync.server.ts)

- **Location**: `app/lib/sync.server.ts`
- **Called by**:
  - "Verifiser" button on deployment detail page (`deployments.$id.tsx`, line ~725)
  - Batch sync when `VERIFICATION_V2` env var is not `'true'` (line ~512)
- **Key functions**:
  - `verifyDeploymentFourEyes()` (~line 555): Main entry point. Fetches GitHub data directly and runs verification inline.
  - `verifyFourEyesFromPrData()` (~line 54): Local helper that checks PR reviews/approvals. **This is a separate copy from V2's function with the same name.**
- **Data shape**: Uses snake_case (`submitted_at`, `merged_by`, `merge_commit_sha`). Commits are `{ sha, date, author, message }`. Reviews are `{ user, state, submitted_at }`.
- **Commit matching**: Builds `deployedPrCommitShas` set from PR commits AND checks `merge_commit_sha` for squash merges (~line 760).

### V2 — `verifyDeployment` (verification/verify.ts)

- **Location**: `app/lib/verification/verify.ts` (pure stateless logic), `app/lib/verification/index.ts` (orchestration with DB)
- **Called by**:
  - `reverifyDeployment()` in `verification/index.ts` — used by re-verification flows
  - `runDebugVerification()` in `verification/index.ts` — used by debug verification page
  - Verification-diff page (`team.$team.env.$env.app.$app.admin.verification-diff.tsx`)
  - Batch sync when `VERIFICATION_V2=true` — via `verifyDeploymentFourEyesV2()` wrapper in sync.server.ts (~line 1070)
- **Key functions**:
  - `verifyDeployment(input)` in `verify.ts`: Pure function, takes `VerificationInput`, returns `VerificationResult`. Testable without DB/network.
  - `verifyFourEyesFromPrData()` in `verify.ts` (~line 291): Shared helper. **Different implementation from V1's copy.**
  - `runVerification()` in `index.ts`: Orchestrates fetching data and calling `verifyDeployment()`.
- **Data shape**: Uses camelCase (`submittedAt`, `mergedBy`, `mergeCommitSha`). Has typed interfaces (`VerificationInput`, `PrDataForVerification`).
- **Unit tests**: `app/lib/__tests__/four-eyes-verification.test.ts` — tests V2 functions only.

### Feature Flag

`VERIFICATION_V2` environment variable (checked at `sync.server.ts` line ~21):
- `'true'`: Batch sync uses `verifyDeploymentFourEyesV2` (V2 path)
- Any other value / unset: Batch sync uses `verifyDeploymentFourEyes` (V1 path)

**Note**: The "Verifiser" button on the deployment detail page **always uses V1** regardless of the feature flag. This is a known inconsistency.

### ⚠️ Important: Keep Both Paths in Sync

When fixing verification bugs, **always apply fixes to both V1 and V2**:
1. V1: `sync.server.ts` — `verifyFourEyesFromPrData()` and `verifyDeploymentFourEyes()`
2. V2: `verification/verify.ts` — `verifyFourEyesFromPrData()` and `verifyDeployment()`

The long-term plan is to migrate fully to V2 and remove V1, but until then both must be maintained.
