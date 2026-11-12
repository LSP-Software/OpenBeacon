# OpenBeacon

OpenBeacon is an open-source, privacy-focused family location app. Self-hosting is supported allowing running the backend on your own hardware; the architecture assumes sensitive data is encrypted so the people running servers are not in a position to read your family’s locations or activity. Profile and group images are not end-to-end encrypted.

This repo is a Bun monorepo: a React Native (Expo) app under `apps/mobile`, an API server under `apps/backend`, and shared packages (`api`, `database`, `encryption`, `schemas`, and others) at the root.

## Requirements

- [Bun](https://bun.sh) (see `packageManager` in the root `package.json` for the version this repo expects)
- **Java 17** — needed for Android builds
- **Android SDK** — needed for the offline tracking queue tests in `bun run ci`; they're skipped with a warning without it (set `ANDROID_HOME` if it isn't in `~/Android/Sdk`)
- **PostgreSQL** and **Redis** — the backend expects them; URLs are set in `.env`

## Development Enviroment Setup

Copy the example env and fill in values for your machine:

```sh
cp .env.example .env
```

Install dependencies:

```sh
bun install
```

Apply database migrations (from the repo root):

```sh
cd ./packages/database
bun run db:migrate
```

## Run the integration tests

`bun run ci` skips the integration tests. They need PostgreSQL and Redis running at the URLs in `.env.ci`; `docker compose up -d db redis` starts both. The tests use a separate `openbeacon_test` database so they never touch your development data. The first command below creates it and applies the migrations:

```sh
bun run test:integration:migrate
bun run test:integration
```

Both commands take their settings from `.env.ci`, and its values win over variables exported in your shell. Pass `--env-file=<path>` to use another env file.

`bun run test:integration` runs every `*.integration.test.ts` under `apps/` and `packages/` with `OPENBEACON_INTEGRATION=1`. Pass directories to run only their tests, such as `bun run test:integration packages/cache`. Other `bun test` flags are passed through and must use the `--flag=value` form.

Every test cache uses a random Redis key prefix, so several runs can share one Redis.

## Run the backend

```sh
bun run dev --filter=@openbeacon/backend
```

The API listens on the port in `OPENBEACON_API_PORT` (default `3000`).

