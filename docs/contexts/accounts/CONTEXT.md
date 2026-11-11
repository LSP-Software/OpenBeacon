# Accounts

This context covers how an account owner proves who they are and how the server tells them about changes to their account by email.

## Language

**Email code**:
A 6-digit code the server emails to an account's address, which the owner types into the app to prove they can read that inbox. Each one has a single purpose: sign-up, email verification, password reset or Recovery reset.
_Avoid_: OTP, magic link, verification link, PIN

**Session**:
One sign-in to an account. Each Session belongs to one device, which the app names on every request. Signing a session out ends its sign-in but doesn't remove the device from Devices.
_Avoid_: Login, device

**Device name**:
The name the owner gives a device, such as "Pixel 9" or "Car tablet". A new device is named after its model. It's stored in plain text, like a profile name, so group members and Security alerts can show it.
_Avoid_: Device label, nickname

**Device icon**:
One of a fixed set of pictures the owner picks for a device: phone, tablet, watch, car, laptop, bag, tag or home. A new device gets tablet if its model contains "iPad" or "Tab", and phone otherwise.
_Avoid_: Device type, avatar

**Security alert**:
An email telling the owner that something important happened to their account, such as a password change, a new device or a deletion.
_Avoid_: Email alert, notice, notification, Place Alert

**Always-on alert**:
A Security alert the owner can't turn off: password changed or reset, Recovery phrase changed or reset, other sessions signed out, Security alerts turned off, and account deleted.
_Avoid_: Mandatory alert, required alert

**Optional alert**:
A Security alert the owner can turn off: new device added and account deletion scheduled.
_Avoid_: Opt-out alert, preference
