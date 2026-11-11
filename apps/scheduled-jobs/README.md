# Scheduled jobs

The scheduled job runner is a separate Bun process and Docker image released alongside the backend. It runs three jobs:

- `account-deletion` runs once per minute. It deletes accounts at the end of their grace period and retries image cleanup.
- `verification-cleanup` runs once per hour. It deletes `Verification` rows whose `expiresAt` is before the database time. These hold email codes, the tokens issued for a correct code and better-auth's own verification records, together with the email address or user ID they are for. Unexpired rows are kept. It runs whether or not email is configured.
- `pending-device-cleanup` runs once per hour. It deletes Pending devices (signed in but never set up) created more than 7 days before the database time, and signs out their sessions. Active and removed devices are kept. It also deletes device links (QR codes) whose code expired more than a day ago. It also deletes expired device challenges, the one-time values a phone answers to prove it holds a key.

Run it locally with `bun run dev --filter=@openbeacon/scheduled-jobs`; it reads the root `.env`.

The runner requires `DATABASE_URL`, `S3_ACCESS_KEY_ID`, `S3_ACCESS_KEY`, `S3_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PM_TILES_KEY`. `S3_ENDPOINT` and `S3_REGION` are optional and use the same defaults as the backend. When the backend has email configured, give the runner the same email settings (`RESEND_API_KEY` or the `SMTP_*` settings, `EMAIL_FROM` and `SERVER_NAME`) and `REDIS_URL`, so it can email owners when their account is deleted at the end of the grace period. Without them it deletes accounts as normal but sends no email. See the root `.env.example`. Configure these values separately for the runner in Coolify; the backend and runner must use the same database, S3 bucket, and `S3_CDN_URL`, as well as the same R2 bucket. Do not put credentials in Git.

On startup the runner checks PostgreSQL with `SELECT 1`, lists S3 object versions, checks that the R2 PMTiles object exists and, when email is configured, checks the email settings without sending anything. Its credentials also need permission to delete image objects, versions and delete markers. It exits if configuration or connectivity checks fail. Clients are closed on shutdown. The Docker image generates the Prisma client but does not apply migrations.

Once the checks pass, the runner serves `GET /health` on `127.0.0.1:3000`, inside the container only. It returns the same status, backend version and server name (`SERVER_NAME`) as the backend's health check. The image's Docker `HEALTHCHECK` calls it with Bun, so Coolify can tell when the runner is up. Leave the port unpublished.

## Adding a job

Register an object in `src/index.ts` with a unique stable `name`, a positive integer `delay` in milliseconds (at most 2,147,483,647), and an async `run` function. Put job-specific work in `src/jobs`. The shared Prisma, S3, and R2 clients are available from `src/services.ts`; pass them to jobs explicitly. Create and validate additional clients once at startup and close them after the scheduler stops. Grant only the permissions jobs need in addition to the startup checks.

Jobs start immediately on process startup. After each run completes or fails, the runner waits the configured delay before starting it again. Runs of the same job do not overlap within one process; different jobs can run concurrently. Failures are logged and retried after the same delay. Shutdown stops future runs and waits for active work. Jobs should have bounded execution time so a container can shut down within its configured grace period. Account deletion processes at most 100 due accounts and 100 image cleanup records per run, and defers failed records for five minutes so other records can progress. Verification cleanup deletes expired rows with one `DELETE`. Rows expire within minutes, so an hourly run only finds an hour's worth; `expiresAt` is not indexed, which is fine for a table this small.

Schedules and run history are not persisted. Restarts run every job again; missed intervals are not backfilled. Run exactly one runner per backend installation, and make jobs idempotent and safe to retry after interruption. Deployments may briefly overlap old and new containers: before adding a job with side effects, implement and test distributed coordination and durable scheduling appropriate to that job. Do not assume this runner provides exactly-once execution, cross-process locking, or persistent last-run tracking. Add database migrations and integration tests when introducing durable state. The x-bot runner persists last-run times, but also records failed runs as completed; do not copy that failure behavior.

Keep tracking plaintext, encryption keys, credentials, and user data out of logs. Test scheduling and failure behavior as well as the job's business logic. Avoid coupling jobs to the API process: both containers should use shared packages and the same backing services where necessary.

## Deployment

The backend release workflow builds both images from the same commit and deploys the backend first and then the `OpenBeacon Scheduled Jobs` Coolify application. Apply the corresponding Coolify infrastructure configuration before using the updated workflow. A backend deployment failure prevents the runner deployment; a runner deployment failure leaves the backend deployed and requires operator intervention. Check both applications after a release and roll back both to the same version tag when needed. Future schema changes must remain compatible across the rollout. The runner image does not apply migrations; the backend owns them.
