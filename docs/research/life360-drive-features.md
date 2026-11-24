# Life360 driving features and what users say about them

Research for OPE-378, part of the Wayfinder map OPE-377 (record drives with distance, speed and driving behaviour). Checked 24 Nov 2026.

## Short answer

- **The bar is low on smarts, high on crash alerts.** Life360 flags speeding only above a fixed 80 mph for 30 seconds, counts hard braking and rapid acceleration at about 8 mph in one second, and guesses phone use from the phone moving. It shows top speed, average speed and weekly miles, but gives no driving score in the app. Crash detection is what users praise most.
- **Most of the detail is paid.** Free and Silver get a weekly family summary. Per-drive and per-person reports (all drives, distracted, speeding, braking) need Gold or Platinum. Crash alerts to the Circle are free; emergency dispatch needs Gold or Platinum.
- **The mistakes to avoid:** passenger, bus, train and plane trips logged as the person's own driving; a passenger fix that still counts in the weekly report and often doesn't save; speed spikes like 295 mph; no way to delete drives; driving summaries that stay visible after the person turns off location sharing; and drive detection that only works if the person agrees to send their data to an insurance-data company.

## Sources and how far to trust them

| Kind         | Source                                                                                                                                                                                                 | Notes                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Primary      | Life360 help centre articles, read in full through the help centre's public Zendesk API (`support.life360.com/api/v2/help_center/en-us/articles/{id}.json`), since the web pages return 403 to scripts | Several articles were last updated in 2025 and disagree with each other in places. Disagreements are noted below. |
| Primary      | Life360 UK plans page (`life360.com/en-gb/plans-pricing`) and driving safety page (`life360.com/en-us/driving-safety/`, served as the UK version), fetched 24 Nov 2026                                 | The US plan page redirected to the UK one from this machine.                                                      |
| User reviews | Apple App Store reviews of Life360 (app id 384830320), the newest 500 each from the US, UK, Canada and Australia, Sep 2025 to 22 Nov 2026: 2,000 reviews, 188 mention driving, speed or crashes        | Self-selected reviewers. Quotes are representative examples, not a measured rate.                                 |
| Press        | The Markup (2021, 2022), Texas Attorney General (Jan 2025) and coverage of that suit                                                                                                                   | Allegations in a lawsuit are not findings.                                                                        |
| Secondary    | Price trackers for US prices; hands-on reviews for phone-use false positives                                                                                                                           | Treat as indicative.                                                                                              |

Reddit could not be read: its search API returned 403 and web search returned no Reddit threads. User sentiment here therefore comes from the App Store and press.

## Driving features as they stand

### Drive detection

- Drive Detection "analyzes phone location and activity to determine when each member is driving", and "driving information and events are then shared with the entire Circle". [Drive Detection & Analysis, 23053499870487, updated 6 Oct 2026]
- A drive needs speed over 15 mph; otherwise the app labels it a "Trip". The driving safety page also says drives must cover at least half a mile. [same article; driving safety page FAQ]
- It switches off when the battery is at or below 10%. Another article says 20%, so the help centre contradicts itself. [Drive Detection & Analysis; Drive Detection Alerts, 23053540566551]
- It needs background running, battery saver off, a strong cell signal, and "Always" location. [Drive Detection & Analysis; Crash Detection & Location Sharing, 23053468035095]
- **Drive Detection is powered by Arity**, Allstate's driving-data company. To turn it on you go to Settings → Privacy Center → Trusted Partners → Arity → "Connect to Arity". "Drive Detection, including Crash Alerts, Driving reports, and Drive history, is powered by Arity. These features will be disabled if data sharing with Arity is turned off." [Drive Detection & Analysis; Privacy Center, 23053465742743; Arity, 23053397958551]
- Other movement types (walk, bike, boat, flight) exist only as live map icons, and the help centre says the icons may be wrong. [Movement Icons, 23053397194903]

### Drive summary (per drive)

