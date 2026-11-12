# Pausing location sharing

Account has a location sharing card. Pauses default to this device; the owner can choose all devices instead. The durations are 15 minutes, 1 hour, 8 hours, 24 hours, or until the owner resumes. Account → Devices also lets the owner manage an individual device from another phone.

A device pause applies in every group. An account pause overrides each device's preference, including devices added during the pause. Resuming an account never clears a device's own pause. Pausing leaves group access and encryption keys intact, so a tablet can stay at home and view other members without sharing its location.

## State and visibility

Both User and UserDevice store a pause flag, optional deadline, last change time, and monotonic revision. The shared resolver computes the effective preference. A deadline expires when server time reaches it; no scheduled database job is needed. The account query returns both preferences to the owner. Live tracking responses return the effective state of active devices to group members.

These controls are server-readable operational metadata, like device names and group membership. The server needs them to enforce upload and retrieval rules. Locations remain encrypted. The ribbon and person details disclose that sharing is paused, without showing a device's previous coordinates, battery reading, or location age. A member appears in Paused when all of their active devices are paused. Otherwise their sharing devices remain visible and the device list identifies the paused devices.

Each captured point's clientPointId includes the account and device revisions. Unchanged accounts and devices retain the original ID format. The server discards points with an obsolete revision or an active pause and acknowledges them separately, so the uploader removes them rather than retrying forever. This also discards unuploaded points from before a pause; already stored ciphertext is retained.

Uploads and pause changes lock the account row before other tracking work, so an upload cannot commit after a pause based on an obsolete preference. Live queries filter points using the current preference. Poll responses carry the last scanned cursor even if every scanned point was filtered out.

The map removes cached positions when a pause or revision change arrives. Older responses from another group cannot overwrite a newer revision. Decrypted points must match the current revision, and their capture time must be after the resume cutoff. Resuming therefore waits for a fresh fix rather than restoring a previous pin, including when a phone's clock was ahead before pausing.

## Android capture and offline behavior

The native capture runtime persists the effective state by account and server. It removes location callbacks during a pause and rejects fixes already being encrypted when the preference changes. The foreground notification says sharing is paused. Timed pauses use a native timer and an alarm that can run while the device is idle. Android may delay an alarm; capture resumes when Android delivers it. The service restores the preference and timer after restarting. While paused, it checks for remote preference changes every 30 seconds while awake and uses an idle-capable alarm for checks about every five minutes, subject to Android scheduling. This lets the owner resume a tablet from another phone without opening the tablet app.

The owner can stop capture locally even without a connection. Device and account requests are persisted separately and retried before applying remote state. Until confirmation, the UI explains that groups and other devices may not know about the pause. A failed resume leaves capture paused. A remote device may continue capturing until it receives the change, but the server rejects its obsolete revision, including uploads attempted after the account resumes.

An offline viewer cannot learn about a new pause until it reconnects. The app cannot erase a location someone has already received, copied, or recorded.

The native tracking implementation currently exists on Android. The Account controls and server visibility rules also apply when viewing on other platforms.

## Compatibility and validation

Compatibility level 4 requires both updated apps and an updated server. Older apps do not understand the changed clientPointId meaning, discarded uploads, or paused map state. Client version 1.9.0 and server version 0.9.0 include the change.

Tests cover preference composition and expiry, native capture revisions and cached fixes, offline retry and late responses, map cache removal, server authorization, delayed uploads, new devices during an account pause, and upload/pause races against PostgreSQL.
