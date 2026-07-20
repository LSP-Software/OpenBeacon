# Identity and Access

This context distinguishes the people represented in OpenBeacon from the methods they use to authenticate.

## Language

**User**:
A person represented in OpenBeacon, independent of how they authenticate.
_Avoid_: Account

**Authentication Identity**:
A provider-specific identity that authenticates a User. A User may have more than one Authentication Identity.
_Avoid_: User, login, account
