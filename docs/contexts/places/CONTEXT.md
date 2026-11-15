# Places

This context covers group-shared Places and the arrive/leave language around them.

## Language

**Place**:
A named circular area shared by a Group, defined by a centre, radius, name, and emoji. Its Place geometry is end-to-end encrypted; its name and emoji are plain text. A Place belongs to the member who created it: deleting that account deletes the Place, its Place Transitions and its Place Alert Mutes. Leaving or being removed from the Group keeps it.
_Avoid_: Geofence, zone, location, pin, fence

**Place geometry**:
The encrypted part of a Place: its centre and a radius of 100 to 1000 metres in steps of 25.
_Avoid_: Fence, bounds, shape

**Place Transition**:
A record that one device arrived at or left a Place. The two kinds are Arrive and Leave. It belongs to the device that detected it, not to the member.
_Avoid_: Geofence event, enter/exit, fence trigger, check-in/check-out

**Arrive**:
A Place Transition kind meaning the device entered the Place.
_Avoid_: Enter, check-in

**Leave**:
A Place Transition kind meaning the device exited the Place.
_Avoid_: Exit, check-out

**Place Alert**:
A notification on a Group member's phone about another member's Place Transition. It names the Place, the member and the device. The receiving phone writes the text itself, using its own nicknames, when the Place Transition arrives with its next tracking upload. There's no push in v1.
_Avoid_: Push, banner, toast, geofence notification

**Place Alert Mute**:
A recipient’s choice not to be notified about a particular member’s Place Transitions at a particular Place.
_Avoid_: Notification setting, silence, block, filter, preference

**Place Sharing**:
A device's per-Group switch for sending its Place Transitions, shown on the phone as "Share arrivals and departures" and in code as `PlaceSharing`. It is on unless the device turns it off, and only that device can change it. While it is off the server refuses the device's Place Transitions for that Group, and after it is turned back on it still refuses any that happened while it was off. Other members see "Arrivals off" next to the device.
_Avoid_: Arrivals setting, transition sharing, place privacy

**Dwell**:
The time a device must remain inside or outside a Place before a Place Transition is recorded.
_Avoid_: Hysteresis, debounce, delay, timeout, grace period

## Multiple devices

A member can have more than one Active device. Each device detects its own Place Transitions, and each one gets its own Place Alert that names the device. A member who carries a phone and a tablet into a Place sends two Place Alerts, one per device.
