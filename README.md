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

## Published Exports

JSON exports are published to GitHub Pages on each push to `main`:

- `https://<owner>.github.io/<repo>/policies.json`
- `https://<owner>.github.io/<repo>/index.json`
- `https://<owner>.github.io/<repo>/policies-draft.json` (only when present)
