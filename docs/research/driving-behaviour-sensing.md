# What phone sensors can detect about driving behaviour

Research for OPE-380, part of the Wayfinder map OPE-377 (record drives with distance, speed and driving behaviour). Researched 24 Nov 2026.

Question: on Android and iOS, how reliably can a phone in a pocket, cupholder or mount detect hard braking, rapid acceleration and phone use while driving, what does each signal need, and what do telematics vendors and insurers publish about their methods?

## Short answer

- **Braking and acceleration:** use GPS speed change as the main signal, with the accelerometer only to confirm and time an event. A raw accelerometer threshold on a loose phone does worse than chance in Google's large study. GPS speed works, but only with about 1 fix a second during a drive. OpenBeacon takes a fix every 10 s while moving today, which is too coarse.
- **Thresholds:** the industry clusters around 7 mph/s (about 0.32 g, 3.1 m/s²) for a hard brake. Fleet vendors use 0.34–0.56 g depending on vehicle. Google's research label for a hard brake was −5 m/s² (about 0.5 g). Rapid acceleration uses similar or slightly lower numbers.
- **Phone use:** both platforms can tell when the screen is unlocked and when a call is active. Android can also see screen on/off. Neither can tell the driver from a passenger, and that is the biggest accuracy problem. Seeing which app is in use needs Android's usage access, a special permission the user turns on in Settings. iOS has no equivalent outside Apple's research-only SensorKit.
- **Recommendation:** record hard braking and rapid acceleration from 1 Hz GPS speed while a drive is detected, with an accelerometer check. Record phone use only as "phone unlocked or call held by hand while moving above about 15 km/h", never which app. Let the person mark a drive as "I was a passenger", which removes phone use and scoring from that drive.

## Hard braking and rapid acceleration

### What the research shows

Google trained a model on phone sensors from drivers using Google Maps with their phone connected to the car, using the car's wheel speed as ground truth ([Liu et al., "Smartphone-based Hard-braking Event Detection at Scale for Road Safety Services", arXiv 2202.01934](https://arxiv.org/html/2202.01934)):

- A hard brake was labelled when the car's own longitudinal deceleration reached −5 m/s² or below.
- Phone input: accelerometer, gyroscope, linear acceleration and GPS speed, averaged to 10 Hz, in 5 s windows around a peak.
- No orientation correction: the phone could be anywhere in the car and move during the drive.
- Results (PR-AUC, higher is better; hard brakes are rare, so this is the honest measure):
  - Transformer model: 0.833 (ROC-AUC 0.996). Precision 0.96 at 0.2 recall, 0.87 at 0.6 recall.
  - GPS speed heuristic (minimum of GPS-derived acceleration against a threshold): 0.221 (ROC-AUC 0.970).
  - Accelerometer heuristic (largest linear acceleration taken as braking): 0.005 (ROC-AUC 0.482, worse than random). The paper blames phone handling and drops, which a magnitude threshold can't tell from braking.

