## Scope

Describe the user-visible and architectural change.

## Trust and measurement

- [ ] Displayed measurements have a real source/formula and documented limitations.
- [ ] No mock, random, fallback, or placeholder value is presented as measured.
- [ ] Privacy/data collection and retention are unchanged, or relevant docs are updated.

## Security

- [ ] No secrets, `.env` files, generated artifacts, dumps, or sensitive logs are included.
- [ ] New inputs/actions have validation, authorization/abuse controls, safe errors, and tests.
- [ ] Threat model and runbooks are updated for material trust-boundary changes.

## Validation

- [ ] `npm ci`
- [ ] `npm audit --omit=dev`
- [ ] `npm run check`
- [ ] Relevant browser/accessibility checks
- [ ] Staging and rollback evidence for infrastructure or database changes
