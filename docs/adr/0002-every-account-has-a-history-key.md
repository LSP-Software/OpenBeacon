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

- An account without a phrase holds History key versions with no Recovery escrow. Restore never offers them, and the server only returns versions that have an escrow. A Device link (below) is the only way such a version reaches another device.
- Two devices of an account created before this can race to create v1. The server takes the first, and the other carries on with Device wraps and Personal data v2 until it gets the key.
- Setting up a phrase needs a device that holds every History key version. A device that lost the race, or a new device that hasn't been given the key, can't set one up.
- Epoch creation keeps requiring a History wrap for each member's current History key. Members whose accounts haven't got v1 yet have no current key, so they get no History wrap until they do.

## Handing the History key to a new device (OPE-293)

A new device gets every History key version through a **Device link**. The new device shows a QR code, `openbeacon-link:1:<linkId>:<devicePublicKey>:<psk>`, where `psk` is 32 random bytes that never leave the two phones. An Active device of the same account scans it. It checks that the Device key the server has registered for the new device is the one in the QR code, then seals `{ v: 1, historyKeys: [{ version, privateKey }] }` with HPKE AuthPSK (mode 0x03): the sender is its own Device key, the PSK is `psk` with PSK id `openbeacon.device-link.v1`, and the info is `["openbeacon.device-link.v1", userId, linkId, newDeviceId]`. The server stores the ciphertext on the `DeviceLink` row and activates the new device with `activatedBy = link`. The new device opens it, checks every private key against the published History public key for its version, and stores them.

ADR 0001 rejected a device-to-device handover because the server chose the receiving device. With a Device link it doesn't: the approving phone only encrypts to the key in the QR code, which the user carried from one screen to the other, and refuses if the server's record for that link names a different key. The PSK proves the sender saw that exact QR code, so the server can't make a handover of its own for the new device to accept, and auth mode ties the handover to a Device key of the account.

What this doesn't cover:

- The new device trusts the server for the approver's public key until devices can be verified (OPE-213). A server that swapped it could only hand over keys that still have to match the published History public keys, and it can't learn the PSK.
- The server activates the new device when the handover is stored, before the new device has opened it. If the new device rejects it, it's active without the History key, and the user can Restore with their phrase.
- A Device link doesn't rotate anything. The new device can read every Epoch that has a History wrap for the versions it receives.
