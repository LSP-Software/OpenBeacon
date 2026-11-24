# Context Map

## Contexts

- [Places](./docs/contexts/places/CONTEXT.md) — group-shared Places, Place Transitions, Place Alerts, and mutes
- [Accounts](./docs/contexts/accounts/CONTEXT.md) — Email codes, Security alerts, Sessions, Device names and icons, and Removing a device
- [Encryption](./docs/contexts/encryption/CONTEXT.md) — Epoch keys, Device wraps and History wraps, the Recovery phrase and History key, Personal data, Active and Pending devices, Device links and Session links
- [Drives](./docs/contexts/drives/CONTEXT.md) — Drives and Drive detection

## Relationships

- **Accounts → Encryption**: with email on, a Recovery reset needs an Email code, and a Phrase change or Recovery reset sends a Security alert. Removing a device sends a Security alert. When a Pending device registers, the server sends the new sign-in Security alert.
- **Accounts ↔ Places**: a Security alert is an email to the account owner; a Place Alert is a notification about another Group member. They are separate.
