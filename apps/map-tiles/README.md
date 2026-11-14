# Map tiles service

Keeps the [Protomaps](https://docs.protomaps.com/basemaps/downloads) planet basemap in the map storage bucket current. It checks for a new map when it starts and again whenever the map in use reaches `MAP_TILES_UPDATE_INTERVAL_DAYS` old, counted from its Protomaps build date. The same image has a `map-tiles` command for checking the service, rolling back and starting an update by hand.

Running it, the `map-tiles` commands, rolling back and its settings are covered in the docs:

- [Map tiles service](https://docs.openbeacon.net/docs/self-host/running-your-server/map-tiles-service)
- [Map tiles configuration](https://docs.openbeacon.net/docs/self-host/configuration/map-tiles)

This file covers how it works, for people changing it.

## Two slots, used in turn

The bucket only ever holds two maps: slot A (`planet-a.pmtiles`) and slot B (`planet-b.pmtiles`). `pmtiles-manifest.json` in the bucket records which slot is in use and which Protomaps build each slot holds. The service owns the manifest; the backend and runner only read it.

On an empty bucket the first update downloads the map into slot A and starts using it straight away. After that each update replaces the slot that isn't in use. If the app is using slot A, an update:

1. Checks that nobody can still be using slot B, then removes slot B from the manifest so the API never signs it while it is being replaced.
2. Uploads the new build over `planet-b.pmtiles`.
3. Checks the upload against the Protomaps source.
4. Switches the manifest to slot B. Slot A stays untouched as the rollback copy.

- The API reads the manifest (cached for a minute) and signs the map the app asks for. A map that was just replaced is still served for 7 days to apps that already had it open; everything else gets the slot in use.
- The app asks for the map it already uses whenever it refreshes its signed URL, so an open map never mixes tiles from two builds. It moves to the new map when the app restarts, when the map recovers from a load failure, or when the 7 days are up, in which case the map remounts.
- Each build gets its own source URL in the app (`planet-b.pmtiles?archive=b-20261201`), so tiles cached from an older build in the same slot are never reused.
- A slot can be replaced 1 day after it stops being served, so 8 days after it was replaced or rolled back from. The update interval must be longer than that.

## Each check

Each check first makes sure the maps the manifest lists are in the bucket:

- If the map in use is missing and the other slot's map is there, it switches to the other slot.
- If the other slot's map is missing, it removes that slot from the manifest so nothing is served from it or rolled back to.
- If neither map is there, it removes the manifest and downloads the map again into slot A.

A manifest that can't be read is never overwritten. The check fails and logs why until the file is fixed or deleted by hand.

A scheduled update then does nothing unless all of these hold:

- the bucket has no map yet, or the map in use is at least `MAP_TILES_UPDATE_INTERVAL_DAYS` old,
- Protomaps has a newer build with basemap schema 4, and it is newer than any build that was rolled back,
- the other slot is empty or free to replace.

A timer doesn't survive a restart, so every start checks the map's age instead. If the map is due but Protomaps has nothing newer, it waits a full interval. If the update fails, it tries again after 1 hour, doubling the wait after each failure up to 24 hours.

## Uploading and verifying

A planet build is about 130 GiB. Protomaps publishes no diffs, so every update downloads and uploads the whole archive. It streams 64 MiB parts and doesn't store the archive on disk.

Each part is uploaded with its MD5, so the storage provider rejects corrupted parts. Upload state is kept in `MAP_TILES_STATE_DIR`, so a restart resumes from the parts already in the bucket. An unreadable state file is ignored and the upload starts again. Unfinished multipart uploads stay in the bucket until the provider removes them; Cloudflare R2 does this after 7 days by default, and other providers need a lifecycle rule.

Before switching to a new map, the service checks that the uploaded size matches the build, compares the first 16 KiB (header and root directory) with the Protomaps source, and checks that the metadata reports basemap schema major version 4, which the app's `@protomaps/basemaps` style expects. If a check fails, nothing is switched and the next update uploads the slot again.

## Rollback

After a rollback the bad map is in the other slot. The manifest records its build as rolled back, so scheduled updates skip it until Protomaps publishes a newer build. `map-tiles update` installs it anyway. Publishing any build clears the record. The service's own switch to the other slot, when the map in use is missing from the bucket, doesn't record anything.

## The `map-tiles` command

The command talks to the running service over `127.0.0.1:8080`, so it only works while the service is up and never races an update the service is running. Nothing outside the container can reach that port, so it needs no key.

To run it outside a container, start the service from the repository root in one terminal and run commands in another:

```bash
bun run map-tiles serve
bun run map-tiles status
```

## Build the image

From the repository root:

```bash
docker build -f apps/map-tiles/Dockerfile -t openbeacon-map-tiles .
```
