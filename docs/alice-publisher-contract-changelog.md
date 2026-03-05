# Alice Publisher Contract Changelog

All notable changes to the Alice publisher integration contract are recorded here.

## Compatibility Policy
- Major schema or contract changes require a documented migration path.
- Previous major versions remain supported for at least 90 days from release date.
- Removal dates and required client actions must be documented in this changelog.

## [1.1.0] - 2026-03-05
Added:
- Machine-readable JSON Schemas under `contracts/exports/v2/` for `policies.json`, `policies-draft.json`, `index.json`, and `metadata.json`.
- Contract drift guard `npm run check:exports:contract` to fail CI on silent export shape changes.
- Publish manager-gate regression check `npm run check:publish:guard`.
- Publisher workflow expectations document (`docs/publisher-workflow.md`).
- Release note template for downstream-impacting contract changes (`docs/templates/alice-contract-release-note-template.md`).
- `Publisher PR Contract` GitHub workflow to enforce publisher PR title/body/branch conventions.

Changed:
- `check:exports` now includes the contract-shape check in addition to visibility checks.
- Main pages publication workflow now runs `ci:validate` before publishing exports.

## [1.0.0] - 2026-03-05
Added:
- Initial Alice publisher integration contract (`docs/alice-publisher-integration-contract.md`).
- Explicit schema documentation for `policies.json`, `policies-draft.json`, and `index.json` (`docs/export-schemas.md`).
- `exports/metadata.json` artifact for publish observability (`request_id`, `pr_number`, `merge_commit`, `generated_at`).
- Live duplicate `policy_id` enforcement during `build:exports`.

Changed:
- Pages export preparation now publishes `metadata.json` with other export artifacts.

## Versioning Notes
- Contract/document versioning and export schema versioning are related but separate.
- Export payload schema currently remains at `version: 2`.