- Location and drive history: Free 2 days, Silver 7 days, Gold/Platinum 30 days. Each drive opens to a route replay. [Location & Drive History, 23053602225559]
- "Speed detection provides top speed per trip and average speed for Driver Reports." [Driving Speed & Accuracy, 23053597039511]
- Life360 says points can be missed, which can make a trip look shorter and the speed higher than it really was. It says its speed data is not meant as evidence for police or insurers. [same article]
- Drives and driving events **cannot be deleted**, only with the whole account, and cannot be exported. [Location & Drive History; Drive Detection & Analysis]
- History belongs to the account, not the Circle, so a new Circle can see drives from the retention window made while you were in another Circle. [Location & Drive History]

### Events: speeding, hard braking, rapid acceleration, phone use

From In-App Driving Events (23053537048599):

| Event                   | Definition                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Speeding ("High speed") | Over 80 mph for at least 30 seconds. A fixed threshold, not the road's speed limit.                            |
| Hard braking            | Slowing by about 8 mph or more in one second                                                                   |
| Rapid acceleration      | Speeding up by about 8 mph or more in one second                                                               |
| Phone usage             | "texting, phone calls, social apps, or other phone use while driving". Not counted when stopped or hands-free. |

How phone use is detected: "by detecting the movement of the phone including orientation change and locking or unlocking your phone while moving at a driving speed. We cannot detect an actual call or text, hands-free or Bluetooth calls". [Drive Detection & Phone Usage, 23053592166295; driving safety page FAQ] One help article says phone-use events need Gold or Platinum, while the free weekly summary lists phone usage too.

A hands-on review found phone-use events logged while the phone was used only at a stop (secondary, via search summary of airdroid.com and gpsdad.com reviews).

### Scores

- **No driving score is shown in the Life360 app.** It shows counts of events and top speed.
- The only score is the **Arity driving score**, based on "distracted driving, speeding, sudden braking, time of day", normalised per mile so rare events count for little. It is used for personalised insurance quotes if the person opts in, and "high-risk drivers could receive higher rates". [Arity, 23053397958551]

### Weekly reports

- **Weekly Family Driving Summary (free):** one week of top speed, phone usage, high speed, rapid acceleration and hard braking for everyone in the Circle. "Turning off 'Location Sharing' in the app will not prevent the Weekly Family Driving Summary from showing the member's driving history report for the week." [Weekly Family Driving Summary, 23053618281239]
- **Individual Driver Reports (Gold and Platinum):** per person per week: total miles, top speed, all drives, speeding, distracted, rapid acceleration, hard braking, with a calendar to pick past weeks. [Individual Driver Reports, 23292607876887, updated 14 Jul 2026]
- The marketing pages say "Get a weekly snapshot of everyone's driving behavior" and "Who's a speed queen?". The whole Circle sees everyone's driving. [driving safety page]

### Drive notifications

- "Drive Detection Alerts" go to Circle members for anyone who has Drive Detection on, and are set per member under Settings → Smart Notifications → Safe Drive Notifications. [Drive Detection Alerts, 23053540566551] The help centre does not list exactly which events trigger a notification. App reviews mention "set off" and "arrived" notifications and crash alerts.

### Passenger marking

- "You are automatically listed as the driver for each of these events, however, you can change your role to passenger": open the drive, tap the car icon, pick the role.
- "Changing the role to passenger will not exclude the data for that driving event from weekly driver reports." [Change from Driver to Passenger, 23053640152215]
- There is no automatic passenger detection and no public transport mode.

### Crash detection

