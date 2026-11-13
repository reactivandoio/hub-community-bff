---
symptom: "GraphQL error reaches the frontend with only extensions.code (retryAfter, attemptsLeft, missing, password_pending, count are gone), although the resolver set them"
tags: [graphql, apollo, errors, bff]
evidence: fixed
card: REA-26
agent: claude
date: 2026-11-12
---
## Causa

`createFormatError` (src/utils/error-handling, REA-35) keeps only `message`, `locations`, `path`
and `extensions.code` outside development, to never leak upstream answers a data source attached.
Every other extension was dropped too, including the ones the BFF sets on purpose for the page:
REA-22 `REGISTRATION_INCOMPLETE` (`password_pending`, `missing`), REA-6 `OPAPINGOU_*` (`missing`,
`count`) and REA-26 `LOGIN_CODE_*` (`retryAfter`, `attemptsLeft`). Unit tests of the resolvers
don't see it: they call the resolver directly, never the formatter. With
`EXPOSE_ERROR_DETAILS=true` (development .env) everything passes, so it only shows in production.

## Correção

`PUBLIC_EXTENSIONS` in src/utils/error-handling: an allowlist of the extension names the BFF sets
for the frontend. They pass on business errors only (never on `INTERNAL_SERVER_ERROR`). A new public
extension has to be added there.

## Como conferir

`yarn vitest run src/__tests__/error-responses.test.js` (case "business errors keep the public
extensions"), or, against a running BFF without `EXPOSE_ERROR_DETAILS`, ask for a login code twice
in a row: the second answer has `extensions: { code: 'LOGIN_CODE_COOLDOWN', retryAfter: <n> }`.
