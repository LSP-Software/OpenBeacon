---
status: accepted
---

# The History key is random and separate from the Recovery key

Group Epoch keys and Personal data are encrypted to a random, versioned History key. The Recovery phrase only derives a Recovery key, and that key only protects one Recovery escrow per History key version. We don't encrypt anything else to a key derived from the phrase, because the phrase is the one thing we never want users to have to replace. The terms are defined in the [encryption glossary](../contexts/encryption/CONTEXT.md). This decision was made in OPE-155.

## Considered options

- **Derive the History key from the phrase.** It's simpler, with one key and no escrow. But replacing the key would mean a new phrase: every device revocation, and every phrase that might have been seen, would force the user to write down new words and every History wrap to be redone.
- **Random History key, escrowed to a phrase-derived Recovery key.** This is the option we chose.
- **No phrase; hand the History key from one device to another.** Rejected for now. Until devices can be verified (OPE-213), the server decides which device receives it, so anyone who takes over the password could ask for the whole history.

## Why

- **Revocation without a new phrase.** A remaining Enrolled device can rotate the History key to a new version without the user writing down new words. Sealing the new version's escrow needs the Recovery private key, so the user enters their current phrase. OPE-167 adds this. Older Epochs stay under the version that wrapped them.
- **Phrase change without re-wrapping.** A Phrase change re-seals the escrows to the new Recovery key. History key IDs, public keys and versions don't change, so no History wrap or Personal data record is touched.
- **Restore without re-wrapping.** A Restore downloads the escrows, opens them and stores every version on the device. Epochs are then read on demand through their existing History wraps. No Epoch key is wrapped again and no tracking data is downloaded or re-encrypted.
- **The Recovery private key is short-lived.** It exists in memory only during setup, Restore, Phrase change and Recovery reset. Enrolled devices keep the History key, not the phrase.
- **Room for an identity key.** The Recovery key is derived with HKDF-SHA256 using the label `recovery-key`. The label `identity-signing-key` is reserved for the identity signing key in OPE-213, so adding that key later doesn't change anyone's phrase.
- **Phrases survive a server move.** The Recovery key derivation isn't bound to a user ID or server. A self-hoster who moves their database to a new server keeps the same phrase. (Escrows are bound to the user ID, so user IDs must be kept.)

## Consequences

- The server stores one Recovery escrow per History key version. Anyone who has both the phrase and the escrows can read the account's history, so the escrows are only served to the signed-in account.
- A History key shared across devices isn't per-device revocation. Until OPE-167 rotates it, a stolen Enrolled device can read every Epoch that has a History wrap for the versions it holds, including future ones.
- The server publishes History public keys. Until OPE-213 signs them with the identity key, a malicious server could substitute one and receive future History wraps. Restore detects a substituted escrow. Escrows are sealed with HPKE auth mode from the Recovery key to itself, so only someone with the phrase can make one, and the opened private key must match the published public key.
- A Recovery reset deletes every History key version, its escrow and its History wraps, and starts a new version one higher. Devices keep their keys for deleted versions. Those keys no longer open any History wrap, but they still open Personal data sealed to their version until a device re-seals it to the new one.
