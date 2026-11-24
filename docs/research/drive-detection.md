# Drive detection research

Research snapshot: 24 November 2026, for OPE-379 under the Wayfinder map OPE-377. The question: how can Android and iOS tell, while OpenBeacon is in the background, that a drive has started and ended, and what does each way cost in battery?

Nothing here was tested on a phone. Where a source gives no figure, this note says so rather than guessing one.

## Answer

Use the GPS fixes the app already takes. While someone shares their location, OpenBeacon already runs high-accuracy location in the background on both platforms, so a speed rule costs almost no extra battery and works on every phone, including ones without Google Play services. Add the system's motion classifier as a second opinion where it exists (Core Motion on iPhone, Google's Activity Recognition on Android phones with Google Play services), mainly to drop bus, train and cycling trips after the fact. Never depend on it, because on microG it silently returns nothing. Car Bluetooth and Android Auto/CarPlay are not worth building on. No platform can tell a driver from a passenger; only the person can.

## What we already have

- **Android.** `TrackingCaptureService` is a location foreground service that asks the fused location provider from Google Play services (`play-services-location` 21.0.1) for `PRIORITY_HIGH_ACCURACY` fixes. `CaptureSamplingPolicy` asks for a fix every 10 s while moving and every 30 s while still (20 s and 60 s with battery saver or 15% battery). Source: `apps/mobile/modules/openbeacon-tracking/android/.../capture/TrackingCaptureService.kt`, `capture/CaptureSamplingPolicy.kt`.
- **iOS.** `LocationCapture` runs `CLLocationManager` with `kCLLocationAccuracyBest`, no distance filter, `pausesLocationUpdatesAutomatically = false` and `allowsBackgroundLocationUpdates = true`, so the app keeps running in the background while sharing. Source: `apps/mobile/modules/openbeacon-tracking/ios/LocationCapture.swift`.
- **Moving or not.** A fix counts as moving at 0.5 m/s or more when its accuracy is 20 m or better. Without a trusted speed, the phone has to have covered 25 m beyond the fix's accuracy at 0.5 m/s or more. See `docs/development/live-location-updates.md`.
- **Permissions held today.** Fine and background location, foreground service (location), notifications. No physical activity, motion or Bluetooth permission.

So every sharing phone already has a 10-second GPS speed stream whenever it moves. Drive detection gets that for free, and stops when sharing stops or is paused.

## The options

### 1. Speed rules on our own GPS fixes

