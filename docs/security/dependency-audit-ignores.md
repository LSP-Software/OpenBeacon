# Dependency audit ignores

`bun run audit` runs `bun audit --audit-level=high` and is part of `bun run ci`. Bun has no config file setting for ignored advisories, so the ignores are `--ignore` flags in the `audit` script in the root `package.json`. Every ignore must be listed here with its reason. Remove it once a fixed version can be installed.

## Ignored high and critical advisories

| Advisory                                                                 | Package                    | Pulled in by                                             | Why it is ignored                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) | decode-uri-component 0.2.2 | query-string 7, used by expo-router and React Navigation | The only fix is 0.5.1, which is ESM only. query-string 7 loads it with `require`, so an override breaks URL parsing. The slow path only runs on malformed percent-encoding, so the worst case is a crafted deep link of hundreds of KB freezing the app on the phone that opens it. No server or other user is affected. |
| [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | image-size 1.2.1           | Metro                                                    | Metro only reads image sizes for our own bundled assets at build time. The fix is in image-size 2, which changed its API, and Metro requires `^1.0.2`.                                                                                                                                                                   |
| [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | image-size 1.2.1           | Metro                                                    | Same as above.                                                                                                                                                                                                                                                                                                           |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | zod 3.25.76                | @expo/cli                                                | There is no fixed zod 3 release, and @expo/cli requires `^3.25.76`. The Expo CLI only uses it on a developer machine to validate dev tools plugin config. It is not in the app bundle or the backend. Our own code uses zod 4.6.6, which has the fix.                                                                    |

## Known moderate and low advisories

These are below the CI threshold and have no compatible fix. Apart from decode-uri-component, they are in Expo build tooling that only handles our own project files, or in email rendering that only merges options we pass in.

| Advisory                                                                 | Package                    | Pulled in by                                                                       |
| ------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------- |
| [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | decode-uri-component 0.2.2 | query-string 7 (see above)                                                         |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob 13                    | Expo CLI and config packages                                                       |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch 10               | glob 13 and @expo/fingerprint                                                      |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | uuid 7                     | xcode, used by Expo config plugins                                                 |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | deepmerge 4.3.1            | @expo/config, and html-to-text 9 via @react-email/components when rendering emails |

## Overrides

The root `package.json` `overrides` raise these packages past a dependent's range:

- `postcss` to `^8.5.23`. @expo/metro-config 55.0.11 asks for `~8.4.32`, and 8.4 has GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp and GHSA-qx2v-qp2m-jg93. Later @expo/metro-config 55 releases ask for `^8.5.14`, so 8.5 works with this SDK.
