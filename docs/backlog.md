# Backlog

Do not merge to `main` until the gates in `CONTRIBUTING.md` are green and Tony WALTEUR accepts the change.

Landed on this branch:

- A watermark rewrites Office bytes. View stays a text preview of the stamped package. A package that cannot be stamped is still refused.
- A watermarked PDF above 32 MiB is stamped with an incremental update.
- An admin can export the audit log, and can set a domain allowlist for staff sign-in. The list stays unset until it is saved.

Still open:

- Office preview that keeps layout for PPTX, DOCX, and XLSX. The in-browser path shows extracted text. It does not keep layout.
- Quality gates beyond this branch: a second person runs the attack script against a deployed worker, and an independent review signs the threat model.
