# Phone geocoders for Place search

Research snapshot: 21 November 2026, for [OPE-362](https://linear.app/open-beacon/issue/OPE-362) under [OPE-361](https://linear.app/open-beacon/issue/OPE-361). Already decided: address search when adding a Place uses the phone's own geocoder, never a server the operator runs, and results should include named places as well as addresses.

## Short answer

- **iOS** gives us everything we want. `MKLocalSearchCompleter` does as-you-type suggestions for addresses and points of interest. `MKLocalSearch` turns the chosen suggestion into `MKMapItem`s with a business name, category, address and coordinate. Both can be biased to a region, and from iOS 18 they can be restricted to it.
- **Android** gives us a submit-only `Geocoder.getFromLocationName` that returns up to a handful of `Address` objects, with an optional bounding box. It has no autocomplete. Android documents that it accepts place names, addresses and airport codes, but Google documents nothing about which backend answers on Google phones, how good named-place results are, or any rate limit. On phones without Google Play services `Geocoder.isPresent()` can be false and there is no geocoder at all.
- **expo-location is not enough.** `geocodeAsync` returns only coordinates, asks Android for one result, and needs location permission that Android itself doesn't require.
- **No maintained React Native library** fills the gap. The candidates were last published between 2017 and 2021. We should add a small search function to our own native code: Kotlin in `apps/mobile/modules/openbeacon-tracking`, and Swift in the iOS port.
- **Privacy:** nothing reaches the OpenBeacon operator, but the typed search text, any area we bias towards, the locale and the app's package name go to Google (Android) or Apple (iOS). The privacy draft will need a line for this when the feature ships.

## Android: `android.location.Geocoder`

### What it accepts and returns

`getFromLocationName` "Returns an array of Addresses that attempt to describe the named location, which may be a place name such as "Dalvik, Iceland", an address such as "1600 Amphitheatre Parkway, Mountain View, CA", an airport code such as "SFO", and so forth." `maxResults` is "max number of addresses to return. Smaller numbers (1 to 5) are recommended". [Geocoder reference](https://developer.android.com/reference/android/location/Geocoder)

The class carries a warning: "Geocoding services may provide no guarantees on availability or accuracy. Results are a best guess, and are not guaranteed to be meaningful or correct." Results are only "best effort" in the requested locale. [Geocoder reference](https://developer.android.com/reference/android/location/Geocoder)

Each result is an `android.location.Address`, "a simplified version of xAL". Fields useful as a label [Address reference](https://developer.android.com/reference/android/location/Address):

| Getter                                                    | Documented meaning                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `getFeatureName()`                                        | "the feature name of the address, for example, "Golden Gate Bridge""   |
| `getPremises()`                                           | "the premises of the address"                                          |
| `getSubThoroughfare()` / `getThoroughfare()`              | street number / street                                                 |
| `getSubLocality()` / `getLocality()`                      | neighbourhood / town                                                   |
| `getSubAdminArea()` / `getAdminArea()`                    | county / state                                                         |
| `getPostalCode()`, `getCountryCode()`, `getCountryName()` | as named                                                               |
| `getAddressLine(i)` / `getMaxAddressLineIndex()`          | pre-formatted address lines, `-1` if none                              |
| `getPhone()`, `getUrl()`, `getExtras()`                   | optional; extras are "provider-specific"                               |
| `getLatitude()` / `getLongitude()`                        | throw `IllegalStateException` if unset, so check `hasLatitude()` first |

There is no category or "this is a business" field. A named place can only show up as `featureName` or `premises`, and the docs don't say when the provider fills these. Whether "Tesco Extra" or "St Mary's Primary School" comes back as a usable named result is undocumented and needs a test on a real Google phone before we build UI around it.

### Area bias and bounds

The bounding-box overloads take lower-left and upper-right corners: "You may specify a bounding box for the search results by including the latitude and longitude of the lower left point and upper right point of the box." The docs don't say whether the box is a hard filter or a hint. [Geocoder reference](https://developer.android.com/reference/android/location/Geocoder)

In AOSP the overloads without a box pass `0, 0, 0, 0`. [Geocoder.java lines 218, 241](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/location/java/android/location/Geocoder.java)

### Sync vs the API 33 listener form

- The `List<Address>`-returning overloads are deprecated in API 33, "to avoid blocking a thread waiting for results". They "may hit the network, and may block for excessive amounts of time" and should run off the main thread. They throw `IOException` on failure and return null or empty "if no matches were found or there is no backend service available". [Geocoder reference](https://developer.android.com/reference/android/location/Geocoder)
- API 33 added `getFromLocationName(..., Geocoder.GeocodeListener)`. The listener has `onGeocode(List<Address>)` and a default `onError(String?)`. [Geocoder reference](https://developer.android.com/reference/android/location/Geocoder)
- In current AOSP the sync form is a wrapper over the async one that waits on a latch with a 15-second timeout and throws `IOException(TimeoutException)` when it expires. [Geocoder.java `TIMEOUT_MS = 15000`](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/location/java/android/location/Geocoder.java)

Our `minSdkVersion` is 26 (`apps/mobile/app.json`), so we need both: the listener on API 33+, and the sync call on a background thread or coroutine below it.

### `isPresent()` and which backend answers

`isPresent()` "Returns true if there is a geocoder implementation present on the device that may return results. If true, there is still no guarantee that any individual geocoding attempt will succeed." [Geocoder reference](https://developer.android.com/reference/android/location/Geocoder)

The platform has no geocoder of its own. `LocationManagerService` binds to a provider service at startup and logs "no geocoder provider found" when there isn't one. `isGeocodeAvailable()` (what `isPresent()` asks) is simply `mGeocodeProvider != null`. [LocationManagerService.java](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/services/core/java/com/android/server/location/LocationManagerService.java) The provider is any system package that offers `GeocodeProviderBase.ACTION_GEOCODE_PROVIDER`, or the package in `config_geocoderProviderPackageName`, which is `@null` in stock AOSP. [ProxyGeocodeProvider.java](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/services/core/java/com/android/server/location/provider/proxy/ProxyGeocodeProvider.java), [config.xml](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/core/res/res/values/config.xml)

So on a normal Android phone the answer comes from whichever system app ships a provider, which on phones with Google services is Google Play services. A phone without one (AOSP builds, some de-Googled ROMs, Huawei phones without Google services) has no geocoder, unless a replacement system package registers its own provider, in which case results come from whatever service that package uses. The UI needs a fallback for `isPresent() == false`: drop a pin on the map.

### What leaves the phone

The request handed to the provider is a `ForwardGeocodeRequest` holding the search text, the bounding box, `maxResults`, the locale, and the caller's UID, package name and attribution tag. [Geocoder.java lines 324–336](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/location/java/android/location/Geocoder.java), [ForwardGeocodeRequest.java](https://github.com/aosp-mirror/platform_frameworks_base/blob/main/location/java/android/location/provider/ForwardGeocodeRequest.java) The phone's own location is not part of the request unless we put it in as a box. What Google Play services then sends to Google, and what Google keeps, is not documented anywhere we found.

### Rate limits

Android documents none. The only limit in the platform code is the 15-second timeout. Google does not document a per-app quota for the Play services geocoder.

## Apple

### `MKLocalSearchCompleter`: as-you-type

"As the user types text, you feed the current text string into the search completer object, which delivers possible string completions that match locations or points of interest." The completer debounces for us: "You can update this property in real time as the user types new characters into a text field because the completer object waits a short amount of time for the query string to stabilize." It's a long-lived object reporting through a delegate. [MKLocalSearchCompleter](https://developer.apple.com/documentation/mapkit/mklocalsearchcompleter)

- `resultTypes` (iOS 13): `address`, `pointOfInterest`, `physicalFeature`, `query`. [ResultType](https://developer.apple.com/documentation/mapkit/mklocalsearchcompleter/resulttype)
- `pointOfInterestFilter` and `addressFilter` (`MKAddressFilter`, iOS 18, filters by country, region, municipality and so on). [MKAddressFilter](https://developer.apple.com/documentation/mapkit/mkaddressfilter)
- `region`: "Use this property to limit search results to the specified geographic area. The default value of this property is a region that spans the entire world." [region](https://developer.apple.com/documentation/mapkit/mklocalsearchcompleter/region)
- `regionPriority` (iOS 18): `.default` "results can originate from outside the specified region"; `.required` "no results can originate from outside the specified region". [MKLocalSearchRegionPriority](https://developer.apple.com/documentation/mapkit/mklocalsearchregionpriority)

Each suggestion is an `MKLocalSearchCompletion` with only `title`, `subtitle` and highlight ranges, and no coordinate. [MKLocalSearchCompletion](https://developer.apple.com/documentation/mapkit/mklocalsearchcompletion) To get a coordinate, pass the chosen completion to `MKLocalSearch.Request(completion:)`. [MKLocalSearch.Request](https://developer.apple.com/documentation/mapkit/mklocalsearch/request)

### `MKLocalSearch`: submit or resolve

"You might use this class to search for addresses or points of interest on the map." [MKLocalSearch](https://developer.apple.com/documentation/mapkit/mklocalsearch) The request has `naturalLanguageQuery`, `region`, `regionPriority` (iOS 18), `resultTypes`, `pointOfInterestFilter`, `addressFilter`. On the request, `region` is "merely a hint to the search engine" unless `regionPriority` is `.required`. [Request.region](https://developer.apple.com/documentation/mapkit/mklocalsearch/request/region)

Results are `MKMapItem`s. Label fields:

- `name`: "if there's a business at the specified location, use this property to specify the name of the business." [name](https://developer.apple.com/documentation/mapkit/mkmapitem/name)
- `pointOfInterestCategory` (iOS 13): nil if the item isn't a known POI. [pointOfInterestCategory](https://developer.apple.com/documentation/mapkit/mkmapitem/pointofinterestcategory)
- `phoneNumber`, `url`, `timeZone`, `identifier`. [MKMapItem](https://developer.apple.com/documentation/mapkit/mkmapitem)
- Address: `placemark` (a `CLPlacemark`) is deprecated in iOS 26 in favour of `address` (`MKAddress` with `fullAddress` and `shortAddress`), `addressRepresentations` and `location`. [placemark](https://developer.apple.com/documentation/mapkit/mkmapitem/placemark), [MKAddress](https://developer.apple.com/documentation/mapkit/mkaddress)

Our iOS deployment target is 16.0 (`apps/mobile/app.json`), so the iOS code needs `placemark` below 26, `address` from 26, and a soft `region` below 18.

### `CLGeocoder`

Deprecated in iOS 26, along with `CLPlacemark`. MapKit's `MKGeocodingRequest` (iOS 26) replaces it and returns `MKMapItem`s. [CLGeocoder](https://developer.apple.com/documentation/corelocation/clgeocoder), [MKGeocodingRequest](https://developer.apple.com/documentation/mapkit/mkgeocodingrequest) It's an address geocoder, though it "may also return additional information about the specified location, such as a point of interest". For our use `MKLocalSearch` covers everything it does, so we don't need it.

### Rate limits

- `CLGeocoder`: "Geocoding requests are rate-limited for each app, so making too many requests in a short period of time may cause some of the requests to fail", reported as a `network` error. Apple asks for "at most one geocoding request for any one user action" and none while the app is in the background. [CLGeocoder](https://developer.apple.com/documentation/corelocation/clgeocoder)
- MapKit: `MKError.Code.loadingThrottled`, "This error can occur if an app makes frequent requests for data over a short period of time." [loadingThrottled](https://developer.apple.com/documentation/mapkit/mkerror/code/loadingthrottled)

No numbers are published. One `MKLocalSearch` per tapped suggestion or Search press keeps us inside the documented guidance. The completer does its own debouncing.

### What leaves the phone

The search text, the region we set, and the filters go to Apple. `CLGeocoder`'s docs say "the geocoder server uses all the information provided to it when processing the request". [CLGeocoder](https://developer.apple.com/documentation/corelocation/clgeocoder) Apple's Maps privacy page says Maps uses an "identifier that rotates multiple times per hour", not tied to the Apple Account, and that Apple does "not collect or retain personal data associated with your Maps usage", but it describes the Maps app and doesn't say whether it covers MapKit calls from other apps. [Apple Maps & Privacy](https://www.apple.com/legal/privacy/data/en/apple-maps/)

## expo-location (installed: 55.1.4)

From the installed source (`node_modules/expo-location`):

- `geocodeAsync(address)` returns `LocationGeocodedLocation[]` with only `latitude`, `longitude`, `altitude`, `accuracy`. No name or address fields (`android/.../records/LocationResults.kt` `GeocodeResponse`, `ios/Geocoder.swift`).
- Android calls the deprecated sync `Geocoder(...).getFromLocationName(address, 1)`, so at most one result, and throws if foreground location permission is missing or the app is backgrounded (`LocationModule.kt` `geocode`). Android's API needs no permission. That check is Expo's own.
- iOS calls `CLGeocoder.geocodeAddressString`, which is deprecated in iOS 26 and doesn't use MapKit search, so it gives no POIs and no completer.
- `reverseGeocodeAsync` does return labelled fields (`name`, `street`, `city`, `postalCode`, ...), which could label a dropped pin. That is reverse geocoding, though, not search.

The app doesn't use any of these today. There is no geocoding call in `apps/mobile`.

## Existing React Native libraries

| Package                                       | Last version published | What it does                                                           |
| --------------------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `react-native-geocoder` 0.5.0                 | Oct 2017               | Android Geocoder + iOS CLGeocoder, labelled results                    |
| `react-native-geocoder-reborn` 0.9.0          | Feb 2020               | Fork of the above                                                      |
| `@binpar/react-native-geocoder` 0.4.7         | Aug 2017               | Fork                                                                   |
| `react-native-address-autocomplete` 0.4.1     | Mar 2021               | iOS-only `MKLocalSearchCompleter`                                      |
| `@kiwicom/react-native-reverse-geocode` 0.0.7 | Jun 2019               | "wrapper for MapKit's MKLocalSearch and Geocoder's getFromLocatioName" |

(From `npm view <pkg> time`, 21 Nov 2026.) None of these is an Expo module, all predate React Native's new architecture becoming the default, and none uses the API 33 listener or iOS 18 region priority. Everything else we found calls Google Places or another hosted API, which the decision rules out.

## Recommendation

Write it ourselves. It's small:

- **Android (Kotlin, `openbeacon-tracking`)**: one async function `searchPlaces(query, box?)`. It checks `Geocoder.isPresent()`, calls the listener form on API 33+ and the sync form on a background dispatcher below, asks for 5 results, and maps each `Address` to `{ name: featureName ?: premises, addressLines, locality, postalCode, countryCode, latitude, longitude }`. It searches on submit only, because there's no completer and no documented quota.
- **iOS (Swift port)**: `MKLocalSearchCompleter` for suggestions while typing, then `MKLocalSearch(request: .init(completion:))` on tap, mapping `MKMapItem` to the same shape plus `category`.
- **Both**: bias to the visible map area or the phone's last fix, a soft hint by default, and fall back to dropping a pin when there's no geocoder or no results.

## What could undermine the decision

None of this rules out the phone's own geocoder, but three things cut against it on Android:

1. **Named-place quality on Android is unknown.** Nothing from Google says the Play services geocoder returns schools and shops reliably, or which field the name lands in. Test on a real Google phone (UK queries such as a supermarket, a primary school and a postcode) before designing the result list.
2. **Android has no autocomplete.** iOS will feel like Maps, Android will feel like a search box with a Search button. Matching iOS on Android would need a hosted API, which the decision rules out.
3. **Phones without Google services get nothing.** That includes some of the privacy-minded users OpenBeacon attracts. The pin-drop fallback has to be a full path, not an afterthought.

Privacy note: the typed text and any bias area go to Google or Apple. `docs/security/beta-1-privacy-draft.md` names what Google and Apple see, so it needs a line for Place search when the feature ships.
