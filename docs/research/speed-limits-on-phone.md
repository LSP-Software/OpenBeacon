# Speed limits on the phone

Research snapshot: 24 November 2026, for OPE-381 (part of OPE-377, recording drives). The question: where can the phone get the speed limit of the road it is on without the server or a third party learning where it drives?

## Short answer

- Our map tiles don't carry speed limits and can't be made to without building our own planet map. `apps/map-tiles` mirrors the prebuilt Protomaps planet build, and the Protomaps roads layer drops OSM `maxspeed`.
- OSM `maxspeed` is good on main roads in the UK, Germany and the Netherlands, patchy in France and the US, and poor on minor roads almost everywhere outside the Netherlands. Default limits fill some of the gap, but the main default (built-up or not) isn't in the data.
- The private way is a separate **speed limit pack** per region (country, or state in the US). A job builds it from OSM, it is published beside the basemap, and the phone downloads the whole pack for the regions the person picks. The phone matches the recorded drive to roads after the drive ends. The storage operator then learns only which regions were downloaded, not the route.
- Fetching speed limit tiles while driving would tell the storage operator the route, tied to the account. Online limit APIs need the route's coordinates, so they reveal the drive outright.
- Estimated pack size: roughly 50–150 MB for Great Britain, about 1 GB or more for the contiguous US. These come from sampled tiles, not from a pack we built.

## What our map tiles hold

`apps/map-tiles` downloads the Protomaps planet build from `build.protomaps.com` and checks it has basemap schema major version 4 (`apps/map-tiles/src/source.ts`, `apps/map-tiles/src/pmtiles.ts`, `apps/map-tiles/README.md`). We don't build tiles ourselves.

