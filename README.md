# OpenBeacon

OpenBeacon is an open-source, privacy-focused family location app. You can run the backend on your own hardware or point the client at a hosted API; the architecture assumes sensitive data is encrypted so the people running servers are not in a position to read your family’s locations or activity.

This repo is a Bun monorepo: a React Native (Expo) app under `apps/mobile`, an API server under `apps/backend`, and shared packages (`api`, `database`, `encryption`, `schemas`, and others) at the root.

## Requirements

- [Bun](https://bun.sh) (see `packageManager` in the root `package.json` for the version this repo expects)
- **Java 17** — needed for Android builds
- **PostgreSQL** and **Redis** — the backend expects them; URLs are set in `.env`

## Setup

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
cd /packages/database
bun run db:migrate
```

## Run the backend

```sh
bun run dev --filter=@openbeacon/backend
```

The API listens on the port in `OPENBEACON_API_PORT` (default `3000`).

## Run the mobile app

From `apps/mobile` copy the example env and fill in values for your machine:

```sh
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

## License

See [LICENSE.md](LICENSE.md).
