# Backend

The API server the app talks to. It serves tRPC under `/api/trpc` and better-auth under `/api/auth`.

## Run it locally

From the repository root, with `.env` filled in and PostgreSQL and Redis running (`docker compose up -d db redis`):

```sh
bun run dev --filter=@openbeacon/backend
```

It listens on http://localhost:3000 and reads the root `.env`. See [Run the app and backend](https://docs.openbeacon.net/docs/contribute/run-the-app-and-backend) and [Development setup](https://docs.openbeacon.net/docs/contribute/development-setup) for every value.

For email in development, set `EMAIL_CONSOLE=true` instead of a provider. Each email is printed to the log as one line, such as `[email] to=alice@example.com type=password-reset code=123456`, instead of being sent. It's refused unless `NODE_ENV` is `development` or `test`; `bun run dev` sets `development`.

Turning email off on a server locks accounts with sign-in codes on out of password sign-in until you run `turn-off-sign-in-codes` for each of them. See [Sign-in codes](../../docs/development/sign-in-codes.md).

## Health checks

- `GET /health` returns the status, backend version and server name (`SERVER_NAME`), plus any announcements showing now. It never touches Redis or waits on PostgreSQL, so the app can always read it. Announcements are loaded from PostgreSQL every 30 seconds in the background.
- `GET /ready` returns 200 while Redis answers and 503 while it doesn't. It's for monitoring, not the container health check: the backend reconnects to Redis by itself.

## Announcements

`bun run announce` adds, lists and ends the banners the app shows at the top of its main tabs and sign-in screens, for example before planned downtime. Run it with no arguments for its options. Announcements live in the `Announcement` table and the app filters them by platform and app version itself, so it never sends those to the server for this. See [Announcements](https://docs.openbeacon.net/docs/self-host/running-your-server/announcements).

`bun run seats` shows or sets an account's seat count, found by email: `bun run seats show <email>` or `bun run seats set <email> <seats>`. It prints the seats the account uses, which is every activated device in every group it owns. Self-hosted servers never check seats. To test grace periods before billing exists, `bun run seats end-period <email> [hours-ago]` ends the account's paid period, `bun run seats renew <email>` clears it, and `bun run seats reset-grace <email>` forgets the last grace period. After a paid period ends the account keeps its seats for 7 days, at most once every 6 months, and then has 0 seats, so its newest seats go on hold.

## Startup

The Docker image validates its settings, applies Prisma migrations, then checks PostgreSQL, Redis, picture storage, the map bucket and, if configured, the email provider. If a check or migration fails, the container doesn't start. Rolling back an image doesn't reverse migrations, so migrations must stay compatible with the previous release.

With no map tiles manifest in the bucket yet, the backend starts anyway, the app shows that the map isn't ready, and the backend logs a reminder every 5 minutes until the [map tiles service](../map-tiles/README.md) publishes the first map.

## Google sign-in

Google sign-in isn't released yet. To try it, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and add `<BETTER_AUTH_URL>/api/auth/google-deletion-callback` as an authorised redirect URI on that Google web client. Account deletion uses it to confirm the person is the account owner.

## Running your own server

Everything about running the backend in production is in the docs:

- [Quick start with Docker](https://docs.openbeacon.net/docs/self-host/quick-start-with-docker)
- [Environment variables](https://docs.openbeacon.net/docs/self-host/configuration/environment-variables)
- [Networking and reverse proxies](https://docs.openbeacon.net/docs/self-host/networking-and-reverse-proxies), including `TRUSTED_PROXY_PROVIDER` and serving under a path
- [Email](https://docs.openbeacon.net/docs/self-host/configuration/email)
- [Health checks and the job runner](https://docs.openbeacon.net/docs/self-host/running-your-server/health-checks-and-the-job-runner)
- [Upgrades and migrations](https://docs.openbeacon.net/docs/self-host/running-your-server/upgrades-and-migrations)
- [Announcements](https://docs.openbeacon.net/docs/self-host/running-your-server/announcements)

The app only connects to a self-hosted backend over `https://`, so put it behind a reverse proxy with a TLS certificate. Every server also needs the [scheduled job runner](../scheduled-jobs/README.md).

## Publishing images

The `Release Docker images` workflow builds the backend, runner and map tiles images for `serverVersion`, pushes them to Docker Hub and points `latest-stable` at them. The `Deploy to Coolify` workflow then has Coolify pull and deploy `latest-stable`. See [Publishing releases](https://docs.openbeacon.net/docs/contribute/publishing-releases).
