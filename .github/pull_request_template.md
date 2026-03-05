## Summary

## Publisher Metadata (required for `kb(publish): ...` PRs)

- Actor ID:
- Source system: `alice`
- Policy IDs:
- Reason / ticket:
- Export generated timestamp (UTC):

## Contract Impact

- [ ] No export contract change affecting downstream systems
- [ ] If export contract changed, I updated `docs/alice-publisher-contract-changelog.md`
- [ ] If export contract changed, I used `docs/templates/alice-contract-release-note-template.md`

## Checklist
- [ ] I updated or added policies using the templates in `templates/`
- [ ] Live policy changes are limited to `live/**`
- [ ] Effective dates are valid and reflect intended go-live timing
- [ ] Temporary policy expiries are set and not in the past
- [ ] I ran `npm run build:exports` and validated the outputs
- [ ] I ran `npm run check:exports` and contract checks passed
- [ ] If this is a publisher PR, the title is `kb(publish): <policy_id or batch-id>`
- [ ] No direct push/bypass path to `main` was used
