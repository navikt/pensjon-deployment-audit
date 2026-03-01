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

The verification system checks that all deployments follow the four-eyes principle (at least two people involved in each code change).

**Full documentation**: See [`docs/verification.md`](docs/verification.md) for complete decision logic, statuses, and code references.

### Key Components

- **Pure verification logic**: `app/lib/verification/verify.ts` — stateless `verifyDeployment()` function, testable without DB/network
- **Orchestration**: `app/lib/verification/index.ts` — `runVerification()` (fetch → verify → store)
- **Types & enums**: `app/lib/verification/types.ts` — `VerificationStatus`, `UnverifiedReason`, `ImplicitApprovalMode`
- **Batch verification**: `app/lib/sync/github-verify.server.ts` — `verifyDeploymentsFourEyes()`
- **Periodic sync**: `app/lib/sync/scheduler.server.ts` — `startPeriodicSync()`

### Key Functions in verify.ts

- `verifyDeployment(input)`: Main entry point. Pure function with 8 decision steps (step 0: repo validation).
- `verifyFourEyesFromPrData()`: Checks PR reviews against commits timeline.
- `shouldApproveWithBaseMerge()`: Detects base branch merge patterns.
- `checkImplicitApproval()`: Evaluates implicit approval rules (off/dependabot_only/all).

### Unit Tests

- `app/lib/__tests__/four-eyes-verification.test.ts` — PR review, squash merge, Dependabot scenarios
- `app/lib/__tests__/verify-coverage-gaps.test.ts` — All 7 decision steps in `verifyDeployment`, security gap tests
- `app/lib/__tests__/v1-unverified-reasons.test.ts` — Complex multi-commit scenarios

### Documentation Requirement

When modifying verification logic in `app/lib/verification/verify.ts`, always update [`docs/verification.md`](docs/verification.md) to reflect the changes. This documentation is used by developers, managers, and auditors to understand the verification system.
