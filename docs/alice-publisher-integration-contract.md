# Alice Publisher Integration Contract (PBT-KnowledgeBase Side)

Date: 2026-03-05  
Owner: KB Platform  
Contract Version: 1.1.0

## 1. Purpose
Define how Alice submits formal policy changes safely and scalably into this repository.

## 2. Canonical Model
1. `live/**` is formal active policy source.
2. `draft/**` is pre-publication workspace.
3. `exports/*.json` are generated artifacts.
4. `main` remains protected and review-gated.
5. Machine-readable export contract schemas live in `contracts/exports/v2/**`.

## 3. Publish Mechanism
1. Alice never commits directly to `main`.
2. Publisher service performs:
   - branch creation
   - policy file write/move into correct `live/**` path
   - `build:exports`
   - validation checks
   - PR creation
3. Merge to `main` triggers pages export workflow.

## 4. Required Contract Stability
1. Keep export schema versioned.
2. Maintain explicit schema docs for:
   - `exports/policies.json`
   - `exports/index.json`
   - `exports/policies-draft.json`
3. Publish changelog for any contract changes.
4. Provide compatibility window for downstream clients (Alice).

## 5. PR Requirements for Publisher-generated Changes
1. PR title format:
   - `kb(publish): <policy_id or batch-id>`
2. PR body includes:
   - actor id
   - source system (`alice`)
   - policy ids
   - reason / ticket
   - generated export timestamp
3. Required checks:
   - `build:exports`
   - `check:exports`
   - `check:publish:guard`
   - `check:publish:audit-chain`
   - scope/citation/live-preference checks
   - `Publisher PR Contract` workflow check

## 6. Operational Guardrails
1. Reject duplicate `policy_id` in live scope.
2. Enforce required frontmatter for live policies.
3. Block publish when validations fail.
4. Roll back branch changes on export failure.

## 7. Observability
1. Record publish metadata:
   - request id
   - PR number
   - merge commit
   - export generation timestamp
2. Expose latest export metadata in a machine-readable endpoint or file for downstream sync health checks.

## 8. Acceptance Criteria
1. Any formal policy change from Alice arrives only through PR.
2. All merged policy changes regenerate and publish exports.
3. Export contract remains stable and versioned.
4. Downstream clients can detect schema incompatibility before runtime failure.

## Related Documents
- [Export Schemas](./export-schemas.md)
- [Publisher Workflow Expectations](./publisher-workflow.md)
- [Contract Changelog](./alice-publisher-contract-changelog.md)
- [Contract Release Note Template](./templates/alice-contract-release-note-template.md)
- [Repository README](../README.md)
