# Live location updates

How often a sharing phone sends its location, and how the map draws people between updates.

## How often a phone uploads

A moving phone takes a fix every 10 seconds. Each fix queues a live-only row for the map, and the phone uploads with the fix nearest the time the upload is due, so every interval below except the battery saver one has 5 seconds taken off it.

| Phone state                                              | Upload due                                       |
| -------------------------------------------------------- | ------------------------------------------------ |
| Moving, with a speed reading                             | After 100 m of travel, between 10 and 60 seconds |
| Moving, judged by distance (no speed or a poor fix)      | Every 60 seconds                                 |
| Moving, with Save battery on                             | Every 60 seconds                                 |
| Not moving                                               | Every 60 seconds, if there is something to send  |
| Phone battery saver on, or battery 15% or less unplugged | Every 120 seconds                                |

So a walker uploads about once a minute, a cyclist about every 20 seconds, and anything at 36 km/h or more every 10 seconds. A phone that isn't moving queues a fix after it has moved 25 m, or every 5 minutes.

The rule lives in `CaptureSamplingPolicy`, once for Android (`capture/CaptureSamplingPolicy.kt`) and once for iOS (`ios/Core/CaptureState.swift`). Change both together.

Save battery while moving is a switch in Account → Save battery while moving. It is stored on the phone by the native module (`isLowPowerMode`, `setLowPowerMode`), never sent to the server, and only the person holding the phone can change it. It only changes how often the phone uploads. The phone still takes a fix every 10 seconds while moving.

## When a phone counts as moving

A phone counts as moving from 0.5 m/s, so a slow walk gets a fix every 10 seconds. The phone trusts the fix's speed only when the fix is accurate to 20 m or better, because a phone sitting indoors often reports a small speed from a poor GPS fix.

When the speed is missing or the fix is less accurate than that, the phone counts as moving if it has gone at least 25 m from its last queued fix, after taking off the fix's accuracy, at 0.5 m/s or more. A Wi-Fi or mobile network fix that jumps 40 m with 30 m accuracy doesn't count.

## History points on walks

The history filter keeps a point when a straight line between kept points would be more than 8 m from a fix, or 1.5 seconds of travel if that is more. Below about 5 m/s the 8 m applies, so walks and slow rides keep their bends. In the tests, a 30-minute walk with ±4 m of GPS noise kept 15 to 21 points.

## Server work per upload

Uploads less than 50 seconds apart carry points and place arrivals and departures only. The phone sends the account sync and asks for place alerts and group notices with one upload at most every 50 seconds, as it did when every upload was a minute apart. The server returns the tracking key state (`keyState`) only on an upload that asks for alerts or notices.

The server limits `groupTracking.uploadBatch` to 1,000 requests a minute per account, which covers 10 phones in 16 groups at the fastest rate. Uploads that ask for alerts or notices also count against a limit of 120 a minute per account. Over that limit the server still stores the points and place arrivals and departures, and leaves the alerts, notices and key state out of the response.

## How the map draws people between updates

The map polls every 5 seconds. A pin doesn't jump to a new location. It glides there (`apps/mobile/lib/liveMapPinGlide.ts`), taking as long as the person took between their last two locations plus 2 seconds, so the next update usually arrives as the pin gets there and the pin keeps moving.

- The pin only ever moves between locations the phone reported. It never runs ahead, and it stops at the last location when updates stop.
- The pin is behind the person by about one update: 12 to 16 seconds for someone driving, about a minute for someone walking. The person sheet still shows the time of their newest location.
- A pin that is still on its way when a newer location arrives heads for the newer one from where it is drawn.
- These are shown straight away instead of gliding: a move of less than 5 m, a location more than 3 minutes after the previous one, a location with a time that isn't later, and a location that arrives more than 30 seconds later than the gap between fixes explains, which is what happens after the map has been closed or the app was in the background. A glide never takes longer than 90 seconds.
- Moving across the date line takes the short way round.

Stacked pins move by the average of their members' movement. Your own pin follows this phone's location without gliding. With Reduce motion on, every pin is shown at its reported location.

All gliding pins and the camera share one frame loop (`components/map/liveMapFrameTicker.ts`). It only runs while something is gliding and the map screen is focused. A pin redraws when it has moved at least 1 pixel.

While a person is selected, the camera follows where their pin is drawn. It waits for any camera animation the map started, such as flying to a person, and aims that animation at where the pin will be when it ends. The person the camera is following never gets an edge chip.

In simulated journeys with updates every 10 seconds the pin stayed a mean 2 m from the route the person took (5 m on a motorway), and never moved backwards.
