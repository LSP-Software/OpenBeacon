<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="store-assets/play-store-icon-dark.png">
    <img src="store-assets/play-store-icon-light.png" alt="OpenBeacon" width="96">
  </picture>

  <h1>OpenBeacon</h1>

  <p><strong>Privacy-first family location sharing.</strong><br>
  Open source, end-to-end encrypted and self-hostable.</p>

  <p>
    <a href="https://openbeacon.net">Website</a> ·
    <a href="https://docs.openbeacon.net">Docs</a> ·
    <a href="https://docs.openbeacon.net/docs/self-host/quick-start-with-docker">Self-host</a> ·
    <a href="https://docs.openbeacon.net/docs/privacy-security/privacy-and-security-overview">Privacy &amp; security</a> ·
    <a href="https://docs.openbeacon.net/docs/contribute/contributing-to-openbeacon">Contribute</a>
  </p>

  <p>
    <a href="https://github.com/LSP-Software/OpenBeacon/actions/workflows/pre-merge-checks.yml"><img alt="Checks" src="https://github.com/LSP-Software/OpenBeacon/actions/workflows/pre-merge-checks.yml/badge.svg"></a>
    <img alt="Platform: Android" src="https://img.shields.io/badge/platform-Android-3DDC84">
    <a href="LICENSE.md"><img alt="Licence: AGPL-3.0 with Commons Clause" src="https://img.shields.io/badge/licence-AGPL--3.0%20%2B%20Commons%20Clause-blue"></a>
  </p>
</div>

## What is OpenBeacon?

OpenBeacon lets your family see where each other are, without handing that information to anyone else.

- **Encrypted on your phone.** Locations and battery levels are encrypted before they leave the phone. The server stores them but can't read them, whether it's ours or yours.
- **Use our server or run your own.** The hosted server and the self-hosted server are the same code.
- **Honest about the limits.** Names, email addresses, group membership and pictures aren't end-to-end encrypted. The docs list [exactly what a server can see](https://docs.openbeacon.net/docs/privacy-security/what-the-server-can-see) and the [known limits](https://docs.openbeacon.net/docs/privacy-security/known-limits).

OpenBeacon is available on **Android 8.0 and newer**. An iPhone app is on the [roadmap](https://docs.openbeacon.net/docs/use-openbeacon/roadmap).

## Features

- Live map of everyone in your groups, with one pin per phone
- Pause sharing for a set time or until you turn it back on
- Several groups, with owner, admin and member roles
- Invite by email, link or QR code
- Use OpenBeacon on more than one phone or tablet, and link a new one by scanning a code
- Optional 12-word recovery phrase to restore your history on a new phone
- Works offline: locations are stored encrypted and sent when you reconnect
- Security emails for important account changes

See the [user guide](https://docs.openbeacon.net/docs/use-openbeacon/welcome-to-openbeacon) for everything the app does.

## Get the app

Install OpenBeacon from Google Play. See [Install the app](https://docs.openbeacon.net/docs/use-openbeacon/getting-started/install-the-app) for what it needs and why.

## Run your own server

A server runs as three containers next to PostgreSQL, a Redis-compatible cache, and S3-compatible storage for pictures and the map:

| Image                                                                                                     | What it does                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| [`lspsoftware/openbeacon-backend`](https://hub.docker.com/r/lspsoftware/openbeacon-backend)               | The API the app talks to           |
| [`lspsoftware/openbeacon-scheduled-jobs`](https://hub.docker.com/r/lspsoftware/openbeacon-scheduled-jobs) | Clean-up jobs and account deletion |
| [`lspsoftware/openbeacon-map-tiles`](https://hub.docker.com/r/lspsoftware/openbeacon-map-tiles)           | Keeps the map up to date           |

Start with the [self-hosting guide](https://docs.openbeacon.net/docs/self-host/self-hosting-overview). Every setting is in the [environment variables reference](https://docs.openbeacon.net/docs/self-host/configuration/environment-variables).

## Development quick start

You need [Bun](https://bun.sh) (the version in `package.json`), Docker, Java 17 and the Android SDK.

```sh
cp .env.example .env
bun install
docker compose up -d db redis
(cd packages/database && bun run db:migrate)
bun run dev --filter=@openbeacon/backend
```

Then, in another terminal, run the Android app against it:

```sh
cd apps/mobile
cp .env.example .env
bun run android
```

`.env` needs real S3-compatible storage credentials for pictures and the map. The [development setup guide](https://docs.openbeacon.net/docs/contribute/development-setup) explains every value, and [Android emulators](https://docs.openbeacon.net/docs/contribute/android-emulators) covers `bun run emulators`, which starts everything on four simulated phones at once. To build a signed bundle for Google Play, see [Android release builds](https://docs.openbeacon.net/docs/contribute/android-release-builds).

Before opening a pull request, run:

```sh
bun run ci
```

## Repository layout

| Path                  | What's in it                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `apps/mobile`         | The React Native (Expo) app, with a native Android module for background location |
| `apps/backend`        | The API server                                                                    |
| `apps/scheduled-jobs` | The scheduled job runner                                                          |
| `apps/map-tiles`      | The map tiles service                                                             |
| `packages/*`          | Shared code: API routers, auth, database schema, encryption, email, schemas       |
| `docs/`               | Architecture decisions, domain glossaries and design notes                        |

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md), [Contributing to OpenBeacon](https://docs.openbeacon.net/docs/contribute/contributing-to-openbeacon) and the [code conventions](https://docs.openbeacon.net/docs/contribute/code-conventions) first. Bug reports and feature ideas are welcome as [issues](https://github.com/LSP-Software/OpenBeacon/issues/new/choose).

## Security

Please don't report security problems in public issues. Use [private vulnerability reporting](https://github.com/LSP-Software/OpenBeacon/security/advisories/new) or see [SECURITY.md](SECURITY.md).

OpenBeacon's encryption hasn't been independently reviewed yet. [How encryption works](https://docs.openbeacon.net/docs/privacy-security/how-encryption-works) describes the design.

## Licence

[AGPL-3.0 with the Commons Clause](LICENSE.md). You can run, change and self-host OpenBeacon for yourself, your family or your organisation. You can't sell it or offer it as a paid service. See the [licence summary](https://docs.openbeacon.net/docs/privacy-security/licence) for details.

Copyright © 2026 LSP Software Ltd.
