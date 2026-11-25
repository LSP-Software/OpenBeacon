# Speed limit packs

Builds the Speed limit packs phones use to check a Drive for speeding, and publishes them with a manifest at `https://cdn.openbeacon.net/speed-limits/`. Each server's map-tiles service mirrors them into its own map storage once a day (see `apps/map-tiles/README.md`), and phones only ever download from their own server. ADR 0004 records why.

- `builder/` is the Kotlin pack builder. It reads Geofabrik extracts with `osmpbf` and fills in missing limits with [osm-legal-default-speeds](https://github.com/westnordost/osm-legal-default-speeds). `src/main/resources/legal_default_speeds.json` is that project's data file, taken from the OpenStreetMap wiki under CC BY-SA 2.0.
- `src/publish.ts` uploads packs and writes the manifest.
- `testVectors/speed-limit-pack-v1.json` is shared by the builder's writer and the phone's Kotlin and Swift readers (`SpeedLimitPack.kt`, `SpeedLimitPack.swift`).
- `.github/workflows/speed-limit-packs.yml` runs the build on the 2nd of each month.

## What goes in a pack

Every drivable road (`motorway` to `residential`, `living_street`, `service` except parking aisles, driveways and drive-throughs, and `road`), with its class, whether it is one-way, and a limit for each direction. Each limit has a source:

- **Posted**: a numeric `maxspeed` (or `maxspeed:forward`/`:backward`), converted to km/h, or `none`.
- **Road type**: no numeric limit, but osm-legal-default-speeds matched the road type exactly or from an implicit value such as `GB:nsl_single`.
- **Unknown**: anything else, including the library's Fuzzy and Fallback guesses (built-up or not), `walk`, `signals` and values that don't parse.

Speeding is only checked against posted and road-type limits. Roads with an unknown limit stay in the pack so the phone doesn't match a Drive onto the wrong road.

One-way roads that run against their way (`oneway=-1`) are reversed, so a one-way road always runs in the direction of its points. Points are simplified to within 1 m.

## Regions

One pack per Geofabrik country: each continent's children that have an ISO 3166 code, Russia, and a few code-less territories (Isle of Man, Guernsey and Jersey, Azores, Canary Islands, Comoros, Bermuda, the Falklands and American Oceania). A country whose pack comes out over 200 MiB, or whose extract is over 8 GiB, is replaced by Geofabrik's next level down: its subdivisions with ISO 3166-2 codes (US states, Canadian provinces) where there are any, otherwise all its children (German states). Defaults use the subdivision's code where it has one and the country's otherwise.

A real Great Britain pack built on 25 November 2026 was 60.0 MB (3.8 million roads, 18.7 million points) from a 2.2 GB extract, in under 2 minutes with 2.7 GB of memory.

## Pack format 1

Little-endian. Coordinates are whole 1/100,000ths of a degree (`E5`, about 1.1 m). Varints are unsigned LEB128; signed values are zigzag-encoded first.

Header, 42 bytes plus the region ID:

| Offset | Size | Field                                                                        |
| ------ | ---- | ---------------------------------------------------------------------------- |
| 0      | 4    | `OBSL`                                                                       |
| 4      | 2    | format version, `1`                                                          |
| 6      | 2    | header length (42 + region ID length)                                        |
| 8      | 4    | build date, `yyyymmdd`                                                       |
| 12     | 4    | tile size in E5 (`10000`, 0.1°)                                              |
| 16     | 4    | road count                                                                   |
| 20     | 4    | tile count                                                                   |
| 24     | 16   | bounds: min longitude, min latitude, max longitude, max latitude (signed E5) |
| 40     | 2    | region ID length                                                             |
| 42     | n    | region ID (UTF-8), the Geofabrik ID such as `united-kingdom`                 |

Then the tile directory: one 16-byte entry per tile, sorted by y then x: tile x (signed), tile y (signed), offset from the start of the file, length. Tile x is `floor(longitudeE5 / tileSize)`.

Each tile:

1. A varint count of attribute rows, then each row: road class (1 byte, `1` motorway to `15` road, see `RoadClass` in `RoadLimits.kt`), one-way (1 byte, `0` or `1`), then forward and backward limits, each a source byte (`0` unknown, `1` posted, `2` road type) and a varint in tenths of a km/h. A limit of `0` with a known source means no limit.
2. A varint count of road pieces, sorted by road ID, then each piece: road ID as a varint difference from the previous piece's, its attribute row index, its point count (at least 2), then each point as zigzag varint differences in longitude then latitude. The first point of the tile is relative to the tile's south-west corner, and every later point to the point before it, across pieces.

A road that crosses tiles is split into pieces, and a segment that crosses a tile edge appears in every tile its bounding box touches, so a reader that loads every tile within a radius of a point sees every segment within that radius. Pieces of one road share its road ID.

A change to any of this needs a new format version, a new vector file and a raised API compatibility level.

## Building locally

```bash
cd apps/speed-limit-packs/builder
./gradlew installDist
build/install/openbeacon-speed-limit-packs/bin/openbeacon-speed-limit-packs build \
  --pbf great-britain-latest.osm.pbf --region great-britain --name "Great Britain" \
  --country GB --build 20261125 --out packs
```

`build-continent --continent europe --build <yyyymmdd> --out <dir> --work <dir>` downloads and builds a whole continent and writes `regions.json`; `plan --continent europe` lists the countries it would build.

## Publishing

`bun run src/publish.ts upload <out-dir>` uploads one continent's packs to `speed-limits/packs/<region>-<sha256 prefix>.obsl`. `bun run src/publish.ts manifest --build <yyyymmdd> <regions.json>...` builds the region outlines file from Geofabrik's index, checks every pack is in the bucket, writes `speed-limits/manifest.json` last, and then deletes files neither the new nor the replaced manifest uses. Both read the bucket from `SPEED_LIMIT_PACKS_S3_ENDPOINT`, `SPEED_LIMIT_PACKS_S3_REGION`, `SPEED_LIMIT_PACKS_S3_ACCESS_KEY_ID`, `SPEED_LIMIT_PACKS_S3_ACCESS_KEY` and `SPEED_LIMIT_PACKS_S3_BUCKET_NAME`.
