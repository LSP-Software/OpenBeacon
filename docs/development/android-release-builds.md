# Android release builds

Google Play takes an Android App Bundle (`.aab`) signed with the app's upload key. We build it on our own machine with `eas build --local`, which is free and signs with a keystore that never leaves the machine.

## What you need

- The Android SDK and JDK 17, the same setup `bun run android` uses.
- An Expo account with access to the `open-beacon` project. Sign in once with `bunx eas-cli login`.
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

The `production` profile in `apps/mobile/eas.json` sets `"credentialsSource": "local"`, so it signs with the keystore described in `apps/mobile/credentials.json` rather than one stored on Expo. That file holds passwords and is gitignored.

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

## Environment variables

The build reads the `EXPO_PUBLIC_*` variables from the `production` environment on EAS, not from `apps/mobile/.env`. See the [mobile app variables](../../README.md#mobile-app) for what each one does. Add or change one with:

```sh
bunx eas-cli env:create --environment production --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <value> --visibility plaintext
```

## Build the bundle

Every upload needs a higher `android.versionCode` in `apps/mobile/app.json` than any bundle Play has seen, including ones that were never released. Every PR that changes the app already bumps it.

From `apps/mobile`:

```sh
bunx eas-cli build -p android --profile production --local
```

The build installs dependencies, generates the Prisma client (the `eas-build-post-install` script), runs `expo prebuild` and Gradle in a temporary folder. It writes `build-<timestamp>.aab` into `apps/mobile`. Pass `--output <path>` to choose the file name.

## Check the signature

Before uploading, confirm the bundle is signed with the upload key Play expects:

```sh
keytool -printcert -jarfile build-<timestamp>.aab
```

The SHA1 must match the upload key certificate shown in Play Console under Protected with Play, Play Store protection, Manage Play app signing. If it doesn't, Play rejects the upload with "signed with the wrong key".

## Upload

Upload the `.aab` in Play Console to the track you want, usually Internal testing first.
