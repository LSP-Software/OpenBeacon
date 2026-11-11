# Accounts

This context covers how an account owner proves who they are and how the server tells them about changes to their account by email.

## Language

**Email code**:
A 6-digit code the server emails to an account's address, which the owner types into the app to prove they can read that inbox. Each one has a single purpose: sign-up, email verification, password reset or Recovery reset.
_Avoid_: OTP, magic link, verification link, PIN

**Session**:
One sign-in to an account. A Session is linked to a device when it registers that device as new, or when a session with no device proves the phone holds the device's Device key by opening a challenge sealed to it. Registering a new device moves the link to that device, even from another one. Naming a device in the device header never links it. A session with no device that names one gets `DEVICE_UNVERIFIED` for anything that needs a device. A linked session that names a different device is refused as if that device were Pending or not registered. If the server refuses a session's proof with any 4xx error except a rate limit or `DEVICE_REMOVED`, the app signs out and shows "Sign in again to keep using this phone." After a network failure, a 5xx error or a rate limit, it tries again after 10 seconds. Signing a session out ends its sign-in but doesn't remove the device from Devices. The server keeps a Session until it's signed out, its device is removed or deleted, or the account is deleted. A sign-in that expires without being used again stays until then.
_Avoid_: Login, device

**Device name**:
The name the owner gives a device, such as "Pixel 9" or "Car tablet". A new device is named after its model. It's stored in plain text, like a profile name, so group members and Security alerts can show it. It can't contain invisible formatting characters, such as bidi overrides or zero-width spaces. Every member of a group, from any signed-in session, can see the Device name and Device icon of each Active device of the group's members.
_Avoid_: Device label, nickname

**Device icon**:
One of a fixed set of pictures the owner picks for a device: phone, tablet, watch, car, laptop, bag, tag or home. A new device gets tablet if its model contains "iPad" or "Tab", and phone otherwise.
_Avoid_: Device type, avatar

**Removing a device**:
Taking a lost or stolen device off the account in Account → Devices. It needs a recent sign-in on an Active device. The server signs the device out, refuses its requests from then on, and leaves it out of new Epochs. The phone wipes its keys and data the next time it reaches the server. It's different from signing out, which keeps the device in Devices so it can sign in again. Removing a device can't take back anything it has already seen. Tapping "Not me" after scanning a Pending device's code removes it too, without a recent sign-in, because a Pending device can't see anything yet.
_Avoid_: Revoking, deleting a device, unlinking

**Security alert**:
An email telling the owner that something important happened to their account, such as a password change, a new sign-in or a deletion.
_Avoid_: Email alert, notice, notification, Place Alert

**Always-on alert**:
A Security alert the owner can't turn off: password changed or reset, Recovery phrase changed or reset, other sessions signed out, device removed, Security alerts turned off, and account deleted.
_Avoid_: Mandatory alert, required alert

**Optional alert**:
A Security alert the owner can turn off: new sign-in (sent when a Pending device registers) and account deletion scheduled.
_Avoid_: Opt-out alert, preference
