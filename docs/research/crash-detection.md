# Crash detection research

Research date: 2026-11-24, for OPE-382 under the Wayfinder map OPE-377 (record drives). Already decided on the map: crash detection is in scope, Android and iOS ship together, and drive detection is on by default.

This is research, not legal advice. The legal sections say what the rules are and where they come from. Before OpenBeacon ships anything described as crash detection, a UK lawyer should review the claims, terms and store listing.

## Recommendation

1. **Never call emergency services from OpenBeacon.** Neither platform lets a third-party app do it without a tap (see below), Apple's guideline 5.1.5 forbids using location APIs "to provide emergency services", and false automatic calls are the main harm the big three have caused. Apple's and Google's own crash detection already calls 999 on most supported phones. OpenBeacon should tell people to turn that on, and link to the setting.
2. **Alert the group, not the authorities.** After a suspected crash the phone shows a full-screen-ish prompt with a countdown (about 60 s, like Pixel), sound and vibration. If nobody taps "I'm OK", the phone sends an end-to-end encrypted crash alert to its groups with the last location. The person on the phone always gets the first say, which fits the consent rules.
3. **On iOS, use Apple's crash events where possible.** SafetyKit hands Apple's own crash detection to one authorised app per phone (iPhone 14 or later). It needs an entitlement Apple must grant. Our own detector stays the fallback for older iPhones, for people who pick another app, and if Apple refuses.
4. **Build our own detector from GPS speed plus accelerometer, no microphone.** Gate it on a confirmed drive above about 25 mph (40 km/h), a large deceleration spike, then the phone staying still. Pixel and Apple use sound too, but recording near-crash audio adds a permission, a recording indicator and a privacy story we don't need.
5. **Word it as "may help", never "will detect".** Every big player says it can miss crashes and can false-alarm. Call it something like "Crash alerts", say it doesn't contact emergency services, and say it's no replacement for 999.
6. **Be plain about self-hosted servers.** Without pushes, other members see the alert only when their own phone next uploads, usually a few minutes and sometimes much longer for a phone sitting still. The app should say so on the setting, and the crashed phone should also offer one-tap "Call 999" and "Text someone" buttons, which work on any server.

## How the big three detect a crash

### Apple Crash Detection

