# Export Contract Schemas (Machine-readable)

These JSON Schema files are the canonical machine-readable contract for export artifacts.

- `policies.schema.json` for `exports/policies.json`
- `policies-draft.schema.json` for `exports/policies-draft.json`
- `index.schema.json` for `exports/index.json`
- `metadata.schema.json` for `exports/metadata.json`

Versioning:
- Export payload major: `2` (via each schema `properties.version.const`).
- Metadata payload major: `1`.
- Contract family id: `alice-publisher-v1`.

CI enforcement:
- `npm run check:exports:contract` validates generated exports against contract expectations and schema version constants.
