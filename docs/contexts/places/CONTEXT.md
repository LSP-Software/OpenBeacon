# Places

This context covers group-shared Places and the arrive/leave language around them.

## Language

**Place**:
A named circular area shared by a Group, defined by a center, radius, name, and emoji.
_Avoid_: Geofence, zone, location, pin, fence

**Place Transition**:
A record that a Group member arrived at or left a Place. The two kinds are Arrive and Leave.
_Avoid_: Geofence event, enter/exit, fence trigger, check-in/check-out

**Arrive**:
A Place Transition kind meaning the member entered the Place.
_Avoid_: Enter, check-in

**Leave**:
A Place Transition kind meaning the member exited the Place.
_Avoid_: Exit, check-out

**Place Alert**:
A notification to a Group member about another member’s Place Transition.
_Avoid_: Push, banner, toast, geofence notification

**Place Alert Mute**:
A recipient’s choice not to be notified about a particular member’s Place Transitions at a particular Place.
_Avoid_: Notification setting, silence, block, filter, preference

**Dwell**:
The time a member must remain inside or outside a Place before a Place Transition is recorded.
_Avoid_: Hysteresis, debounce, delay, timeout, grace period