Source: [Apple Support, Use Crash Detection on iPhone or Apple Watch](https://support.apple.com/en-us/104959); [SafetyKit docs](https://developer.apple.com/documentation/safetykit).

- **Devices:** iPhone 14 or later on iOS 16+, Apple Watch Series 8, SE (2nd gen) and Ultra on watchOS 9+.
- **Crashes:** front, side and rear impacts and rollovers in passenger cars, SUVs, pickups and minivans.
- **Sensors:** processed on the device. Apple names the microphone, used for "loud sound levels" with no raw audio kept. Apple's launch material (not re-checked here) also described a high-g accelerometer, gyroscope, barometer (cabin pressure change from airbags) and GPS speed.
- **After a crash:** a 10-second alert, then a 30-second countdown with loud whoops and vibration, then an automatic emergency call. The call loops a recorded message every 5 seconds with latitude, longitude and a search radius. Emergency contacts get a Messages text with the location.
- **Limits Apple states:** "Crash Detection cannot detect all car crashes." Contacts aren't texted if Messages isn't the texting app.

### Google Pixel Car Crash Detection

Source: [Pixel Help, Get help in an emergency (Car crash detection section)](https://support.google.com/pixelphone/answer/7055029?hl=en-GB); [Google Store magazine](https://store.google.com/magazine/car-crash-detection).

- **Devices and places:** Pixel 4a or later. 21 countries including the UK and US, only in the SIM's own country, not while roaming. Off in airplane mode and Battery Saver. Not for supervised accounts.
- **Sensors:** "location, motion sensors and nearby sound", needing Location, Physical activity and Microphone permissions. Google says the model was trained against test crashes, and its engineers focused on crashes at a relative speed of 25 mph or more.
- **After a crash:** vibration, alarm and a spoken question. 60 seconds to answer by voice or tap. With no answer it calls emergency services on speaker, plays an automated message with the approximate location, and can start Emergency Sharing to contacts by SMS.
- **Limits Google states:** it may miss crashes, high-impact activities can trigger it, and it can fail on weak signal or during another call.

### Life360

Source: Life360 help pages ([Free Crash Detection](https://support.life360.com/hc/en-us/articles/23053410919063-Life360-Free-Crash-Detection), [False Collision Alerts](https://support.life360.com/hc/en-us/articles/23053549450391-False-Collision-Alerts), [Crash Detection Troubleshooting](https://support.life360.com/hc/en-us/articles/23053524367127-Crash-Detection-Troubleshooting)), [How does crash detection work](https://www.life360.com/learn/how-does-crash-detection-work). The help pages block automated fetches, so the details below come from search excerpts of those pages and can't be quoted directly. Life360's own pages also disagree with each other.

- **Trigger:** phone motion sensors detect "a significant impact" while the vehicle is going at least 25 mph. One page says 25 mph within 5 seconds before the crash, another says 25 mph for at least 30 seconds then a sudden stop. Drive Detection must be on, motion permission on Android, location "Always" on iOS. Battery must be above 10% (another page says 20%). No microphone is mentioned.
- **What it misses:** Life360 says it may not catch fender-benders, rear-end collisions and other minor crashes.
- **After a crash:** a critical alert asks the person if they're OK. Picking "False alarm" within about 5 minutes means the Circle hears nothing. Otherwise Circle members get push and SMS (free) or a phone call (paid).
- **Emergency dispatch:** paid tiers only, in the US, Canada, UK, Australia and New Zealand. Life360's own agents call the person first, then call emergency services for them and pass on the location. This is a human in the loop, not an automated 999 call.
- **False alarms:** sudden stops, jolts, off-roading, skiing, sledding and skydiving. Life360 says it filters some amusement park and ski resort events.

## How often they false-alarm

No vendor publishes a false-alarm rate. What exists is reports from emergency services:

- **US ski areas, winter 2022–23:** Summit County, Colorado, logged 185 automatic crash calls in one week in January 2023, and its interim emergency services director said they very rarely got false calls from Android phones. Pitkin County reported up to 20 a day. ([MacRumors](https://www.macrumors.com/2023/01/14/apple-feedback-on-false-911-calls/), [Entrepreneur](https://www.entrepreneur.com/business-news/apple-crash-detection-is-overwhelming-ski-town-911-centers/444750), [Fox 9](https://www.fox9.com/news/apple-crash-detection-software-triggers-fake-911-calls-first-responders-say))
- **Japan:** a Nagano fire department attributed most of 134 false calls between 16 December and 23 January to iPhone Crash Detection, about 15% of their calls ([PhoneArena](https://www.phonearena.com/news/iphone-crash-detection-false-calls-to-japanese-emergency-services_id145240)).
- **Roller coasters:** Kings Island, Ohio, triggered repeated calls in 2022 ([MacRumors](https://www.macrumors.com/2022/10/09/iphone-14-crash-detection-on-rollercoaster/)).
- **Apple's response:** tuning in iOS 16.1.2 and watchOS 9.2, staff sent to a dispatch centre, and a support page update telling people not to hang up on a false call ([MacRumors](https://www.macrumors.com/2023/04/05/crash-detection-support-document-update/)).
- **UK:** police complaints were about Android's five-press Emergency SOS, not crash detection. In 2023 the NPCC and several forces blamed it for a surge in silent 999 calls, each needing a callback ([Cleveland Police](https://www.cleveland.police.uk/news/cleveland/news/2023/july/android-phone-feature-leads-to-increase-in-abandoned-999-calls/), [ITV](https://itv.com/news/anglia/2023-06-14/spike-in-accidental-999-calls-caused-by-android-software-update)). Police also criticised Apple Watch fall-detection calls ([AppleInsider](https://appleinsider.com/articles/23/07/31/apple-watch-emergency-calls-false-positives-slammed-by-uk-police-chiefs)).

Takeaway for us: false alarms are certain. They cost emergency services a lot, but cost a family group much less, as long as the person can cancel before anyone is told and a cancelled alarm reaches nobody.

## Can a third-party app call or text for help automatically?

### Android

- **Emergency calls: no.** `Intent.ACTION_CALL` "cannot be used to call emergency numbers. Applications can dial emergency numbers using ACTION_DIAL", which only opens the dialer for the user to press call ([Intent reference](https://developer.android.com/reference/android/content/Intent#ACTION_CALL)). `TelecomManager.placeCall` allows emergency calls only from the default or preloaded dialer ([TelecomManager](https://developer.android.com/reference/android/telecom/TelecomManager)). `CALL_PRIVILEGED`, which can, isn't available to ordinary apps ([Manifest.permission](https://developer.android.com/reference/android/Manifest.permission#CALL_PRIVILEGED)).
- **Calling an ordinary number:** possible with `CALL_PHONE`, but calling a family member's phone is a worse version of the push alert we already have.
- **SMS: possible but restricted.** `SEND_SMS` is limited by Play to default SMS handlers, with a temporary exception for "Apps that send SMS alerts in emergency situations" under "Physical safety/emergency alerts", given through a Play Console declaration and review ([Play SMS and Call Log policy](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en)). An SMS is plain text through the carrier, so the message would break the end-to-end rule.
- **Getting Pixel's crash events:** there's no public API.
- **Full-screen alert:** since 22 January 2025, `USE_FULL_SCREEN_INTENT` is on by default only for calling and alarm apps targeting Android 14+. Others must ask the user and cope without it ([Play FGS and full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/13392821)). The existing location foreground service covers running the accelerometer during a drive.

### iOS

- **Emergency calls: no.** Since iOS 10.3 a `tel:` link always shows a confirmation alert ([Apple Phone Links](https://developer.apple.com/library/ios/featuredarticles/iphoneurlscheme_reference/phonelinks/phonelinks.html), [Developer Forums](https://developer.apple.com/forums/thread/775161)).
- **SafetyKit: Apple's crash events.** An app with the `com.apple.developer.severe-vehicular-crash-event` entitlement (by application to Apple) can, with permission, receive Apple's crash events: time, location and whether the system tried to call emergency services. "Only one app on the device can receive Crash Detection events." If Emergency SOS is on, Apple's call runs first and the app gets the event afterwards. Then `SAEmergencyResponseManager.dialVoiceCall` can dial a number with no confirmation, for a short time after the event, but "the system doesn't allow emergency numbers such as 112, 911, or 999" ([SafetyKit](https://developer.apple.com/documentation/safetykit), [dialVoiceCall](<https://developer.apple.com/documentation/safetykit/saemergencyresponsemanager/dialvoicecall(tophonenumber:completionhandler:)>), [entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.severe-vehicular-crash-event)). Apple's request form needs a sign-in, so the eligibility criteria couldn't be read.
- **SMS:** `MFMessageComposeViewController` only fills in a message that the user must send.
- **Critical alerts:** making the family's alert sound through silent mode and Focus needs Apple's critical alerts entitlement, which Apple grants case by case for health, safety and security apps. Third-party guides say this; Apple publishes no criteria. Time Sensitive notifications need no entitlement.
- **Background accelerometer:** Core Motion only delivers while the app is running. The existing background location session during a drive keeps it running, which is how Life360's iOS app needs location "Always".

### Store rules

- **App Store 5.1.5:** "Location-based APIs shouldn't be used to provide emergency services or autonomous control over vehicles". We read this as ruling out an app that contacts emergency services itself, and not group alerts. App Review decides that ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)).
- **App Store 1.4 and 1.4.1:** apps that risk physical harm may be rejected. Health accuracy claims need disclosed data and method. **2.3.1:** no marketing features that don't work. **2.5.14:** a clear indicator when recording with the microphone, another reason to leave sound out.
- **Google Play:** the SMS exception above. The location foreground service declaration needs a video of the user starting the feature. Play's misleading-claims rules also apply to the listing.

## Legal and liability limits

Not legal advice; summaries of the sources.

### Medical device rules (UK MHRA, EU MDR, US FDA)

Software is a medical device only when its maker gives it a medical purpose, such as diagnosing or monitoring a condition ([MHRA, software and AI as a medical device](https://www.gov.uk/government/publications/software-and-artificial-intelligence-ai-as-a-medical-device/software-and-artificial-intelligence-ai-as-a-medical-device), [stand-alone software guidance](https://www.gov.uk/government/publications/medical-devices-software-applications-apps)). Neither the MHRA nor anyone else has guidance naming crash detection. Our inference: detecting a crash and telling family is a safety alert, not a medical purpose, as long as we never say anything about injuries, health or medical response. Fall detection for older people is closer to the line and should stay out of scope.

### Emergency call rules

- **eCall (EU Regulation 2015/758, kept in UK law):** applies to the type approval of new cars with built-in 112 systems, and to licensed third-party eCall services. It doesn't cover phone apps ([EUR-Lex](https://eur-lex.europa.eu/eli/reg/2015/758/2025-11-17/eng/html), [legislation.gov.uk](https://www.legislation.gov.uk/eur/2015/758/contents)).
- **UK:** Ofcom's General Condition C4 puts emergency call duties on phone networks, not apps. The 999 system answers all calls and calls back abandoned ones, so automated false calls cost real police time.
- **US:** 47 U.S.C. §227(b)(1)(A)(i) bans calls to "any emergency telephone line (including any '911' line)" using an autodialer or a recorded voice, except calls "made for emergency purposes" ([Cornell LII](https://www.law.cornell.edu/uscode/text/47/227)). A real crash call would probably count as an emergency purpose. A false one might not, which is a further reason not to auto-call.

Since OpenBeacon won't call emergency services, none of this applies directly. If that changes, it needs its own legal review.

### Product liability and claims

- **UK:** the Consumer Protection Act 1987 covers "goods", and it's unsettled whether app software counts. The Law Commission's consultation (8 October 2026 to 14 January 2027) proposes bringing software and AI in ([Law Commission](https://lawcom.gov.uk/project/product-liability/)). Negligence applies regardless. A trader can't exclude liability for death or personal injury from negligence in a consumer contract ([Consumer Rights Act 2015 s65](https://www.legislation.gov.uk/ukpga/2015/15/section/65)), so a terms clause won't cover a careless detector. Misleading claims fall under consumer protection law.
- **EU:** the new Product Liability Directive (EU) 2024/2853 counts software as a product, applies strict liability for defects, bars contract terms limiting that liability, and must be in national law by 9 December 2026. Free and open-source software supplied outside a commercial activity is excluded. The paid hosted service and the app it serves would very likely count as commercial ([EUR-Lex](https://eur-lex.europa.eu/eli/dir/2024/2853/oj/eng)).
- **US:** state product liability and negligence law. The FTC Act bans deceptive claims, and safety claims need evidence behind them.
- **What follows for us:** the main risk is the claim, not the feature. A feature honestly described as "may help, can miss crashes, doesn't call 999" with sensible defaults is far easier to defend than one sold as protection. Document the detector's design and testing (store reviewers and the EU directive both look at what a product can be expected to do). Don't promise delivery times.

## What happens when the app can't wake other phones

How alerts move today (from `docs/security/beta-1-privacy-draft.md`): alerts reach phones only in the response to their own uploads. The hosted server wakes members' phones with a content-free FCM push about 16 s after an upload. A self-hosted server sends no pushes to the official app, so place alerts arrive "on their next upload, usually a few minutes after the event". Phones that aren't moving upload less often, and earlier work (OPE-286) found gaps of about 9 minutes when stationary.

For a crash alert that means:

| Server                                      | Crashed phone online           | Other members see it                                                                                       |
| ------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Hosted                                      | Uploads straight away          | Within seconds (push wake, high priority), subject to Doze and the OS delivering the push                  |
| Self-hosted, official app                   | Uploads straight away          | On each member's next upload: usually minutes, can be 10+ minutes for a phone sitting still                |
| Self-hosted with their own build + Firebase | Uploads straight away          | Same as hosted                                                                                             |
| Any                                         | Offline (no signal, destroyed) | Nobody until it reconnects. Only Apple's or Google's own crash detection, if on, helps here (it calls 999) |

Options for self-hosted, from cheapest:

1. **Say so.** The setting explains that on this server crash alerts can take several minutes, and recommends turning on the phone's own crash detection. This is needed anyway.
2. **Use the open app.** Members' phones that are open on the map already poll. That doesn't help a phone in a pocket.
3. **On-phone buttons after a crash.** "Call 999" (dialer, one tap) and "Text someone" (prefilled SMS, one tap to send). Work on any server and need no special permission, but need a conscious person.
4. **Automatic SMS from the crashed phone (Android only).** Needs Play's emergency SMS exception, sends location in plain text through the carrier, and isn't possible on iOS. It breaks the end-to-end rule and the Android/iOS parity decision. Not recommended.
5. **Self-host your own Firebase build.** Already supported; documented for those who need fast alerts.

## Privacy and consent notes

- The crash alert is new user data: encrypt its content (location, the fact it was a crash) end to end. The server needs to know only that an urgent wake is due, so the hosted server can send a high-priority push. Update `docs/security/beta-1-privacy-draft.md` with what the server sees, as it does for Update now wakes.
- The person whose phone detected the crash decides first (countdown and "I'm OK"). No other member can turn crash detection on for someone else's phone, per consent rule 4.
- No microphone, so no recording indicator or audio permission.

## Gaps

- No published false-alarm or miss rates from any vendor, and no independent accuracy study was found.
- Apple's SafetyKit entitlement criteria are behind a sign-in. Whether Apple would grant it to a family-location app that alerts people rather than dispatching help is unknown until we apply.
- Life360's exact thresholds couldn't be fetched first-hand and its pages contradict each other.
- Apple's sensor list beyond the microphone comes from launch material, not the support page.
