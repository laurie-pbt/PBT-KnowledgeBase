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

## Create a policy

1. Copy the relevant template from `templates/`.
2. Fill in the YAML frontmatter fields and sections.
3. Save the file in the appropriate department folder under `draft/in-progress/` (or `draft/experiments/`).
4. Run `npm run build:exports` to validate the policy content.

## Promote draft -> live

1. Move the markdown file from `draft/**` to the matching department folder under `live/perpetual/` or `live/temporary/`.
2. Update `status` to `active`, confirm `domain` matches the folder, and confirm `effective_from`/`effective_to` dates.
3. Re-run `npm run build:exports` and review `exports/` outputs.

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
- `exports/index.json` (minimal metadata index)
