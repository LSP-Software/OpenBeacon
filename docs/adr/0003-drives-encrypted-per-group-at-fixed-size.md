---
status: accepted
---

# Drives are encrypted per Group, under the Epoch of their start, at one fixed size

A Drive is uploaded as one copy per Group it is shared with. Each copy is encrypted with the Epoch key that was current in that Group when the Drive started, and filed by the UTC hour it started, the same way a history point is filed. Every copy is the same size, about 1 KiB, whatever the Drive holds. Marking a Passenger drive replaces each copy with one of the same size and Epoch, with the Driving events blanked. The terms are defined in the [Drives glossary](../contexts/drives/CONTEXT.md) and the [encryption glossary](../contexts/encryption/CONTEXT.md). This decision was made in OPE-385.

## Considered options

- **Encrypt to the History key.** Rejected. The History key belongs to the driver's account, so other members could never read the Drive.
- **Per-Group copies under the latest Epoch at upload time.** Rejected. A Drive uploads after it ends, so someone who joined the Group halfway through would read where it started, before they joined. Timeline never shows them that.
- **File by the hour the Drive ended.** Rejected. A Drive could then stay visible after its start had left the person's history window, showing a position older than the window.
- **Size buckets (1, 4, 16 KiB) or no padding.** Rejected. The size would tell the server roughly how many Driving events a Drive had, which is close to how well someone drove.
- **Set a passenger flag and leave the events in place.** Rejected. Every member's phone could still decrypt the events, and a modified app could show them.
- **Per-Group copies under the Epoch at drive start, filed by start hour, one fixed size.** This is the option we chose.

## Why

- **The same window as Timeline, enforced the same way.** The server already deletes and withholds points by recorded hour according to each person's history setting for each Group. Filing a Drive by its start hour lets the same rule apply, and nothing in the Drive is older than that hour.
- **Joining rules come from the keys.** A member who joined after a Drive started holds no key for its Epoch, so no app, modified or not, can show it to them.
- **Size reveals nothing.** Up to 48 Driving events keep their positions; counts of each type stay exact beyond that, and only the 48 most severe keep positions.
- **The score can change.** The record holds only inputs. Each viewer's phone works out the score, so a new formula reaches old Drives without re-uploading them.

## Consequences

- The server sees that a Drive exists, in which Group, from which device, its start hour, when it arrived (shortly after the Drive ended, with the next point batch), when it was replaced (which suggests a Passenger drive) and when it was deleted. It never sees distances, speeds, positions or events. The privacy draft must say this when Drives ship.
- Epoch cleanup must also keep an Epoch while a stored Drive uses it. A Drive whose start Epoch is already deleted isn't uploaded to that Group.
- The record's layout is a versioned encrypted format. Changing it later needs an API compatibility level raise.
- Undoing a Passenger drive needs the full record, which only the recording device keeps. Other devices of the account can mark a Drive but not undo the mark.