So a simple GPS speed rule finds most hard brakes but with many false alarms, a raw accelerometer rule is useless, and the best results need a trained model on several sensors. Hand-held phones are the worst case: hand movement swamps vehicle acceleration (MIT CSAIL telematics paper, [people.csail.mit.edu/hari/papers/p169.pdf](https://people.csail.mit.edu/hari/papers/p169.pdf)).

### Orientation

The accelerometer measures in the phone's own axes, so it has to be rotated into the car's frame before "forwards" means anything. The standard method comes from Microsoft Research's Nericell (Mohan, Padmanabhan, Ramjee, SenSys 2008): gravity gives the vertical axis, and a braking episode found from GPS speed gives the forward axis ([Ramjee talk slides](https://microsoft.com/en-us/research/wp-content/uploads/2016/02/ramjee-nericellkaistmar2009.pdf); [US8423255B2](https://patents.google.com/patent/US8423255)). This has to be repeated whenever the phone moves, which the gyroscope can detect. A phone in a pocket shifts with the body, and a phone in a cupholder rattles, so the rotation is never perfect. That is why vendors confirm events with GPS speed.

### Thresholds vendors publish

| Source                                                                                                                                                                    | Hard brake                                   | Notes                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| Progressive Snapshot ([program details](https://progressive.com/auto/discounts/snapshot/snapshot-details/?state=AR))                                                      | speed drop of about 7 mph per second or more | defined on vehicle speed, not raw g |
| Motive fleet ([configurable options](https://helpcenter.gomotive.com/hc/en-us/articles/14972995725213-Configurable-options-in-Unsafe-Behavior-Detection-Safety-Settings)) | 7.46 mph/s (0.34 g) to 12.28 mph/s (0.56 g)  | depends on vehicle make and model   |
| Google research label (above)                                                                                                                                             | −5 m/s² (about 0.5 g)                        | car's wheel speed                   |
| Example in a vendor patent ([USPTO 12236728](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12236728))                                                  | > 2.5 m/s², or > 0.7 g for over 400 ms       | illustrative only                   |

Insurers define the event on speed change over about a second, which suits GPS speed directly. 7 mph/s is 3.1 m/s². A GPS speed rule needs consecutive 1 Hz fixes. At OpenBeacon's current 10 s moving interval (`CaptureSamplingPolicy.MOVING_INTERVAL_MS`) a 2-second hard stop is invisible.

### Platform limits on sensors

- **Android:** since Android 9, background apps get no accelerometer or gyroscope events. A foreground service is required ([Android 9 behaviour changes](https://developer.android.com/about/versions/pie/android-9.0-changes-all)). OpenBeacon already runs a `location` foreground service while sharing, so sensors are available during drives. Apps targeting Android 12+ are capped at 200 Hz through `registerListener` unless they declare `HIGH_SAMPLING_RATE_SENSORS` ([sensors overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)). 10–50 Hz is enough for braking, so the cap doesn't matter. Google's guidance is to pick the slowest rate that works; sensors don't stop when the screen goes off and can drain the battery in hours if left on. Turn them on only during a detected drive.
- **iOS:** Core Motion (`CMMotionManager`) delivers accelerometer and gyroscope data only while the app is running. The app stays running in the background while it receives continuous location updates, the same mode a drive recorder needs anyway. `CMMotionActivity.automotive` gives Apple's own "in a vehicle" guess, but an Apple engineer confirms it is confused by device orientation and vibration ([developer forums 771915](https://developer.apple.com/forums/thread/771915)).
- **Without Google Play services:** Android's Activity Recognition API is part of Play services, so drive start detection on de-Googled phones has to come from our own speed and motion logic. The tracking module also uses the fused location provider today (`TrackingCaptureService.kt`), so a de-Googled phone needs a `LocationManager` path for 1 Hz GPS.

### Battery

GPS dominates. 1 Hz high-accuracy GPS for the length of a drive costs much more than the accelerometer. Most cars charge the phone, which offsets some of it but not all. The accelerometer at 25–50 Hz, held only during a drive and read in batches (`maxReportLatencyUs`) so the CPU can sleep between them, costs little. The 1 Hz GPS rate should start only once a drive is confirmed and stop at the end.

## Phone use while driving

### What each platform exposes

| Signal                                   | Android                                                                                                                                                                                                    | iOS                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Screen turned on / off                   | `ACTION_SCREEN_ON` / `OFF`, runtime-registered receiver only, no permission ([broadcasts](https://developer.android.com/guide/components/broadcasts))                                                      | Not available                                                                                       |
| Phone unlocked                           | `ACTION_USER_PRESENT`, no permission                                                                                                                                                                       | `protectedDataDidBecomeAvailable` notification while the app runs, only if the phone has a passcode |
| Our own app in use                       | yes                                                                                                                                                                                                        | yes                                                                                                 |
| Call active                              | `TelephonyCallback.CallStateListener`, needs `READ_PHONE_STATE` runtime permission on API 31+ ([reference](https://developer.android.com/reference/android/telephony/TelephonyCallback.CallStateListener)) | `CXCallObserver` (CallKit), no permission                                                           |
| Handheld vs speaker/Bluetooth call       | audio route plus proximity sensor                                                                                                                                                                          | audio route                                                                                         |
| Phone moving in the hand while screen on | accelerometer/gyroscope in the foreground service                                                                                                                                                          | Core Motion while running in background                                                             |
| Which other app is in front              | `UsageStatsManager`, needs usage access                                                                                                                                                                    | Not available                                                                                       |
| Typing / taps in other apps              | only through the Accessibility API; not allowed for this                                                                                                                                                   | Not available                                                                                       |

Notes:

- **Usage access** (`PACKAGE_USAGE_STATS`) is a system-level permission. Apps can't request it with a dialog; the user has to turn it on in Settings > Special app access. Google Play's sensitive-permissions policy doesn't list it for a declaration form today, but it sits under the general rule that sensitive access must make sense for the app's core purpose and come with a prominent in-app disclosure ([Play policy](https://support.google.com/googleplay/android-developer/answer/9888170?hl=en)).
- **Accessibility API:** Play says it must not be used where narrower APIs exist ([same policy](https://support.google.com/googleplay/android-developer/answer/9888170?hl=en)). Reading taps in other apps through it would be both a policy breach and the kind of covert capability our consent rules forbid.
- **Call log** permissions are only for default phone or assistant apps on Play, so call numbers and history are out. Call _state_ through `READ_PHONE_STATE` is enough.
- **iOS SensorKit** has phone-usage and app-usage reports, but Apple grants the entitlement only to approved research studies and the data arrives at least 24 hours late ([SensorKit setup](https://developer.apple.com/documentation/sensorkit/configuring-your-project-for-sensor-reading.md); [forum 745100](https://developer.apple.com/forums/thread/745100)). Not usable.

So the common ground on both platforms is: **unlock (or screen on on Android), active call with route, and the phone moving in the hand, while the car moves**. That is enough for a "phone in use" event without knowing what the person did on it.

### What vendors do

- **Zendrive** lists hard brake, hard turn, over-speeding, phone use and phone screen interaction. Phone use needs a gyroscope, which some phones lack. Distraction events are mutually exclusive, ranked handheld call > hands-free call > active distraction > passive distraction (Zendrive SDK event docs; the docs host was unreachable when checked, summary from search).
- **Cambridge Mobile Telematics** measures "phone movement, interaction, and incoming and outgoing calls" ([CMT blog](https://www.cmtelematics.com/reports/measuring-and-pricing-phone-distraction-risk-blog/)). Its distraction metric counts screen tapping while the vehicle moves. CMT's patents describe a distraction episode starting when the phone moves while being interacted with and running on for a period after, with tap rate and screen orientation used to guess mounted vs handheld ([US11485369B2](https://patents.google.com/patent/US11485369)).
- **Minimum duration and speed:** fleet vendors only count interaction above a speed and time floor, for example over 3 s at 11 mph or more, or 5 s at 25 mph or more (vendor help pages found by search: [Compass alert definitions](https://compassbyselective.zendesk.com/hc/en-us/articles/41872025952531-Alert-Definitions), [MediRoutes driver insights](https://support.mediroutes.com/knowledge/driver-insights-infringements)). This cuts out red lights and a quick glance at navigation.
- **Accuracy claims:** none publish precision or recall for phone use. The best outside check is an IIHS-linked study matching about 17,000 police-reported crashes (2021–24) to telematics: telematics showed phone use within 10 s before 4–5% of crashes, against under 1% in police reports ([IIHS](https://www.iihs.org/api/datastoredocument/bibliography/2376)). That shows the signal finds real use, not how often it is wrong.

### Driver or passenger

No public signal on either platform tells a driver's phone from a passenger's. Vendors use trained models (how the phone moves when the person gets in, which side of the car, whether it pairs to the car's Bluetooth) and let the user mark trips as a passenger. Bluetooth pairing to the car is the most useful cheap hint but proves nothing when two people share the car. In a family app this matters more than for an insurer: a teenager in the back seat on their phone would show up to their parents as "using phone while driving".

## Recommendation for OpenBeacon

1. **Braking and acceleration:** during a detected drive, raise GPS to 1 Hz and flag a hard brake when GPS speed falls by about 3 m/s² (7 mph/s) over at least a second, and rapid acceleration at a similar rise. Use the accelerometer (rotated into the car's frame with gravity plus the GPS-found braking direction) to confirm the event and reject GPS jumps, not as the trigger. Keep the thresholds in one shared policy file so Android and iOS give the same results, and test them against recorded drives.
2. **Phone use:** record an event when the phone is unlocked (Android: or the screen is on and the phone is moving in the hand) or a call is held to the ear, while speed is above about 15 km/h, for longer than about 3 s. Don't use usage access, the Accessibility API or SensorKit, and never record which app was open. This keeps the feature the same on both platforms and avoids a Settings permission that would look like monitoring.
3. **Passenger:** a one-tap "I was a passenger" on the drive, available only to the person whose phone recorded it, that removes phone-use and behaviour scoring from that drive for everyone. Consider using car Bluetooth as a hint only.
4. **Wording:** present events as "possible" and never as proof. None of these signals is accurate enough for a family member to treat a single event as fact.

## Things this changes elsewhere on the map

- **Sampling and battery:** behaviour detection needs 1 Hz GPS during drives, ten times the current moving rate. That should feed the drive-detection and battery decisions.
- **De-Googled Android:** drive detection can't use Play's Activity Recognition, and the tracking module's fused location provider also needs a `LocationManager` fallback for 1 Hz fixes.
- **Passenger handling** is a product decision the map should make before scoring and weekly reports, because phone-use and behaviour events are wrong for every passenger drive.
- **Consent:** phone-use events are visible to the group, so on-by-default needs to be clear on the person's own phone, in line with the consent safeguards.
