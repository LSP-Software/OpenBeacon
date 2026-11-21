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

| Field              | What to put                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `keystorePath`     | Absolute path to the `.jks` file.                                                                           |
| `keystorePassword` | The keystore password.                                                                                      |
| `keyAlias`         | The alias the key was created with.                                                                         |
| `keyPassword`      | The key password. For a PKCS12 keystore, like the one `keytool` makes above, this is the keystore password. |

A release build without this file stops with an error rather than signing with the debug key. To use a file somewhere else, for example in CI, set the environment variable `ORG_GRADLE_PROJECT_openbeaconCredentials` to its path. A relative path is read from `apps/mobile`. `bun run build-aab` and `bun run build-apk` pass the full path on to Gradle, so both read the same file.

## Environment variables

The build reads `apps/mobile/.env` like a development build, so set the Google sign-in variables there. The build stops if `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` isn't set, because Google sign-in would be turned off in the release. See the [mobile app variables](../../README.md#mobile-app) for what each one does. Release builds ignore `EXPO_PUBLIC_DEV_API_URL`, so a development server in `.env` never ends up in a release.

### Push notifications

The app wakes up for place alerts and notices through Firebase Cloud Messaging. Copy four values from the project's `google-services.json` into `apps/mobile/.env`. Don't commit the file or put it in the build.

| Variable              | Value in `google-services.json`          |
| --------------------- | ---------------------------------------- |
| `FIREBASE_APP_ID`     | `client[0].client_info.mobilesdk_app_id` |
| `FIREBASE_API_KEY`    | `client[0].api_key[0].current_key`       |
| `FIREBASE_PROJECT_ID` | `project_info.project_id`                |
| `FIREBASE_SENDER_ID`  | `project_info.project_number`            |

The `plugins/withFirebasePush.js` config plugin writes them into the app as string resources at prebuild, and the app starts Firebase from them. If any of the four is missing, the plugin writes none of them and the app runs without push. Phones then get alerts and notices on their next upload instead. Development builds read the same `.env`, so they get push too when the values are there.

The app doesn't use the google-services Gradle plugin, Firebase Analytics or Firebase's automatic start-up. It only asks Firebase for a token once its server says it sends pushes, so phones on a server without push never contact Firebase.

Development builds can use an `http://` backend, but release builds only connect over `https://` with a certificate Android trusts. To test a release build against your own backend, serve it over HTTPS.

## Build the bundle

Every upload needs a higher `android.versionCode` in `apps/mobile/app.json` than any bundle Play has seen, including ones that were never released. Every PR that changes the app already bumps it.

From the repository root or `apps/mobile`:

```sh
bun run build-aab
```

`scripts/build-release.ts` checks everything it can before the slow part starts. It stops if:

- there are uncommitted changes, since they would end up in the release;
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` isn't set;
- the hosted server at `https://api.openbeacon.net` has Google sign-in turned off, uses a different `GOOGLE_CLIENT_ID`, or can't be reached, since the app would then hide Continue with Google. A server too old to report its client ID only prints a warning. Check against another server with `--server=https://your.server`, or skip the check with `--skip-server-check`;
- any of the four [Firebase values](#push-notifications) isn't set, since the release would have no push;
- `credentials.json` is missing or has an empty field, or the keystore doesn't open with its passwords;
- `keyPassword` differs from `keystorePassword` in a PKCS12 keystore, which would otherwise only fail at the signing step.

It then generates the Prisma client, regenerates `android/` with `expo prebuild --clean`, runs `./gradlew bundleRelease`, and writes `apps/mobile/openbeacon-<version>-<versionCode>.aab`. Regenerating `android/` throws away any local edits in it, which `bun run android` recreates anyway.

For a test build, `bun run build-aab --allow-dirty` includes uncommitted changes.

## Code shrinking

Release builds run R8, which removes unused code and renames classes. `expo-build-properties` in `apps/mobile/app.json` turns it on with `enableMinifyInReleaseBuilds` and `enableShrinkResourcesInReleaseBuilds`. Debug builds aren't shrunk, so test a release build after adding or upgrading a native library.

If a library breaks only in release builds, usually with `ClassNotFoundException` or `NoSuchMethodError` in `adb logcat`, add keep rules to `extraProguardRules` in the same plugin entry. Don't edit `android/app/proguard-rules.pro`, because prebuild regenerates it.

The bundle includes R8's mapping file, so Play Console shows readable stack traces in crash reports without a separate upload.

## Check the signature

The build prints the SHA1 of the key it signed with, and fails if the signature doesn't match the key in `credentials.json`. To check a bundle yourself:

```sh
keytool -printcert -jarfile openbeacon-1.14.0-36.aab
```

`keytool` can't read an APK's signature, so check an APK with `apksigner` from the Android SDK build tools:

```sh
apksigner verify --print-certs openbeacon-1.14.0-36.apk
```

`apksigner` prints the SHA1 in lower case without colons.

The SHA1 must match the upload key certificate shown in Play Console under Protected with Play, Play Store protection, Manage Play app signing. If it doesn't, Play rejects the upload with "signed with the wrong key".

## Upload

Upload the `.aab` in Play Console to the track you want, usually Internal testing first.

## Build an APK

To install a release build straight onto a phone without Google Play, build an APK instead. From the repository root or `apps/mobile`:

```sh
bun run build-apk
```

It signs with the key in `credentials.json` and runs the same checks as `build-aab`, including `--allow-dirty`, except that missing Firebase values only print a warning and the APK is built without push. It also needs `apksigner` from the Android SDK build tools in `ANDROID_HOME` to check the signature. It writes `apps/mobile/openbeacon-<version>-<versionCode>.apk`, which you can install with:

```sh
adb install -r apps/mobile/openbeacon-<version>-<versionCode>.apk
```

`adb install -r` refuses an APK with a lower `versionCode` than the copy already on the phone.

Phones that installed OpenBeacon from Google Play have it signed with Google's app signing key, so the APK can't be installed over that copy. Remove it first with `adb uninstall net.openbeacon.app`, which deletes the app's data on that phone.

Google sign-in in the APK only works if the SHA1 of your signing key is registered on the Android OAuth client. See [Building your own version](#building-your-own-version).

## Building your own version

Anyone can build and sign the app with their own key. Google Play only lets one developer publish a package name, so a version published separately from OpenBeacon needs:

- **Its own package name.** Change `android.package` (and `ios.bundleIdentifier`) in `apps/mobile/app.json`.
- **Its own upload key**, created as above and set in `credentials.json`.
- **Its own Google sign-in client**, if you want Google sign-in. Create an Android OAuth client in Google Cloud for your package name and the SHA1 of your Play app signing key (and your upload key, for builds installed without Play), and set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the web client your backend uses.

- **Its own Firebase project**, if you want push. Register your package name in a Firebase project and set the four [Firebase values](#push-notifications) from its `google-services.json`. Your server needs a service account key from the same project. Without one, build an APK and the app works without push.

A build you only install yourself can keep the package name; it just can't be installed over the Play Store version.

The app talks to `https://api.openbeacon.net` unless the user picks another server in the app.
