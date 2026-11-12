# Map tiles service

Keeps the [Protomaps](https://docs.protomaps.com/basemaps/downloads) planet basemap in the R2 bucket current. It runs as a standalone service that checks for a new map when it starts and then once a day. The same image has a `map-tiles` command for checking the service, rolling back and starting an update by hand.

A planet build is about 130 GiB. Protomaps publishes no diffs, so every update downloads and uploads the whole archive. It streams 64 MiB parts and does not store the archive on disk.

## Two slots, used in turn

The bucket only ever holds two maps: slot A (`planet-a.pmtiles`) and slot B (`planet-b.pmtiles`). `pmtiles-manifest.json` in the bucket records which slot is in use and which Protomaps build each slot holds.

On an empty bucket the first update downloads the map into slot A and starts using it straight away. At the next scheduled update slot B is empty, so the new map goes there. From then on each update replaces the slot that isn't in use. If the app is using slot A, an update:

1. Checks that nobody can still be using slot B (see below), then removes slot B from the manifest so the API never signs it while it is being replaced.
2. Uploads the new build over `planet-b.pmtiles`.
3. Checks the upload against the Protomaps source.
4. Switches the manifest to slot B. Slot A stays untouched as the rollback copy.

The next update replaces slot A, and so on.

- The API reads the manifest (cached for a minute) and signs the map the app asks for. A map that was just replaced is still served for 7 days to apps that already had it open; everything else gets the slot in use.
- The app asks for the map it already uses whenever it refreshes its signed URL, so an open map never mixes tiles from two builds. It moves to the new map when the app restarts, when the map recovers from a load failure, or when the 7 days are up, in which case the map remounts.
- Each build gets its own source URL in the app (`planet-b.pmtiles?archive=b-20261201`), so tiles cached from an older build in the same slot are never reused.
- A slot can be replaced 1 day after it stops being served, so 8 days after it was replaced or rolled back from. The update interval must be longer than that.
- The app's About screen shows the slot in use and the date of its Protomaps build. Feedback sent from the app includes both.
- Until the first update finishes there is no manifest. The backend and runner still start, the app shows that the server is still preparing the map, and the backend logs a reminder every 5 minutes to check this container for progress.

## Configuration

The service reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`. The credentials need to read, write, delete and list objects and multipart uploads in the bucket (Cloudflare's "Object Read & Write" permission).

| Variable                         | Default                           | What it does                                                             |
| -------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `MAP_TILES_UPDATE_INTERVAL_DAYS` | `30`                              | Days between scheduled updates. Must be more than 8.                     |
| `MAP_TILES_PORT`                 | `8080`                            | Port the service listens on, inside the container only (`127.0.0.1`).    |
| `MAP_TILES_MAX_MBPS`             | None                              | Caps the upload and the download, each at this many megabits per second. |
| `MAP_TILES_STATE_DIR`            | `.map-tiles` (`/state` in Docker) | Resumable upload state. Keep it on a volume.                             |

## Running the service

The `Publish images to Docker Hub` workflow publishes `lspsoftware/openbeacon-map-tiles` tagged with `serverVersion`, and the `Deploy backend` workflow points `latest-stable` at a released version, but neither redeploys the service. Deploy it from Coolify when `map-tiles status` shows no update running.

To build the image yourself, run this from the repository root:

```bash
docker build -f apps/map-tiles/Dockerfile -t openbeacon-map-tiles .
```

Run exactly one map tiles service per bucket; two would race each other's uploads and manifest changes. Run it with `/state` on a volume:

```bash
docker run -d --name map-tiles --env-file .env -v openbeacon-map-tiles-state:/state openbeacon-map-tiles
```

On start the service checks its settings, the same way the backend does. It then checks that its R2 credentials can list the bucket and write and delete a small `map-tiles-access-check` object, and that it can write to its state directory. It exits if any check fails, naming the error code (for example `R2: failed (AccessDenied)`):

```text
Environment configuration:
  R2_ACCOUNT_ID: valid
  ...
  MAP_TILES_MAX_MBPS: not set (optional/default)
Environment configuration valid
Service connectivity:
  State directory: valid
  R2: valid
Map tiles API listening on 127.0.0.1:8080 for the map-tiles command
Checking for a map update now and every 24 hours in R2 bucket openbeacon-maps
```

It then checks for an update straight away and every 24 hours after that. The service owns the manifest, so each check first makes sure the maps it lists are in R2:

- If the map in use is missing and the other slot's map is there, it switches to the other slot.
- If the other slot's map is missing, it removes that slot from the manifest so nothing is served from it or rolled back to.
- If neither map is there, it removes the manifest and downloads the map again into slot A.

A manifest that can't be read (not valid JSON, or not in the expected format) is never overwritten. The check fails and logs why until the file is fixed or deleted by hand.

After that the update check runs as normal. It logs progress and the reason for every skip or failure. On `SIGTERM` it stops at once; an unfinished upload resumes on the next start.

The image includes `curl`, so Coolify's health check against `http://127.0.0.1:8080/health` works. The Docker `HEALTHCHECK` calls the same endpoint.

A scheduled update does nothing unless all of these hold:

- the bucket has no map yet, or the map in use is at least `MAP_TILES_UPDATE_INTERVAL_DAYS` old,
- Protomaps has a newer build with basemap schema 4,
- the other slot is empty or free to replace.

So the daily check is cheap and the map changes roughly monthly.

If the service restarts in the middle of an upload, it resumes from the parts already in R2 when it starts again. This includes an upload started with `map-tiles update` before the next update was due. An unreadable upload state file is ignored and the upload starts again. R2 deletes unfinished multipart uploads after 7 days by default, after which the upload starts again.

Before switching to a new map, the service checks that the uploaded size matches the build, compares the first 16 KiB (header and root directory) with the Protomaps source, and checks that the metadata reports basemap schema major version 4, which the app's `@protomaps/basemaps` style expects. Each part is uploaded with its MD5 so R2 rejects corrupted parts. If a check fails, nothing is switched and the next update uploads the slot again.

## The `map-tiles` command

Run it inside the service's container:

```bash
docker exec map-tiles map-tiles status
```

The command talks to the running service, so it only works while the service is up, and it never races an update the service is running. The service listens on `127.0.0.1` only, so nothing outside its container can reach it and it needs no key. Don't publish its port.

| Command    | What it does                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`   | Shows which slot is in use, the Protomaps build in each slot, when the other slot can be replaced, when the next scheduled update is due, the speed limit, whether an update is running and how the last one ended. |
| `update`   | Starts an update now, ignoring `MAP_TILES_UPDATE_INTERVAL_DAYS`. It still skips when Protomaps has nothing newer or the other slot may still be in use. Returns straight away.                                      |
| `rollback` | Switches back to the map in the other slot after asking for confirmation. Refused while an update is running.                                                                                                       |
| `serve`    | Runs the service. This is what the container runs by default.                                                                                                                                                       |

`--yes` skips the rollback confirmation, which is needed without a terminal (`docker exec` without `-it`). `--help` lists the commands.

Example `status` output:

```text
Bucket: openbeacon-maps
Map in use: slot B
Slot A: Protomaps build 2026-11-01 (schema 4.15.2, 120.3 GiB, published 2026-11-02T03:12:44.000Z), still served to open maps until 2026-12-09T03:00:00.000Z
Slot B: Protomaps build 2026-12-01 (schema 4.15.2, 121.0 GiB, published 2026-12-02T03:00:00.000Z), in use
The standby slot can be replaced from 2026-12-10T03:00:00.000Z
Next scheduled update: from 2027-01-01T03:00:00.000Z, if Protomaps has a newer build
Speed limit: 100 Mbps each way (MAP_TILES_MAX_MBPS)
Update: not running
Last update: published at 2026-12-02T03:00:00.000Z: Published build 20261201 to slot b. Newly opened maps use it within about a minute.
```

`status` also lists any `.pmtiles` archives in the bucket that aren't in either slot, such as a map published before the slots existed. The service never touches them; delete them by hand once nothing serves them.

### Starting an update by hand

```bash
docker exec map-tiles map-tiles update
```

Then follow it with `map-tiles status` or `docker logs -f map-tiles`. A full upload takes several hours.

### Rolling back

```bash
docker exec -it map-tiles map-tiles rollback
```

Apps using the bad map move off it on their next URL refresh, within about 10 minutes. Rollback works until the other slot is replaced, which is at least 8 days after the switch and normally a full update interval later. After a rollback the bad map is in the other slot, and the next update replaces it.

### Outside the container

From the repository root, while the service runs on the same machine (for example `bun run map-tiles serve` in another terminal):

```bash
bun run map-tiles status
```

## Self-hosting

Self-hosted backends can use their own R2 bucket: run the service against it and it fills the bucket on its first start. The first update fills slot A and creates the manifest; the app shows that the map isn't ready until then.

Backends that served a map from `R2_PM_TILES_KEY` before the map tiles service existed have no manifest, so the map stops showing when they upgrade. Deploy this service and let its first update finish (`map-tiles status` until it's done) before upgrading the backend.
