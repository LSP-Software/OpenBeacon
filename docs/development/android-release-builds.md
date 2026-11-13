# Android release builds

Google Play takes an Android App Bundle (`.aab`) signed with the app's upload key. We build it on our own machine with `expo prebuild` and Gradle. No Expo account or build service is involved, and the key never leaves the machine.

## What you need

- The Android SDK and JDK 17, the same setup `bun run android` uses.
- The upload keystore and its passwords. Keep them in a password manager. Google only accepts bundles signed with this key, and replacing a lost one means asking Google for an upload key reset.

## Create an upload key

Skip this if you already have the keystore.

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore ~/keys/openbeacon-upload.jks -alias openbeacon-upload -keyalg RSA -keysize 2048 -validity 10000
```

The name and organisation it asks for aren't shown to anyone. Google re-signs the app with its own app signing key before it reaches phones.

When registering a new key with Google, during setup or an upload key reset, export its certificate and upload the `.pem` file in Play Console:

```sh
keytool -export -rfc -keystore ~/keys/openbeacon-upload.jks -alias openbeacon-upload -file ~/keys/openbeacon-upload.pem
```

## Point the build at the key

The `plugins/withReleaseSigning.js` config plugin makes release builds sign with the key described in `apps/mobile/credentials.json`. That file holds passwords and is gitignored.

```sh
cd ./apps/mobile
cp credentials.json.example credentials.json
```

Then fill it in:

| Field              | What to put                                       |
| ------------------ | ------------------------------------------------- |
| `keystorePath`     | Absolute path to the `.jks` file.                 |
| `keystorePassword` | The keystore password.                            |
| `keyAlias`         | The alias the key was created with.               |
| `keyPassword`      | The key password, often the same as the keystore. |

A release build without this file stops with an error rather than signing with the debug key. To use a file somewhere else, for example in CI, set the Gradle property `openbeaconCredentials` to its path, or the environment variable `ORG_GRADLE_PROJECT_openbeaconCredentials`.

## Environment variables

The build reads `apps/mobile/.env` like a development build, so set the Google sign-in variables there. See the [mobile app variables](../../README.md#mobile-app) for what each one does. Release builds ignore `EXPO_PUBLIC_DEV_API_URL`, so a development server in `.env` never ends up in a release.

## Build the bundle

Every upload needs a higher `android.versionCode` in `apps/mobile/app.json` than any bundle Play has seen, including ones that were never released. Every PR that changes the app already bumps it.

From `apps/mobile`:

```sh
bun run build-aab
```

This generates the Prisma client, regenerates `android/` with `expo prebuild --clean`, runs `./gradlew bundleRelease`, and copies the result to `apps/mobile/openbeacon-release.aab`. Regenerating `android/` throws away any local edits in it, which `bun run android` recreates anyway.

## Check the signature

Before uploading, confirm the bundle is signed with the upload key Play expects:

```sh
keytool -printcert -jarfile openbeacon-release.aab
```

The SHA1 must match the upload key certificate shown in Play Console under Protected with Play, Play Store protection, Manage Play app signing. If it doesn't, Play rejects the upload with "signed with the wrong key".

## Upload

Upload the `.aab` in Play Console to the track you want, usually Internal testing first.
