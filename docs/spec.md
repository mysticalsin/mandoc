# Spec

ManDoc lets a Mantu staff member keep a document, send one link, and see that it was opened. The viewer confirms an email, and optionally a password, then reads the file in the browser.

## Journeys

### Staff sign-in

The staff member enters an email and a 6-digit code. Locally the code is written to the dev outbox and shown in the code field. In production the local code routes answer 404 and Cloudflare Access issues the code. The first sign-in creates the user. The address in `BOOTSTRAP_ADMIN_EMAIL` is an admin. Every other address is a member. A disabled user cannot start a session.

### Upload

The member chooses a PDF, DOCX, PPTX, or XLSX. The browser sends it in 8 MiB parts, up to 2 GiB. The worker writes the parts through the R2 binding and marks the document ready only after every part is stored. The library lists ready documents the caller may see. An admin sees every ready document. A member sees their own.

### Share

From a document, the member sets recipients, an expiry, an optional password, download on or off, and watermark on or off. Download and watermark start off. The expiry must be at least 5 minutes ahead and at most 366 days ahead. The response is one URL. The database stores the SHA-256 of the token and a sealed copy so the sender can reveal the link again. That reveal is audited.

### Viewer

The link shows the document title when it is live. The viewer enters an email and a code. A wrong code, an unknown link, a revoked link, and an expired link do not explain which failure happened: dead links all say not found, and a bad code always says the code is invalid or expired. If the share has a password, the grant waits until the password checks. The viewer then receives a grant that lasts 5 minutes. Each byte request checks the signature, the grant row, the viewer cookie, and that the share is still live.

### Opens, revoke, expiry

The first successful view writes one open for that viewer session. The sender sees the count. Revoke and expiry make the link and any grant already issued fail the same way an unknown link fails.

### Admin

An admin lists users and can change another user's role or disable them. An admin cannot change their own row, and cannot remove the last active admin. An admin lists every share and can revoke one. An admin reads the audit log.

## File types

| Type | Upload | View | Download |
|---|---|---|---|
| PDF | Yes | PDF.js, first page | Original, or stamped when the watermark is on |
| DOCX, PPTX, XLSX | Yes | Text taken from the Office package | Original only when the watermark is off. Watermark on refuses the download |

Layout-faithful Office rendering is not this slice.

## Out of scope

- A model that summarises or classifies a document.
- Entra ID.
- Email invitations from a custom domain. The mailer stays disabled. The sender copies the link.
- Burning the watermark into the bytes of a view (the view uses an overlay; the PDF download is stamped).
- A document retention period. The job runs. It does not delete live documents until a period is set.
