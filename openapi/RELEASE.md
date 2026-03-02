# Contract Release Process (Manual, Docs-Only)

The OpenAPI contract files in this repository are contract authority only. Release updates are manual and documentation-driven; no automation is required.

## 1) Choose The Version Bump

Use these rules before editing any contract files.

### Patch (`v1.0.x` -> `v1.0.y`)

Use a patch release when contract behavior does not change.

- Allowed: typo fixes, wording clarifications, docs updates, example improvements that do not change schema intent.
- Not allowed: schema changes that alter what payloads are accepted or rejected.

### Minor (`v1.x.y` -> `v1.z.0` within `/contracts/v1/`)

Use a minor release for backward-compatible v1 contract evolution.

- Allowed: additive changes intended to remain non-breaking for v1 consumers (for example new optional metadata agreed by all consuming teams).
- Must keep major line in `/contracts/v1/`.
- Must document compatibility notes for downstream repos.

### Major (new folder, for example `/contracts/v2/`)

Use a major release for any breaking change.

- Create a new major folder (`/contracts/v2/`).
- Copy forward and update schemas, `index.json`, examples, and docs for the new major.
- Do not introduce breaking changes directly in `/contracts/v1/`.

## 2) Apply Contract Changes

- Update schema files only in the target major folder (`contracts/v1/` or `contracts/v2/`).
- Keep boundary invariants explicit (`no auto-send`, `no silent mutation`, `Massive authoritative inbox state holder`).
- Keep layer scope strict: contracts only, no runtime logic.

## 3) Update Required Metadata Files

For every release, update all of the following:

1. `contracts/v{major}/index.json`
2. `contracts/REGISTRY.md`
3. `contracts/CHANGELOG.md`

### `index.json` update requirements

- Set `version` to the released contract set version.
- Ensure each schema entry has correct `name`, `file`, and `$id`.
- Ensure `$id` major path matches the folder major (`/v1/`, `/v2/`, etc.).

### `REGISTRY.md` update requirements

- Update purpose/producer/consumers/trigger notes for changed contracts.
- Keep boundary notes accurate for every affected contract.
- Add entries for any newly introduced contracts.

### `CHANGELOG.md` update requirements

- Move release notes from `Unreleased` into a dated version section.
- List added/changed/deprecated/removed contracts clearly.
- Include explicit upgrade notes for downstream consumers.

## 4) Add Or Adjust Examples

Examples live at `contracts/v{major}/examples/`.

- For each changed schema, update both `*_valid.json` and `*_invalid.json`.
- Keep examples minimal, realistic, and unambiguous.
- `*_valid.json` must validate against the target schema version.
- `*_invalid.json` must fail for one clear reason only.
- Do not add runtime validators or scripts in this repo.

## 5) Breaking Change Definition (Contracts)

A change is breaking and MUST use a new major folder when any of the following is true:

- A previously valid payload becomes invalid.
- A previously invalid payload becomes valid in a way that changes safety or authority assumptions.
- A required field is added, removed, renamed, or semantically repurposed.
- A field type, format, enum, `const`, or `additionalProperties` rule changes incompatibly.
- Cross-contract identity bindings or correlation requirements change meaning.
- Boundary or audit guarantees change (including human-actor accountability or execution-authority prohibitions).
- Any consumer must change existing integration logic to remain conformant.

## 6) Release Completion Checklist

- Version bump type chosen and justified (patch/minor/major).
- Schemas updated in correct major folder.
- `index.json`, `REGISTRY.md`, and `CHANGELOG.md` updated.
- Examples updated for all affected schemas.
- Breaking-change check completed against rules above.