- Uses phone sensors to detect "a significant impact" when the vehicle was going at least 25 mph within 5 seconds before the impact. It "may not detect fender-benders". Needs Drive Detection on, crash detection on, battery over 10%, power saving off, good signal, and Always location, Motion and Notifications permissions. It has not been tested on motorbikes or scooters. A phone call during the crash may delay or block detection on some carriers. [Life360 Free Crash Detection, 23053410919063, updated 7 Nov 2026; Crash Detection Troubleshooting, 23053524367127]
- **Free:** Life360 contacts you and your emergency contacts; the Circle is notified. [Free Crash Detection; Circle Admin and Member Permissions]
- **Paid:** a 24/7 dispatcher calls the driver, sends police or ambulance, and phones Circle members and emergency contacts until one answers. Which plans get dispatch is inconsistent: Gold and Platinum in US/CA/UK/AU/NZ per the Nov 2026 article; "paid members" (which would include Silver) per the July 2025 article. [Free Crash Detection; Crash Detection with 24/7 Emergency Dispatch, 23053382766487]
- False alarms (dropped phone, roller coaster, skydiving): the app may ask "was this a false alarm?" right after detection. [False Collision Alerts, 23053549450391]

### What needs a paid plan

UK prices from the plans page, 24 Nov 2026. US prices from secondary trackers (Oct–Nov 2026): Silver $9.99, Gold $16.99, Platinum $24.99 a month.

| Feature                                                         | Free   | Silver (£6.99)                  | Gold (£9.99) | Platinum (£19.99) |
| --------------------------------------------------------------- | ------ | ------------------------------- | ------------ | ----------------- |
| Drive detection, drive list, top speed                          | Yes    | Yes                             | Yes          | Yes               |
| Location and drive history                                      | 2 days | 7 days                          | 30 days      | 30 days           |
| Weekly Family Driving Summary                                   | Yes    | Yes                             | Yes          | Yes               |
| Individual Driver Reports (per-drive events, miles, distracted) | No     | No                              | Yes          | Yes               |
| Crash detection with Circle alert                               | Yes    | Yes                             | Yes          | Yes               |
| Emergency dispatch after a crash                                | No     | Unclear (help centre disagrees) | Yes          | Yes               |
| Roadside / breakdown assistance                                 | No     | No                              | Yes          | Yes               |

## What users praise (App Store reviews, Sep 2025 – Nov 2026)

1. **Crash alerts reaching the family fast.** By far the strongest praise. Examples: "it notified my whole family when my brother got into his car accident"; "Son was in a dead area and phone would not work but the app was able to send an alert"; "told me either dropped phone or had head on collision… it advised exactly where he was". Users value the exact location most.
2. **Seeing how fast family members drive**, mostly parents of new teen drivers: "Love the history of each drive for my 16 yo new driver"; "accountability on their driving speed".
3. **Arrival and departure** as a substitute for "text me when you get there", and not phoning someone who is driving ("When I want to call one of my girls, I look to see if they're driving").
4. **Weekly totals and top speed** as a talking point: "how many kms a week you do when driving to your maximum speed during the drive"; "driving summaries are super helpful to use as a learning tool".
5. **Drive history as evidence** in disputes, such as a police complaint or an employer accident, even though Life360 says not to rely on it.

## What users complain about

