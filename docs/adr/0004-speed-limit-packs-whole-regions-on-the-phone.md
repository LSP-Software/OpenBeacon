---
status: accepted
---

# Speed limits come from whole-region packs on the device, built by us and mirrored by each server

A device checks a Drive for speeding against a Speed limit pack it already holds: one region's OSM road limits, fetched whole and never during a Drive. We build every pack monthly from Geofabrik extracts and publish them under ODbL. Each server's map-tiles service mirrors the whole world into that server's own map storage, and devices download only from there. The device picks the region it is in on its own. One API call signs download links for every region, so the API never learns which pack a device chose. The terms are defined in the [Drives glossary](../contexts/drives/CONTEXT.md). This decision was made in OPE-390, building on the research in OPE-381.

## Considered options

- **Add `maxspeed` to our map tiles.** Rejected. We mirror Protomaps' planet build, which drops speed limits. Building our own planet means a forked profile and a build of about 130 GiB that every self-hoster would have to run or take from us.
- **Fetch limits for the roads along a Drive, during or after it.** Rejected. Storage request logs would show the route, and signed links tie the requests to the account.
- **Online speed limit APIs (Google, HERE, TomTom, Mapbox).** Rejected. Each one needs the Drive's positions.
- **Every server builds its own packs.** Rejected. Every self-hosted box would need a JVM job and Geofabrik downloads. Mirroring keeps self-hosting at "run map-tiles".
- **Devices on self-hosted servers fetch packs from us.** Rejected. Those devices would then contact our servers.
- **The person picks regions in Settings.** Rejected. It reveals the same thing as automatic downloads and is easy to forget, so Drives go unchecked.

## Consequences

- Whoever runs a server's map storage can see from request logs which regions a device downloaded, by IP address, so roughly which countries or states it has been in. The privacy draft must say this when Drives ship.
- A Drive in a region whose pack hasn't arrived yet is "Speeding not checked" for that stretch and is never re-checked later.
- Self-hosted map storage needs roughly 15–25 GB more for the whole world.
- Fuzzy guessed defaults (built-up or not) are stored as unknown, so many minor roads are never checked for speeding.
