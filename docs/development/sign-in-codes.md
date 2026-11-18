# Sign-in codes

An account with sign-in codes on needs a code from its email for every password sign-in that doesn't come from a session linked to one of its Active devices. The server checks the password first. With no code in the `x-openbeacon-sign-in-code` header, a right password emails a code and answers `SIGN_IN_CODE_REQUIRED`. The app then sends the password again with the code in that header. A wrong code answers `INVALID_CODE` and sends no new code. Because a code is only checked after the right password, someone who only knows the address can't use up the owner's code or their daily wrong-guess allowance.

## Turning codes off for someone

If a server's email is turned off, or the owner has lost access to their inbox, accounts with codes on can't sign in with their password. The operator can turn codes off for one account:

- Locally, with the root `.env`: `bun --env-file=../../.env run --cwd apps/scheduled-jobs turn-off-sign-in-codes <email>`.
- In a configured deployment, such as the scheduled job runner container: `bun run --cwd apps/scheduled-jobs turn-off-sign-in-codes <email>`. With the self-host Compose file that's `docker compose exec scheduled-jobs bun run --cwd apps/scheduled-jobs turn-off-sign-in-codes <email>`.

The email is matched exactly after trimming and lowercasing. The command signs no one out. It always stores a "sign-in codes turned off" Account Notice for the account's phones, and when the runner has email configured, the owner also gets the email. It exits with 1 on a usage error or a database failure, and with 0 otherwise, including when no account with that email has codes on.

Only turn codes off after confirming the request came from the account's owner. Anyone who knows the password can sign in once codes are off.
