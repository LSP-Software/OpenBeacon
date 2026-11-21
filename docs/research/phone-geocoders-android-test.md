# Android Geocoder: UK test results

Run on 21 Nov 2026 for OPE-368, on the `pixel_8_api_35` emulator (Android 15, Google Play image `sdk_gphone64_x86_64`, so Play services answers just as it would on a Google phone). A throwaway app called `Geocoder.getFromLocationName(query, 5, [box,] listener)` with `Locale.UK`. The source and raw output are in [`phone-geocoders-android-test/`](phone-geocoders-android-test/).

The test boxes were 0.5° boxes, as decided in OPE-365: north London (51.5,-0.5 to 52.0,0.0), Manchester (53.25,-2.5 to 53.75,-2.0) and Cornwall (50.0,-5.0 to 50.5,-4.5).

## Findings

1. **It works, and it's fast.** `isPresent()` was true, and every call answered in about 50 to 130 ms after a 1 s first call.
2. **The bounding box is a hard filter.** "Eden Project" with no box or the Cornwall box returned Bodelva PL24 2SG. With the London box it returned nothing. "Tesco Barnet" with the Manchester box returned nothing. So the OPE-365 retry without the box is needed.
3. **Usually one result.** Even with `maxResults = 5`, every query returned 0 or 1 results, except "High Street" in the Manchester box, which returned 3.
4. **Named places resolve to the right spot, but the name is never returned.** `featureName` holds a house number, a street, a postcode or a locality, never the place's name. `premises` was always null, and `phone`, `url` and `extras` were always empty. The app has to build the label from the user's query plus the address.

| Query | Result | Right? |
| --- | --- | --- |
| Tesco Barnet | 64–66 High St, Chipping Barnet EN5 5SJ | yes, house level |
| Underhill School (London box, or "… Barnet" with no box) | 215 Mays Ln, Barnet EN5 2LZ | yes |
| Barnet Hospital | Wellhouse Ln, Barnet EN5 3DJ | yes, street level |
| British Museum | Great Russell St, London WC1B 3DG | yes, street level |
| Eden Project | Bodelva, Par PL24 2SG | yes |
| St John's Church of England Primary School Whetstone | "Whetstone, London, UK" (area centre) | **no**: quietly fell back to the area |
| SW1A 1AA, EN5 3DJ, M1 1AE | postcode centre | yes |
| EN5 (outward code) | Barnet EN5 | area |
| 10 Downing Street, London | 10 Downing St SW1A 2AA | yes, house level |
| 221B Baker Street | Baker St, London (no number) | street only |
| 12 Wood Street (London box) | 12 Wood St, London E17 3HT | yes; one of several Wood Streets |
| Tesco, Sainsbury's (London box); Tesco Extra (Manchester box); primary school (London box) | nothing | category or chain searches don't work |
| High Street (no box, London box) | nothing | |
| High Street (Manchester box) | 3 streets (Tyldesley, Lancashire, Manchester) | |
| asdkjhqwe | nothing | |

## What this means for the design

- **Label results from the address, never from `featureName`.** Show `getAddressLine(0)`. The query can serve as the suggested Place name.
- **How precise a result is can be read from the fields that are filled in:** `subThoroughfare` means house, `thoroughfare` alone means street, postcode only means postcode centre, and `locality`/`subLocality` only means an area. The St John's case shows the geocoder can silently fall back to an area, so the screen should make a coarse result obvious (for example, by showing the address line and letting the user move the pin).
- **There's no browsing by category.** "Tesco" or "primary school" near me returns nothing. Users have to type a specific name, an address or a postcode.
- **Results are a single best guess, not a list to choose from.** The results UI is mostly "here's where we think it is, move the pin if it's wrong".
