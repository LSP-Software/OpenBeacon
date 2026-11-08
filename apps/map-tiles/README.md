# Map tiles CLI

Publishes [Protomaps](https://docs.protomaps.com/basemaps/downloads) daily planet builds to the R2 bucket the backend signs map URLs for. Run it from a dev machine, or as a one-off Docker container. It is not part of the scheduled job runner.

A planet build is about 130 GiB. Protomaps publishes no diffs, so every refresh downloads and uploads the whole archive. The CLI streams it in 64 MiB parts without storing it on disk.

## How a cutover works

Every build is stored under its own key (`planet-YYYYMMDD.pmtiles`) and keys are never overwritten. `pmtiles-manifest.json` in the bucket records the current archive and the archives it replaced.

- The API reads the manifest (cached for a minute) and signs the archive the app asks for: the current archive, or a replaced archive for 8 days after it was replaced. Unknown or expired archives get the current archive.
- The app asks for the archive it is already using whenever it refreshes its signed URL, so an open map never mixes tiles from two builds. It moves to the newest archive when the app restarts or the map recovers from a load failure. If the server moves it to another archive, the map remounts instead of swapping the source in place.
- `publish` and `prune` delete replaced archives once they have not been served for a day. The archive `R2_PM_TILES_KEY` points to is never deleted, so the API fallback keeps working.
- Without a manifest the API serves `R2_PM_TILES_KEY`.

## Configuration

The CLI reads `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` and, if set, `R2_PM_TILES_KEY` from the root `.env`. The credentials need to read, write, list and delete objects and multipart uploads in the bucket.

- `MAP_TILES_MAX_MBPS` caps the upload and the download, each at that many megabits per second. Unset means no cap.
- `MAP_TILES_STATE_DIR` holds resumable upload state. It defaults to `.map-tiles` in the working directory.

Commands that change R2 refuse to run unless `--bucket` matches `R2_BUCKET`. Use `--dry-run` to see what would happen without writing anything.

## Commands

Run from the repository root:

```bash
bun run map-tiles status
```

```bash
bun run map-tiles publish --bucket <bucket>
```

| Command                     | Effect                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`                    | Shows the manifest, archives in the bucket that the manifest does not track, and local resumable uploads. Read-only.                                                                                            |
| `publish [--date YYYYMMDD]` | Picks the newest build with a supported basemap schema (or the given date), shows its size and an estimated time, asks for confirmation, uploads it, verifies it, makes it current and prunes expired archives. |
| `adopt <key>`               | Creates the first manifest for an archive already in the bucket, without uploading it again.                                                                                                                    |
| `rollback`                  | Makes the most recent archive that was not itself rolled back current again. Clients using the rolled back archive move off it on their next URL refresh. Rolling back again goes further back.                 |
| `prune`                     | Deletes archives that stopped being served more than a day ago, except the one `R2_PM_TILES_KEY` points to. `publish` runs this too.                                                                            |

Options: `--bucket <name>` confirms the target bucket for changes, `--dry-run` writes nothing, and `--yes` skips confirmation prompts (required without a terminal).

### First run

The hosted bucket already holds `planet-20260315.pmtiles`. Before the first publish, deploy the backend and app changes, then run:

```bash
bun run map-tiles adopt planet-20260315.pmtiles --bucket <bucket>
```

App builds released before archive pinning do not send their archive, so they switch archives once mid-session after the first publish.

### Publishing

`publish` prints progress with the transferred size, the speed over the last minute and an ETA that follows the measured speed. In a terminal it updates one line every second; without a terminal it logs a line every 30 seconds.

If the upload stops, rerun the same command. Finished parts are kept in R2 and only the missing parts are uploaded. R2 deletes unfinished multipart uploads after 7 days by default, after which the upload starts again. If the saved state file is unreadable, the command stops and names the file to delete.

Before making an archive current, `publish` checks that the uploaded size matches the build, compares the first 16 KiB (header and root directory) with the Protomaps source, and checks that the metadata reports basemap schema major version 4, which the app's `@protomaps/basemaps` style expects. Each part is uploaded with its MD5 so R2 rejects corrupted parts. If the uploaded archive fails these checks it is deleted and nothing is published; rerun to upload it again.

The API serves a newly published archive to newly opened maps within about a minute. No backend change or redeploy is needed.

### Rolling back

```bash
bun run map-tiles rollback --bucket <bucket>
```

Rollback needs the previous archive to still exist. It is pruned on the first `publish` or `prune` at least 9 days after it was replaced.

## Docker

Build from the repository root:

```bash
docker build -f apps/map-tiles/Dockerfile -t openbeacon-map-tiles .
```

Pass the R2 variables and keep `/state` on a volume so an interrupted upload can resume:

```bash
docker run --rm -it --env-file .env -v openbeacon-map-tiles-state:/state openbeacon-map-tiles publish --bucket <bucket>
```

Without `-it`, add `--yes`.

## Self-hosting

Self-hosted backends can use their own R2 bucket: set the R2 variables, then run `publish` to upload the first archive and create the manifest. `R2_PM_TILES_KEY` must still be set for the backend to start, but it is only served until a manifest exists.
