# Contributing to OpenBeacon

Thanks for helping. The full guide is in the docs: [Contributing to OpenBeacon](https://docs.openbeacon.net/docs/contribute/contributing-to-openbeacon). Start with [Development setup](https://docs.openbeacon.net/docs/contribute/development-setup).

## Issues

- **Bugs and feature ideas:** open an [issue](https://github.com/LSP-Software/OpenBeacon/issues/new/choose) using one of the forms.
- **Security problems:** don't open an issue. See [SECURITY.md](SECURITY.md).

## Pull requests

Branch from `main`. Before opening a pull request, check that:

- `bun run ci` passes.
- New logic has tests, especially anything touching encryption.
- Shipped code changes bump the right version. See [Versions and releases](https://docs.openbeacon.net/docs/contribute/versions-and-releases); `bun scripts/check-version-bump.ts origin/main` checks it locally.
- Database changes come with a migration. See [Database changes](https://docs.openbeacon.net/docs/contribute/database-changes).
- `bun install --frozen-lockfile` passes.
- The pull request body says `API compatibility: unchanged` or `API compatibility: raised because …`. See [API compatibility](https://docs.openbeacon.net/docs/contribute/api-compatibility).
- If your change affects the [docs](https://docs.openbeacon.net), the pull request lists the pages.

Code style is described in [Code conventions](https://docs.openbeacon.net/docs/contribute/code-conventions).

AI-assisted pull requests are welcome, but the tool must follow [AGENTS.md](AGENTS.md), and you're responsible for reviewing what it wrote.

## Code of conduct

Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).
