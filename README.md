# OpenBeacon

OpenBeacon is an open-source, privacy-focused family location app. Self-hosting is supported allowing running the backend on your own hardware; the architecture assumes sensitive data is encrypted so the people running servers are not in a position to read your family’s locations or activity. Profile and group images are not end-to-end encrypted.

This repo is a Bun monorepo: a React Native (Expo) app under `apps/mobile`, an API server under `apps/backend`, and shared packages (`api`, `database`, `encryption`, `schemas`, and others) at the root.

## Requirements

- [Bun](https://bun.sh) (see `packageManager` in the root `package.json` for the version this repo expects)
- **Java 17** — needed for Android builds
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

## Run the backend

```sh
bun run dev --filter=@openbeacon/backend
```

The API listens on the port in `OPENBEACON_API_PORT` (default `3000`).

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

The command installs dependencies, starts PostgreSQL and Redis, applies database migrations, starts the backend, builds the Android development APK, and launches Metro and four emulators. On first run it creates `.env` if needed and tells you which required storage settings to fill in. Configure `S3_ACCESS_KEY_ID`, `S3_ACCESS_KEY`, `S3_BUCKET_NAME`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PM_TILES_KEY` there; real storage credentials and a PMTiles object are needed for storage and map features. Map data is published with the map tiles CLI; see `apps/map-tiles/README.md`. Configure native Google sign-in values in `apps/mobile/.env` if needed. Existing `.env` files are preserved.

The first available AVD is used by default. Each emulator is allocated 6 GiB RAM (24 GiB across four devices); the host also needs memory for the operating system and build tools. To change the allocation, select an AVD, or use an already running backend instead of starting the local one:

```sh
bun run emulators --avd Medium_Phone
bun run emulators --memory-mb 4096
bun run emulators --api-url https://api.example.com
```

Use `--external-backend` to use an existing backend at the default `http://10.0.2.2:3000` address, and `--apk /path/to/app-debug.apk` to skip the Android build. `10.0.2.2` reaches the host machine from Android emulators. The chosen API URL is embedded in the development bundle, so restart the command when switching backends. Backend authentication and network configuration must permit the selected URL.

The script starts Metro and four read-only instances of the AVD, installs and opens the app, and updates GPS once per second. The devices represent a stationary phone in central Derby, a 3 mph walk through the centre, a 6 mph jog in Darley Park, and a 70 mph car journey along the A6 south-east of Derby. Routes repeat, with the car reversing at each end. Sign in and enable location sharing on each device as needed. Emulator diagnostics are saved in the log directory printed at startup. Press Ctrl+C to stop the backend process, Metro and the emulators. The database and cache containers keep running; stop them with `docker compose stop db redis`.

## License

See [LICENSE.md](LICENSE.md).
