# Encryption

This context covers the keys that keep group locations and personal data unreadable to the server, and how an account gets them back on a new phone. It spans the encryption package, the API and the mobile app.

## Language

### Group keys

**Epoch**:
One generation of a Group's encryption key. A new Epoch starts when the Group is created, someone joins or leaves, or a rotation is due.
_Avoid_: Key version, generation, session

**Epoch key**:
The symmetric key of one Epoch. It encrypts the Group's tracking data for that Epoch.
_Avoid_: Group key, shared key

**Device key**:
A key pair created on one device for one account. Its private half never leaves that device.
_Avoid_: Account key, user key, identity key

**Device wrap**:
An Epoch key encrypted to one Device key.
_Avoid_: Wrapped key, recipient key, device envelope

**History wrap**:
An Epoch key encrypted to one account's History key, for one History key version.
_Avoid_: Account wrap, backup wrap, recovery wrap

### Recovery

**Recovery phrase**:
The 12 words a user writes down to get their History key onto a new device. It's never stored or sent anywhere.
_Avoid_: Seed phrase, mnemonic, recovery code, backup code, password

**Recovery key**:
The key pair derived from the Recovery phrase. It only protects Recovery escrows.
_Avoid_: Account key, master key, seed key

**History key**:
A random key pair per account that protects History wraps and personal data. An account can hold several numbered versions; the highest is the current one.
_Avoid_: Account key, account private key, recovery key, archive key

**Recovery escrow**:
One History key version's private key encrypted to the Recovery key and stored on the server.
_Avoid_: Backup, key backup, escrowed key, recovery blob

**Enrolled device**:
A device that holds the account's current History key.
_Avoid_: Trusted device, approved device, verified device, primary device

**Backfill**:
An Enrolled device adding History wraps, to the current History key it holds, for Epochs it can already read through its Device wraps.
_Avoid_: Sync, migration, re-wrap

**Restore**:
Getting every History key version onto a device by entering the Recovery phrase.
_Avoid_: Recover, import, sync

**Phrase change**:
Replacing the Recovery phrase from an Enrolled device. The History key versions stay the same.
_Avoid_: Rotation, re-key, reset

**Recovery reset**:
Replacing the Recovery phrase when it's lost and no Enrolled device is left. It deletes every History key version and starts a new one.
_Avoid_: Start over, wipe, phrase change

### Personal data

**Personal data**:
A user's nicknames for other members and their own group colours. Only that user can read it.
_Avoid_: Private data, profile data, settings

## Notes

- User-facing text says "phone" (or "device") for a device and "the group's encryption key" for an Epoch key.
- "Identity key" is reserved for the phrase-derived signing key planned in OPE-213. Don't use it for Device keys or the Recovery key.
- See [ADR 0001](../../adr/0001-random-history-key-separate-from-recovery-key.md) for why the History key is random rather than derived from the Recovery phrase.
