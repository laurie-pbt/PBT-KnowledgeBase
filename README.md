# PBT Policy Knowledge Base

This repository stores policy documents and exports JSON bundles for use by agents and apps.

## Folder structure

```
live/
  perpetual/
    merchandise/
    workshops/
    online-training/
  temporary/
    merchandise/
    workshops/
    online-training/
draft/
  in-progress/
    merchandise/
    workshops/
    online-training/
  experiments/
    merchandise/
    workshops/
    online-training/
templates/
exports/
scripts/
.github/
```

- `live/**`: Approved policies that can ship to agents, organized by department.
- `draft/**`: Work-in-progress policies (never included in the live export), organized by department.
- `templates/`: Canonical policy templates.
- `exports/`: Generated JSON payloads.
- `scripts/`: Build utilities.
- `domain`: Department identifier (`merchandise`, `workshops`, `online-training`) that must match the folder path.

## Draft vs live visibility

- `draft/**`: Work-in-progress policies for internal iteration and testing.
- `live/**`: Final policies used for production exports and date-based activation.
- Live policies must include frontmatter `visibility` with one of: `public`, `internal`.
- Draft policies may include `visibility`; when omitted, `exports/policies-draft.json` records it as `null`.
- Customer chatbot rule: use only policies that are `live` and `visibility: public`.

## Create a policy

1. Copy the relevant template from `templates/`.
2. Fill in the YAML frontmatter fields and sections.
3. Save the file in the appropriate department folder under `draft/in-progress/` (or `draft/experiments/`).
4. Run `npm run build:exports` to validate the policy content.

## Promote draft -> live

Use the manager-only publish CLI so required live metadata is enforced:

```bash
npm run publish:policy -- --manager <draft-path-or-policy_id> [--visibility public|internal] [--effective-from YYYY-MM-DD] [--effective-to YYYY-MM-DD] [--copy]
```

- Input can be a draft markdown path (for example `draft/in-progress/merchandise/REF-NEW_refunds-rewrite.md`) or a `policy_id`.
- The command validates required live frontmatter (`policy_id`, `title`, `priority`, `owner_team`, `approvers`, `jurisdiction`, `applies_to`, `tags`, `effective_from`, `visibility`).
- `effective_to` controls destination: set => `live/temporary/**`, unset => `live/perpetual/**`.
- `policy_id` stays unchanged and must be unique across `live/**`.
- `build:exports` is run automatically; if it fails, the publish operation is rolled back.

Expected git workflow:
1. Create/update policy in `draft/**` on a feature branch.
2. Run `npm run publish:policy -- --manager ...`.
3. Review moved/copied file plus regenerated `exports/*.json`.
4. Run `npm run check:exports` and open a PR for review/approval.

## Temporary policy expiry

Temporary policies must have an `effective_to` date. Once the date passes, the policy is automatically excluded from `exports/policies.json`.

## Build exports locally

```bash
npm install
npm run build:exports
```

This generates:
- `exports/policies.json` (active live policies only; the only export agents read)
- `exports/policies-draft.json` (all draft policies for app testing)
- `exports/index.json` (minimal metadata index, including visibility)

Export schema version is now `v2` (`"version": 2`) because policy `sections` changed from a key/value map to an array of section objects and each section now includes stable `section_id`.

### Exports v1 → v2 migration

- `sections` changed from a heading->content map to an ordered array of section objects.
- `section_id` is stable and should be used for citations.
- `visibility` is enforced; customer retrieval scope is `live` + `visibility: public` only.
- `draft/**` remains non-authoritative and must never be exposed to customers.

## Published Exports

JSON exports are published to GitHub Pages on each push to `main`:

- `https://<owner>.github.io/<repo>/policies.json`
- `https://<owner>.github.io/<repo>/index.json`
- `https://<owner>.github.io/<repo>/policies-draft.json` (only when present)

## KB Service API contract

The KB Service API contract is documented in [`openapi/kb-service.yaml`](openapi/kb-service.yaml); it defines `POST /v1/kb/search`, `GET /v1/kb/policy/{policy_id}`, and `POST /v1/kb/answer` while keeping `live/**`, `draft/**`, and `exports/**` as the canonical data flow.
Policy section citations use stable `section_id` values generated from `policy_id` + normalized heading text so citation anchors remain deterministic across builds.

## Running KB Service locally

Build exports first so the service has runtime data, then run `npm run kb:dev` to start the HTTP API from `apps/kb-service/` (default port `4010`, override with `PORT=<port>`). For quick verification, run `npm run kb:smoke` for endpoint/scope checks and `npm run kb:answer-check` for answer retrieval + citation behavior (including live-first and draft-fallback warnings).
Scope enforcement is server-side and derived from `Authorization` only; request body fields (including `scope`) cannot elevate access.
Set `KB_DEBUG=1` to log internal answer retrieval details, including live/draft fallback decisions and score-threshold reasoning.
Customer chat UI is available at `/customer-chat` and calls `/v1/kb/answer` without an `Authorization` header. Configure the API base via `NEXT_PUBLIC_KB_API_BASE_URL` (defaults to the current origin when unset). Run `npm run kb:customer-chat-smoke` for a basic end-to-end check that answers return and sources are live public only.
- Set `KB_STAFF_TOKEN` to require `Authorization: Bearer <KB_STAFF_TOKEN>` for `GET /staff`.
- If `KB_STAFF_TOKEN` is unset, `GET /staff` remains available for local development.
- `KB_STAFF_TOKEN` only gates the `/staff` page and does not alter answer scope resolution.
- `/v1/kb/answer` without auth remains customer scope (`live` + `visibility: public` only).
Unauthenticated customer requests are rate limited in-memory per IP (default `60` requests per `60` seconds) and return `429` with the standard error payload when exceeded.

## CI validation gate

Run `npm run ci:validate` from the repository root to execute the full PR gate (`build:exports`, `check:exports`, `kb:smoke`, `kb:answer-check`, `kb:scope-check`, `kb:citation-check`, `kb:live-preference-check`, `kb:rate-limit-check`).
