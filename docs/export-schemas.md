# Export Schemas

Date: 2026-03-05  
Owner: KB Platform  
Schema Version: `2`

This document defines the contract for generated export artifacts in `exports/`.
Machine-readable JSON Schemas are versioned in `contracts/exports/v2/`.

## Machine-readable Schema Files
- `contracts/exports/v2/policies.schema.json`
- `contracts/exports/v2/policies-draft.schema.json`
- `contracts/exports/v2/index.schema.json`
- `contracts/exports/v2/metadata.schema.json`

## Versioning Rules
1. `version` is required in every export payload.
2. Backward-incompatible field changes require a new major schema version.
3. Additive, backward-compatible fields may ship within the same major version.
4. Clients must check `version` before processing payloads.

## Compatibility Window
1. After a major schema change, the previous major remains supported for at least 90 days.
2. During the window, downstream clients must migrate before the removal date documented in the changelog.

## `exports/policies.json`
Purpose: active live policies only.

Top-level shape:
```json
{
  "version": 2,
  "generated_at": "ISO-8601 datetime",
  "source": "live",
  "policies": ["PolicyRecord"]
}
```

`PolicyRecord` fields:
- `policy_id`: string
- `title`: string
- `status`: string
- `type`: string
- `domain`: lowercase kebab-case department id (`[a-z0-9-]+`) declared in `config/departments.json`
- `visibility`: `public | internal`
- `category_path`: string (for example `live/perpetual/content`)
- `effective_from`: `YYYY-MM-DD`
- `effective_to`: `YYYY-MM-DD | null`
- `priority`: number
- `owner_team`: string
- `approvers`: string[]
- `jurisdiction`: string[]
- `applies_to`: string[]
- `tags`: string[]
- `path`: string (repo-relative markdown path)
- `sections`: `PolicySection[]`
- `raw_markdown`: string

`PolicySection` fields:
- `section_id`: string (stable hash from `policy_id + normalized heading`)
- `heading`: string
- `content`: string

## `exports/policies-draft.json`
Purpose: draft/testing policies, not authoritative for customer-facing runtime.

Top-level shape:
```json
{
  "version": 2,
  "generated_at": "ISO-8601 datetime",
  "source": "draft",
  "policies": ["PolicyRecord"]
}
```

Differences from live:
- `visibility` may be `null`.
- `effective_from` may be `null`.
- Records come from `draft/**`.

## `exports/index.json`
Purpose: minimal metadata index for fast policy discovery.

Top-level shape:
```json
{
  "version": 2,
  "generated_at": "ISO-8601 datetime",
  "policies": ["IndexPolicyRecord"]
}
```

`IndexPolicyRecord` fields:
- `policy_id`: string
- `title`: string
- `status`: string
- `type`: string
- `effective_from`: `YYYY-MM-DD | null`
- `effective_to`: `YYYY-MM-DD | null`
- `visibility`: `public | internal | null`
- `section_ids`: string[]
- `tags`: string[]
- `path`: string

## `exports/metadata.json`
Purpose: machine-readable sync/observability metadata for downstream systems.

Top-level shape:
```json
{
  "version": 1,
  "contract": "alice-publisher-v1",
  "export_schema_version": 2,
  "generated_at": "ISO-8601 datetime",
  "artifacts": {
    "policies": "exports/policies.json",
    "policies_draft": "exports/policies-draft.json",
    "index": "exports/index.json"
  },
  "publish": {
    "source_system": "alice | null",
    "actor_id": "string | null",
    "request_id": "string | null",
    "pr_number": "number | null",
    "merge_commit": "git sha | null"
  }
}
```
