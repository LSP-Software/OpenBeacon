# Map tiles service and CLI

Keeps the [Protomaps](https://docs.protomaps.com/basemaps/downloads) planet basemap in the R2 bucket current. It runs as a small service that the scheduled job runner calls once a day, and the same image works as a CLI for manual runs.

A planet build is about 130 GiB. Protomaps publishes no diffs, so every refresh downloads and uploads the whole archive. It streams 64 MiB parts and does not store the archive on disk.

## Two slots, used in turn

The bucket only ever holds two maps: slot A (`planet-a.pmtiles`) and slot B (`planet-b.pmtiles`). `pmtiles-manifest.json` in the bucket records which slot is current and which build each slot holds.

If the app is using slot A, a refresh:

1. Checks that nobody can still be using slot B (see below), then removes slot B from the manifest so the API never signs it while it is being replaced.
2. Uploads the new build over `planet-b.pmtiles`.
3. Checks the upload against the Protomaps source.
4. Switches the manifest to slot B. Slot A stays untouched as the rollback copy.

The next refresh replaces slot A, and so on.

- The API reads the manifest (cached for a minute) and signs the map the app asks for. A map that was just replaced is still served for 7 days to apps that already had it open; everything else gets the current slot.
- The app asks for the map it already uses whenever it refreshes its signed URL, so an open map never mixes tiles from two builds. It moves to the new map when the app restarts, when the map recovers from a load failure, or when the 7 days are up, in which case the map remounts.
- Each build gets its own source URL in the app (`planet-b.pmtiles?archive=b-20261201`), so tiles cached from an older build in the same slot are never reused.
- A slot can be replaced 1 day after it stops being served, so 8 days after it was replaced or rolled back from. The refresh interval must be longer than that.
- Without a manifest the API serves `R2_PM_TILES_KEY`.

## Configuration

Both the service and the CLI read `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and, if set, `R2_PM_TILES_KEY`. The credentials need to read, write, list and delete objects and multipart uploads in the bucket.

| Variable                         | Default                           | What it does                                                                     |
| -------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `MAP_TILES_API_KEY`              | None                              | Shared key the scheduled job runner sends. Required for `serve`, 32+ characters. |
| `MAP_TILES_UPDATE_INTERVAL_DAYS` | `30`                              | Days between refreshes. Must be more than 8.                                     |
| `MAP_TILES_PORT`                 | `8080`                            | Port `serve` listens on.                                                         |
| `MAP_TILES_MAX_MBPS`             | None                              | Caps the upload and the download, each at this many megabits per second.         |
| `MAP_TILES_STATE_DIR`            | `.map-tiles` (`/state` in Docker) | Resumable upload state. Keep it on a volume.                                     |

## The service

`serve` starts an HTTP server:

| Request        | Key needed | Effect                                                                                                |
| -------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `GET /health`  | No         | Returns `ok`.                                                                                         |
| `POST /update` | Yes        | Starts a refresh in the background unless one is running, and returns `202` with the status.          |
| `GET /status`  | Yes        | Returns whether a refresh is running and how the last one ended (`published`, `skipped` or `failed`). |

Send the key as `Authorization: Bearer <MAP_TILES_API_KEY>`.

A refresh does nothing unless all of these hold: Protomaps has a newer build with basemap schema 4, the current map is at least `MAP_TILES_UPDATE_INTERVAL_DAYS` old, and the standby slot is free to replace. So the runner can call it daily and the map changes roughly monthly.

Give the scheduled job runner `MAP_TILES_SERVICE_URL` (for example `http://map-tiles:8080`) and the same `MAP_TILES_API_KEY`. It calls `POST /update` once a day, logs `MAP_TILES_HTTP_<status>` if the service refuses, and `MAP_TILES_UPDATE_FAILED` if the previous refresh failed. The service logs progress and the reason for every skip or failure.

If the service restarts in the middle of an upload, the next daily call resumes it from the parts already in R2. R2 deletes unfinished multipart uploads after 7 days by default, after which the upload starts again.

## CLI

Run from the repository root:

```bash
bun run map-tiles status
```

| Command                     | Effect                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                    | Shows both slots, when the standby slot can be replaced, archives in the bucket that the manifest does not track, and local resumable uploads. Read-only.           |
| `publish [--date YYYYMMDD]` | Replaces the standby slot with the newest supported build (or the given date) and switches to it, ignoring the update interval. Asks for confirmation first.        |
| `adopt <key> [--date …]`    | Creates the first manifest for an archive already in the bucket, in slot A, without uploading it again. The build date is read from the key unless `--date` is set. |
| `rollback`                  | Switches back to the standby slot. Apps using the current slot move off it on their next URL refresh.                                                               |
| `serve`                     | Runs the service described above.                                                                                                                                   |

Commands that change R2 refuse to run unless `--bucket` matches `R2_BUCKET`. `--dry-run` writes nothing and `--yes` skips confirmation (required without a terminal). Don't run `publish` by hand while the service is refreshing the same bucket.

Before switching to a new map, `publish` checks that the uploaded size matches the build, compares the first 16 KiB (header and root directory) with the Protomaps source, and checks that the metadata reports basemap schema major version 4, which the app's `@protomaps/basemaps` style expects. Each part is uploaded with its MD5 so R2 rejects corrupted parts. If the check fails, nothing is switched; the next run uploads the slot again.

### First run on the hosted bucket

The hosted bucket already holds `planet-20260315.pmtiles`. Deploy the backend and app changes first, then:

```bash
bun run map-tiles adopt planet-20260315.pmtiles --bucket <bucket>
```

That puts the existing map in slot A. The first refresh fills slot B. The refresh after that replaces slot A: it deletes `planet-20260315.pmtiles` and uploads `planet-a.pmtiles`, so the bucket goes back to two maps. Once that has happened, point `R2_PM_TILES_KEY` at `planet-a.pmtiles` or `planet-b.pmtiles`.

`publish` refuses to run without a manifest if `R2_PM_TILES_KEY` already exists, so it can't add a third map.

App builds released before archive pinning do not send their archive, so they switch maps once mid-session after the first refresh.

### Rolling back

```bash
bun run map-tiles rollback --bucket <bucket>
```

Rollback works until the standby slot is replaced, which is at least 8 days after the switch and normally a full update interval later. After a rollback the bad map becomes the standby slot, and the next refresh replaces it.

## Docker

Build from the repository root:

```bash
docker build -f apps/map-tiles/Dockerfile -t openbeacon-map-tiles .
```

The image runs `serve` by default. Keep `/state` on a volume:

```bash
docker run -d --env-file .env -p 8080:8080 -v openbeacon-map-tiles-state:/state openbeacon-map-tiles
```

Run a CLI command in the same image:

```bash
docker run --rm -it --env-file .env -v openbeacon-map-tiles-state:/state openbeacon-map-tiles status
```

## Self-hosting

Self-hosted backends can use their own R2 bucket: set the R2 variables, then run `publish` to upload the first map into slot A and create the manifest, or run the service and let the scheduled job runner call it. `R2_PM_TILES_KEY` must still be set for the backend to start, but it is only served until a manifest exists.
