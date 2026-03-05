# Alice Publisher Workflow Expectations

## Branch Strategy
1. Publisher service must create a non-`main` branch per request or batch.
2. Recommended naming:
   - `publisher/alice/<request-id>`
   - `publisher/alice/batch-<batch-id>`
3. Direct commits to `main` are not allowed.

## PR Conventions
1. PR title must be:
   - `kb(publish): <policy_id or batch-id>`
2. PR body must include:
   - actor id
   - source system (`alice`)
   - policy ids
   - reason / ticket
   - generated export timestamp (UTC)

## Mandatory Checks
Publisher PRs must pass:
1. `build:exports`
2. `check:exports`
3. `check:publish:guard`
4. `check:publish:audit-chain`
5. scope/citation/live-preference checks (via `ci:validate`)
6. GitHub check `Publisher PR Contract` (enforces publisher title/body/branch conventions)

## Manager Confirmation and Validation Gate
1. `npm run publish:policy` requires `--manager`.
2. Publish attempt is rolled back if `build:exports` fails.
3. Duplicate live `policy_id` is rejected.

## Main Protection and No-bypass Policy
1. `main` must stay branch-protected and review-gated in GitHub settings.
2. Export publication on `main` runs `ci:validate` before pages artifacts are prepared.
3. No publisher path may skip PR review or required checks.
