# Context Map

## Contexts

- [Places](./docs/contexts/places/CONTEXT.md) — group-shared Places, Place Transitions, Place Alerts, and mutes
- [Accounts](./docs/contexts/accounts/CONTEXT.md) — Email codes and Security alerts
- [Encryption](./docs/contexts/encryption/CONTEXT.md) — Epoch keys, Device wraps and History wraps, the Recovery phrase and History key, and Personal data

## Relationships

- **Accounts → Encryption**: with email on, a Recovery reset needs an Email code, and a Phrase change or Recovery reset sends an Always-on alert.
- **Accounts ↔ Places**: a Security alert is an email to the account owner; a Place Alert is a notification about another Group member. They are separate.
