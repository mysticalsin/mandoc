# Security

Report a vulnerability to Tony WALTEUR. Do not open a public issue with the details.

ManDoc is not claimed to be enterprise-ready by this repository. The controls below are what the code enforces. An independent review still has to look at them.

## Controls

- Cloudflare Access for production sign-in. Local one-time codes exist only when `ENVIRONMENT` is `development` or `e2e`, and production refuses that mode.
- Share lookup is a SHA-256. The raw token is sealed for the sender and is not a column used for lookup.
- Grants are HMAC-SHA256, five minutes, checked again on the server for every read.
- Download and watermark follow the share row. A watermarked view is not the original file.
- Sessions are HttpOnly Secure cookies. Admin routes read the role from D1.
- Headers: CSP without script eval, frame denial, nosniff, no-referrer, COOP, HSTS on https.
- CSRF on unsafe API methods.
- Audit log without secrets.
- Secrets are Worker secrets or a gitignored `.dev.vars`.

## What to run

```bash
npm test
npm run security:attack
npm run security:static
npm run e2e
```

`docs/security/threat-model.md` is the model. `docs/architecture.md` is the map.