Email is optional. To send password resets, verification codes and security alerts, configure Resend or SMTP as described in [the backend guide](apps/backend/README.md#email).

## Environment variables

The backend and the scheduled job runner both read the root `.env` in development. In production each container gets its own environment, so set the variables listed for it on that container. The mobile app reads `apps/mobile/.env` at build time.

Containers:

- **Backend**: the API server, built from the root `Dockerfile`.
- **Runner**: the scheduled job runner, built from `apps/scheduled-jobs/Dockerfile`.
- **Mobile**: the Expo app; these values are embedded in the app bundle when it is built.

The `db` (PostgreSQL) and `redis` (Dragonfly) services in `docker-compose.yml` are for local development. Their settings are fixed in the compose file and match the defaults in `.env.example`.

Leave an optional variable out rather than setting it to an empty value. Some, such as `OPENBEACON_API_PORT` and `S3_ENDPOINT`, fail validation when empty instead of using their default, and the backend won't start.

### Core

| Variable                       | Containers      | Required                                    | Default                           | Example                                                        | What it does                                                                                                                                                                                                                                                   |
| ------------------------------ | --------------- | ------------------------------------------- | --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Backend, Runner | Yes                                         | None                              | `postgresql://openbeacon:openbeacon@localhost:5432/openbeacon` | PostgreSQL connection string. Must use `postgres://` or `postgresql://`. The backend applies migrations to this database on startup, so its user needs permission to change the schema.                                                                        |
| `REDIS_URL`                    | Backend, Runner | Backend: yes. Runner: only when email is on | None                              | `redis://localhost:6379`                                       | Redis-compatible cache used for rate limits and signed map URLs. Must use `redis://` or `rediss://`. The runner uses it to apply the per-account email limit.                                                                                                  |
| `REDIS_HASH_SECRET`            | Backend         | Yes                                         | None                              | Output of `openssl rand -base64 32`                            | Key for hashing IP addresses and email addresses before they are used in Redis rate-limit keys, so Redis never holds them. At least 32 characters. Every backend instance that shares one Redis must use the same value. Changing it resets those rate limits. |
| `BETTER_AUTH_SECRET`           | Backend         | Yes                                         | None                              | Output of `openssl rand -base64 32`                            | Secret that signs sessions and tokens. At least 32 characters. Changing it signs everyone out.                                                                                                                                                                 |
| `BETTER_AUTH_URL`              | Backend         | Yes                                         | None                              | `https://api.example.com`                                      | Public URL of the backend, used for auth callbacks. Must be `http` or `https`.                                                                                                                                                                                 |
| `SERVER_NAME`                  | Backend, Runner | No                                          | `OpenBeacon`                      | `Smith Family`                                                 | Server name shown by `GET /health`, in the app, and in the footer of emails.                                                                                                                                                                                   |
| `SELF_HOSTED`                  | Backend         | No                                          | `true`                            | `true`                                                         | When `true` the backend refuses app feedback. Only the hosted API sets `false`; set it locally to test feedback.                                                                                                                                               |
| `DISCORD_FEEDBACK_WEBHOOK_URL` | Backend         | No                                          | None                              | `https://discord.com/api/webhooks/…`                           | Hosted API only. HTTPS Discord webhook that is told when new feedback arrives. The alert carries the feedback ID and whether a contact email was given, never the message or email. Self-hosted backends refuse feedback, so leave it unset.                   |
| `NODE_ENV`                     | Backend, Runner | No                                          | `production` in the Docker images | `production`                                                   | Runtime mode. The backend's and runner's `bun run dev` scripts set `development`. `EMAIL_CONSOLE` only works in `development` or `test`.                                                                                                                       |

### Network

| Variable                   | Containers | Required                             | Default   | Example                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ---------- | ------------------------------------ | --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENBEACON_API_PORT`      | Backend    | No                                   | `3000`    | `3000`                           | Port the API listens on. The Docker image exposes `3000`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `OPENBEACON_API_HOSTNAME`  | Backend    | No                                   | `0.0.0.0` | `127.0.0.1`                      | IPv4 address the API binds to.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `TRUSTED_PROXY_PROVIDER`   | Backend    | No                                   | `none`    | `trusted-proxy`                  | Where the backend reads the client IP from. `none` uses the connecting address. `trusted-proxy` uses the last `X-Forwarded-For` entry, for a single reverse proxy such as nginx, Caddy or Traefik. `cloudflare` trusts `CF-Connecting-IP`; only use it when the origin is reachable solely through Cloudflare. `cloudflare-authenticated` also requires a shared secret header on every request. See [the backend guide](apps/backend/README.md#production-deployment). |
| `CLOUDFLARE_ORIGIN_SECRET` | Backend    | Only with `cloudflare-authenticated` | None      | Output of `openssl rand -hex 32` | Secret Cloudflare must send in the `X-OpenBeacon-Origin-Secret` header. At least 32 characters.                                                                                                                                                                                                                                                                                                                                                                         |

### Google sign-in

| Variable               | Containers | Required                | Default | Example                                     | What it does                                                                                                                                                                                            |
| ---------------------- | ---------- | ----------------------- | ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Backend    | No                      | None    | `1234567890-abc.apps.googleusercontent.com` | Google web OAuth client ID. Set it with `GOOGLE_CLIENT_SECRET` to turn on Google sign-in. Register `<BETTER_AUTH_URL>/api/auth/google-deletion-callback` as a redirect URI for account deletion checks. |
| `GOOGLE_CLIENT_SECRET` | Backend    | With `GOOGLE_CLIENT_ID` | None    | `GOCSPX-...`                                | Secret for the Google web OAuth client.                                                                                                                                                                 |

### Email

Email is optional. Configure Resend or SMTP, not both, or leave both unset to turn email off. Give the runner the same email settings as the backend so it can send the account deleted email. See [the backend guide](apps/backend/README.md#email) for what is sent.

| Variable              | Containers      | Required             | Default                                        | Example               | What it does                                                                                                                                                                                                                |
| --------------------- | --------------- | -------------------- | ---------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`      | Backend, Runner | No                   | None                                           | `re_123...`           | Sends email through Resend. A sending-only key works.                                                                                                                                                                       |
| `SMTP_HOST`           | Backend, Runner | No                   | None                                           | `smtp.example.com`    | Sends email through this SMTP server. Every other `SMTP_*` setting needs it.                                                                                                                                                |
| `SMTP_PORT`           | Backend, Runner | No                   | `465` when `SMTP_SECURE=true`, otherwise `587` | `587`                 | SMTP port. Setting `465` also turns on implicit TLS unless `SMTP_SECURE` is set.                                                                                                                                            |
| `SMTP_SECURE`         | Backend, Runner | No                   | `true` on port 465, otherwise `false`          | `true`                | Connect with implicit TLS.                                                                                                                                                                                                  |
| `SMTP_REQUIRE_TLS`    | Backend, Runner | No                   | `true`                                         | `false`               | Refuse to log in or send unless STARTTLS succeeds. Set `false` only for a local plaintext relay.                                                                                                                            |
| `SMTP_USER`           | Backend, Runner | With `SMTP_PASSWORD` | None                                           | `noreply@example.com` | SMTP username.                                                                                                                                                                                                              |
| `SMTP_PASSWORD`       | Backend, Runner | With `SMTP_USER`     | None                                           | `app-password`        | SMTP password.                                                                                                                                                                                                              |
| `EMAIL_FROM`          | Backend, Runner | With Resend or SMTP  | None                                           | `noreply@example.com` | Sender address. Emails come from `OpenBeacon <EMAIL_FROM>`.                                                                                                                                                                 |
| `EMAIL_CONSOLE`       | Backend, Runner | No                   | `false`                                        | `true`                | Development only: prints a one-line summary of each email (recipient, type and any code) to the log instead of sending it. Refused unless `NODE_ENV` is `development` or `test`, and can't be combined with Resend or SMTP. |
| `EMAIL_CODE_IP_LIMIT` | Backend         | No                   | `false`                                        | `true`                | Also limits each IP address to 20 code requests an hour. Off by default because it can block users who share an IP, such as phones behind carrier NAT.                                                                      |

### Image storage (S3)

Profile and group images are stored in an S3-compatible bucket. The backend and runner must use the same bucket and `S3_CDN_URL`.

| Variable              | Containers      | Required | Default                                  | Example                                     | What it does                                                                                                                     |
| --------------------- | --------------- | -------- | ---------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`         | Backend, Runner | No       | `https://s3.us-east-005.backblazeb2.com` | `https://s3.eu-central-003.backblazeb2.com` | S3 API endpoint.                                                                                                                 |
| `S3_REGION`           | Backend, Runner | No       | `us-east-005`                            | `eu-central-003`                            | S3 region.                                                                                                                       |
| `S3_ACCESS_KEY_ID`    | Backend, Runner | Yes      | None                                     | `0051a2b3c4d5e6f0000000001`                 | S3 access key ID. At least 20 characters. The runner's key also needs permission to delete objects, versions and delete markers. |
| `S3_ACCESS_KEY`       | Backend, Runner | Yes      | None                                     | `K005abcdefghijklmnopqrstuvwxyz`            | S3 secret key. At least 20 characters.                                                                                           |
| `S3_BUCKET_NAME`      | Backend, Runner | Yes      | None                                     | `openbeacon-images`                         | Bucket that holds uploaded images.                                                                                               |
| `S3_CDN_URL`          | Backend, Runner | No       | `https://cdn.openbeacon.net/file`        | `https://cdn.example.com/file`              | Public base URL for image links. A trailing slash is removed.                                                                    |
| `MAX_IMAGE_FILE_SIZE` | Backend         | No       | `5242880` (5 MB)                         | `10485760`                                  | Largest image upload in bytes.                                                                                                   |

### Map tiles (R2)

The map is served from a PMTiles file in a Cloudflare R2 bucket. The backend hands the app short-lived signed URLs to it. The bucket holds two maps, slot A and slot B, and the map tiles service refreshes them in turn; see `apps/map-tiles/README.md`.

| Variable                         | Containers                 | Required | Default                           | Example                            | What it does                                                                           |
| -------------------------------- | -------------------------- | -------- | --------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID`                  | Backend, Runner, Map tiles | Yes      | None                              | `0123456789abcdef0123456789abcdef` | Cloudflare account ID that owns the bucket.                                            |
| `R2_ACCESS_KEY_ID`               | Backend, Runner, Map tiles | Yes      | None                              | `abcdef0123456789abcdef0123456789` | R2 access key ID.                                                                      |
| `R2_SECRET_ACCESS_KEY`           | Backend, Runner, Map tiles | Yes      | None                              | `0123456789abcdef...`              | R2 secret key.                                                                         |
| `R2_BUCKET`                      | Backend, Runner, Map tiles | Yes      | None                              | `openbeacon-maps`                  | Bucket that holds the PMTiles file.                                                    |
| `MAP_TILES_UPDATE_INTERVAL_DAYS` | Map tiles                  | No       | `30`                              | `30`                               | Days between map refreshes. Must be more than 8, the time a replaced map stays in use. |
| `MAP_TILES_PORT`                 | Map tiles                  | No       | `8080`                            | `8080`                             | Port the map tiles service listens on, inside its container only.                      |
| `MAP_TILES_MAX_MBPS`             | Map tiles                  | No       | None                              | `100`                              | Upload and download cap in megabits per second.                                        |
| `MAP_TILES_STATE_DIR`            | Map tiles                  | No       | `.map-tiles` (`/state` in Docker) | `/state`                           | Resumable upload state. Keep it on a volume.                                           |

### Mobile app

Set these in `apps/mobile/.env`.

| Variable                            | Containers | Required                  | Default                                         | Example                                     | What it does                                                                                                               |
| ----------------------------------- | ---------- | ------------------------- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_DEV_API_URL`           | Mobile     | No                        | The server chosen in the app, or the hosted API | `http://192.168.0.10:3000`                  | Points a development build at your backend. Use your machine's LAN IP, or `http://10.0.2.2:3000` from an Android emulator. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`  | Mobile     | For Google sign-in        | None                                            | `1234567890-abc.apps.googleusercontent.com` | Google web client ID, the same one as the backend's `GOOGLE_CLIENT_ID`.                                                    |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`  | Mobile     | For Google sign-in on iOS | None                                            | `1234567890-ios.apps.googleusercontent.com` | Google iOS client ID.                                                                                                      |
| `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` | Mobile     | For Google sign-in on iOS | None                                            | `com.googleusercontent.apps.1234567890-ios` | The iOS client ID reversed, used as the app's URL scheme.                                                                  |

### Development only

| Variable                 | Used by      | Required | Default | Example                                                               | What it does                                                         |
| ------------------------ | ------------ | -------- | ------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `SHADOW_DATABASE_URL`    | `db:migrate` | No       | None    | `postgresql://openbeacon:openbeacon@localhost:5432/openbeacon_shadow` | Shadow database Prisma uses when creating migrations.                |
| `OPENBEACON_INTEGRATION` | Tests        | No       | Unset   | `1`                                                                   | Set to `1` to run integration tests. They need PostgreSQL and Redis. |

## Scheduled job runner

The scheduled job runner is a separate Bun process in `apps/scheduled-jobs`, shipped as its own Docker image next to the backend. Every installation needs exactly one. It runs:

- **Account deletion**, every minute. Deletes accounts whose deletion grace period has ended, removes their profile images from S3 and retries image cleanup that failed earlier. When email is on, it emails the owner once the account is gone.
- **Verification cleanup**, every hour. Deletes expired email codes and verification tokens from the database.

Each job runs once at startup, then waits its interval after each run finishes. A failed run is logged and retried after the same interval. Schedules aren't stored, so a restart runs every job again and missed runs aren't caught up.

On startup the runner checks PostgreSQL, S3, R2 and, when configured, the email provider, and exits if any check fails. It doesn't apply migrations; the backend does. See the [environment variables](#environment-variables) marked Runner for its settings.

Run it locally with:

```sh
bun run dev --filter=@openbeacon/scheduled-jobs
```

See [the runner guide](apps/scheduled-jobs/README.md) for deployment and adding jobs.

## Run the mobile app

From `apps/mobile` copy the example env and fill in values for your machine:

```sh
cd ./apps/mobile
cp .env.example .env
```

```sh
cd ./apps/mobile
bun run android
```

For iOS on macOS, from the same directory:

```sh
bun run ios
```

## Derby Android emulator simulation

Install Bun, Python 3, Java 17, Docker Compose and the Android SDK emulator and platform tools. Install the Android NDK and accept the SDK licences in Android Studio’s SDK Manager, create an Android Virtual Device (AVD), and ensure `emulator` and `adb` are on your PATH. Stop any emulators using ports 5554–5560 and any Metro server on port 8081 first.

From the repository root, run:

```sh
bun run emulators
```

The command installs dependencies, starts PostgreSQL and Redis, applies database migrations, starts the backend, builds the Android development APK, and launches Metro and four emulators. On first run it creates `.env` if needed and tells you which required storage settings to fill in. Configure `S3_ACCESS_KEY_ID`, `S3_ACCESS_KEY`, `S3_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` there; real storage credentials are needed for storage features, and the map only shows once the map tiles service has published one to the bucket. Map data is published by the map tiles service; see `apps/map-tiles/README.md`. Configure native Google sign-in values in `apps/mobile/.env` if needed. Existing `.env` files are preserved.

The first available AVD is used by default. Each emulator is allocated 6 GiB RAM (24 GiB across four devices); the host also needs memory for the operating system and build tools. Before building, the script checks that the available RAM covers every emulator plus 2 GiB and stops if it doesn't; pass `--skip-memory-check` to start anyway. To change the allocation, select an AVD, or use an already running backend instead of starting the local one:

```sh
bun run emulators --avd Medium_Phone
bun run emulators --memory-mb 4096
bun run emulators --api-url https://api.example.com
```

Use `--external-backend` to use an existing backend at the default `http://10.0.2.2:3000` address, and `--apk /path/to/app-debug.apk` to skip the Android build. `10.0.2.2` reaches the host machine from Android emulators. The chosen API URL is embedded in the development bundle, so restart the command when switching backends. Backend authentication and network configuration must permit the selected URL.

The script starts Metro and four read-only instances of the AVD, installs and opens the app, and updates GPS once per second. The devices represent a stationary phone in central Derby, a 3 mph walk through the centre, a 6 mph jog in Darley Park, and a 70 mph car journey along the A6 south-east of Derby. Routes repeat, with the car reversing at each end. Sign in and enable location sharing on each device as needed. Emulator diagnostics are saved in the log directory printed at startup. Press Ctrl+C to stop the backend process, Metro and the emulators. The database and cache containers keep running; stop them with `docker compose stop db redis`.

## License

See [LICENSE.md](LICENSE.md).
