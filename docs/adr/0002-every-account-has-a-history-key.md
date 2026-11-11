---
status: accepted
---

# Every account has a History key

Every account gets History key v1 when its first device registers, with no Recovery escrow. The Recovery phrase becomes an optional escrow of the History key the account already has: setting one up seals an escrow for every existing version, like a Phrase change, instead of creating v1. Accounts created before this get v1 from the next device that runs a tracking reconcile, which then Backfills its History wraps and re-seals Personal data to it. This was decided as D6 in the OPE-190 plan (11 November 2026) and built in OPE-289.

Without it, an account with no phrase has nothing a new device could be given, so linking a new device by QR code (OPE-293) would only work for accounts with a phrase. That handover depends on this decision. It also moves Personal data off the Device key, which only one phone can read, for every account. ADR 0001 still holds: the History key stays random, and the phrase only derives the Recovery key.

## Considered options

- **Create the History key only when a phrase is set up.** This is what OPE-155 shipped. Accounts without a phrase keep their history and Personal data tied to one phone's Device key, and have no key to hand over.
- **Create the History key at sign-up and make the escrow optional.** This is the option we chose.

## Consequences

- An account without a phrase holds History key versions with no Recovery escrow. Restore never offers them, and the server only returns versions that have an escrow. Until QR linking ships, the key stays on the device that created it.
- Two devices of an account created before this can race to create v1. The server takes the first, and the other carries on with Device wraps and Personal data v2 until it gets the key.
- Setting up a phrase needs a device that holds every History key version. A device that lost the race, or a new device that hasn't been given the key, can't set one up.
- Epoch creation keeps requiring a History wrap for each member's current History key. Members whose accounts haven't got v1 yet have no current key, so they get no History wrap until they do.