1. **Crash detection that stayed silent.** Several 1-star reviews describe real crashes with no alert: a 100 km/h crash into a pole ("didn't even register i went higher than 62kmh"), a 110 km/h crash on Gold ("We met all the 'prerequisites'"), and "Apple immediately detected the crash & dialed 911 … Life360 didn't notify anyone". This is the biggest trust risk because people rely on it.
2. **Passenger, transit and plane trips counted as driving.** "Reads being in the passenger seat as driving"; "incorrectly detects that I'm driving when I'm using public transport"; "IF YOU GET IN A PLANE … YOU COMPLETED A RISKY DRIVE"; "It would be good if people can add what transportation they use like.. bus or train". The passenger fix also fails: "nearly 50% of the time that I changed it to only go back in and see that it didn't save. It skews all of the downstream reporting."
3. **Wrong speeds, both ways.** "told me my boyfriend has gone 295 miles per hour"; "going 96 mph when they are next to me"; "Said I topped at 103 when it was actually 151"; "I did 197km… is always 135". Routes that cut corners or cross water, and "driving when I'm in bed".
4. **Unexplained risky events.** "I am just confused why it says there's a lot of risky events when driving." Phone-use events based on phone movement can't tell a passenger glance or a red-light check from texting.
5. **Feeling watched.** A teen: "Life360 has honestly damaged my relationship with my parents… Why were you driving that fast?" Press coverage describes teens sharing ways to beat the app (CBS Los Angeles). Parents' own praise ("I can be a hands-on parent from the comfort of my couch") shows the same thing from the other side.
6. **Insurance and data selling.** "They give your driving info to insurance companies without your consent"; "with updates … you automatically share data with a third party". This matches the record: Life360 sold precise location data to about a dozen brokers until early 2022, then kept selling precise data to Arity ([The Markup, Dec 2021](https://themarkup.org/privacy/2021/12/06/the-popular-family-safety-app-life360-is-selling-precise-location-data-on-its-tens-of-millions-of-user); [Jan 2022](https://themarkup.org/privacy/2022/01/27/life360-says-it-will-stop-selling-precise-location-data)). In Jan 2025 the Texas Attorney General sued Allstate and Arity for collecting driving data through SDKs in apps including Life360 ([Texas AG release](https://www.texasattorneygeneral.gov/news/releases/attorney-general-ken-paxton-sues-allstate-and-arity-unlawfully-collecting-using-and-selling-over-45)).
7. **Paywalls on safety.** "you don't get emergency dispatch if a crash happens unless you want to pay"; "Crash detection should be a free feature"; constant "unlock individual driver reports" upsells.
8. **Battery and data.** Life360 itself expects about 10% shorter battery life per day and turns on high-precision GPS while driving [Life360 and Battery Usage, 23053716563223]. Reviewers: "They complain that the app uses a lot of data and battery". Battery comes up less often in driving reviews than accuracy does.
9. **Redesigns that hid the drive view.** Late-2026 reviews complain that the new drive details card covers the replay map.

## What this means for OpenBeacon

Bar to match or beat:

- Automatic drive detection with no setup, a per-drive summary (distance, duration, top and average speed, route) and a weekly summary per person. Life360 charges for the per-person detail; giving it to everyone beats them.
- Crash detection that alerts the group with the exact location. Phone-to-group alerts are the part users value most. Emergency dispatch is a paid call-centre service and outside what an E2E app can offer, so the design should say plainly that OpenBeacon tells the group and does not call emergency services.
- An actual per-drive and weekly score would be new: Life360 shows only counts in the app.

Mistakes to avoid:

- **Speeding against a fixed 80 mph.** Users and parents care about the limit on the road. Using speed limits (where the phone can get them without telling the server) would beat Life360. A sustained-time rule like their 30 seconds is still worth copying to ignore GPS spikes.
- **Impossible speeds.** Reject jumps between fixes that imply impossible acceleration before computing top speed; never show a 295 mph top speed.
- **Assuming everyone is the driver.** Detect passenger, bus, train and flight trips where possible (speed profile, stops, altitude, airport and rail geometry). Make "I was a passenger" one tap that reliably saves and **removes the drive from scores and weekly reports**.
- **Undeletable drives.** Let the person delete a drive, and let it leave every report.
- **Drive data that outlives sharing.** In Life360 the weekly summary stays visible after location sharing is off, and history follows you into new Circles. OpenBeacon drives should follow the same pause and per-group history rules as locations.
- **Opaque phone-use events.** Explain each event (when, where, how fast) and count phone use only when the screen is unlocked and in use while moving, not from the phone tilting.
- **Silent crash misses.** Be honest in the app about conditions where detection won't work (low battery, no signal, power saving) and show the person when crash detection is not currently able to run.
- **Insurance-style data sharing.** Life360 ties drive detection to sending raw sensor and GPS data to Arity. OpenBeacon's encrypted on-phone approach is a selling point: say so.
- **Making drivers feel judged by everyone.** The Circle-wide "who's the speed queen" framing is what the teen review objects to. Consider showing the driver their own score first and keeping the wording about safety, not about catching someone.
