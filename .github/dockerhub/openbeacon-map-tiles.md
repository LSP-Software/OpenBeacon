# OpenBeacon map tiles

The map tiles service for [OpenBeacon](https://openbeacon.net), a privacy-first family location sharing app. It keeps the map in S3-compatible storage up to date. Run it next to [`lspsoftware/openbeacon-backend`](https://hub.docker.com/r/lspsoftware/openbeacon-backend).

## Run your own server

A server is three images next to PostgreSQL, a Redis-compatible cache and S3-compatible storage:

| Image                                                                                                     | What it does                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`lspsoftware/openbeacon-backend`](https://hub.docker.com/r/lspsoftware/openbeacon-backend)               | The API the app talks to           |
| [`lspsoftware/openbeacon-scheduled-jobs`](https://hub.docker.com/r/lspsoftware/openbeacon-scheduled-jobs) | Clean-up jobs and account deletion |
| [`lspsoftware/openbeacon-map-tiles`](https://hub.docker.com/r/lspsoftware/openbeacon-map-tiles)           | Keeps the map up to date           |

Start with [Quick start with Docker](https://docs.openbeacon.net/docs/self-host/quick-start-with-docker). Every setting is in the [environment variables reference](https://docs.openbeacon.net/docs/self-host/configuration/environment-variables).

## Tags

`latest-stable` is the newest release. Each release is also tagged with its server version, such as `0.27.0`.

## Links

- [Source code on GitHub](https://github.com/LSP-Software/OpenBeacon)
- [Docs](https://docs.openbeacon.net)
- [Licence: AGPL-3.0 with the Commons Clause](https://github.com/LSP-Software/OpenBeacon/blob/main/LICENSE.md)
