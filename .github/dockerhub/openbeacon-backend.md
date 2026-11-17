# OpenBeacon backend

The API server for [OpenBeacon](https://openbeacon.net), a privacy-first family location sharing app. Locations, battery levels, nicknames and pictures are end-to-end encrypted on the phone, so this server stores them without being able to read them. [What the server can see](https://docs.openbeacon.net/docs/privacy-security/what-the-server-can-see) lists everything it does see.

The hosted OpenBeacon server and a self-hosted one run this same image.

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