The roads layer is defined in the Protomaps [`Roads.java`](https://github.com/protomaps/basemaps/blob/main/tiles/src/main/java/com/protomaps/basemap/layers/Roads.java) Planetiler profile. For OSM roads it writes `kind`, `kind_detail`, `min_zoom`, `ref`, `oneway` (from z14), `access` (from z15), `is_link`, `is_bridge`, `is_tunnel`, names, shields and `sort_rank`. The file never mentions `maxspeed`. Its `postProcess` merges touching lines with the same attributes and drops OSM way identity, so the tiles can't be joined to OSM data later either.

Checked against the live build `20261124.pmtiles` (schema 4.15.2, max zoom 15): z14 and z15 tiles in central London, Reading, rural Powys, the M25, Ohio and rural Kansas have no speed attribute on any roads feature. The full attribute list seen was `access, is_bridge, is_link, is_tunnel, kind, kind_detail, min_zoom, name*, network*, oneway, ref, route, service, shield_text*, sort_rank`.

Adding `maxspeed` to the basemap would mean building our own planet with a forked Protomaps profile instead of mirroring theirs. A planet build is about 130 GiB, would make every self-hoster's map server a builder or force them onto our build, and would still need every rendered tile fetched to know the limit (see [Fetching while driving](#fetching-while-driving)). A separate pack is simpler.

## How complete `maxspeed` is

Share of OSM ways of each `highway` type that carry a `maxspeed` tag, from taginfo on 24 November 2026 (world: [taginfo.openstreetmap.org](https://taginfo.openstreetmap.org/keys/maxspeed); countries: Geofabrik's per-country taginfo, e.g. [Great Britain](https://taginfo.geofabrik.de/europe:great-britain/keys/maxspeed)). Counts are ways, not kilometres, so short urban ways weigh more than long rural ones. `maxspeed:forward`/`:backward`-only ways aren't counted.

| highway      | World | Great Britain | Germany | France | Italy | Netherlands | US  |
| ------------ | ----- | ------------- | ------- | ------ | ----- | ----------- | --- |
| motorway     | 66%   | 100%          | 98%     | 97%    | 95%   | 100%        | 94% |
| trunk        | 58%   | 98%           | 95%     | 96%    | 81%   | 99%         | 80% |
| primary      | 60%   | 93%           | 90%     | 81%    | 55%   | 100%        | 68% |
| secondary    | 50%   | 85%           | 85%     | 67%    | 37%   | 100%        | 52% |
| tertiary     | 30%   | 70%           | 75%     | 50%    | 27%   | 100%        | 32% |
| unclassified | 7%    | 37%           | 37%     | 13%    | 8%    | 97%         | 12% |
| residential  | 10%   | 39%           | 60%     | 27%    | 13%   | 99%         | 10% |

Values need parsing. [Key:maxspeed](https://wiki.openstreetmap.org/wiki/Key:maxspeed) says plain numbers are km/h, other units follow a space (`30 mph`), `none` means no limit, `walk` means walking pace, and implicit values look like `GB:nsl_single` or `DE:urban`. Limits can also differ by direction (`maxspeed:forward`/`:backward`), lane, time or weather (`maxspeed:conditional`), and vehicle (`maxspeed:hgv`). In GB the top way values are `30 mph` (528k), `20 mph` (444k), `60 mph`, `40 mph` and `70 mph`; in the US `25 mph` (845k), `45 mph`, `35 mph` and `30 mph`. The US list has a long tail of typos (`2330 mph`, `30-35 mph`, `County Highway 27`), so the build must reject what it can't parse rather than guess.

## Defaults where the tag is missing

- **UK** ([gov.uk/speed-limits](https://www.gov.uk/speed-limits)): 30 mph in built-up areas in England, Scotland and Northern Ireland, 20 mph in Wales (since September 2023, [gov.wales](https://www.gov.wales/introducing-default-20mph-speed-limits)), 60 mph on single carriageways, 70 mph on dual carriageways and motorways. The built-up limit applies to roads with street lights unless signs say otherwise.
- **Europe** ([Default speed limits](https://wiki.openstreetmap.org/wiki/Default_speed_limits)): usually 50 km/h urban and a rural and motorway value per country, e.g. France 50/80–90/110/130, Germany 50 urban with only an advisory 130 on autobahns.
- **US**: set per state, often per road type, with no federal default. The wiki lists them per state; they are the least reliable default in this list.

[osm-legal-default-speeds](https://github.com/westnordost/osm-legal-default-speeds) (BSD-3-Clause code, CC BY-SA 2.0 data from that wiki page) turns a country or subdivision code plus a way's tags into a default limit and says how sure it is: Exact, FromMaxSpeed, Fuzzy or Fallback. It is Kotlin Multiplatform (JVM, native, JS), so it fits a pack build job better than the phone. It needs to know whether a road is urban and takes a callback for that; without one it guesses from tags such as `highway=residential`, which is the "Fuzzy" case.

The hard part is "built-up". OSM has no consistent tag for it, and in the UK the legal test is street lighting, which is rarely mapped. A default limit is a guess; treat it as weaker evidence than a tagged one.

## Matching a GPS track to a road

The standard method is a hidden Markov model with Viterbi decoding ([Newson and Krumm, 2009](https://www.microsoft.com/en-us/research/publication/hidden-markov-map-matching-noise-sparseness/)): candidate roads near each fix, scored by distance from the fix and by how well the road distance between consecutive candidates matches the straight-line distance between the fixes. Valhalla's map matcher (Meili) does this and its `trace_attributes` can return a `speed_limit` per matched edge, taken from OSM `maxspeed` ([Valhalla speeds](https://valhalla.github.io/valhalla/speeds)).

Because the drive record is written after the drive, the phone can match the whole track at the end instead of in real time. That is easier and more accurate: it can look ahead past a junction before committing to a road. Real-time limits would only matter for an on-screen warning, which isn't in scope.

Two ways to do it on the phone:

1. **Own matcher on a simple pack.** Candidates within about 30–50 m, scored by distance, heading against the road direction and `oneway`, and continuity with the previous road. No routing graph, so it is weaker at junctions and parallel roads (motorway beside a slip road or frontage road). Speeding should only count where the match is unambiguous and the limit tagged.
2. **Valhalla offline.** A full HMM with a routing graph and `speed_limit` already in its tiles. It is a C++ library built per platform, and its tiles also carry the routing data we don't need, so packs are larger.

Start with option 1 and only move to Valhalla if real drives show bad matches at junctions.

## How much data offline

Sampled from the live Protomaps build at z14, counting vertices of drivable roads (`kind` highway, major_road, minor_road) in random land tiles:

| Area sampled                               | Tiles | Drivable road vertices per km² |
| ------------------------------------------ | ----- | ------------------------------ |
| Great Britain box (5.5°W–1.5°E, 50.5–55°N) | 195   | 118                            |
| Central US box (100–80°W, 33–45°N)         | 300   | 45                             |

Great Britain is about 209,000 km², so about 25 million vertices; the contiguous US about 365 million. Delta-encoded and compressed at roughly 2–4 bytes a vertex, plus a limit and class per road, that is roughly 50–150 MB for Great Britain and 1–1.5 GB for the contiguous US. A US pack should be per state. These are estimates from tile samples; build one GB pack before relying on them. For comparison, MapLibre's map cache on the phone is already capped at 250 MB.

A pack could drop roads with no tagged limit and no confident default, but those roads are still needed to avoid matching onto the wrong road, so keep all drivable roads and mark their limit unknown.

## Fetching while driving

Map tiles come from our map bucket through a signed URL the API makes per account (`packages/api/src/lib/pmtilesUrl.ts`). Each tile is a byte range of the archive, so anyone who can see the bucket's request logs can work out which tiles were fetched. If the phone fetched speed limit tiles along a drive, those logs would show the route, and the per-account URL would tie it to the account. So speed limit data must be on the phone before the drive, downloaded a whole region at a time.

## Online speed limit APIs

All of them need the positions. Google's Roads API Speed Limits takes a path of up to 100 latitude/longitude points or road place IDs, and is only sold with an Asset Tracking licence ([Google docs](https://developers.google.com/maps/documentation/roads/speed-limits)). HERE, TomTom and Mapbox map-matching APIs work the same way. Using any of them sends the drive's track, the phone's IP address and our API key to that company; proxying through our server would show the track to the server instead. They are not an option under the privacy model.

## Recommendation

1. Add a speed limit pack per region, built by a scheduled job from Geofabrik extracts with OSM `maxspeed` parsed to km/h, and defaults from osm-legal-default-speeds marked as defaults. Publish it in map storage with its own manifest, like the basemap.
2. The phone downloads the packs for regions the person picks, in Settings, before drive scoring works there.
3. Match each drive after it ends; count speeding only on unambiguous matches, and keep tagged and default limits apart in the drive record so the app can show how sure it is.
4. Never fetch speed limit data during a drive and never call an online limit API.

## Sources

- Protomaps roads profile: https://github.com/protomaps/basemaps/blob/main/tiles/src/main/java/com/protomaps/basemap/layers/Roads.java
- Protomaps builds list: https://build-metadata.protomaps.dev/builds.json
- taginfo (world): https://taginfo.openstreetmap.org/keys/maxspeed
- taginfo (countries): https://taginfo.geofabrik.de/
- OSM wiki Key:maxspeed: https://wiki.openstreetmap.org/wiki/Key:maxspeed
- OSM wiki Default speed limits: https://wiki.openstreetmap.org/wiki/Default_speed_limits
- osm-legal-default-speeds: https://github.com/westnordost/osm-legal-default-speeds
- UK speed limits: https://www.gov.uk/speed-limits
- Wales 20 mph: https://www.gov.wales/introducing-default-20mph-speed-limits
- Newson and Krumm, Hidden Markov Map Matching Through Noise and Sparseness (2009): https://www.microsoft.com/en-us/research/publication/hidden-markov-map-matching-noise-sparseness/
- Valhalla speeds: https://valhalla.github.io/valhalla/speeds
- Google Roads API speed limits: https://developers.google.com/maps/documentation/roads/speed-limits
