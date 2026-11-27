# Backlog

Do not merge to `main` until the gates in `CONTRIBUTING.md` are green and Tony WALTEUR accepts the change.

Landed:

- Office preview keeps headings and tables for DOCX, slide positions for PPTX, and sheet cells for XLSX. The view is still JSON, not the package.
- A watermark rewrites Office bytes. The view is that layout, taken from the stamped package. A package that cannot be stamped is still refused.
- A watermarked PDF above 32 MiB is stamped with an incremental update.
- An admin can export the audit log, and can set a domain allowlist for staff sign-in. The list stays unset until it is saved.

Still open:

- Quality gates beyond this branch: a second person runs the attack script against a deployed worker, and an independent review signs the threat model.
