# Accounts

This context covers how an account owner proves who they are and how the server tells them about changes to their account by email.

## Language

**Email code**:
A 6-digit code the server emails to an account's address, which the owner types into the app to prove they can read that inbox. Each one has a single purpose: sign-up, email verification, password reset or Recovery reset.
_Avoid_: OTP, magic link, verification link, PIN

**Session**:
One phone or tablet signed in to an account. Signing a session out ends its sign-in but doesn't remove the phone or tablet from Devices.
_Avoid_: Login, device

**Security alert**:
An email telling the owner that something important happened to their account, such as a password change, a new device or a deletion.
_Avoid_: Email alert, notice, notification, Place Alert

**Always-on alert**:
A Security alert the owner can't turn off: password changed or reset, Recovery phrase changed or reset, other sessions signed out, Security alerts turned off, and account deleted.
_Avoid_: Mandatory alert, required alert

**Optional alert**:
A Security alert the owner can turn off: new device added and account deletion scheduled.
_Avoid_: Opt-out alert, preference
