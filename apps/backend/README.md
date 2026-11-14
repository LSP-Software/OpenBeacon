# Backend

The API server the app talks to. It serves tRPC under `/api/trpc` and better-auth under `/api/auth`.

## Run it locally

From the repository root, with `.env` filled in and PostgreSQL and Redis running (`docker compose up -d db redis`):

```sh
bun run dev --filter=@openbeacon/backend
```

It listens on http://localhost:3000 and reads the root `.env`. See [Run the app and backend](https://docs.openbeacon.net/docs/contribute/run-the-app-and-backend) and [Development setup](https://docs.openbeacon.net/docs/contribute/development-setup) for every value.

For email in development, set `EMAIL_CONSOLE=true` instead of a provider. Each email is printed to the log as one line, such as `[email] to=alice@example.com type=password-reset code=123456`, instead of being sent. It's refused unless `NODE_ENV` is `development` or `test`; `bun run dev` sets `development`.

## Health checks

- `GET /health` returns the status, backend version and server name (`SERVER_NAME`). It never touches Redis, so the app can always read it.
- `GET /ready` returns 200 while Redis answers and 503 while it doesn't. It's for monitoring, not the container health check: the backend reconnects to Redis by itself.

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

The app only connects to a self-hosted backend over `https://`, so put it behind a reverse proxy with a TLS certificate. Every server also needs the [scheduled job runner](../scheduled-jobs/README.md).

## Publishing images

The `Release Docker images` workflow builds the backend, runner and map tiles images for `serverVersion`, pushes them to Docker Hub and points `latest-stable` at them. The `Deploy to Coolify` workflow then has Coolify pull and deploy `latest-stable`. See [Publishing releases](https://docs.openbeacon.net/docs/contribute/publishing-releases).
