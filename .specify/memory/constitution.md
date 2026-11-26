# ManDoc Constitution

## Purpose

ManDoc is the staff library for business documents. A member uploads a file, sends one link, and sees who opened it. A viewer proves an email address and reads the file in the browser. The link expires, and it can be revoked.

The reference is Vision (private video library, tracked screening links), studied read-only. ManDoc is not a fork of that repository.

## Principles

### I. Fit the architecture, or stop

Domain rules live in `packages/core` and import nothing from a platform. Persistence lives in `packages/db`. Cloudflare adapters live in `packages/cf`. HTTP lives in `apps/api`. The staff and viewer UI lives in `apps/web`.

A feature is a module on those boundaries. If it cannot sit there without changing the boundaries first, the change is written down and done before the feature.

### II. One rule, one module

Who may read a document, whether a link is live, whether a download is stamped, and what the retention job deletes each have one owner. A second writer for the same decision is a defect.

### III. Spec before code

A behaviour change starts from this constitution and `docs/spec.md`. The specify CLI is not a dependency.

### IV. Test before done

Auth, shares, grants, and the download gate are pinned by tests. Tests use synthetic fixtures. They do not call production D1, production R2, or a live Access team.

### V. Secrets stay out of git

No secret in source, in `wrangler.jsonc`, in URLs, in logs, or in the UI. A local `.dev.vars` file is generated on the machine and gitignored. Tokens are not query parameters except the share token on the link the sender copies, and the short-lived grant on the view request.

### VI. Explain the number

A count or a time says what it measures. Empty and error are shown as themselves. A missing retention period is not filled in.

### VII. Quiet interface

Copy is the control and the fact. Taglines, badges, and helper paragraphs are cut.

### VIII. No new infrastructure in a slice

This repository runs on Cloudflare Workers, D1, and R2. A design that needs another paid service says so and waits.

### IX. A rule before a model

ManDoc does not call a model. File type, preview text, and access decisions are rules.

### X. Do not invent

A retention period, an allowed email domain, or a permission the owner has not set stays unset. It is not filled in.

## Security non-negotiables

- Staff and viewers authenticate before they see a document. Local development uses one-time codes in an outbox. Production uses Cloudflare Access and refuses the local code endpoints.
- Unknown, revoked, and expired links return the same body.
- Document bytes are never served from a raw storage URL. A view or download requires a short-lived signed grant, re-checked against the share on the server.
- Download stays off unless the share says otherwise. A watermarked PDF, on view and on download, is stamped in the bytes. A watermarked Office file is refused until it can be stamped.
- Roles are enforced on the server. A member does not gain admin by asking for it.
- CSRF, session cookies, and the security headers in `docs/architecture.md` are on for every response.
- Audit rows carry ids and action names. They do not carry secrets, codes, or tokens.
- Personal data at rest is in the EU jurisdiction when D1 and R2 are created. The wrangler config says so. Local simulation has no remote region.
- Fail closed. A missing secret, a bad signature, or an uncertain download does not serve the file.

## Governance

Tony WALTEUR is the authority for a merge to `main` and for a production deploy. A green typecheck, unit run, security attack script, and the share journey are necessary. They are not sufficient. An independent review has to agree, and Tony has to accept the change.

Amendments are a new version in this file, with the date and the reason.

**Version**: 1.0.1 | **Ratified**: 2026-11-26 | **Last Amended**: 2026-11-26

1.0.1: A watermarked PDF is stamped on view as well as download. Production viewers sign in with Cloudflare Access. An admin can set the document lifetime the purge job already reads.
