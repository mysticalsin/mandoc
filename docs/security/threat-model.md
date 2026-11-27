# Threat model

ManDoc holds staff documents and the email addresses of people who open them. The attacker we design for can send requests, can hold a leaked link, and can modify their own browser. They cannot read Worker secrets or the D1 file.

## Assets

- Document bytes in R2.
- Share tokens and grant signing keys.
- Staff and viewer session cookies.
- The audit log and the list of who opened a link.

## What we refuse

| Threat | Response |
|---|---|
| Guess or replay a dead link | Unknown, revoked, and expired links return the same 404 body |
| Read R2 directly | No storage URL is ever returned. The key is `documents/<id>/versions/<id>` |
| Use a grant after revoke or expiry | Every byte request re-reads the share and the grant row |
| Forge a grant | HMAC-SHA256. A bad signature is `invalid_grant` and serves nothing |
| Download when the sender said no | Server returns 403. The UI hiding the button is not the control. An Office view is a text preview, not the file |
| Skip a watermark on a PDF view or download | The server stamps the email into the PDF. A range is taken from the stamped bytes. If stamping throws, the original is not sent |
| Skip a watermark on an Office file | 403 `unstampable` on view and on download. The body is not the package |
| Change a role from a member session | `/api/admin/*` checks the user row on that request |
| Read another member's document | 404, same as missing |
| CSRF from another site | `X-Mandoc-Request` and a matching `Origin`, plus `SameSite=Lax` |
| Steal a session from script | `HttpOnly`, `Secure`, `Path=/`, `__Host-` prefix |
| Put a secret in the audit log | Metadata keys that look like tokens, passwords, or codes are dropped |
| Run local OTP in production | `parseConfig` throws |

## Honest limits

- The on-screen watermark is also CSS. The bytes of a watermarked PDF already contain the email, including on the view route. Someone can still photograph the screen.
- A screenshot or a camera is not stopped.
- Office preview is text extraction rendered in the browser. It is not a layout-faithful render, and it is not a statement that the file is safe to open in another program.
- Rate limits are best-effort counters in D1, not a global lock.
- Access JWT verification is implemented and tested with a local key. This environment has not called a live Access team.

## Checks

`npm test` covers the rules in `packages/core` and the HTTP journeys in `apps/api`. `npm run security:attack` prints a pass/fail list. `npm run security:static` rejects raw storage hostnames, private keys, and `eval`. Semgrep runs the same class of rule in CI.
