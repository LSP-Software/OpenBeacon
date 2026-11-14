# Security policy

If you've found a security problem in OpenBeacon, please tell us privately so we can fix it before anyone can misuse it. **Don't open a public issue.**

## How to report

Either:

- use [GitHub private vulnerability reporting](https://github.com/LSP-Software/OpenBeacon/security/advisories/new), or
- use the [contact form on our website](https://openbeacon.net/contact).

## What to include

- What the problem is, and what someone could do with it.
- Steps to reproduce it, or a proof of concept.
- The app and server versions you tested, from Account › **About**.
- Whether you tested on our hosted server or your own.

## Scope

- The OpenBeacon Android app.
- The backend, the scheduled job runner and the map tiles service.
- Our hosted server at `api.openbeacon.net`.
- The encryption design described in [How encryption works](https://docs.openbeacon.net/docs/privacy-security/how-encryption-works).

Problems we already know about are listed in [Known limits](https://docs.openbeacon.net/docs/privacy-security/known-limits).

## Please don't

- Access, change or delete other people's data, or accounts you don't own.
- Run tests that could make the hosted server slow or unavailable, such as load or spam tests.
- Share the problem publicly before we've fixed it.

## What we'll do

We'll acknowledge your report, keep you updated while we work on it, and tell you when it's fixed. If you'd like, we'll credit you when we publish the fix.

See [Report a vulnerability](https://docs.openbeacon.net/docs/privacy-security/report-a-vulnerability) in the docs for the same guidance.
