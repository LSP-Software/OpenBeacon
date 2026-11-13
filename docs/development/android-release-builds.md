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

The build reads `apps/mobile/.env` like a development build, so set the Google sign-in variables there. The build stops if `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` isn't set, because Google sign-in would be turned off in the release. See the [mobile app variables](../../README.md#mobile-app) for what each one does. Release builds ignore `EXPO_PUBLIC_DEV_API_URL`, so a development server in `.env` never ends up in a release.

## Build the bundle

Every upload needs a higher `android.versionCode` in `apps/mobile/app.json` than any bundle Play has seen, including ones that were never released. Every PR that changes the app already bumps it.

From `apps/mobile`:

```sh
bun run build-aab
```

`scripts/build-aab.ts` checks everything it can before the slow part starts. It stops if:

- there are uncommitted changes, since they would end up in the release;
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` isn't set;
- `credentials.json` is missing or has an empty field, or the keystore doesn't open with its passwords.

It then generates the Prisma client, regenerates `android/` with `expo prebuild --clean`, runs `./gradlew bundleRelease`, and writes `apps/mobile/openbeacon-<version>-<versionCode>.aab`. Regenerating `android/` throws away any local edits in it, which `bun run android` recreates anyway.

For a build you won't upload, `bun run build-aab --allow-dirty` includes uncommitted changes.

## Code shrinking

Release builds run R8, which removes unused code and renames classes. `expo-build-properties` in `apps/mobile/app.json` turns it on with `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds`. Debug builds aren't shrunk, so test a release build after adding or upgrading a native library.

If a library breaks only in release builds, usually with `ClassNotFoundException` or `NoSuchMethodError` in `adb logcat`, add keep rules to `extraProguardRules` in the same plugin entry. Don't edit `android/app/proguard-rules.pro`, because prebuild regenerates it.

The bundle includes R8's mapping file, so Play Console shows readable stack traces in crash reports without a separate upload.

## Check the signature

The build prints the SHA1 of the key it signed with, and fails if the bundle's signature doesn't match the key in `credentials.json`. To check a bundle yourself:

```sh
keytool -printcert -jarfile openbeacon-1.14.0-35.aab
```

The SHA1 must match the upload key certificate shown in Play Console under Protected with Play, Play Store protection, Manage Play app signing. If it doesn't, Play rejects the upload with "signed with the wrong key".

## Upload

Upload the `.aab` in Play Console to the track you want, usually Internal testing first.

## Building your own version

Anyone can build and sign the app with their own key. Google Play only lets one developer publish a package name, so a version published separately from Open Beacon needs:

- **Its own package name.** Change `android.package` (and `ios.bundleIdentifier`) in `apps/mobile/app.json`.
- **Its own upload key**, created as above and set in `credentials.json`.
- **Its own Google sign-in client**, if you want Google sign-in. Create an Android OAuth client in Google Cloud for your package name and the SHA1 of your Play app signing key, and set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the web client your backend uses.

A build you only install yourself can keep the package name; it just can't be installed over the Play Store version.

The app talks to `https://api.openbeacon.net` unless the user picks another server in the app.
