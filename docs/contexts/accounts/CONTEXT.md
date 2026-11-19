# Accounts

This context covers how an account owner proves who they are and how the server tells them about changes to their account by email.

## Language

**Email code**:
A 6-digit code the server emails to an account's address, which the owner types into the app to prove they can read that inbox. Each one has a single purpose: sign-up, email verification, password reset, Recovery reset, sign-in or turning on Sign-in codes.
_Avoid_: OTP, magic link, verification link, PIN

**Sign-in codes**:
An account setting that makes every password sign-in also need an Email code. The server checks the password first: it only emails a code when the password is right, and only checks a code sent with the right password, so someone who knows just the address can't use the code up. A sign-in from a session already linked to one of the account's Active devices (such as "Confirm it's you") needs no code, and signing in straight after a password reset uses the reset's code instead. Turning them on needs a recent sign-in and a code to prove the inbox works. Turning them off needs a recent sign-in. Neither signs any session out, and both send a Security alert, by email and as an Account Notice, that can't be switched off. Only password accounts on a server with email can turn them on. If the server's email is turned off later, those accounts can't sign in with their password until the operator runs `turn-off-sign-in-codes`.
_Avoid_: Two-factor, 2FA, MFA, OTP

**Session**:
One sign-in to an account. A Session is linked to a device when it registers that device as new, or when a session with no device proves the phone holds the device's Device key by opening a challenge sealed to it. A session linked to a device that hasn't been removed can't register another one. Naming a device in the device header never links it. A session with no device that names one gets `DEVICE_UNVERIFIED` for everything outside setup. A linked session that names a different device is refused as if that device were Pending or not registered. If the phone can't open the challenge, or the server refuses its proof with any 4xx error except a rate limit or `DEVICE_REMOVED`, the app signs out once and shows "Sign in again to keep using this phone." After a network failure, a 5xx error or a rate limit, it tries again after 10 seconds. After 5 failures in a row it tries once every 5 minutes, until the app returns to the foreground, is relaunched, signs in again or links successfully. Signing a session out ends its sign-in but doesn't remove the device from Devices. The server keeps a Session until it's signed out, its device is removed or deleted, the account is deleted, or it expires. The hourly scheduled job deletes expired Sessions, so one can stay up to about an hour after it expires.
_Avoid_: Login, device

**Device name**:
The name the owner gives a device, such as "Pixel 9" or "Car tablet". A new device is named after its model. It's stored in plain text, like a profile name, so group members and Security alerts can show it. It can't contain invisible formatting characters, such as bidi overrides or zero-width spaces. Every member of a group, from any signed-in session, can see the Device name and Device icon of each Active device of the group's members.
_Avoid_: Device label, nickname

**Device icon**:
One of a fixed set of pictures the owner picks for a device: phone and tablet variants, star, heart, flower or sun. A new device gets tablet if its model contains "iPad" or "Tab", and phone otherwise.
_Avoid_: Device type, avatar

**Removing a device**:
Taking a lost or stolen device off the account in Account → Devices. It needs a recent sign-in on an Active device. The server signs the device out, refuses its requests from then on, and leaves it out of new Epochs. The phone wipes its keys and data the next time it reaches the server. It's different from signing out, which keeps the device in Devices so it can sign in again. Removing a device can't take back anything it has already seen. Tapping "Not me" after scanning a Pending device's code removes it too, without a recent sign-in, because a Pending device can't see anything yet. So does "Cancel and remove this phone" on the Pending phone itself, which then wipes the phone.
_Avoid_: Revoking, deleting a device, unlinking

**Security alert**:
A message telling the owner that something important happened to their account: a new sign-in (sent when a Pending device registers), the password or Recovery phrase changed or reset, Sign-in codes turned on or off, other sessions signed out, a device removed, or account deletion scheduled. It's sent by email, as an Account Notice, or both. The owner can turn off each one for email and for phone in Account › Notifications; turning one off always sends the "alerts turned off" email naming it. The "account deleted" email and the Sign-in codes alerts, by email or phone, can't be turned off.
_Avoid_: Email alert, Always-on alert, Optional alert, Place Alert

**Account Notice**:
A Security alert kept on the server for the account's other phones, never the device that made the change. Every signed-in phone fetches it through an account-level sync, in a group or not, and writes the notification itself. A phone's first sync returns none and sets its starting point 15 seconds earlier. Later syncs return the Account Notices created from that point on, and never ones from before its session started. It's deleted 24 hours after it's created.
_Avoid_: Push, message

**Notification Setting**:
One Email or Phone switch for one message type in Account › Notifications. It's stored once per account, not per phone, and only once the owner changes it from its default.
_Avoid_: Preference, per-device setting

**Push wake-up**:
A Firebase Cloud Messaging message with no content that makes a phone fetch its Account Notices straight away and, if it's in a group, run its tracking upload to fetch new Place Alerts and group activity. Only a server with the `FCM_*` settings sends them, which means the hosted service. Self-hosted servers send none, and their phones get the same notifications on their next upload.
_Avoid_: Push notification
