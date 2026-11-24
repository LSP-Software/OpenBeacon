# Drives

This context covers trips by vehicle that a phone records and shares with its Groups, and the switch that controls recording.

## Language

**Drive**:
One trip by vehicle, recorded by the device that made it and shared with the Groups that device's account shares location history with. It runs from when the vehicle set off until it stopped for good, arrived at a Place, or the device stopped recording; short stops in traffic or to drop someone off stay inside it. Walking and cycling are never Drives. Buses, trains and taxis can be, until they are marked as a Passenger drive or deleted. Each device records its own Drives, so a phone and a tablet in the same car make two.
_Avoid_: Trip, journey, ride, drive record

**Passenger drive**:
A Drive marked "I was a passenger" on one of its account's devices. Other members still see the Drive, but not its score or Driving events. Only the device that recorded the Drive can undo the mark.
_Avoid_: Passenger trip, ride, not driving

**Driving event**:
One moment in a Drive that counts against the driver: hard braking, rapid acceleration, speeding or phone use. Each has its own time and position. A Passenger drive shows none.
_Avoid_: Behaviour event, incident, alert, violation

**Drive detection**:
A device's switch for recording Drives, shown on the phone as "Drive detection". It is on unless the device turns it off, and only that device can change it. While it is off the device records nothing about driving, and other members see "Drive detection is off" where that person's Drives would be.
_Avoid_: Drive tracking, driving mode, crash detection

## Notes

- See [ADR 0003](../../adr/0003-drives-encrypted-per-group-at-fixed-size.md) for how a Drive is encrypted for each Group and why every one is the same size.
