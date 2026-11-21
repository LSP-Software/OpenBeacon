# Android's Geocoder on phones without Google Play services

Research snapshot: 21 November 2026, for [OPE-363](https://linear.app/open-beacon/issue/OPE-363). Everything here comes from source code and project docs. Nothing was run on a phone.

## Short answer

`android.location.Geocoder` is only as good as the geocoding service the phone's system image ships. Android has none of its own. On a stock phone, Google Play services provides it and Google sees every query. Without that, the outcome depends on the system:

| System | `isPresent()` | A lookup | Who answers and sees the query |
| --- | --- | --- | --- |
| Stock Android with Google Play services | true | works | Google |
| GrapheneOS, geocoder off (the OS default) | false | fails | nobody |
| GrapheneOS, geocoder on | true | works | GrapheneOS's Nominatim server, or OpenStreetMap's if the user picks it |
| GrapheneOS with sandboxed Google Play | same as the row above | same | Play is never the geocoder |
| LineageOS (no add-ons) | false | fails | nobody |
| LineageOS with Google apps flashed | true | works | Google |
| LineageOS for microG, /e/OS | true | works if microG's address lookup is on | `nominatim.openstreetmap.org` (OpenStreetMap Foundation) |
| microG with address lookup off | true | fails with an error | nobody |
| Huawei without Google services | reportedly true | reportedly fails | unknown |

For OpenBeacon that means three things:

1. Address search will be missing on a real share of de-Googled phones. The app needs a working fallback, which is to drop a pin on the map.
2. Where it does work, the query goes to Google, GrapheneOS or the OpenStreetMap Foundation, chosen by the phone and not by us. It never reaches the OpenBeacon server. The privacy wording should say the phone's own address lookup service sees the text typed.
3. `isPresent() == true` doesn't mean a lookup will work (microG with lookup off, Huawei). The app has to handle errors and empty results as well as checking `isPresent()`.

## How Android picks a geocoder

- At boot, `LocationManagerService` binds a geocoder with `ProxyGeocodeProvider.createAndRegister`. If nothing resolves it logs "no geocoder provider found" and keeps the provider null. `isGeocodeAvailable()`, which is what `Geocoder.isPresent()` asks, returns `mGeocodeProvider != null`. ([LocationManagerService, AOSP main](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/location/LocationManagerService.java); [Geocoder.isPresent](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/location/java/android/location/Geocoder.java))
- The provider is a service declaring the action `com.android.location.service.GeocodeProvider`. By default (`config_enableGeocoderOverlay = true`) any system package can supply it. ([ProxyGeocodeProvider](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/core/java/com/android/server/location/provider/proxy/ProxyGeocodeProvider.java); [GeocodeProviderBase](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/location/java/android/location/provider/GeocodeProviderBase.java); [config.xml](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/res/res/values/config.xml))
- The lookup uses `MATCH_SYSTEM_ONLY`, so a user-installed app can never become the geocoder. That rules out sandboxed Google Play on GrapheneOS and microG installed as an ordinary app. ([CurrentUserServiceSupplier](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/core/java/com/android/server/servicewatcher/CurrentUserServiceSupplier.java))
- The check for a provider happens once at boot. If none is found then, `isPresent()` stays false until the phone restarts.

### Android 15 changes

Android 15 replaced the internal plumbing under the `new_geocoder` flag, which is turned on in release builds. The old `GeocoderProxy`/`IGeocodeListener` path became `ProxyGeocodeProvider` with `ForwardGeocodeRequest`/`ReverseGeocodeRequest`, and `GeocodeProviderBase` became the new system API for providers. The old `com.android.location.provider.GeocodeProvider` class still works through an adapter, which is why microG's older-style provider still runs. ([android15-release LocationManagerService](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/services/core/java/com/android/server/location/LocationManagerService.java); [new_geocoder flag value](https://android.googlesource.com/platform/build/release/+/refs/heads/main/aconfig/ap3a/android.location.flags/new_geocoder_flag_values.textproto); [legacy GeocodeProvider adapter](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/location/lib/java/com/android/location/provider/GeocodeProvider.java))

The app-facing behaviour also changed a little when no provider exists:

| Call | Android 14 and earlier | Android 15 and later |
| --- | --- | --- |
| `isPresent()` | false | false |
| Blocking `getFromLocationName` | empty list | empty list |
| Listener `getFromLocationName` | `onGeocode(emptyList)` | `onError(null)` |
| Provider bound but no answer within 15 s | `IOException("Service not Available")` | `IOException(TimeoutException)` |
| Provider returns an error string | `IOException(message)` | `IOException(message)` |

Sources: on Android 14 `getFromLocation` calls `listener.onResults(null, emptyList)` when there is no provider ([android14-release LocationManagerService](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android14-release/services/core/java/com/android/server/location/LocationManagerService.java); [android14-release Geocoder](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android14-release/location/java/android/location/Geocoder.java)). On main the service calls `callback.onError(null)`, and the blocking path's `SynchronousGeocoder` only throws when the error string is non-null, so it returns an empty list ([Geocoder, main](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/location/java/android/location/Geocoder.java)).

## GrapheneOS

- GrapheneOS ships its own geocoder in its bundled Network Location app (`app.grapheneos.networklocation`), added in July 2025. The service declares `com.android.location.service.GeocodeProvider` and extends `GeocodeProviderBase`. ([commit 9e7aeed](https://github.com/GrapheneOS/platform_packages_apps_NetworkLocation/commit/9e7aeede77c59302b54664276e593ece51646e28); [AndroidManifest.xml](https://github.com/GrapheneOS/platform_packages_apps_NetworkLocation/blob/17/AndroidManifest.xml); [GeocodeProviderImpl.kt](https://github.com/GrapheneOS/platform_packages_apps_NetworkLocation/blob/17/src/app/grapheneos/geocoder/GeocodeProviderImpl.kt))
- Settings > Location > Location services > Geocoder offers "GrapheneOS server", "OpenStreetMap server" and "Off". The OS default is Off (`GEOCODER_DISABLED`). Setup wizard shows a switch that sets it to the GrapheneOS server and describes it as a GrapheneOS-hosted service that "some apps need ... for critical functionality". ([GeocoderSettings.java](https://github.com/GrapheneOS/platform_frameworks_base/blob/17/core/java/android/ext/settings/GeocoderSettings.java); [Settings controller](https://github.com/GrapheneOS/platform_packages_apps_Settings/blob/17/src/com/android/settings/location/LocationServicesGeocoderPreferenceController.kt); [setup wizard actions](https://github.com/GrapheneOS/platform_packages_apps_SetupWizard2/blob/17/java/app/grapheneos/setupwizard/action/LocationActions.kt); [setup wizard strings](https://github.com/GrapheneOS/platform_packages_apps_SetupWizard2/blob/17/res/values/strings.xml))
- GrapheneOS changed `isGeocodeAvailable()` so that it returns false when the setting is Off, and also when the calling app lacks the `INTERNET` permission. In both cases a lookup gets an error instead of results. OpenBeacon has `INTERNET`, so only the setting matters. ([commit de76c6a](https://github.com/GrapheneOS/platform_frameworks_base/commit/de76c6aaccceba792d110cc043bbb3ba7b63b2a3); [commit 348d240](https://github.com/GrapheneOS/platform_frameworks_base/commit/348d240bcc95725d81f43071c58469c6541b0547))
- The lookup goes to `https://nominatim.grapheneos.org` or `https://nominatim.openstreetmap.org` with User-Agent `GrapheneOS geocoder 1`, the phone's locale as `Accept-Language`, and the query text. Nothing identifying the calling app is sent. A non-200 response or a parse failure becomes an `IOException`. The "Unable to geocode" response becomes an empty list. ([NominatimGeocoder.kt](https://github.com/GrapheneOS/platform_packages_apps_NetworkLocation/blob/17/src/app/grapheneos/geocoder/NominatimGeocoder.kt))
- GrapheneOS's server list describes `nominatim.grapheneos.org` as a reverse proxy to `nominatim.openstreetmap.org` that "will become our own instance of Nominatim", and separately lists a dedicated geocoding server in Amsterdam (`ams.nominatim.grapheneos.org`). In March 2026 the setting was renamed from "proxy" to "server", which suggests the switch to their own instance has happened. GrapheneOS services follow the EFF Do Not Track policy. ([GrapheneOS servers](https://grapheneos.org/articles/grapheneos-servers); [rename commit](https://github.com/GrapheneOS/platform_packages_apps_NetworkLocation/commit/3e86b0ca8a96c8f2818a93f231547b2d8e22c846); [FAQ: privacy policy for GrapheneOS services](https://grapheneos.org/faq#privacy-policy))
- With sandboxed Google Play: Play is a user app, so it can't be the system geocoder. `Geocoder` calls still go to the OS setting above. The "Reroute location requests to the OS" toggle only affects Play's own location APIs. The GrapheneOS FAQ says geocoding is one of the open Android APIs it will implement itself instead of through Play. ([features: sandboxed Google Play](https://grapheneos.org/features#sandboxed-google-play); [FAQ](https://grapheneos.org/faq))

## microG: LineageOS for microG and /e/OS

- microG's GmsCore has included a geocoder since July 2023 (`OpenStreetMapNominatimGeocodeProvider`). Its service declares `com.android.location.service.GeocodeProvider`. Because it must be a system app, this only applies to ROMs that build microG into the system image. ([provider source](https://github.com/microg/GmsCore/blob/master/play-services-location/core/provider/src/main/kotlin/org/microg/gms/location/provider/OpenStreetMapNominatimGeocodeProvider.kt); [GeocodeProviderService.kt](https://github.com/microg/GmsCore/blob/master/play-services-location/core/provider/src/main/kotlin/org/microg/gms/location/provider/GeocodeProviderService.kt); [manifest](https://github.com/microg/GmsCore/blob/master/play-services-location/core/provider/src/main/AndroidManifest.xml))
- The server is hardcoded to `nominatim.openstreetmap.org` with User-Agent `microG/<version>` and the locale's language. Forward lookups send the query text, `limit=maxResults` and a `viewbox` when the app passes bounds. The calling app's identity is not sent. It waits 5 seconds, and a timeout returns the error "timeout reached", which `Geocoder` turns into an `IOException`.
- If the user has switched off microG's address lookup setting (`location_geocoder_nominatim`), every lookup returns the error "address resolver is disabled in microG settings". The provider is still bound, so `isPresent()` stays true. The built-in default is off unless the ROM ships a defaults file. ([SettingsProvider.kt](https://github.com/microg/GmsCore/blob/master/play-services-base/core/src/main/kotlin/org/microg/gms/settings/SettingsProvider.kt); [LocationSettings.kt](https://github.com/microg/GmsCore/blob/master/play-services-location/core/base/src/main/kotlin/org/microg/gms/location/LocationSettings.kt))
- LineageOS for microG ships `microg.xml` with `location_geocoder_nominatim = true`, so lookups work out of the box. ([lineageos4microg microg.xml](https://github.com/lineageos4microg/android_vendor_partner_gms/blob/master/GmsCore/microg.xml))
- /e/OS's GmsCore fork uses the same provider with the same hardcoded `nominatim.openstreetmap.org`, and an /e/ backlog issue confirms that address lookups on /e/OS "go through microG that is using Nominatim". I couldn't read /e/'s shipped defaults file, so whether lookup is on by default there is unconfirmed. In practice the Gallery issue suggests it is on. ([e/os/GmsCore](https://gitlab.e.foundation/e/os/GmsCore/-/blob/main-rebased/play-services-location/core/provider/src/main/kotlin/org/microg/gms/location/provider/OpenStreetMapNominatimGeocodeProvider.kt); [e/backlog#7599](https://gitlab.e.foundation/e/backlog/-/issues/7599))
- The old standalone UnifiedNlp "NominatimGeocoderBackend" is superseded. Its last F-Droid update was 2017. ([F-Droid](https://f-droid.org/en/packages/org.microg.nlp.backend.nominatim/))

## LineageOS without add-ons

Official LineageOS ships no geocoder. A search of the LineageOS GitHub organisation finds `com.android.location.service.GeocodeProvider` only in the framework itself, not in any app, so `isPresent()` is false and lookups fail. If the user flashes Google apps, Google Play services becomes the geocoder as on stock Android. This conclusion comes from a code search and not a device test. ([LineageOS android_frameworks_base](https://github.com/LineageOS/android_frameworks_base))

## Huawei phones without Google services

I found no primary source. Huawei documents its own HMS Location Kit and Site Kit geocoding instead of `android.location.Geocoder`. Developer reports from 2020–21 (P40 era) say `isPresent()` returns true but `getFromLocation` throws `IOException: Service not Available` or returns empty. That is consistent with a bound provider that never answers. Treat it as likely broken and unverified. ([Stack Overflow 63156569, archived](https://kaweah.freedombox.rocks/kiwix/stackoverflow.com_en_all_2023-11/questions/63156569/reverse-geocode-a-lat-long-coordinate-using-geocoder-on-a-hms-device); [Huawei geocoding Web API](https://developer.huawei.com/consumer/en/doc/HMSCore-Guides/web-api-geocoding-0000001078097838))

## Who sees the query on OpenStreetMap's Nominatim

- The OSM Foundation's Nominatim usage policy allows at most 1 request per second, needs an identifying User-Agent, and forbids search-as-you-type. Apps must not autocomplete against it on the client. ([Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/))
- The OSMF privacy policy says its services collect IP address and request details, may analyse Nominatim data (for example to find missing addresses), give no retention period for server logs, and share nothing except with service providers such as its CDN or where required by law. ([OSMF privacy policy](https://osmfoundation.org/wiki/Privacy_Policy))
- The phone's IP and the typed text reach the OSMF. The OpenBeacon server sees nothing. The app identity isn't sent by either GrapheneOS or microG.

## What this means for the OpenBeacon app

The app uses `expo-location` 55.1.4. Its Android `geocodeAsync`:

- Needs foreground location permission and throws `LocationUnauthorizedException` without it.
- Throws "Could not find the Geocoder" when `isPresent()` is false.
- Calls the deprecated blocking `getFromLocationName(address, 1)`. So it asks for one result, passes no bounds, and returns only latitude and longitude (no address text). An empty list is a normal outcome, and provider errors come back as a rejected promise.

([LocationModule.kt](https://github.com/expo/expo/blob/main/packages/expo-location/android/src/main/java/expo/modules/location/LocationModule.kt))

Design consequences:

- Treat "no geocoder", "error" and "no results" as one state: show that address search isn't available on this phone and let the user place the pin on the map.
- Run the search on submit, not on every keystroke. Every de-Googled route ends at a Nominatim instance whose policy bans autocomplete, and GrapheneOS's own server is volunteer-run.
- To show several matches, pass a bounding box near the map view, or show an address instead of bare coordinates, the app needs its own small native call to `Geocoder` (the listener API on Android 13+). `expo-location` can't do either.
- Privacy wording: address search uses the phone's own lookup service, such as Google on most phones or OpenStreetMap on many de-Googled ones. That service sees the text typed and the phone's IP address. The OpenBeacon server never does.

## Not verified

- No device tests. Each row of the table should be checked on a phone: a GrapheneOS Pixel with the setting on and off, /e/OS, LineageOS for microG, and plain LineageOS.
- /e/OS's default for microG address lookup.
- Huawei behaviour on current EMUI or HarmonyOS builds.
