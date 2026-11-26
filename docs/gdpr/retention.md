# Retention

ManDoc stores staff accounts, viewer email addresses, open events, and document bytes. The region for a real D1 database and R2 bucket is EU. Local `wrangler dev` does not create those remote resources.

## What the job deletes

The cron is `0 3 * * *` UTC. `runRetention` in `apps/api/src/retention-job.ts`:

- One-time codes whose expiry has passed.
- Staff sessions past their absolute end or idle for 8 hours.
- Viewer sessions past their end.
- Grants past their end.
- Outbox rows older than a day.
- Uploads still incomplete after a day, including their bytes.
- Documents a person has already deleted, including their bytes, shares, and events.
- Live documents only when `retention_policies.days` for scope `documents` is a number, and the document is older than that many days.

The seeded policy has `days` null. Null means the owner has not chosen a lifetime. The job must not invent one. Setting the number is an admin action that is not in the UI yet. Tests set it explicitly.

Each run writes one `retention.run` audit row with counts. The row does not include emails or tokens.

## Access requests

Export and erasure of a person are not a self-serve screen in this slice. Deleting a document removes its bytes on the next request and the row on the next retention run. Disabling a user blocks new sessions immediately because every request reads the user row.
