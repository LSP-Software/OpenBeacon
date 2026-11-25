# Drives

This context covers trips by vehicle that a phone records and shares with its Groups, and the switch that controls recording.

## Language

**Drive**:
One trip by vehicle, recorded by the device that made it and shared with the Groups that device's account shares location history with. It runs from when the vehicle set off until it stopped for good, arrived at a Place, or the device stopped recording; short stops in traffic or to drop someone off stay inside it. Walking and cycling are never Drives. Buses, trains and taxis can be, until they are marked as a Passenger drive or deleted. Each device records its own Drives, so a phone and a tablet in the same car make two. Any device on the account can delete a Drive, which removes it for every Group for good.
_Avoid_: Trip, journey, ride, drive record

**Passenger drive**:
A Drive marked "I was a passenger" on one of its account's devices. Other members still see the Drive, but not its score or Driving events. Only the device that recorded the Drive can undo the mark.
_Avoid_: Passenger trip, ride, not driving

**Driving event**:
One moment in a Drive that counts against the driver: hard braking, rapid acceleration, speeding or phone use. Each has its own time and position. A Passenger drive shows none.
_Avoid_: Behaviour event, incident, alert, violation

**Driving score**:
A number from 0 to 100 for one Drive, or for one person's week of Drives, worked out on the viewer's phone from the Drive's Driving events and Checked distance. Fewer and milder Driving events per Checked distance give a higher score. A Passenger drive has none.
_Avoid_: Safety score, risk score, rating, grade

**Checked distance**:
The part of a Drive's distance the device watched closely enough to look for hard braking, rapid acceleration and speeding. Distance driven while the device was saving battery is recorded but not checked, so it holds no such Driving events and the Driving score counts only Checked distance.
_Avoid_: Scored distance, monitored distance, covered distance

**Speed limit pack**:
The road speed limits for one region (a country, or part of one when a country is too large), kept on a device so it can check a Drive for speeding without asking anyone where it went. A device holds packs only for regions it has been in while Drive detection was on, and fetches each pack whole, never during a Drive. Each road's limit is posted (signed on the road), set by the road type, or unknown; speeding is only checked against a posted or road-type limit.
_Avoid_: Speed limit tiles, limit data, speed map, region download

**Weekly driving report**:
One person's Drives from Monday to Sunday in that person's time zone: how many, how far, how long, top speed, Driving score and Driving events, compared only with their own previous week. Each viewer sees the part of the week that person shares with them. Passenger drives are listed apart and count towards nothing.
_Avoid_: Weekly summary, driver report, weekly digest

**Drive detection**:
A device's switch for recording Drives, shown on the phone as "Drive detection". It is on unless the device turns it off, and only that device can change it. While it is off the device records nothing about driving, and other members see "Drive detection is off" where that person's Drives would be.
_Avoid_: Drive tracking, driving mode, crash detection

**Drive alert**:
A notification on a Group member's phone that someone has just finished a Drive, giving its distance, duration and top speed, never its Driving score or Driving events. Members only get one for a Drive that ended in the last 30 minutes. The driver chooses per Group whether their Drives send them; members of a Group they don't send to see "Drive alerts are off". Each member can turn Drive alerts off or mute one person or everyone in a Group. Nothing alerts members when a Drive starts or while it is under way.
_Avoid_: Drive notification, trip alert, drive started alert

**Crash alert**:
A message a device sends to every Group it shares location with after it suspects a crash during a Drive and nobody on it answers "I'm OK" before a countdown ends. It says when and where, and how fast the vehicle was going. It goes only to Group members, never to emergency services. A device sends Crash alerts only while its "Crash alerts" switch is on, which needs Drive detection on; only that device can change the switch, and other members see "Crash alerts are off" when it isn't. Passenger drives send them too.
_Avoid_: Crash detection, collision alert, SOS, emergency alert

## Notes

- See [ADR 0003](../../adr/0003-drives-encrypted-per-group-at-fixed-size.md) for how a Drive is encrypted for each Group and why every one is the same size.
- See [ADR 0004](../../adr/0004-speed-limit-packs-whole-regions-on-the-phone.md) for why speed limits come from whole-region packs on the device.
