# Contributing

A change that alters who can see a document, how a link dies, or what a download returns needs a test that fails first.

Before you call the work done locally:

```bash
npm run typecheck
npm test
npm run security:attack
npm run e2e
```

CI runs the same checks, plus Semgrep.

Do not merge to `main` on a red check. Do not merge without Tony WALTEUR's acceptance. A green suite is not that acceptance.

Synthetic names only in fixtures. No real customer, candidate, or employee record. No secrets in the diff.

Domain code does not import `cloudflare:workers`. That import stays in `apps/api/src/worker.ts` and `apps/api/src/workflow.ts`.
