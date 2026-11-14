# Scheduled jobs

The scheduled job runner is a separate Bun process and Docker image, released alongside the backend. Every server needs exactly one.

The job list, what each job deletes and how to configure the runner are in the docs:

- [Health checks and the job runner](https://docs.openbeacon.net/docs/self-host/running-your-server/health-checks-and-the-job-runner)
- [Data retention](https://docs.openbeacon.net/docs/privacy-security/data-retention)
- [Scheduled jobs](https://docs.openbeacon.net/docs/contribute/scheduled-jobs), for contributors

This file covers the implementation details behind each job: batch sizes, locking and the measurements behind them.

Run it locally with `bun run dev --filter=@openbeacon/scheduled-jobs`; it reads the root `.env`.

## Adding a job

Register an object in `src/jobs/index.ts` with a unique stable `name`, a positive integer `delay` in milliseconds (at most 2,147,483,647), and an async `run` function. Put job-specific work in `src/jobs`. The shared Prisma, picture storage and map storage clients are available from `src/services.ts`; pass them to jobs explicitly. Create and validate additional clients once at startup and close them after the scheduler stops. Grant only the permissions jobs need in addition to the startup checks.

Jobs start immediately on process startup. After each run completes or fails, the runner waits the configured delay before starting it again. Runs of the same job do not overlap within one process; different jobs can run concurrently. Failures are logged with the job name and the error code (or error name) only, never the error itself, and retried after the same delay. Shutdown stops future runs and waits for active work. Jobs should have bounded execution time so a container can shut down within its configured grace period.

Schedules and run history are not persisted. Restarts run every job again; missed intervals are not backfilled. Make jobs idempotent and safe to retry after interruption. Deployments may briefly overlap old and new containers: before adding a job with side effects, implement and test distributed coordination and durable scheduling appropriate to that job. Do not assume this runner provides exactly-once execution, cross-process locking, or persistent last-run tracking. Add database migrations and integration tests when introducing durable state.

Keep tracking plaintext, encryption keys, credentials, and user data out of logs. Test scheduling and failure behavior as well as the job's business logic. Avoid coupling jobs to the API process: both containers should use shared packages and the same backing services where necessary.

## How each job works

### `account-deletion` (every minute)

Processes at most 100 due accounts and 100 image cleanup records per run, and defers failed records for five minutes so other records can progress.

### `expired-records-cleanup` (every hour)

Deletes verification rows with one `DELETE`; they expire within minutes, so an hourly run only finds an hour's worth. It deletes the other tables (`Session`, `GoogleDeletionChallenge`, `GroupSharedInvite`, `GroupJoinAlert`, `GroupMemberInvite` and `Feedback`) 1,000 rows at a time, at most 10 times per table per run. A table that fails is logged by name, with the database error code when there is one, and the remaining tables are still cleaned.

None of their `expiresAt` columns are indexed. `Session` can be large, but an index was left out on purpose: it would stop session refreshes from being HOT updates and slow them down, and an hourly scan measured about 40 ms on 1 million sessions.

better-auth only deletes an expired session when someone presents it, so without this job abandoned sign-ins would keep their IP address, user agent and device link.

### `pending-device-cleanup` (every hour)

Skips a device that a request has locked at that moment; a later run deletes it. It deletes device links and challenges separately, so a skipped device doesn't hold them up.

### `location-history-cleanup` (every hour)

Deletes `trackingPoint` payloads in `GroupEncryptedPayload` whose server `createdAt` is more than 14 days before the database time, oldest first across all groups, 1,000 per statement, using the `(kind, createdAt)` index. A run only reads rows that are due and costs one index probe when nothing is.

A run stops after 500,000 points. When it stops at that limit it logs `Location history clean-up reached its limit of 500000 points; the rest will be deleted on later runs`, without any IDs; if that shows up every hour, uploads are outpacing the clean-up and points are staying past 14 days. Points that a concurrent delete has locked, such as a member leaving, are skipped (`FOR UPDATE SKIP LOCKED`). A failed statement stops the run and logs one line with the database error code; the next run carries on.

`GroupEncryptedPayload` has `autovacuum_vacuum_scale_factor` set to 0.02 and `autovacuum_vacuum_cost_limit` set to 1000, so dead rows from these deletions are vacuumed sooner and faster. This matters because the clean-up reads the `(kind, createdAt)` index from its oldest end: until a vacuum removes the deleted entries, each batch steps over them.

A benchmark with 1 million groups and 10 million points measured an empty hourly run at about 2 ms, 50,000 due points in under half a second, and a 3.4 million point backlog cleared at 100,000 to 175,000 points a second while the index was clean, slowing to about 15,000 a second when vacuum fell behind. The index made no measurable difference to upload speed.

### `epoch-cleanup` (every day)

Walks the epochs created more than 14 days ago, 5,000 at a time in `(createdAt, id)` order, and deletes the ones in each page that a newer epoch replaced more than 14 days ago and that no stored payload still uses. The latest epoch of a group is never deleted, so new epochs keep their numbering.

An epoch that an upload in progress has locked is skipped (`FOR UPDATE SKIP LOCKED`) and looked at again the next day. An upload that read the epoch just before the job deleted it can fail once with a server error; when the app retries, the server lists those points as `expired` and the app drops them from its queue. A failed page stops that day's run and logs one line with the error code. The benchmark above measured about 7 seconds per million old epochs.

### `pending-upload-cleanup` (every hour)

Handles at most 500 uploads per run, each in its own transaction. It locks the row with `FOR UPDATE SKIP LOCKED`, so an upload being confirmed at that moment is skipped. A confirmation that arrives after the row is deleted fails, and the person picks the image again. If storage refuses the delete, the row is kept and retried next run; each run logs one line with the number of failures and their error codes.

### `image-storage-sweep` (every day)

Lists every object version under `user/` in the S3 bucket and deletes avatar files more than an hour old that no user, group or pending upload points to. Other keys in the bucket, including images under the old `group/<id>/uploads/avatar/` path, are left alone.

It decides whether a file is in use by rebuilding the image URL from `IMAGES_S3_CDN_URL` and `IMAGES_S3_BUCKET_NAME`, so the runner's values must match the backend's exactly. Before listing anything it checks that every stored image starts with `<IMAGES_S3_CDN_URL>/<IMAGES_S3_BUCKET_NAME>/`, and skips the whole sweep if any doesn't.

It checks each listed page of versions against users, groups and pending uploads in one `REPEATABLE READ` snapshot, so an image confirmed during the sweep is never treated as unused. New uploads always use a new random file name. It scans the `User` and `Group` tables once per 1,000 object versions, because `image` isn't indexed; add an index on `image` if it ever shows up as slow. A failure stops that day's sweep and logs one line with the error code; the next day's run starts again from the beginning.

### `upload-growth-report` (every day)

Logs the 10 accounts that stored the most location points in the last 24 hours, with how many groups each is in. It logs nothing when there were no uploads.

## Releases

The runner image is built and released with the backend's and doesn't apply migrations; the backend owns them. Future schema changes must stay compatible while old and new containers overlap. See [Publishing releases](https://docs.openbeacon.net/docs/contribute/publishing-releases).
