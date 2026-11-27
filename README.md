# ManDoc

Staff library for PDF, DOCX, PPTX, and XLSX. A member uploads a file, copies one link, and sees when it is opened. The viewer confirms an email and reads the file in the browser. Links expire and can be revoked.

The shape follows Vision's Worker, D1, and R2 split. This repository is not a copy of that one.

## Run locally

Node 22.

```bash
npm install
npm test
npm run dev
```

`npm run dev` writes `apps/api/.dev.vars` the first time, builds the web app, and starts the Worker at <http://127.0.0.1:8791>.

Sign in as `ada@example.com` for the admin. Any other address becomes a member. The code appears in the code field. It is also at `GET /api/dev/outbox`. That route is absent in production.

```bash
npm run e2e
npm run security:attack
```

## Layout

| Path | Role |
|---|---|
| `apps/api` | Hono Worker. Health at `/api/health` |
| `apps/web` | React library, share form, viewer |
| `packages/core` | Rules and ports |
| `packages/db` | Drizzle schema and D1 repositories |
| `packages/cf` | R2 and Access adapters |
| `e2e` | Playwright |
| `docs/architecture.md` | Boundaries, the Vision map, decisions |
| `docs/spec.md` | Journeys |
| `docs/security/threat-model.md` | What the checks refuse |
| `.specify/memory/constitution.md` | Rules for a change |

## Deploy

Not done from this tree without an account.

1. `npx wrangler d1 create mandoc --jurisdiction eu` and put the id in `apps/api/wrangler.jsonc`.
2. `npx wrangler r2 bucket create mandoc-documents --jurisdiction eu`.
3. Set `APP_ORIGIN`, the Access team domain, and the two Access audience tags. Create two Access applications: one for staff, one for viewer links.
4. `npx wrangler secret put` for `SESSION_PEPPER`, `OTP_PEPPER`, `GRANT_SECRET`, `SHARE_LINK_KEY`, and `BOOTSTRAP_ADMIN_EMAIL`.
5. `npx wrangler d1 migrations apply mandoc --remote`, then `npm run build` and `npx wrangler deploy` from `apps/api`.

Production keeps `MAILER=disabled` and `AUTH_PROVIDER=cloudflare-access`. Viewers sign in through `GET /auth/s/<token>`. An admin sets the document lifetime and the staff domain allowlist on the users page. Until the lifetime is set, live documents are not aged out. Until the allowlist is set, staff sign-in is not limited by domain. The audit page can download the log.

Do not merge to main without the gates in `CONTRIBUTING.md` and Tony WALTEUR's acceptance.