- **How it works.** A drive starts when trusted speed stays above a car-only threshold for a while, and ends after the phone has been still or walking for a set time.
- **Delay before a drive is noticed.** Set by our own rule. With fixes every 10 s, "above 7 m/s (25 km/h) for 3 fixes in a row" notices a drive within about 30 s of reaching speed. The stretch before the threshold (pulling out of a drive, a car park) can be added back from fixes already queued.
- **False starts.** Speed cannot tell a car from a bus, tram, train or taxi. Fast cycling (road bikes, e-bikes downhill) passes a low threshold for short stretches. A higher threshold, or one that has to be held for longer, cuts cycling but misses slow town driving. Trains are the hardest case: they are as fast as cars and often faster. A rule on top speed or straight-line legs would only catch some of them.
- **How the end is noticed.** A traffic light or a queue is a stop of seconds to a couple of minutes, and a fuel stop is roughly 5 to 10 minutes. A drive should end only after about 5 minutes without driving speed, or sooner once the person walks away (steady walking speed or 25 m+ on foot). Arriving at one of the person's Places can end it straight away. A fuel stop then either splits the trip in two or is kept as a stop inside one drive. That is a product choice, not a detection limit.
- **Background limits and permissions.** None beyond what sharing already needs. Works on GrapheneOS with or without sandboxed Google Play, on microG and on LineageOS, as long as location capture itself works there (see "Surprises").
- **Battery.** No extra sensor cost: the GPS is already on. The only new work is a few comparisons per fix on the phone. Building it as a separate always-on detector, without the sharing service, would be the expensive way. Continuous high-accuracy GPS is the most power-hungry location mode on both platforms (Apple's `pausesLocationUpdatesAutomatically` docs: pausing "powers down the appropriate hardware" to "improve battery life").

### 2. Android Activity Recognition Transition API (Google Play services)

- **How it works.** The app registers for `IN_VEHICLE` enter and exit transitions with `ActivityRecognitionClient.requestActivityTransitionUpdates()` and gets them through a `PendingIntent`. It also covers `ON_BICYCLE`, `RUNNING`, `STILL` and `WALKING`. ([Android: detect when users start or end an activity](https://developer.android.com/develop/sensors-and-location/location/transitions))
- **Delay before a drive is noticed.** Google gives no figure, only that "the latency of event detection might vary by device" (same page). Delivery "may" also be less frequent "if the device is in power save mode". ([ActivityRecognitionClient reference](https://developers.google.com/android/reference/com/google/android/gms/location/ActivityRecognitionClient)) We would have to measure it.
- **False starts.** `IN_VEHICLE` is any vehicle. Google documents no split between car, bus and train. `ON_BICYCLE` is separate, which helps with cycling.
- **How the end is noticed.** An `IN_VEHICLE` EXIT fires when the user "transitions to any other activity", so a long stop can show as `STILL` and end the drive at a traffic light unless we debounce it ourselves.
- **Background limits and permissions.** Results come through a `PendingIntent`, so the app needs no running service to get them. Android 10+ needs the runtime `ACTIVITY_RECOGNITION` ("Physical activity") permission, and the Play services API gives no results until it is granted ([Android 10 privacy changes](https://developer.android.com/about/versions/10/privacy/changes#physical-activity-recognition)). That means one more permission prompt.
- **Battery.** Google calls the Transition API "the preferred way" because it "consumes less power" than polling activity, but publishes no number (ActivityRecognitionClient reference). It runs on low-power motion sensors inside Play services, so it costs little compared with GPS.
- **Phones without Google's Play services:**
  - **GrapheneOS with sandboxed Google Play.** Sandboxed Play is not installed by default, and runs as an ordinary app. GrapheneOS reroutes Play's location requests to its own implementation and warns that "a small subset" of privileged Play features don't work. It lists the Physical activity permission as needed for Google Play services for some location features. ([GrapheneOS usage guide](https://grapheneos.org/usage)) Whether Activity Recognition delivers events there is not documented and would need testing.
  - **GrapheneOS without sandboxed Play, or plain LineageOS.** No Play services, so the client cannot connect and we get nothing.
  - **microG.** The API is a stub. In microG's current source, `requestActivityTransitionUpdates` logs "Not yet implemented" and returns `Status.SUCCESS` without ever sending an event ([microG `LocationManagerInstance.kt`](https://github.com/microg/GmsCore/blob/master/play-services-location/core/src/main/kotlin/org/microg/gms/location/manager/LocationManagerInstance.kt), lines 75–78, repository last updated 12 November 2026). An app cannot tell this apart from "the person never drove", so silence from this API must never mean "not driving".

### 3. iOS Core Motion (`CMMotionActivityManager`)

- **How it works.** `startActivityUpdates(to:withHandler:)` reports a `CMMotionActivity` whenever the motion type changes. It has `automotive`, `cycling`, `walking`, `running`, `stationary` and `unknown` flags plus a `confidence` of low, medium or high.
- **Delay before a drive is noticed.** Apple gives no figure for live updates. For history, it says "a delay of up to several minutes in reported activities is expected". ([queryActivityStarting](<https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager/queryactivitystarting(from:to:to:withhandler:)>))
- **False starts.** `automotive` means a vehicle. Apple does not say it separates cars from buses or trains. `cycling` is its own flag.
- **How the end is noticed.** Apple handles traffic lights directly: "if the user was driving in a car and the car stopped at a red light, the update event … would have both the `automotive` and `stationary` properties set to true". ([CMMotionActivity](https://developer.apple.com/documentation/coremotion/cmmotionactivity)) A drive ends when `automotive` turns false, usually with `walking`.
- **Background limits and permissions.** Live updates "are not delivered while your app is suspended". Only the last one arrives on resume. ([startActivityUpdates](<https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager/startactivityupdates(to:withhandler:)>)) OpenBeacon is not suspended while sharing, because background location keeps it running, so live updates should arrive. The system keeps up to seven days of activity history that can be queried after the fact. It needs `NSMotionUsageDescription` and a Motion & Fitness prompt ([CMMotionActivityManager](https://developer.apple.com/documentation/coremotion/cmmotionactivitymanager)), another permission the person can refuse.
- **Battery.** The motion coprocessor records activity anyway. Apple publishes no figure, but reading it adds no GPS or radio use.
- **Best use for us.** When the speed rule ends a drive, ask `queryActivityStarting` for that time window and check how much of it was `automotive` and how much was `cycling`. That drops cycling and gives a second opinion on the drive without changing how we detect it.

### 4. Other iOS location signals

- `CLActivityType.automotiveNavigation` and `CLLocationUpdate.LiveConfiguration.automotiveNavigation` only tune positioning for a road vehicle. They "might cause the system to pause location updates when the vehicle doesn't move for an extended period of time". ([automotiveNavigation](https://developer.apple.com/documentation/corelocation/clactivitytype/automotivenavigation)) They do not detect drives. `CLLocationUpdate.isStationary` tells us when Core Location stopped updates because the phone is still ([isStationary](https://developer.apple.com/documentation/corelocation/cllocationupdate/isstationary)).
- Significant-change monitoring fires after about 500 m and "no more frequently than once every five minutes" ([startMonitoringSignificantLocationChanges](<https://developer.apple.com/documentation/corelocation/cllocationmanager/startmonitoringsignificantlocationchanges()>)). It is useful only for a low-power design that is not sharing, and too slow to catch a drive's start.

### 5. Car Bluetooth

- **Android.** `BluetoothDevice.ACTION_ACL_CONNECTED/DISCONNECTED` and the A2DP/headset connection-state broadcasts are on the list of implicit broadcasts a manifest receiver can still get in the background ([broadcast exceptions](https://developer.android.com/develop/background-work/background-tasks/broadcasts/broadcast-exceptions)). On Android 12+, talking to paired devices needs the runtime `BLUETOOTH_CONNECT` permission, shown as "Nearby devices" ([Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)).
- **iOS.** Apps get no public Bluetooth-connection event for classic car audio. The only hint is the audio route (`AVAudioSession.routeChangeNotification`, port type `.carAudio`), and developers on Apple's forums report it is unreliable in the background and only shows while audio plays ([Apple forums 116848](https://developer.apple.com/forums/thread/116848), [715244](https://developer.apple.com/forums/thread/715244)).
- **Assessment.** Near-instant and close to free on Android, but only for people who pair their phone with their car. It also needs the person to tell us which device is their car (headphones and speakers send the same broadcasts), plus another permission, and it doesn't work on iOS. Passengers connect too. Not worth building for a feature that is on by default.

### 6. Android Auto and CarPlay

- **Android.** `androidx.car.app.connection.CarConnection` reports `NOT_CONNECTED`, `NATIVE` or `PROJECTION` as `LiveData` ([CarConnection](https://developer.android.com/reference/androidx/car/app/connection/CarConnection)). It works only when the person uses Android Auto, and Android Auto itself needs Google Play services.
- **iOS.** Apple's CarPlay engineer points to the CarPlay scene's connect and disconnect callbacks ([Apple forums 806832](https://developer.apple.com/forums/thread/806832)), which an app only gets with an Apple-granted CarPlay entitlement in a supported category.
- **Assessment.** Reliable when present, but it covers a small share of drives and needs a CarPlay entitlement we don't have. Not worth building.

## Comparison

| Way                          | Notices a drive                       | Buses / trains            | Cycling              | Traffic lights / fuel stops           | Extra permission         | Works without Play services | Extra battery for us   |
| ---------------------------- | ------------------------------------- | ------------------------- | -------------------- | ------------------------------------- | ------------------------ | --------------------------- | ---------------------- |
| Speed rule on our fixes      | ~30 s after reaching speed (our rule) | Can't tell                | Mostly, by threshold | Our hold time (~5 min)                | None                     | Yes                         | ~None (GPS already on) |
| Android Activity Recognition | Not documented; "varies by device"    | Can't tell (`IN_VEHICLE`) | Yes (`ON_BICYCLE`)   | EXIT on any change; debounce it       | Physical activity        | No (microG stub, silent)    | Low                    |
| iOS Core Motion              | Not documented; history "several min" | Not documented            | Yes (`cycling`)      | `automotive` + `stationary` at lights | Motion & Fitness         | n/a                         | ~None                  |
| Car Bluetooth                | On connect (Android only)             | Yes, if it's your car     | Yes                  | Disconnect at engine off              | Nearby devices (Android) | Yes (Android)               | ~None                  |
| Android Auto / CarPlay       | On connect                            | Yes                       | Yes                  | Disconnect                            | Entitlement (iOS)        | No (Android Auto)           | ~None                  |

## Telling the driver from a passenger

No platform API does this. Android's activity types and Apple's `CMMotionActivity` both report "in a vehicle", nothing more. iOS's Driving Focus isn't exposed either: `INFocusStatus` only says whether some Focus is on, not which one ([INFocusStatus](https://developer.apple.com/documentation/intents/infocusstatus)). The available hints are weak:

- The phone connecting to the car's Bluetooth suggests the car's owner, but passengers connect too.
- A phone in use during the drive suggests a passenger, or a driver using their phone. Treating it as either would be wrong often enough to cause harm in a driving-behaviour feature.
- Two group members' phones moving together could be spotted on the phone, which can read both locations. The server can't, because locations are end-to-end encrypted. That says "travelled together", not who drove.

Recommendation: let the person mark a drive as "I was a passenger" (and remember it for that drive only). Don't infer it.

## Recommendation

1. Detect drives with a speed rule inside the existing capture services (`CaptureSamplingPolicy` on Android, `CaptureState.swift` on iOS, changed together). Start: trusted speed at or above about 7 m/s for about 30 s. End: about 5 minutes below driving speed, or sooner when the person walks away or arrives at one of their Places. Tune these with recorded trips.
2. On iPhone, if Motion & Fitness is allowed, check each finished drive against `queryActivityStarting` and drop drives that were mostly cycling or had no automotive time. Without the permission, keep the speed result.
3. On Android with Google Play services, optionally do the same with Activity Recognition. Treat "no events" as "unknown", never as "not driving", because of microG.
4. Don't use Bluetooth or Android Auto/CarPlay to detect drives.
5. Let the person mark a drive as a passenger trip, and let them delete any drive. Expect buses, trains and taxis to show up as drives sometimes, whatever we choose.

## Surprises for the rest of the map

- **Our Android capture already needs Google Play services, or something that implements it.** `TrackingCaptureService` uses only the fused location provider and has no fallback to Android's own `LocationManager`. On GrapheneOS without sandboxed Play, or plain LineageOS without microG, location capture itself should fail, and so would any drive detection built on it. This was found in the code, not tested on a phone. It matters more than which drive detector we pick, if the app is meant to work without Google Play services.
- **"On by default" works without a new prompt only for the speed rule.** Activity Recognition and Core Motion each need an extra permission (Physical activity on Android, Motion & Fitness on iOS), and Bluetooth needs Nearby devices.
- **Drives are only recorded while the person is sharing.** Detection runs inside the sharing service, so pausing sharing or not sharing with anyone means no drives. That fits the consent rules, but the map should say so.
- **The data can't separate drivers from passengers, or cars from buses and trains.** Any driving-behaviour score (harsh braking, speeding) will sometimes be about a bus driver or a taxi. The person needs to be able to mark or delete drives before anything is shown to others.
